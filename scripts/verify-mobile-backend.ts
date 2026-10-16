import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '@uml/fixtures';
import { buildGenerationIr } from '@uml/generation-ir';
import { generateMobileProject } from '@uml/generator-backend';
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

const work = await mkdtemp(join(tmpdir(), 'uml-generated-mobile-'));
const container = `uml-mobile-test-${randomUUID()}`;
let running: RunningApplication | undefined;
try {
  const project = await generateMobileProject(
    buildGenerationIr({ projectName: 'Ventas', snapshotVersion: 1, model: fixture('T01').model }),
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
    'POSTGRES_DB=ventas',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-p',
    '127.0.0.1::5432',
    'postgres:17-alpine',
  ]);
  await waitForPostgres(container);
  const port = await freePort();
  const dbport = await publishedPort(container);
  const password = randomBytes(20).toString('hex');
  const auth = {
    AUTH_USERNAME: 'admin',
    AUTH_PASSWORD: password,
    AUTH_TOKEN_SECRET: randomBytes(32).toString('hex'),
    CORS_ALLOWED_ORIGINS: 'https://frontend.example.test',
  };
  const jar = join(work, 'target', 'ventas-0.0.1-SNAPSHOT.jar');
  running = await startApplication(jar, port, dbport, 'ventas', auth);
  const url = `http://127.0.0.1:${port}`;
  let token = '';
  async function request(
    path: string,
    method = 'GET',
    body?: object,
    expected = 200,
    authorize = true,
  ) {
    const response = await fetch(url + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(authorize && token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${text}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }
  const resource = project.ir.entities.find((e) => e.className === 'Cliente')!;
  const path = `/api/${resource.resourcePath}`;
  for (const [corsPath, method] of [
    [path, 'PUT'],
    ['/session/login', 'POST'],
    ['/session/refresh', 'POST'],
    ['/session/logout', 'POST'],
    ['/mobile-contract', 'GET'],
    ['/mobile-sync', 'POST'],
  ]) {
    const preflight = await fetch(url + corsPath, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://frontend.example.test',
        'Access-Control-Request-Method': method!,
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(preflight.status, 200);
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      'https://frontend.example.test',
    );
    const denied = await fetch(url + corsPath, {
      method: 'OPTIONS',
      headers: { Origin: 'https://other.example.test', 'Access-Control-Request-Method': method! },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  await request('/mobile-contract', 'GET', undefined, 401, false);
  await request(path, 'GET', undefined, 401, false);
  await request(
    '/session/login',
    'POST',
    { username: 'admin', password: 'incorrecta' },
    401,
    false,
  );
  const login = await request(
    '/session/login',
    'POST',
    { username: 'admin', password },
    200,
    false,
  );
  token = login['accessToken'] as string;
  const refreshToken = login['refreshToken'] as string;
  assert.match(refreshToken, /^[0-9a-f]{64}$/);
  const contract = await request('/mobile-contract');
  assert.equal(contract['protocolVersion'], 1);
  assert.deepEqual(
    contract['contract'],
    JSON.parse(project.files.find((f) => f.path === 'mobile/assets/contract.json')!.content),
  );
  const id = randomUUID();
  const data = { id, nombre: 'Ana', correo: 'ana@example.com', telefono: null };
  const change = {
    operationId: randomUUID(),
    resource: resource.resourcePath,
    method: 'POST',
    id,
    data,
    base: null,
  };
  const first = await request('/mobile-sync', 'POST', change);
  assert.deepEqual(await request('/mobile-sync', 'POST', change), first);
  await request('/mobile-sync', 'POST', { ...change, data: { ...data, nombre: 'otro' } }, 409);
  await request(
    '/mobile-sync',
    'POST',
    { ...change, operationId: randomUUID(), id: randomUUID() },
    400,
  );
  await stopApplication(running);
  running = await startApplication(jar, port, dbport, 'ventas', auth);
  for (let retry = 0; retry < 2; retry++) {
    const refreshed = await request('/session/refresh', 'POST', { refreshToken }, 200, false);
    assert.equal(refreshed['refreshToken'], refreshToken);
    assert.equal(refreshed['username'], 'admin');
    token = refreshed['accessToken'] as string;
  }
  assert.deepEqual(
    await request('/mobile-sync', 'POST', change),
    first,
    'recibo persistido tras reinicio',
  );
  const update = {
    operationId: randomUUID(),
    resource: resource.resourcePath,
    method: 'PUT',
    id,
    data: { ...data, nombre: 'Nueva' },
    base: first['data'],
  };
  const attempts = await Promise.all([
    request('/mobile-sync', 'POST', update),
    request('/mobile-sync', 'POST', update),
  ]);
  assert.deepEqual(attempts[0], attempts[1]);
  await request(
    '/mobile-sync',
    'POST',
    { ...update, operationId: randomUUID(), data: { ...data, nombre: 'Obsoleta' } },
    409,
  );
  const current = await request(`${path}/${id}`);
  assert.equal(current['nombre'], 'Nueva');
  const deletion = {
    operationId: randomUUID(),
    resource: resource.resourcePath,
    method: 'DELETE',
    id,
    data: null,
    base: current,
  };
  await request('/mobile-sync', 'POST', deletion);
  await request('/mobile-sync', 'POST', deletion);
  await request(`${path}/${id}`, 'GET', undefined, 404);
  const otherDevice = await request(
    '/session/login',
    'POST',
    { username: 'admin', password },
    200,
    false,
  );
  assert.notEqual(otherDevice['refreshToken'], refreshToken);
  await request('/session/logout', 'POST', { refreshToken }, 204, false);
  await request('/session/logout', 'POST', { refreshToken }, 204, false);
  await request(path, 'GET', undefined, 401);
  await request('/session/refresh', 'POST', { refreshToken }, 401, false);
  token = otherDevice['accessToken'] as string;
  await request(path);
  await stopApplication(running);
  running = await startApplication(jar, port, dbport, 'ventas', {
    ...auth,
    AUTH_PASSWORD: 'admin',
  });
  await request(path, 'GET', undefined, 401);
  await request(
    '/session/refresh',
    'POST',
    { refreshToken: otherDevice['refreshToken'] },
    401,
    false,
  );
  const seeded = await request(
    '/session/login',
    'POST',
    { username: 'admin', password: 'admin' },
    200,
    false,
  );
  token = seeded['accessToken'] as string;
  await request(path);
  process.stdout.write(
    'Spring movil: semilla admin/admin, renovacion persistente, revocacion por dispositivo y cambio de clave, CORS, CRUD, reintentos, reinicio y conflictos aprobados.',
  );
} finally {
  if (running) await stopApplication(running);
  await runCommand('docker', ['rm', '-f', container], { allowFailure: true });
  await removeVerifiedTemporaryDirectory(work);
}
