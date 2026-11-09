import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

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
