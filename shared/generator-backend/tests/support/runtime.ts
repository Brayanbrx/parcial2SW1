import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, relative, resolve } from 'node:path';

/**
 * Ayudantes para verificar un backend generado en ejecucion.
 *
 * Se extrajeron de la verificacion de T01 al generalizarla al banco entero: eran
 * los mismos ocho pasos para cada modelo, y tenerlos dos veces garantizaba que en
 * algun momento se separaran.
 */

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 2 * 60 * 1000;
export const POSTGRES_IMAGE = 'postgres:17-alpine';

/** Prefijo de los directorios temporales que crea la verificacion. */
export const TEMP_PREFIX = 'uml-generated-';

export interface JsonRequestOptions {
  readonly method?: string;
  readonly body?: object;
  readonly expectedStatus: number;
}

export async function post(baseUrl: string, resource: string, body: object): Promise<unknown> {
  return requestJson(`${baseUrl}/api/${resource}`, { method: 'POST', body, expectedStatus: 201 });
}

export async function deleteResource(baseUrl: string, resource: string, id: string): Promise<void> {
  await requestJson(`${baseUrl}/api/${resource}/${id}`, {
    method: 'DELETE',
    expectedStatus: 204,
  });
}

export async function requestJson(url: string, options: JsonRequestOptions): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    ...(options.body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(options.body),
        }),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    options.expectedStatus,
    `${options.method ?? 'GET'} ${url} devolvio ${response.status}: ${text}`,
  );
  return text.length === 0 ? undefined : JSON.parse(text);
}

export async function writeProject(
  root: string,
  files: readonly { path: string; content: string }[],
): Promise<void> {
  for (const file of files) {
    const destination = resolve(root, ...file.path.split('/'));
    assert.equal(
      relative(root, destination).startsWith('..'),
      false,
      `Ruta insegura: ${file.path}`,
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly allowFailure?: boolean;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<string> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    // En Windows Maven es un archivo .cmd y necesita el interprete del sistema.
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

  const timeout = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
  const [exitCode] = (await once(child, 'exit')) as [number | null];
  clearTimeout(timeout);

  if (exitCode !== 0 && options.allowFailure !== true) {
    throw new Error(
      `${command} ${args.join(' ')} fallo (${String(exitCode)}).\n${stdout}\n${stderr}`,
    );
  }
  return stdout.trim();
}

export async function waitForPostgres(containerName: string): Promise<void> {
  await waitUntil(
    async () => {
      const status = await runCommand(
        'docker',
        ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'sistema_ventas'],
        { allowFailure: true },
      );
      return status.includes('accepting connections');
    },
    STARTUP_TIMEOUT_MS,
    'PostgreSQL no alcanzo el estado healthy.',
  );
}

export async function publishedPort(containerName: string): Promise<number> {
  const output = await runCommand('docker', ['port', containerName, '5432/tcp']);
  const match = /:(\d+)$/m.exec(output);
  if (match?.[1] === undefined) throw new Error(`No se pudo determinar el puerto: ${output}`);
  return Number(match[1]);
}

export interface RunningApplication {
  readonly process: ChildProcessWithoutNullStreams;
  readonly logs: () => string;
}

export async function startApplication(
  jar: string,
  applicationPort: number,
  databasePort: number,
  // El nombre de la base lo decide el modelo (RTM-12). Estaba incrustado y
  // funcionaba por casualidad mientras el banco tenia un solo modelo.
  databaseName: string,
  extraEnvironment: Readonly<Record<string, string>> = {},
): Promise<RunningApplication> {
  const child = spawn('java', ['-jar', jar], {
    env: {
      ...process.env,
      ...extraEnvironment,
      PORT: String(applicationPort),
      DATABASE_URL: `jdbc:postgresql://127.0.0.1:${databasePort}/${databaseName}`,
      DB_USER: 'postgres',
      DB_PASSWORD: 'postgres',
    },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  let logs = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (logs += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (logs += chunk));
  const running = { process: child, logs: () => logs };

  try {
    await waitUntil(
      async () => {
        if (child.exitCode !== null)
          throw new Error(`La aplicacion termino antes de arrancar.\n${logs}`);
        try {
          const response = await fetch(`http://127.0.0.1:${applicationPort}/actuator/health`);
          return response.ok;
        } catch {
          return false;
        }
      },
      STARTUP_TIMEOUT_MS,
      `La aplicacion no arranco.\n${logs}`,
    );
    return running;
  } catch (error) {
    child.kill();
    throw error;
  }
}

export async function stopApplication(application: RunningApplication): Promise<void> {
  if (application.process.exitCode !== null) return;
  application.process.kill();
  await Promise.race([
    once(application.process, 'exit'),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10_000)),
  ]);
  if (application.process.exitCode === null) {
    application.process.kill('SIGKILL');
  }
}

export async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address !== null && typeof address === 'object');
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(timeoutMessage);
}

export async function removeVerifiedTemporaryDirectory(path: string): Promise<void> {
  const resolvedTemp = resolve(tmpdir());
  const resolvedPath = resolve(path);
  const insideTemp = relative(resolvedTemp, resolvedPath);
  assert(!insideTemp.startsWith('..') && insideTemp !== '');
  assert(dirname(resolvedPath) === resolvedTemp);
  // El prefijo se comprueba antes de borrar: un borrado recursivo sobre una ruta
  // que no creo esta prueba no tiene vuelta atras.
  assert(resolvedPath.split(/[\\/]/).at(-1)?.startsWith(TEMP_PREFIX));
  await rm(resolvedPath, { recursive: true, force: true });
}

export function mavenCommand(): string {
  return process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
}

export function report(message: string): void {
  process.stdout.write(`${message}\n`);
}
