import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, GENERABLE_FIXTURE_IDS } from '@uml/fixtures';
import { buildGenerationIr } from '@uml/generation-ir';
import { generateMobileProject, GENERATED_BACKEND_VERSION } from '@uml/generator-backend';
import {
  buildSampleRecords,
  firstMutableAttribute,
  modifiedValue,
} from '../shared/generator-backend/tests/support/sample-data.js';
import {
  freePort,
  mavenCommand,
  publishedPort,
  removeVerifiedTemporaryDirectory,
  runCommand,
  startApplication,
  stopApplication,
  waitForPostgres,
  writeProject,
  type RunningApplication,
} from '../shared/generator-backend/tests/support/runtime.js';

// No AI provider, model runtime or inference is involved in this regression bank.
const selected = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
for (const fixtureId of selected.length ? selected : GENERABLE_FIXTURE_IDS) {
  const sample = fixture(fixtureId);
  const model = process.argv.includes('--numeric-keys')
    ? {
        ...sample.model,
        classes: sample.model.classes.map((entity) => ({
          ...entity,
          attributes: entity.attributes.map((a) =>
            a.primaryKey ? { ...a, type: 'Integer' as const } : a,
          ),
        })),
      }
    : sample.model;
  const project = await generateMobileProject(
    buildGenerationIr({ projectName: sample.title, snapshotVersion: 1, model }),
  );
  const work = await mkdtemp(join(tmpdir(), 'uml-generated-management-'));
  const container = `uml-management-${randomUUID()}`;
  let app: RunningApplication | undefined;
  let databaseStarted = false;
  try {
    process.stdout.write(
      `${fixtureId} ${sample.title}: compilando ${project.ir.entities.length} entidades...\n`,
    );
    await writeProject(
      work,
      project.files
        .filter((f) => f.path.startsWith('backend/'))
        .map((f) => ({ ...f, path: f.path.slice(8) })),
    );
    await runCommand(mavenCommand(), ['-q', '-DskipTests', 'package'], { cwd: work });
    await runCommand('docker', [
      'run',
      '-d',
      '--name',
      container,
      '-e',
      'POSTGRES_DB=gestion',
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-p',
      '127.0.0.1::5432',
      'postgres:17-alpine',
    ]);
    databaseStarted = true;
    await waitForPostgres(container);
    const port = await freePort();
    const password = randomBytes(20).toString('hex');
    app = await startApplication(
      join(work, 'target', `${project.ir.project.artifactId}-${GENERATED_BACKEND_VERSION}.jar`),
      port,
      await publishedPort(container),
      'gestion',
      {
        AUTH_USERNAME: 'admin',
        AUTH_PASSWORD: password,
        AUTH_TOKEN_SECRET: randomBytes(32).toString('hex'),
      },
    );
    const baseUrl = `http://127.0.0.1:${port}`;
    let token = '';
    async function request(path: string, method = 'GET', body?: object): Promise<unknown> {
      const response = await fetch(baseUrl + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      assert.equal(
        response.status,
        200,
        `${fixtureId} ${method} ${path}: ${response.status} ${text}`,
      );
      return JSON.parse(text) as unknown;
    }
    token = (
      (await request('/session/login', 'POST', { username: 'admin', password })) as {
        accessToken: string;
      }
    ).accessToken;
    const contract = (await request('/mobile-contract')) as {
      protocolVersion: number;
      contract: unknown;
    };
    assert.equal(contract.protocolVersion, 1);
    assert.deepEqual(
      contract.contract,
      JSON.parse(project.files.find((f) => f.path === 'mobile/assets/contract.json')!.content),
    );
    const records = buildSampleRecords(project.ir);
    for (const record of records) {
      const resource = record.entity.resourcePath;
      const operation = {
        operationId: randomUUID(),
        resource,
        method: 'POST',
        id: record.body[record.entity.primaryKey.fieldName],
        data: record.body,
        base: null,
      };
      const result = (await request('/mobile-sync', 'POST', operation)) as {
        data: Record<string, unknown>;
      };
      assert.deepEqual(
        await request('/mobile-sync', 'POST', operation),
        result,
        'El reintento debe recuperar el recibo',
      );
      const dto = (await request(`/api/${resource}/${encodeURIComponent(record.id)}`)) as Record<
        string,
        unknown
      >;
      assert.deepEqual(dto, result.data);
      assert.deepEqual(dto, record.body, 'Tipos, atributos y referencias deben conservarse');
      const list = (await request(`/api/${resource}`)) as Record<string, unknown>[];
      assert.ok(list.some((row) => String(row[record.entity.primaryKey.fieldName]) === record.id));
      const field = firstMutableAttribute(record.entity);
      if (field) {
        const data = { ...dto, [field.fieldName]: modifiedValue(field) };
        await request('/mobile-sync', 'POST', {
          operationId: randomUUID(),
          resource,
          method: 'PUT',
          id: operation.id,
          data,
          base: dto,
        });
        const changed = (await request(
          `/api/${resource}/${encodeURIComponent(record.id)}`,
        )) as Record<string, unknown>;
        assert.deepEqual(changed, data);
      }
    }
    for (const record of [...records].reverse()) {
      const resource = record.entity.resourcePath;
      // Fetch current DTO in case another operation affected an inherited view.
      const dto = await request(`/api/${resource}/${encodeURIComponent(record.id)}`);
      const operation = {
        operationId: randomUUID(),
        resource,
        method: 'DELETE',
        id: record.body[record.entity.primaryKey.fieldName],
        data: null,
        base: dto,
      };
      const result = await request('/mobile-sync', 'POST', operation);
      assert.deepEqual(await request('/mobile-sync', 'POST', operation), result);
      const absent = await fetch(`${baseUrl}/api/${resource}/${encodeURIComponent(record.id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(absent.status, 404);
    }
    process.stdout.write(
      `OK ${fixtureId}: contrato Flutter, CRUD, relaciones y reintentos (${records.length} recursos).\n`,
    );
  } finally {
    if (app) await stopApplication(app);
    if (databaseStarted)
      await runCommand('docker', ['rm', '-f', container], { allowFailure: true });
    await removeVerifiedTemporaryDirectory(work);
  }
}
