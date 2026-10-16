import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERABLE_FIXTURE_IDS, fixture } from '@uml/fixtures';
import { buildGenerationIr } from '@uml/generation-ir';
import { verifyPostman } from './support/postman.js';
import { GENERATED_BACKEND_VERSION, generateSpringProjectFiles } from '@uml/generator-backend';
import {
  POSTGRES_IMAGE,
  TEMP_PREFIX,
  deleteResource,
  freePort,
  mavenCommand,
  post,
  publishedPort,
  removeVerifiedTemporaryDirectory,
  report,
  requestJson,
  runCommand,
  startApplication,
  stopApplication,
  waitForPostgres,
  writeProject,
  type RunningApplication,
} from './support/runtime.js';
import {
  buildSampleRecords,
  descendantsOf,
  firstMutableAttribute,
  modifiedValue,
} from './support/sample-data.js';

/**
 * Definition of Done del generador (plan maestro 15.1), sobre el banco entero.
 *
 * La compilacion exitosa por si sola no significa que el generador funciona. El
 * ciclo de serializacion, la violacion de clave foranea, el error sin traducir y
 * el borrado accidental del esquema **solo aparecen ejecutando**.
 *
 *   npm run test:generated   solo T01, en cada cambio (RNF-13)
 *   npm run test:bank        el banco completo, en la rama principal
 */

const objetivos = process.argv.slice(2).filter((argumento) => !argumento.startsWith('-'));
const seleccionados = objetivos.length > 0 ? objetivos : [...GENERABLE_FIXTURE_IDS];

async function main(): Promise<void> {
  const fallidos: string[] = [];

  for (const fixtureId of seleccionados) {
    report(`\n═══ ${fixtureId} ═══`);
    try {
      await verificarModelo(fixtureId);
      report(`   ✓ ${fixtureId} completo`);
    } catch (error) {
      fallidos.push(fixtureId);
      // Con la traza: un aserto sin mensaje no dice nada, y el banco corre en
      // integracion continua donde nadie puede reproducirlo a mano.
      const causa = error as Error;
      report(`   x ${fixtureId}: ${causa.message}`);
      report((causa.stack ?? '').split(/\r?\n/).slice(1, 5).join('\n'));
    }
  }

  assert.deepEqual(fallidos, [], `Modelos que no pasaron la DoD: ${fallidos.join(', ')}`);
  report(`\nBanco verificado sobre ${seleccionados.length} modelo(s).`);
}

async function verificarModelo(fixtureId: string): Promise<void> {
  const item = fixture(fixtureId);
  const workDirectory = await mkdtemp(join(tmpdir(), `${TEMP_PREFIX}${fixtureId.toLowerCase()}-`));
  const containerName = `uml-generated-${fixtureId.toLowerCase()}-${randomUUID()}`;
  let application: RunningApplication | undefined;

  try {
    report('1/8 Generando...');
    const ir = buildGenerationIr({
      projectName: item.title,
      snapshotVersion: 1,
      model: process.argv.includes('--numeric-keys')
        ? {
            ...item.model,
            classes: item.model.classes.map((c) => ({
              ...c,
              attributes: c.attributes.map((a) =>
                a.primaryKey ? { ...a, type: 'Integer' as const } : a,
              ),
            })),
          }
        : item.model,
    });
    const files = await generateSpringProjectFiles(ir);
    await writeProject(workDirectory, files);
    await runCommand(
      'docker',
      ['compose', '--file', 'compose.yaml', '--env-file', '.env.example', 'config', '--quiet'],
      { cwd: workDirectory },
    );

    report('2/8 Compilando con Maven y Java 21...');
    await runCommand(mavenCommand(), ['-q', '-DskipTests', 'package'], { cwd: workDirectory });
    const jar = join(
      workDirectory,
      'target',
      `${ir.project.artifactId}-${GENERATED_BACKEND_VERSION}.jar`,
    );

    report('3/8 Iniciando PostgreSQL limpio...');
    await runCommand('docker', [
      'run',
      '--detach',
      '--name',
      containerName,
      '--env',
      `POSTGRES_DB=${ir.project.databaseName}`,
      '--env',
      'POSTGRES_USER=postgres',
      '--env',
      'POSTGRES_PASSWORD=postgres',
      '--publish',
      '127.0.0.1::5432',
      POSTGRES_IMAGE,
    ]);
    await waitForPostgres(containerName);
    const databasePort = await publishedPort(containerName);
    const applicationPort = await freePort();

    report('4/8 Arrancando y comprobando el contrato OpenAPI...');
    application = await startApplication(
      jar,
      applicationPort,
      databasePort,
      ir.project.databaseName,
    );
    const baseUrl = `http://127.0.0.1:${applicationPort}`;
    const openApi = (await requestJson(`${baseUrl}/v3/api-docs`, { expectedStatus: 200 })) as {
      paths?: Record<string, unknown>;
    };
    for (const entity of ir.entities) {
      assert.ok(
        openApi.paths?.[`/api/${entity.resourcePath}`] !== undefined,
        `El contrato no expone /api/${entity.resourcePath}`,
      );
    }

    report('5/8 Altas en orden topologico, consultas, modificacion e idempotencia...');
    await verifyPostman(
      baseUrl,
      files.find((file) => file.path === 'postman/collection.json')!.content,
    );
    const registros = await ejecutarCrud(baseUrl, ir);

    report('6/8 Reiniciando y comprobando que los datos siguen ahi...');
    await stopApplication(application);
    application = await startApplication(
      jar,
      applicationPort,
      databasePort,
      ir.project.databaseName,
    );
    for (const registro of registros) {
      await requestJson(`${baseUrl}/api/${registro.entity.resourcePath}/${registro.id}`, {
        expectedStatus: 200,
      });
    }

    report('7/8 Comprobando el 409 al borrar un padre con hijos...');
    await comprobarIntegridad(baseUrl, registros);

    report('8/8 Borrando en orden inverso...');
    for (const registro of [...registros].reverse()) {
      await deleteResource(baseUrl, registro.entity.resourcePath, registro.id);
    }
  } finally {
    if (application !== undefined) await stopApplication(application);
    await runCommand('docker', ['rm', '--force', containerName], { allowFailure: true });
    await removeVerifiedTemporaryDirectory(workDirectory);
  }
}

async function ejecutarCrud(
  baseUrl: string,
  ir: ReturnType<typeof buildGenerationIr>,
): Promise<ReturnType<typeof buildSampleRecords>> {
  const registros = buildSampleRecords(ir);

  // RTM-10: entidad no encontrada devuelve 404, no un error de servidor.
  const primera = registros[0];
  assert.ok(primera !== undefined, 'El modelo no tiene ninguna entidad.');
  const invalidId = (await requestJson(
    `${baseUrl}/api/${primera.entity.resourcePath}/no-es-un-uuid`,
    { expectedStatus: 400 },
  )) as { fieldErrors: object };
  assert.deepEqual(invalidId.fieldErrors, {});
  await requestJson(
    `${baseUrl}/api/${primera.entity.resourcePath}/${primera.entity.primaryKey.conceptualType === 'UUID' ? '99999999-9999-4999-8999-999999999999' : '2147483000'}`,
    { expectedStatus: 404 },
  );

  for (const registro of registros) {
    await post(baseUrl, registro.entity.resourcePath, registro.body);
  }
  await requestJson(`${baseUrl}/api/${primera.entity.resourcePath}/${primera.id}`, {
    method: 'PUT',
    body: { ...primera.body, [primera.entity.primaryKey.fieldName]: randomUUID() },
    expectedStatus: 400,
  });
  const requiredString = primera.entity.attributes.find(
    (a) => !a.primaryKey && !a.nullable && a.conceptualType === 'String',
  );
  if (requiredString) {
    const invalid = (await requestJson(`${baseUrl}/api/${primera.entity.resourcePath}`, {
      method: 'POST',
      body: { ...primera.body, [requiredString.fieldName]: '' },
      expectedStatus: 400,
    })) as { fieldErrors: Record<string, string> };
    assert.ok(invalid.fieldErrors[requiredString.fieldName]);
  }

  // RTM-11: repetir el alta con el mismo identificador devuelve el existente.
  // Es lo que hace seguro el reintento de la cola de sincronizacion (CA-10.1).
  const repetido = (await requestJson(`${baseUrl}/api/${primera.entity.resourcePath}`, {
    method: 'POST',
    body: primera.body,
    expectedStatus: 201,
  })) as Record<string, unknown>;
  assert.equal(String(repetido[primera.entity.primaryKey.fieldName]), primera.id);

  for (const registro of registros) {
    // Una entidad con subclases responde tambien por las filas de sus hijas.
    const familia = new Set([
      registro.entity.sourceClassId,
      ...descendantsOf(ir, registro.entity).map((entity) => entity.sourceClassId),
    ]);

    const coleccion = (await requestJson(`${baseUrl}/api/${registro.entity.resourcePath}`, {
      expectedStatus: 200,
    })) as unknown[];
    assert.equal(
      coleccion.length,
      familia.size,
      `${registro.entity.className}: la coleccion no trae ${familia.size}`,
    );

    await requestJson(`${baseUrl}/api/${registro.entity.resourcePath}/${registro.id}`, {
      expectedStatus: 200,
    });

    // La compensacion de RTM-05: sin estos finders no habria forma de consultar
    // los hijos de un padre, que es justo lo que la app movil necesita.
    for (const relacion of registro.entity.relationships) {
      const valor = registro.body[relacion.queryParameterName];
      if (typeof valor !== 'string' && typeof valor !== 'number') continue;

      // Una clave foranea heredada la comparten la superclase y sus hijas, y el
      // finder de la superclase las devuelve todas.
      const esperados = registros.filter(
        (otro) =>
          familia.has(otro.entity.sourceClassId) &&
          otro.body[relacion.queryParameterName] === valor,
      ).length;

      const porClaveForanea = (await requestJson(
        `${baseUrl}/api/${registro.entity.resourcePath}?${relacion.queryParameterName}=${encodeURIComponent(valor)}`,
        { expectedStatus: 200 },
      )) as unknown[];
      assert.equal(
        porClaveForanea.length,
        esperados,
        `${registro.entity.className}.${relacion.queryParameterName}: el finder no trajo ${esperados}`,
      );
    }

    const mutable = firstMutableAttribute(registro.entity);
    if (mutable === undefined) continue;

    const nuevoValor = modifiedValue(mutable);
    const actualizado = (await requestJson(
      `${baseUrl}/api/${registro.entity.resourcePath}/${registro.id}`,
      {
        method: 'PUT',
        body: { ...registro.body, [mutable.fieldName]: nuevoValor },
        expectedStatus: 200,
      },
    )) as Record<string, unknown>;
    assert.equal(actualizado[mutable.fieldName], nuevoValor);
  }

  return registros;
}

/**
 * Borrar un padre con hijos devuelve 409.
 *
 * Es un caso de exito, no un fallo: la integridad referencial es restrictiva y
 * sin cascada, y RTM-10 exige que la violacion se traduzca en lugar de salir
 * como error de servidor.
 */
async function comprobarIntegridad(
  baseUrl: string,
  registros: ReturnType<typeof buildSampleRecords>,
): Promise<void> {
  const referenciados = new Set(
    registros.flatMap((registro) =>
      registro.entity.relationships
        .map((relacion) => relacion.targetEntityId)
        .filter((id) => id !== registro.entity.sourceClassId),
    ),
  );

  let comprobados = 0;
  for (const registro of registros) {
    if (!referenciados.has(registro.entity.sourceClassId)) continue;

    await requestJson(`${baseUrl}/api/${registro.entity.resourcePath}/${registro.id}`, {
      method: 'DELETE',
      expectedStatus: 409,
    });
    comprobados += 1;
  }

  assert.ok(comprobados > 0, 'Ningun registro tenia hijos: la prueba del 409 no comprobo nada.');
}

await main();
