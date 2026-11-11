import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resolveProposal } from '@uml/ai';

const boardId = '00000000-0000-4000-8000-000000000010';

async function enter(page: Page) {
  await page.goto('/entrar');
  await page.getByTestId('email').fill('ana@example.com');
  await page.getByTestId('password').fill('password-test');
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
  await page.goto(`/pizarras/${boardId}`);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.getByTestId('pestana-importar').click();
  await page.route(`**/api/boards/${boardId}/import/*`, (route) =>
    route.fulfill({
      json: { kind: 'NO_CHANGES', message: 'Archivo leído.', rationale: null, warnings: [] },
    }),
  );
}

test.beforeEach(async ({ request }) => {
  await request.post('/test/reset');
});

test('cancelar una exportación XMI en curso permite iniciar otra sin descargas duplicadas', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let exports = 0;
  await page.route(`**/api/boards/${boardId}/export/xmi`, async (route) => {
    exports++;
    const response = { contentType: 'application/xml', body: '<xmi/>' };
    if (exports === 1) {
      await pending;
      return route.fulfill(response).catch(() => undefined);
    }
    return route.fulfill(response);
  });

  try {
    await enter(page);
    await page.getByTestId('exportar-xmi').click();
    const submit = page.getByTestId('confirmar-export');
    const [request] = await Promise.all([
      page.waitForRequest(`**/api/boards/${boardId}/export/xmi`),
      submit.click(),
    ]);
    await expect(submit).toBeDisabled();
    const form = page.getByTestId('nombre-export');
    await Promise.all([
      page.waitForEvent('requestfailed', {
        predicate: (failed) => failed === request,
        timeout: 5000,
      }),
      form.getByRole('button', { name: 'Cancelar' }).click(),
    ]);
    release();

    await page.getByTestId('exportar-xmi').click();
    await page.getByTestId('campo-nombre-export').fill('nuevo');
    const [download] = await Promise.all([page.waitForEvent('download'), submit.click()]);
    expect(download.suggestedFilename()).toBe('nuevo.xmi');
    await expect(page.getByTestId('importacion-aplicada')).toHaveText('Exportado como nuevo.xmi');
    expect(exports).toBe(2);
  } finally {
    release();
  }
});

test('impide aplicar un reemplazo si se quita la última clase del candidato', async ({ page }) => {
  await enter(page);
  await page.getByTestId('crear-clase').click();
  await page.getByTestId('nombre-clase').fill('Cliente');
  await page.getByTestId('nombre-clase').press('Tab');
  await expect(page.getByTestId('clase-Cliente')).toBeVisible();
  await page.route(`**/api/boards/${boardId}/import/xmi`, (route) => {
    const { model } = route.request().postDataJSON();
    const meta = { origin: 'XMI', actorId: randomUUID(), issuedAt: new Date().toISOString() };
    return route.fulfill({
      json: {
        kind: 'CONFIRMATION',
        question: 'Confirma el reemplazo.',
        summary: [],
        rationale: null,
        warnings: [],
        batch: {
          ...meta,
          batchId: randomUUID(),
          commands: [
            {
              ...meta,
              commandId: randomUUID(),
              type: 'DELETE_CLASS',
              payload: { classId: model.classes[0].id },
            },
            {
              ...meta,
              commandId: randomUUID(),
              type: 'CREATE_CLASS',
              payload: { classId: randomUUID(), displayName: 'Pedido' },
            },
          ],
        },
      },
    });
  });
  await page.getByTestId('modo-importacion').selectOption('REPLACE');
  await page.getByTestId('archivo-xmi').setInputFiles({
    name: 'modelo.xmi',
    mimeType: 'application/xml',
    buffer: Buffer.from('<xmi/>'),
  });
  const apply = page.getByTestId('aplicar-candidato');
  await expect(apply).toBeEnabled();
  await page.getByRole('button', { name: 'Quitar operación 2', exact: true }).click();
  await expect(apply).toBeDisabled();
  await expect(
    page.getByRole('alert').filter({ hasText: 'El candidato no contiene clases' }),
  ).toBeVisible();
  await expect(page.getByTestId('clase-Cliente')).toBeVisible();
});

for (const kind of ['xmi', 'imagen'] as const) {
  test(`muestra el error de lectura de ${kind} y permite volver a importar`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enter(page);
    await page.evaluate((kind) => {
      const method = kind === 'xmi' ? 'text' : 'arrayBuffer';
      const original = File.prototype[method];
      Object.defineProperty(File.prototype, method, {
        configurable: true,
        value() {
          Object.defineProperty(File.prototype, method, { configurable: true, value: original });
          return Promise.reject(
            new DOMException('No se pudo leer el archivo.', 'NotReadableError'),
          );
        },
      });
    }, kind);
    const file = {
      name: kind === 'xmi' ? 'modelo.xmi' : 'foto.png',
      mimeType: kind === 'xmi' ? 'application/xml' : 'image/png',
      buffer: Buffer.from('contenido de prueba'),
    };
    await page.getByTestId(`archivo-${kind}`).setInputFiles(file);
    await expect(page.getByTestId('error-importacion')).toContainText(
      'No se pudo leer el archivo.',
    );
    expect(errors).toEqual([]);
    await page.getByTestId(`archivo-${kind}`).setInputFiles(file);
    await expect(page.getByTestId('candidato')).toContainText('Archivo leído.');
    await expect(page.getByTestId('error-importacion')).toHaveCount(0);
  });
}

test('bloquea importaciones desde que empieza a leer el archivo y descarta lecturas al salir', async ({
  page,
}) => {
  await enter(page);
  await page.evaluate(() => {
    File.prototype.text = () =>
      new Promise<string>((resolve) => {
        Object.assign(window, { __releaseImport: () => resolve('<xmi/>') });
      });
  });
  const imports: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/import/xmi')) imports.push(request.url());
  });
  await page.getByTestId('archivo-xmi').setInputFiles({
    name: 'lento.xmi',
    mimeType: 'application/xml',
    buffer: Buffer.from('<xmi/>'),
  });
  await expect(page.getByTestId('importar-xmi')).toBeDisabled();
  await expect(page.getByTestId('importar-imagen')).toBeDisabled();
  await expect(page.getByTestId('modo-importacion')).toBeDisabled();
  // El enlace usa navegación React: la promesa del archivo sigue viva tras desmontar.
  await page.getByRole('link', { name: 'Proyecto', exact: true }).click();
  await page.evaluate(async () => {
    (window as unknown as { __releaseImport(): void }).__releaseImport();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(imports).toEqual([]);
});

test('cancelar la cámara descarta una foto cuya codificación termina después', async ({ page }) => {
  await enter(page);
  await page.evaluate(() => {
    // Fuente de vídeo sintética; no pide permisos ni utiliza la cámara física.
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      const stream = canvas.captureStream(1);
      canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
      return stream;
    };
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      Object.assign(window, {
        __finishPhoto: () => callback(new Blob(['foto'], { type: 'image/jpeg' })),
      });
    };
    Object.assign(window, { __photoReads: 0 });
    File.prototype.arrayBuffer = async () => {
      const state = window as unknown as { __photoReads: number };
      state.__photoReads++;
      return new ArrayBuffer(4);
    };
  });
  await page.getByTestId('abrir-camara').click();
  await expect(page.getByTestId('tomar-foto')).toBeEnabled();
  await page.getByTestId('tomar-foto').click();
  await page.getByTestId('camara').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByTestId('camara')).toHaveCount(0);
  const reads = await page.evaluate(() => {
    const state = window as unknown as { __finishPhoto(): void; __photoReads: number };
    state.__finishPhoto();
    return state.__photoReads;
  });
  expect(reads).toBe(0);
});

test('toma una foto, corrige el método reconocido y aplica el diagrama', async ({ page }) => {
  await enter(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 480;
      const context = canvas.getContext('2d')!;
      const stream = canvas.captureStream(1);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 960, 480);
      context.fillStyle = '#000';
      context.font = '26px Arial';
      context.strokeRect(36, 40, 300, 140);
      context.strokeRect(590, 40, 300, 140);
      context.fillText('Cliente', 56, 82);
      context.fillText('Pedido', 610, 82);
      context.fillText('+ calcular(): Decimal', 610, 139);
      return stream;
    };
  });
  await page.route(`**/api/boards/${boardId}/import/image`, (route) => {
    const { image, mediaType, model } = route.request().postDataJSON();
    expect(mediaType).toBe('image/jpeg');
    expect(Buffer.from(image, 'base64').subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const outcome = resolveProposal({
      model,
      actorId: '00000000-0000-4000-8000-000000000001',
      origin: 'IMAGE',
      proposal: {
        operations: [
          { op: 'CREATE_CLASS', className: 'Cliente' },
          { op: 'CREATE_CLASS', className: 'Pedido' },
          {
            op: 'ADD_OPERATION',
            className: 'Pedido',
            operationName: 'calcular',
            returnType: 'Decimal',
          },
          {
            op: 'CREATE_RELATIONSHIP',
            fromClass: 'Cliente',
            toClass: 'Pedido',
            fromMultiplicity: '1',
            toMultiplicity: '0..*',
          },
        ],
      },
    });
    return route.fulfill({ json: { ...outcome, rationale: null, warnings: [] } });
  });
  await page.getByTestId('abrir-camara').click();
  await page.getByTestId('tomar-foto').click();
  const method = page.getByRole('textbox', { name: 'Nombre de método 3' });
  await expect(method).toHaveValue('calcular');
  await expect(page.getByTestId('clase-Pedido')).toHaveCount(0);
  await method.fill('calcularTotal');
  await page.getByTestId('aplicar-candidato').click();
  await expect(page.getByTestId('importacion-aplicada')).toBeVisible();
  await expect(page.getByTestId('clase-Cliente')).toBeVisible();
  await expect(page.getByTestId('clase-Pedido')).toContainText('calcularTotal(): Decimal');
});

test('cancelar la lectura de una foto permite iniciar otra sin abandonar la pizarra', async ({
  page,
}) => {
  await enter(page);
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  await page.route(`**/api/boards/${boardId}/import/image`, async (route) => {
    if (++calls === 1) await waiting;
    await route
      .fulfill({
        json: { kind: 'NO_CHANGES', message: 'Foto leída.', rationale: null, warnings: [] },
      })
      .catch(() => undefined);
  });
  const file = { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('fixture') };
  try {
    await page.getByTestId('archivo-imagen').setInputFiles(file);
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: 'Cancelar lectura' }).click();
    await expect(page.getByTestId('importar-imagen')).toBeEnabled();
    await page.getByTestId('archivo-imagen').setInputFiles(file);
    await expect(page.getByTestId('candidato')).toContainText('Foto leída.');
    expect(calls).toBe(2);
  } finally {
    finish();
  }
});

for (const action of ['pestana', 'panel'] as const) {
  test(`apaga la cámara al ocultar ${action} y no la reactiva al volver`, async ({ page }) => {
    await enter(page);
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        const stream = canvas.captureStream(1);
        canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
        Object.assign(window, { __cameraStream: stream });
        return stream;
      };
    });
    await page.getByTestId('abrir-camara').click();
    await expect(page.getByTestId('tomar-foto')).toBeEnabled();
    await page.getByTestId(action === 'pestana' ? 'pestana-asistente' : 'alternar-panel').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __cameraStream: MediaStream }).__cameraStream
            .getTracks()
            .map((track) => track.readyState),
        ),
      )
      .toEqual(['ended']);
    await page.getByTestId(action === 'pestana' ? 'pestana-importar' : 'alternar-panel').click();
    await expect(page.getByTestId('camara')).toHaveCount(0);
    await expect(page.getByTestId('abrir-camara')).toBeEnabled();
  });
}
