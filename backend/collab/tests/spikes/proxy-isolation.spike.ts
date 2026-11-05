import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

/** Prueba las configuraciones reales, con un upstream que siempre responde 200. */
const exec = promisify(execFile);
const network = `uml-h0-proxy-${randomUUID()}`;
const containers: string[] = [];
const docker = async (...args: string[]) =>
  (await exec('docker', args, { timeout: 120_000, windowsHide: true })).stdout.trim();
const paths = [
  '/collab/internal',
  '/collab/internal/team-ai/events',
  '/collab/internal-extra',
  '/collab/internal/team-ai/events?probe=1',
  '/collab//internal/team-ai/events',
  '/collab/%69nternal/team-ai/events',
];

await docker('network', 'create', network);
try {
  const upstream = `${network}-upstream`;
  containers.push(upstream);
  await docker(
    'run',
    '--rm',
    '-d',
    '--name',
    upstream,
    '--network',
    network,
    '--network-alias',
    'api',
    '--network-alias',
    'collab',
    '--network-alias',
    'web',
    'node:22.15.0-alpine',
    'node',
    '-e',
    "const http=require('node:http'); for(const port of [80,3001,3002]) http.createServer((req,res)=>res.end('upstream-reached')).listen(port,'0.0.0.0');",
  );
  const configurations = [
    {
      file: 'infra/nginx.conf',
      image: 'nginx:1.27-alpine',
      target: '/etc/nginx/conf.d/default.conf',
    },
    { file: 'infra/caddy/Caddyfile', image: 'caddy:2-alpine', target: '/etc/caddy/Caddyfile' },
    {
      file: 'infra/caddy/Caddyfile.production',
      image: 'caddy:2-alpine',
      target: '/etc/caddy/Caddyfile',
    },
  ];
  for (const [index, config] of configurations.entries()) {
    const container = `${network}-${index}`;
    containers.push(container);
    const source = resolve(config.file).replaceAll('\\', '/');
    await docker(
      'run',
      '--rm',
      '-d',
      '--name',
      container,
      '--network',
      network,
      '--publish',
      '127.0.0.1::80',
      '--env',
      'DOMAIN=http://localhost',
      '--env',
      'ACME_EMAIL=h0@example.invalid',
      '--mount',
      `type=bind,source=${source},target=${config.target},readonly`,
      config.image,
    );
    const address = await docker('port', container, '80/tcp');
    const base = `http://localhost:${address.split(':').at(-1)}`;
    const deadline = Date.now() + 30_000;
    while (true) {
      try {
        const health = await fetch(`${base}/collab/health`, {
          signal: AbortSignal.timeout(2000),
        });
        assert.equal(health.status, 200);
        assert.equal(await health.text(), 'upstream-reached');
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await delay(100);
      }
    }
    for (const path of paths) {
      for (const method of ['GET', 'POST']) {
        const response = await fetch(`${base}${path}`, {
          method,
          signal: AbortSignal.timeout(3000),
        });
        assert.equal(response.status, 404, `${config.file}: ${method} ${path}`);
        assert.notEqual(await response.text(), 'upstream-reached');
      }
    }
    process.stdout.write(
      `PASS ${config.file}: health llega al upstream; 12 accesos internos bloqueados.\n`,
    );
    await docker('rm', '-f', container);
  }
  process.stdout.write('RESULTADO: nginx y ambos Caddy bloquean antes de reenviar o reescribir.\n');
} finally {
  for (const container of containers.reverse()) {
    await docker('rm', '-f', container).catch(() => undefined);
  }
  await docker('network', 'rm', network);
}
