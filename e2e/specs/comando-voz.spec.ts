import { expect, test, type Page } from '@playwright/test';
import type { TeamRequestBody } from '@uml/contracts';
import { montarEscenario } from '../support/escenario.js';
import { commandSpeech, installCommandSpeech, speakCommand } from '../support/voice-command.js';
import { createTeamAiMock } from '../support/team-ai.js';
import { crearClase } from '../support/actors.js';

function requests(page: Page) {
  const calls: TeamRequestBody[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/team-ai\/messages$/.test(request.url()))
      calls.push(request.postDataJSON());
  });
  return calls;
}

test('soltar espera el final, envía una vez, aplica AI_VOICE y replica; otra pestaña y recarga no repiten', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Comando seguro');
  try {
    const { ana, beto } = scenario;
    await installCommandSpeech(ana.page);
    const sister = await ana.page.context().newPage();
    await sister.goto(ana.page.url());
    await expect(sister.getByTestId('estado-conexion')).toHaveText('En vivo');
    await sister.getByTestId('pestana-asistente').click();
    const calls = requests(ana.page);
    let sisterAudits = 0;
    sister.on('request', (r) => {
      if (r.method() === 'POST' && /\/audit$/.test(r.url())) sisterAudits++;
    });
    await ana.page.getByTestId('entrada-asistente').fill('Borrador que se conserva');
    const button = ana.page.getByTestId('comando-voz');
    await button.hover();
    await ana.page.mouse.down();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(ana.page.getByTestId('dictar')).toBeDisabled();
    await commandSpeech(ana.page, 'result', 'Crea Cliente con corre', false);
    await ana.page.mouse.up();
    await expect(button).toHaveText('Finalizando comando…');
    expect(calls).toHaveLength(0);
    await commandSpeech(ana.page, 'result', 'Crea Cliente con correo');
    expect(calls).toHaveLength(0);
    const audit = ana.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/audit$/.test(r.url()),
    );
    await commandSpeech(ana.page, 'end');
    await commandSpeech(ana.page, 'end');
    await commandSpeech(ana.page, 'result', 'Borra Cliente');
    expect((await audit).request().postDataJSON().origin).toBe('AI_VOICE');
    await expect(ana.page.getByTestId('transcripcion-comando-voz')).toContainText(
      'Transcripción final: Crea Cliente con correo',
    );
    await expect(ana.page.getByTestId('entrada-asistente')).toHaveValue('Borrador que se conserva');
    for (const page of [ana.page, beto.page, sister]) {
      await expect(page.getByTestId('clase-Cliente')).toContainText('correo');
      await expect(page.getByTestId('propuesta')).toContainText('Aplicado.');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      text: 'Crea Cliente con correo',
      mode: 'INSTRUCT',
      inputMode: 'VOICE_COMMAND',
    });
    expect(sisterAudits).toBe(0);
    await ana.page.reload();
    await expect(ana.page.getByTestId('propuesta')).toContainText('Aplicado.');
    expect(calls).toHaveLength(1);
    expect(sisterAudits).toBe(0);
  } finally {
    await scenario.cerrar();
  }
});

test('teclado crea y el borrado por voz solo se aplica al confirmar con botón', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Voz sensible');
  try {
    const { ana, beto } = scenario;
    await installCommandSpeech(ana.page);
    await speakCommand(ana.page, 'Crea Cliente con correo');
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('correo');
    await speakCommand(ana.page, 'Elimina el atributo correo de Cliente');
    await expect(ana.page.getByTestId('confirmacion')).toContainText('¿Confirmas?');
    await expect(beto.page.getByTestId('confirmacion')).toHaveCount(0);
    await expect(beto.page.getByTestId('aplicar-propuesta')).toHaveCount(0);
    await ana.page.getByRole('button', { name: 'Rechazar', exact: true }).click();
    await expect(ana.page.getByTestId('propuesta').last()).toContainText('Propuesta rechazada.');
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('correo');
    await speakCommand(ana.page, 'Elimina el atributo correo de Cliente');
    await expect(ana.page.getByTestId('confirmacion')).toContainText('¿Confirmas?');
    const audit = ana.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/audit$/.test(r.url()),
    );
    await ana.page.getByRole('button', { name: 'Sí, aplicar', exact: true }).click();
    expect((await audit).request().postDataJSON().origin).toBe('AI_VOICE');
    await expect(beto.page.getByTestId('clase-Cliente')).not.toContainText('correo');
  } finally {
    await scenario.cerrar();
  }
});

test('cancelación, permiso, parciales y longitud no envían ni alteran el borrador', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Voz cancelada');
  try {
    const page = scenario.ana.page;
    await installCommandSpeech(page);
    const calls = requests(page);
    const button = page.getByTestId('comando-voz');
    await page.getByTestId('entrada-asistente').fill('Borrador previo');
    for (const reason of [
      'escape',
      'button',
      'pointercancel',
      'lostcapture',
      'outside',
      'permission',
      'partial',
      'long',
      'blur',
      'offline',
    ] as const) {
      await test.step(reason, async () => {
        if (reason === 'outside') {
          await button.hover();
          await page.mouse.down();
        } else await button.press('Space');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await commandSpeech(page, 'result', 'Crea Cliente');
        if (reason === 'escape') await page.keyboard.press('Escape');
        if (reason === 'button')
          await page.getByRole('button', { name: 'Cancelar comando de voz', exact: true }).click();
        if (reason === 'pointercancel') await button.dispatchEvent('pointercancel');
        if (reason === 'lostcapture') {
          // Iniciar un gesto real permite comprobar el identificador capturado.
          await page.keyboard.press('Escape');
          await button.hover();
          await page.mouse.down();
          await button.dispatchEvent('lostpointercapture');
          await page.mouse.up();
        }
        if (reason === 'outside') {
          await page.mouse.move(0, 0);
          await page.mouse.up();
        }
        if (reason === 'permission') await commandSpeech(page, 'error', 'not-allowed');
        if (reason === 'partial' || reason === 'long') {
          await button.press('Space');
          await commandSpeech(
            page,
            'result',
            reason === 'long' ? 'x'.repeat(2001) : 'Crea Clien',
            reason === 'long',
          );
          await commandSpeech(page, 'end');
        }
        if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        if (reason === 'offline') await page.context().setOffline(true);
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await commandSpeech(page, 'result', 'Borra Cliente');
        await commandSpeech(page, 'end');
        if (reason === 'offline') await page.context().setOffline(false);
        expect(calls).toHaveLength(0);
        await expect(page.getByTestId('entrada-asistente')).toHaveValue('Borrador previo');
      });
    }
  } finally {
    await scenario.cerrar();
  }
});

test('Dictar excluye Comando, ASK/VIEWER lo bloquean y navegador sin voz conserva texto', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Voz permisos', { rol: 'lector' });
  try {
    const { ana, beto } = scenario;
    await installCommandSpeech(ana.page);
    await installCommandSpeech(beto.page);
    await expect(beto.page.getByTestId('comando-voz')).toBeDisabled();
    await ana.page.getByTestId('dictar').click();
    await expect(ana.page.getByTestId('comando-voz')).toBeDisabled();
    await ana.page.getByRole('button', { name: 'Cancelar dictado', exact: true }).click();
    await ana.page.getByTestId('modo-preguntar').click();
    await expect(ana.page.getByTestId('comando-voz')).toBeDisabled();
    await ana.page.getByTestId('modo-instruir').click();
    await expect(ana.page.getByTestId('comando-voz')).toBeEnabled();
    await ana.page.addInitScript(() =>
      Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined }),
    );
    await ana.page.reload();
    await expect(
      ana.page.getByText(
        'Este navegador no admite comandos de voz. Puedes escribir la instrucción.',
      ),
    ).toBeVisible();
    await ana.page.getByTestId('entrada-asistente').fill('Crea Cliente');
    await expect(ana.page.getByTestId('enviar-asistente')).toBeEnabled();
  } finally {
    await scenario.cerrar();
  }
});

test('cancelar la solicitud de voz impide respuesta tardía y restaura texto para revisión manual', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Voz solicitud cancelada');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = scenario.ana.page;
    const mock = createTeamAiMock(async () => {
      await gate;
      return { answer: 'Respuesta tardía de voz' };
    });
    await mock.install(page);
    await installCommandSpeech(page);
    await speakCommand(page, 'Crea Cliente');
    await expect(page.getByTestId('cancelar-solicitud')).toBeVisible();
    await page.getByTestId('cancelar-solicitud').click();
    await expect(page.getByTestId('entrada-asistente')).toHaveValue('Crea Cliente');
    release();
    await expect(page.getByTestId('conversacion')).toContainText('Solicitud cancelada');
    await expect(page.getByTestId('conversacion')).not.toContainText('Respuesta tardía de voz');
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.inputMode).toBe('VOICE_COMMAND');
  } finally {
    release();
    await scenario.cerrar();
  }
});

test('la aclaración por voz conserva su dueño y replyToId antes de aplicar', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Aclaración de voz');
  try {
    const { ana, beto } = scenario;
    await crearClase(ana, 'Cliente');
    await crearClase(ana, 'Proveedor');
    await installCommandSpeech(ana.page);
    const calls = requests(ana.page);
    await speakCommand(ana.page, 'agrega correo tipo String a Fantasma');
    await expect(ana.page.getByTestId('contexto-asistente')).toContainText(
      'recordaré la solicitud anterior',
    );
    await expect(beto.page.getByRole('button', { name: 'Responder aclaración' })).toHaveCount(0);
    await expect(ana.page.getByTestId('propuesta')).toHaveCount(0);
    const displayed = await ana.page.getByTestId('conversacion').innerText();
    const option = displayed.match(/([12])\. "Cliente"/)![1];
    await speakCommand(ana.page, option === '1' ? 'la primera' : 'la segunda');
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('correo');
    await expect(ana.page.getByTestId('contexto-asistente')).toHaveCount(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.replyToId).toBeTruthy();
    expect(calls.every((call) => call.inputMode === 'VOICE_COMMAND')).toBe(true);
  } finally {
    await scenario.cerrar();
  }
});

test('PROPOSE_ONLY conserva botón de aplicar incluso para comando seguro', async ({ browser }) => {
  const scenario = await montarEscenario(browser, 'Voz solo propuestas');
  try {
    const { ana, beto } = scenario;
    await installCommandSpeech(ana.page);
    await ana.page.getByRole('button', { name: 'Configurar IA' }).click();
    const dialog = ana.page.getByRole('dialog', { name: 'IA del proyecto' });
    await dialog
      .getByRole('combobox', { name: 'Aplicación de cambios', exact: true })
      .selectOption('PROPOSE_ONLY');
    await dialog.getByRole('button', { name: 'Guardar configuración' }).click();
    await expect(dialog).not.toBeVisible();
    await speakCommand(ana.page, 'Crea Cliente');
    await expect(ana.page.getByTestId('aplicar-propuesta')).toBeVisible();
    await expect(beto.page.getByTestId('clase-Cliente')).toHaveCount(0);
    await ana.page.getByTestId('aplicar-propuesta').click();
    await expect(beto.page.getByTestId('clase-Cliente')).toHaveCount(1);
  } finally {
    await scenario.cerrar();
  }
});

test('comando accesible a 320/768/1024/1440 px y ocultar el panel cancela la captura', async ({
  browser,
}, info) => {
  const scenario = await montarEscenario(browser, 'Voz adaptable');
  try {
    const page = scenario.ana.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installCommandSpeech(page);
    const calls = requests(page);
    const button = page.getByRole('button', { name: 'Comando de voz', exact: true });
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await button.scrollIntoViewIfNeeded();
      await button.focus();
      await expect(button).toBeFocused();
      await page.keyboard.down('Enter');
      await page.keyboard.down('Enter');
      await page.keyboard.up('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await commandSpeech(page, 'result', 'Crea Cliente', false);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`comando-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    await button.press('Enter');
    await commandSpeech(page, 'result', 'Crea Cliente');
    await page.getByTestId('pestana-importar').click();
    await commandSpeech(page, 'end');
    await page.getByTestId('pestana-asistente').click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(calls).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally {
    await scenario.cerrar();
  }
});
