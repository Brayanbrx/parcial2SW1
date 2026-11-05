import { expect, test, type Page } from '@playwright/test';
import { montarEscenario } from '../support/escenario.js';
import { crearClase } from '../support/actors.js';
import type { SpeechRecognitionLike } from '../../frontend/src/features/assistant/speech-session.js';

async function send(page: Page, text: string) {
  await page.getByTestId('entrada-asistente').fill(text);
  await page.getByTestId('enviar-asistente').click();
}
async function configure(page: Page, mode: string) {
  await page.getByRole('button', { name: 'Configurar IA' }).click();
  const dialog = page.getByRole('dialog', { name: 'IA del proyecto' });
  await dialog
    .getByRole('combobox', { name: 'Aplicación de cambios', exact: true })
    .selectOption(mode);
  await dialog.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect(dialog).not.toBeVisible();
}

test('DICTATION permanece manual incluso con AUTO_SAFE_ALL y Parar no envía', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Dictado manual opt-in');
  try {
    const { ana, beto } = scenario;
    await ana.page.addInitScript(() => {
      let deliver: ((text: string) => void) | undefined;
      class Recognition implements SpeechRecognitionLike {
        lang = '';
        continuous = false;
        interimResults = false;
        onresult: SpeechRecognitionLike['onresult'] = null;
        onerror: SpeechRecognitionLike['onerror'] = null;
        onend: SpeechRecognitionLike['onend'] = null;
        start() {
          deliver = (text) => this.onresult?.({ results: [[{ transcript: text }]] });
        }
        stop() {
          queueMicrotask(() => this.onend?.());
        }
        abort() {
          this.onend?.();
        }
      }
      Object.assign(window, {
        SpeechRecognition: Recognition,
        __executionDictate: (text: string) => deliver?.(text),
      });
    });
    await ana.page.reload();
    await expect(ana.page.getByTestId('estado-conexion')).toHaveText('En vivo');
    await ana.page.getByTestId('pestana-asistente').click();
    await configure(ana.page, 'AUTO_SAFE_ALL');
    const requests: { inputMode: string }[] = [];
    ana.page.on('request', (r) => {
      if (r.method() === 'POST' && /\/team-ai\/messages$/.test(r.url()))
        requests.push(r.postDataJSON());
    });
    await ana.page.getByTestId('dictar').click();
    await ana.page.evaluate(() =>
      (window as unknown as { __executionDictate(text: string): void }).__executionDictate(
        'Crea Factura',
      ),
    );
    await ana.page.getByTestId('dictar').click();
    await expect(ana.page.getByTestId('revision-dictado')).toBeVisible();
    expect(requests).toHaveLength(0);
    await ana.page.getByTestId('enviar-asistente').click();
    await expect(ana.page.getByTestId('aplicar-propuesta')).toBeVisible();
    expect(requests).toMatchObject([{ inputMode: 'DICTATION' }]);
    await expect(beto.page.getByTestId('clase-Factura')).toHaveCount(0);
    const audit = ana.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/audit$/.test(r.url()),
    );
    await ana.page.getByTestId('aplicar-propuesta').click();
    expect((await audit).request().postDataJSON().origin).toBe('AI_TEXT');
    await expect(beto.page.getByTestId('clase-Factura')).toHaveCount(1);
  } finally {
    await scenario.cerrar();
  }
});

test('AUTO_SAFE_ALL solo ejecuta en pestaña originadora; recarga e historial no repiten', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Autoaplicación local');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const { ana, beto } = scenario;
    await configure(ana.page, 'AUTO_SAFE_ALL');
    const sister = await ana.page.context().newPage();
    await sister.goto(ana.page.url());
    await expect(sister.getByTestId('estado-conexion')).toHaveText('En vivo');
    await sister.getByTestId('pestana-asistente').click();
    let sisterAudits = 0,
      originAudits = 0;
    sister.on('request', (r) => {
      if (r.method() === 'POST' && /\/audit$/.test(r.url())) sisterAudits++;
    });
    ana.page.on('request', (r) => {
      if (r.method() === 'POST' && /\/audit$/.test(r.url())) originAudits++;
    });
    // Detener solo la lectura final de la originadora, sin ocultar el feed compartido.
    await ana.page.route(/\/team-ai\/messages\/[0-9a-f-]+$/, async (route) => {
      await gate;
      await route.continue();
    });
    await send(ana.page, 'Crea la clase Factura');
    await expect(sister.getByTestId('propuesta')).toContainText('Factura');
    await expect(sister.getByTestId('aplicar-propuesta')).toBeVisible();
    await expect(sister.getByTestId('clase-Factura')).toHaveCount(0);
    expect(sisterAudits).toBe(0);
    release();
    for (const page of [ana.page, beto.page, sister]) {
      await expect(page.getByTestId('clase-Factura')).toHaveCount(1);
      await expect(page.getByTestId('propuesta')).toContainText('Aplicado.');
    }
    expect(originAudits).toBe(1);
    expect(sisterAudits).toBe(0);
    await ana.page.reload();
    await expect(ana.page.getByTestId('clase-Factura')).toHaveCount(1);
    await expect(ana.page.getByTestId('propuesta')).toContainText('Aplicado.');
    expect(originAudits).toBe(1);
  } finally {
    release();
    await scenario.cerrar();
  }
});

test('texto default manual; DELETE único exige botón y solo la pestaña que confirma aplica', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Confirmación sensible');
  try {
    const { ana, beto } = scenario;
    await send(ana.page, 'Crea Cliente con correo');
    await expect(ana.page.getByTestId('aplicar-propuesta')).toBeVisible();
    await expect(ana.page.getByTestId('clase-Cliente')).toHaveCount(0);
    await ana.page.getByTestId('aplicar-propuesta').click();
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('correo');
    await configure(ana.page, 'AUTO_SAFE_ALL');
    const sister = await ana.page.context().newPage();
    await sister.goto(ana.page.url());
    await expect(sister.getByTestId('estado-conexion')).toHaveText('En vivo');
    await sister.getByTestId('pestana-asistente').click();
    let sisterAudits = 0,
      originAudits = 0;
    sister.on('request', (r) => {
      if (r.method() === 'POST' && /\/audit$/.test(r.url())) sisterAudits++;
    });
    ana.page.on('request', (r) => {
      if (r.method() === 'POST' && /\/audit$/.test(r.url())) originAudits++;
    });
    await send(ana.page, 'Elimina el atributo correo de Cliente');
    await expect(ana.page.getByTestId('confirmacion')).toContainText('¿Confirmas?');
    await expect(beto.page.getByTestId('confirmacion')).toHaveCount(0);
    await expect(sister.getByTestId('confirmacion')).toContainText('¿Confirmas?');
    await expect(ana.page.getByTestId('clase-Cliente')).toContainText('correo');
    await sister.getByRole('button', { name: 'Sí, aplicar', exact: true }).click();
    for (const page of [ana.page, beto.page, sister]) {
      await expect(page.getByTestId('clase-Cliente')).not.toContainText('correo');
      await expect(page.getByTestId('propuesta').last()).toContainText('Aplicado.');
    }
    expect(sisterAudits).toBe(1);
    expect(originAudits).toBe(0);
  } finally {
    await scenario.cerrar();
  }
});

test('STALE se comunica al equipo y conserva edición concurrente; rechazo no produce auditoría', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Stale real');
  try {
    const { ana, beto } = scenario;
    await crearClase(ana, 'Cliente');
    await send(ana.page, 'Elimina Cliente');
    await expect(ana.page.getByTestId('confirmacion')).toBeVisible();
    await beto.page.getByTestId('clase-Cliente').click();
    await beto.page.getByTestId('nuevo-atributo').fill('datoNuevo');
    await beto.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(ana.page.getByTestId('clase-Cliente')).toContainText('datoNuevo');
    let audits = 0;
    ana.page.on('request', (r) => {
      if (r.method() === 'POST' && /\/audit$/.test(r.url())) audits++;
    });
    await ana.page.getByRole('button', { name: 'Sí, aplicar', exact: true }).click();
    await expect(ana.page.getByTestId('propuesta-obsoleta')).toBeVisible();
    await expect(beto.page.getByTestId('propuesta')).toContainText('desactualizada');
    await expect(ana.page.getByTestId('entrada-asistente')).toHaveValue('Elimina Cliente');
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('datoNuevo');
    expect(audits).toBe(0);
  } finally {
    await scenario.cerrar();
  }
});

test('APPLY_FAILED se persiste cuando almacenamiento local rechaza antes de mutar', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Fallo local');
  try {
    const { ana, beto } = scenario;
    await send(ana.page, 'Crea Factura');
    await expect(ana.page.getByTestId('aplicar-propuesta')).toBeVisible();
    await ana.page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('uml_board_draft_v1:'))
          throw new DOMException('Sin espacio', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    const rejected = ana.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/reject$/.test(r.url()),
    );
    await ana.page.getByTestId('aplicar-propuesta').click();
    const response = await rejected;
    expect(response.request().postDataJSON()).toEqual({ reason: 'APPLY_FAILED' });
    expect((await response.json()).status).toBe('REJECTED');
    await expect(beto.page.getByTestId('propuesta')).toContainText('rechazada');
    await expect(ana.page.getByTestId('clase-Factura')).toHaveCount(0);
    await expect(beto.page.getByTestId('clase-Factura')).toHaveCount(0);
  } finally {
    await scenario.cerrar();
  }
});

test('fallo de auditoría conserva aplicación local; recarga no reejecuta y el ACK se recupera', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'ACK pendiente');
  try {
    const { ana, beto } = scenario;
    let blocked = true,
      rejects = 0;
    await ana.page.route(/\/audit$/, async (route) => {
      if (route.request().method() === 'POST' && blocked)
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'unavailable', message: 'Prueba de ACK pendiente' },
          }),
        });
      else await route.continue();
    });
    ana.page.on('request', (r) => {
      if (/\/reject$/.test(r.url())) rejects++;
    });
    await send(ana.page, 'Crea Factura');
    await ana.page.getByTestId('aplicar-propuesta').click();
    await expect(beto.page.getByTestId('clase-Factura')).toHaveCount(1);
    await expect(ana.page.getByTestId('propuesta')).toContainText('esperando auditoría');
    await ana.page.reload();
    await expect(ana.page.getByTestId('propuesta')).toContainText('esperando auditoría');
    await expect(ana.page.getByTestId('aplicar-propuesta')).toHaveCount(0);
    await expect(ana.page.getByTestId('clase-Factura')).toHaveCount(1);
    expect(rejects).toBe(0);
    blocked = false;
    await ana.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(beto.page.getByTestId('propuesta')).toContainText('Aplicado.');
    await expect(ana.page.getByTestId('propuesta')).toContainText('Aplicado.');
    expect(rejects).toBe(0);
  } finally {
    await scenario.cerrar();
  }
});
