import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * PostgreSQL efimero para las pruebas de integracion de la API.
 *
 * Se levanta un contenedor por ejecucion y se destruye al terminar. Es la misma
 * estrategia que usa la verificacion del backend generado, y por la misma razon:
 * probar la autorizacion y las membresias contra una base de mentira no prueba
 * nada — las restricciones de unicidad, las cascadas y las claves compuestas
 * solo existen de verdad en PostgreSQL.
 *
 * Estas pruebas viven fuera de `npm test` a proposito. El bucle rapido del
 * nucleo de dominio no debe depender de Docker (RNF-15).
 */

const IMAGE = 'postgres:17-alpine';
const READY_TIMEOUT_MS = 60_000;

export interface EphemeralDatabase {
  readonly url: string;
  stop(): Promise<void>;
}

export async function startEphemeralDatabase(): Promise<EphemeralDatabase> {
  const name = `uml-api-test-${randomUUID()}`;
  const port = await freePort();
  const password = randomUUID();

  await run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    'POSTGRES_USER=uml_test',
    '--env',
    'POSTGRES_DB=uml_test',
    '--publish',
    `127.0.0.1:${port}:5432`,
    IMAGE,
  ]);

  const url = `postgresql://uml_test:${password}@127.0.0.1:${port}/uml_test`;

  try {
    await waitUntilReady(name);
    // `migrate deploy` aplica las migraciones versionadas tal cual, sin
    // proponer cambios: es exactamente lo que corre en produccion, asi que la
    // prueba comprueba las mismas migraciones que se van a desplegar.
    await migrateWithRetry(url);
  } catch (error) {
    await run('docker', ['rm', '--force', name]).catch(() => undefined);
    throw error;
  }

  return {
    url,
    async stop() {
      await run('docker', ['rm', '--force', name]).catch(() => undefined);
    },
  };
}

/**
 * `pg_isready` puede responder durante los últimos instantes del arranque en
 * que el motor de esquema de Prisma todavía recibe un cierre de conexión. Es
 * transitorio y ocurría aproximadamente una vez al ejecutar todas las suites.
 */
async function migrateWithRetry(url: string): Promise<void> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      await run('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        shell: process.platform === 'win32',
      });
      return;
    } catch (error) {
      ultimoError = error;
      if (intento < 3) await new Promise((resolve) => setTimeout(resolve, intento * 500));
    }
  }
  throw ultimoError;
}

async function waitUntilReady(container: string): Promise<void> {
  const limite = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < limite) {
    try {
      await run('docker', ['exec', container, 'pg_isready', '-U', 'uml_test', '-d', 'uml_test']);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`El contenedor ${container} no estuvo listo en ${READY_TIMEOUT_MS} ms.`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('No se pudo reservar un puerto libre.'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
