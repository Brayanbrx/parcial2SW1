import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { fetch, AbortSignal } = globalThis;

const origin = 'https://localhost:18443';
const request = (path, options = {}) =>
  fetch(`${origin}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
for (const path of ['/', '/api/health', '/api/ready', '/collab/health']) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.ok(response.headers.get('strict-transport-security'));
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
}
const redirect = await fetch('http://localhost:18080/', { redirect: 'manual' });
assert.equal(redirect.status, 308);
assert.ok(redirect.headers.get('location').startsWith('https://'));
for (const method of ['PUT', 'PATCH', 'DELETE']) {
  const preflight = await request('/api/projects', {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.ok(
    preflight.headers
      .get('access-control-allow-methods')
      .split(',')
      .map((value) => value.trim())
      .includes(method),
  );
}
const foreign = await request('/api/health', {
  headers: { origin: 'https://untrusted.example.org' },
});
assert.equal(foreign.headers.get('access-control-allow-origin'), null);
const email = `${randomUUID()}@example.org`;
const password = randomUUID();
const registration = await request('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email,
    displayName: 'Production test',
    password,
  }),
});
assert.equal(registration.status, 201);
assert.equal(registration.headers.get('set-cookie'), null);
assert.deepEqual(await registration.json(), { verificationRequired: true, emailSent: true });
const composeArgs = JSON.parse(process.env.UML_TEST_COMPOSE_ARGS);
assert.ok(
  composeArgs.includes('-p') && composeArgs.some((arg) => arg.startsWith('uml-prod-test-')),
);
const { stdout: mailJson } = await promisify(execFile)('docker', [
  ...composeArgs,
  'exec',
  '-T',
  'api',
  'cat',
  '/tmp/test-mail.json',
]);
const verificationToken = JSON.parse(mailJson).textContent.match(/#token=([^\s]+)/)[1];
const browserForActivation = await chromium.launch();
try {
  const context = await browserForActivation.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`${origin}/activar#token=${verificationToken}`);
  await page.getByRole('button', { name: 'Activar mi cuenta', exact: true }).click();
  await expect(page.getByTestId('cuenta-activada')).toBeVisible();
  const uiEmail = `ui-${email}`;
  await page.goto(`${origin}/entrar`);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByTestId('email').fill(uiEmail);
  await page.getByTestId('displayName').fill('Activación de prueba');
  await page.getByTestId('password').fill(password);
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('activacion-pendiente')).toContainText('Te enviamos un enlace');
  await page.getByTestId('password').fill(password);
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('error-sesion')).toContainText('Activa tu cuenta');
  const { stdout: uiMail } = await promisify(execFile)('docker', [
    ...composeArgs,
    'exec',
    '-T',
    'api',
    'cat',
    '/tmp/test-mail.json',
  ]);
  const uiToken = JSON.parse(uiMail).textContent.match(/#token=([^\s]+)/)[1];
  await page.goto(`${origin}/activar#token=${uiToken}`);
  await page.setViewportSize({ width: 375, height: 812 });
  await mkdir('reports', { recursive: true });
  await page.screenshot({ path: 'reports/email-activation-mobile.png', fullPage: true });
  assert.ok(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  );
  await page.getByRole('button', { name: 'Activar mi cuenta', exact: true }).click();
  await expect(page.getByTestId('cuenta-activada')).toBeVisible();
  await page.getByRole('link', { name: 'Ir a iniciar sesión' }).click();
  await page.getByTestId('email').fill(uiEmail);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
} finally {
  await browserForActivation.close();
}
const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(login.status, 200);
assert.match(login.headers.get('set-cookie'), /; Secure/i);
assert.match(login.headers.get('set-cookie'), /; HttpOnly/i);
const { accessToken } = await login.json();
const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
const project = await (
  await request('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ displayName: 'HTTPS smoke' }),
  })
).json();
assert.ok(project.id);
const board = await (
  await request(`/api/projects/${project.id}/boards`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ displayName: 'WSS smoke' }),
  })
).json();
assert.ok(board.room);
let provider;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WSS sync timed out')), 15000);
    provider = new HocuspocusProvider({
      url: 'wss://localhost:18443/collab',
      name: board.room,
      token: accessToken,
      onSynced: ({ state }) => {
        if (state) {
          clearTimeout(timer);
          resolve();
        }
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer);
        reject(new Error(reason));
      },
    });
  });
} finally {
  provider?.destroy();
}
// TLS was validated above with the local CA. This option is scoped to this
// temporary localhost browser context, never to a real cloud deployment.
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/entrar`);
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
  await page.goto(`${origin}/pizarras/${board.id}`);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo', { timeout: 20000 });
  // Las herramientas del panel son pestanas (role="tab"), no botones: el mismo
  // localizador que usan las pruebas E2E en e2e/support/actors.ts.
  await page.getByTestId('pestana-importar').click();
  await expect(page.getByTestId('importar-xmi')).toBeEnabled();
  await expect(page.getByTestId('exportar-png')).toBeDisabled();
  await page.getByTestId('crear-clase').click();
  await page.getByTestId('nombre-clase').fill('Persona');
  await page.getByTestId('nuevo-atributo').fill('correo');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await page.getByTestId('tool-association').click();
  await page.getByTestId('clase-Persona').click();
  await page.getByTestId('clase-Persona').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByTestId('rol-origen').fill('supervisor');
  await page.getByTestId('rol-destino').fill('subordinados');
  await expect(page.locator('.rol-asociacion')).toHaveText(['supervisor', 'subordinados']);
  // A translated/zoomed camera must not crop the diagram or its recursive edge.
  const viewport = page.locator('.react-flow__viewport');
  await viewport.evaluate((element) => {
    element.style.transform = 'translate(-1500px, -900px) scale(0.4)';
  });
  const cameraBefore = await viewport.getAttribute('style');
  await page.getByTestId('exportar-png').click();
  await page.getByRole('textbox', { name: 'Nombre de la imagen' }).fill('Diagrama UML');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Guardar PNG' }).click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), 'Diagrama UML.png');
  await mkdir('reports', { recursive: true });
  await download.saveAs('reports/diagram-export.png');
  const png = await readFile('reports/diagram-export.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.readUInt32BE(16) >= 600, 'full class width including padding at 2x');
  assert.ok(png.readUInt32BE(20) >= 350, 'recursive edge is included below the class');
  assert.ok(png.length > 4000, 'PNG contains rendered content');
  await expect(
    page.getByRole('status').filter({ hasText: 'Exportado como Diagrama UML.png' }),
  ).toBeVisible();
  assert.equal(await viewport.getAttribute('style'), cameraBefore, 'export preserves camera');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
let blocked = false;
for (let i = 0; i < 22; i++) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i}` },
    body: '{}',
  });
  if (response.status === 429) {
    assert.ok(response.headers.get('retry-after'));
    blocked = true;
    break;
  }
}
assert.ok(blocked, 'Spoofed forwarding headers must not bypass authentication limits');
console.warn('HTTPS/WSS, security headers, secure cookies and rate limits verified');
