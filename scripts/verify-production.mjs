// Cleanup applies ONLY to this uniquely named test Compose project.
import assert from 'node:assert/strict';
import console from 'node:console';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const project = `uml-prod-test-${randomBytes(4).toString('hex')}`;
await mkdir('tmp', { recursive: true });
const dir = await mkdtemp(resolve('tmp', 'production-check-'));
const envFile = resolve(dir, '.env');
const override = resolve(dir, 'compose.test.yml');
const mailStub = resolve(dir, 'mail-stub.mjs');
await writeFile(
  mailStub,
  `import { writeFile } from 'node:fs/promises';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
    await writeFile('/tmp/test-mail.json', options.body);
    return new Response('{}', { status: 201 });
  }
  return realFetch(url, options);
};
`,
);
const password = randomBytes(32).toString('hex');
await writeFile(
  envFile,
  `APP_VERSION=production-check
DOMAIN=localhost
WEB_ORIGIN=https://localhost:18443
ACME_EMAIL=test@example.org
POSTGRES_USER=uml
POSTGRES_DB=uml
POSTGRES_PASSWORD=${password}
JWT_SECRET=${randomBytes(48).toString('hex')}
MAIL_FROM=test@example.org
BREVO_API_KEY=local-test-no-mail-is-sent
BACKUP_S3_URI=s3://local-test/uml
AI_LLM_PROVIDER=mock
AI_VISION_PROVIDER=mock
AI_SPEECH_PROVIDER=mock
`,
  { mode: 0o600 },
);
await writeFile(
  override,
  `services:
  api:
    environment:
      NODE_OPTIONS: '--import=/opt/test-mail.mjs'
    volumes:
      - '${mailStub.replaceAll('\\', '/')}:/opt/test-mail.mjs:ro'
  proxy:
    ports: !override ['127.0.0.1:18080:80', '127.0.0.1:18443:443']
  backup:
    environment:
      BACKUP_S3_URI: ''
  restore:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: uml
      POSTGRES_DB: restored
      POSTGRES_PASSWORD: ${password}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U uml -d restored']
      interval: 3s
      timeout: 3s
      retries: 30
`,
);
const args = [
  'compose',
  '-p',
  project,
  '--env-file',
  envFile,
  '-f',
  'infra/compose.yml',
  '-f',
  'infra/compose.production.yml',
  '-f',
  override,
];
async function docker(...command) {
  try {
    const result = await exec('docker', command, { maxBuffer: 12 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    console.error(error.stdout, error.stderr);
    throw error;
  }
}
const compose = (...command) => docker(...args, ...command);
try {
  console.warn('Checking production configuration and building isolated images…');
  const config = JSON.parse(await compose('config', '--format', 'json'));
  for (const service of ['db', 'api', 'collab', 'web', 'restore']) {
    assert.ok(!config.services[service].ports?.length, `${service} must not publish ports`);
  }
  assert.equal(
    config.services.api.environment.JWT_SECRET,
    config.services.collab.environment.JWT_SECRET,
  );
  assert.equal(config.services.api.environment.COOKIE_SECURE, 'true');
  assert.equal(config.services.api.environment.NODE_ENV, 'production');
  await compose('build', 'api', 'collab', 'web', 'migrate', 'backup');
  console.warn('Starting HTTPS stack with temporary PostgreSQL volumes…');
  await compose('up', '-d', '--wait', '--wait-timeout', '240');
  const proxyId = (await compose('ps', '-q', 'proxy')).trim();
  const cert = resolve(dir, 'local-ca.crt');
  await docker('cp', `${proxyId}:/data/caddy/pki/authorities/local/root.crt`, cert);
  const result = await exec(process.execPath, ['scripts/verify-production-client.mjs'], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, UML_TEST_COMPOSE_ARGS: JSON.stringify(args) },
    maxBuffer: 1024 * 1024,
  });
  console.warn(result.stdout || result.stderr);
  await compose('stop', 'backup');
  await compose('run', '--rm', '--no-deps', 'backup', 'once');
  console.warn('Restoring the dump into a separate PostgreSQL container…');
  const restored = await compose(
    'run',
    '--rm',
    '--no-deps',
    '--entrypoint',
    'sh',
    '-e',
    'PGHOST=restore',
    '-e',
    'PGDATABASE=restored',
    'backup',
    '-ec',
    `file=$(ls -t /backups/uml-*.dump | head -n 1)
pg_restore --exit-on-error --no-owner --no-acl --dbname "$PGDATABASE" "$file"
test "$(psql -Atc 'SELECT count(*) FROM users')" -ge 1
echo 'Dump restored; user data preserved'`,
  );
  console.warn(restored.trim());
  console.warn(
    'Production smoke passed: HTTPS, secure session, WSS, rate limits, backup and restore.',
  );
} catch (error) {
  console.error(await compose('logs', '--tail', '35').catch(() => 'Logs unavailable'));
  throw error;
} finally {
  console.warn(`Removing only isolated test project ${project}…`);
  await compose('down', '--volumes', '--remove-orphans');
}
