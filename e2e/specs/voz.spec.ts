import { expect, test, type Page } from '@playwright/test';
import { activarCuentaEIniciarSesion, nuevoCorreo } from '../support/actors.js';
import type { SpeechRecognitionLike } from '../../frontend/src/features/assistant/speech-session.js';

interface SpeechControl {
  starts: number;
  stops: number;
  aborts: number;
  result(text: string): void;
  end(): void;
  error(code: string): void;
}

async function abrirAsistente(page: Page) {
  // Se sustituye solo el servicio de reconocimiento. La interfaz, cuentas,
  // pizarra y colaboracion siguen usando los contenedores reales.
  await page.addInitScript(() => {
    const engines: SpeechRecognitionLike[] = [];
    const control: SpeechControl = {
      starts: 0,
      stops: 0,
      aborts: 0,
      result(text) {
        engines.at(-1)?.onresult?.({ results: [[{ transcript: text }]] });
      },
      end() {
        engines.at(-1)?.onend?.();
      },
      error(code) {
        engines.at(-1)?.onerror?.({ error: code });
      },
    };
    class Recognition implements SpeechRecognitionLike {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: SpeechRecognitionLike['onresult'] = null;
      onerror: SpeechRecognitionLike['onerror'] = null;
      onend: SpeechRecognitionLike['onend'] = null;
      start() {
        engines.push(this);
        control.starts++;
      }
      stop() {
        control.stops++;
        queueMicrotask(() => this.onend?.());
      }
      abort() {
        control.aborts++;
      }
    }
    Object.assign(window, { SpeechRecognition: Recognition, __speechTest: control });
  });

  const calls: { instruction?: string; question?: string }[] = [];
  // Ninguna de estas pruebas consume cuotas de proveedores de IA.
  await page.route(/\/api\/(?:boards\/[^/]+\/)?assistant\//, async (route) => {
    expect(route.request().url()).not.toContain('/transcribe');
    calls.push(route.request().postDataJSON() as (typeof calls)[number]);
    await route.fulfill({
      json: route.request().url().endsWith('/question')
        ? { answer: 'La pizarra está vacía.' }
        : { kind: 'QUESTION', question: '¿Qué atributo quieres añadir?', rationale: null },
    });
  });
  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  const email = nuevoCorreo('dictado');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('displayName').fill('Dictado');
  await page.getByTestId('password').fill('contrasena-de-prueba');
  await page.getByTestId('enviar').click();
  await activarCuentaEIniciarSesion(page, email);
  await page.getByTestId('nombre-proyecto').fill('Voz');
  await page.getByTestId('crear-proyecto').click();
  await page.getByTestId('nombre-pizarra').fill('Dictado');
  await page.getByTestId('crear-pizarra').click();
  await page.getByRole('link', { name: 'Dictado', exact: true }).click();
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.getByTestId('pestana-asistente').click();
  return calls;
}

async function voz(page: Page, action: 'result' | 'end' | 'error', text = '') {
  await page.evaluate(
    ({ action, text }) => {
      const control = (window as unknown as { __speechTest: SpeechControl }).__speechTest;
      if (action === 'end') control.end();
      else control[action](text);
    },
    { action, text },
  );
}

test('al agotar el contexto se revisa la solicitud completa sin descartar instrucciones ni gastar otra llamada', async ({
  page,
}) => {
  const calls = await abrirAsistente(page);
  const input = page.getByTestId('entrada-asistente');
  for (let i = 0; i < 6; i++) {
    await input.fill(i === 0 ? 'No borres Persona. Agrega correo.' : `Aclaracion ${i}`);
    await page.getByTestId('enviar-asistente').click();
    await expect(
      page.getByTestId('conversacion').getByText('¿Qué atributo quieres añadir?', { exact: true }),
    ).toHaveCount(i + 1);
  }
  await expect(page.getByTestId('revisar-contexto')).toBeVisible();
  await input.fill('Tambien conserva Estudiante.');
  await expect(page.getByTestId('enviar-asistente')).toBeDisabled();
  expect(calls).toHaveLength(6);
  await page.getByTestId('revisar-contexto').click();
  await expect(input).toHaveValue(/No borres Persona/);
  await expect(input).toHaveValue(/Aclaracion 1/);
  await expect(input).toHaveValue(/Aclaracion 5/);
  await expect(input).toHaveValue(/Tambien conserva Estudiante/);
  await expect(page.getByTestId('enviar-asistente')).toBeEnabled();
  expect(calls).toHaveLength(6);
});

test('las pausas no envían; Parar prepara el texto y Enviar hace una sola solicitud', async ({
  page,
}, info) => {
  const calls = await abrirAsistente(page);
  await page.getByTestId('dictar').click();
  await voz(page, 'result', 'eh, hola, por favor quiero que agregues correo a Cliente');
  await voz(page, 'end');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __speechTest: SpeechControl }).__speechTest.starts,
      ),
    )
    .toBe(2);
  await voz(page, 'result', 'no borres Venta');
  await expect(page.getByTestId('dictar')).toHaveText('Parar');
  await expect(page.getByTestId('entrada-asistente')).toHaveValue(/Cliente no borres Venta$/);
  await expect(page.getByTestId('enviar-asistente')).toBeDisabled();
  expect(calls).toHaveLength(0);

  await page.getByTestId('dictar').click();
  await expect(page.getByTestId('revision-dictado')).toBeVisible();
  await expect(page.getByTestId('entrada-asistente')).toHaveValue(
    'agregues correo a Cliente no borres Venta',
  );
  expect(calls).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('dictado-revisable.png') });
  await page.getByTestId('enviar-asistente').dblclick();
  await expect(page.getByTestId('conversacion')).toContainText('¿Qué atributo quieres añadir?');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.instruction).toBe('agregues correo a Cliente no borres Venta');
});

test('cancelar conserva el texto previo y recuperar original restaura todo el dictado', async ({
  page,
}) => {
  const calls = await abrirAsistente(page);
  const input = page.getByTestId('entrada-asistente');
  await input.fill('No borres Cliente.');
  await page.getByTestId('dictar').click();
  await voz(page, 'result', 'agrega correo');
  await page.getByRole('button', { name: 'Cancelar dictado' }).click();
  await expect(input).toHaveValue('No borres Cliente.');
  await voz(page, 'result', 'resultado tardío');
  await expect(input).toHaveValue('No borres Cliente.');
  await input.fill('');
  await page.getByTestId('dictar').click();
  const original = 'hola, por favor quiero que agregues email String a Cliente';
  await voz(page, 'result', original);
  await page.getByTestId('dictar').click();
  await page.getByRole('button', { name: 'Recuperar dictado original' }).click();
  await expect(input).toHaveValue(original);
  expect(calls).toHaveLength(0);
});

test('un dictado largo se conserva completo y pide acortarlo antes de gastar una solicitud', async ({
  page,
}) => {
  const calls = await abrirAsistente(page);
  const original = 'agrega nombre String. '.repeat(100) + 'No elimines Persona.';
  await page.getByTestId('dictar').click();
  await voz(page, 'result', original);
  await page.getByTestId('dictar').click();
  await expect(page.getByTestId('entrada-asistente')).toHaveValue(original);
  await expect(page.getByTestId('enviar-asistente')).toBeDisabled();
  await expect(page.getByText(/Acorta el texto antes de enviar/)).toBeVisible();
  expect(calls).toHaveLength(0);
});

test('denegar el micrófono no envía ni pierde el borrador y Consultar usa su ruta', async ({
  page,
}) => {
  const calls = await abrirAsistente(page);
  const draft = '  Hola, por favor quiero que no borres Cliente.  ';
  await page.getByTestId('entrada-asistente').fill(draft);
  await page.getByTestId('dictar').click();
  await voz(page, 'error', 'not-allowed');
  await expect(page.getByText(/Revisa el permiso del navegador/)).toBeVisible();
  await expect(page.getByTestId('entrada-asistente')).toHaveValue(draft);
  expect(calls).toHaveLength(0);
  await page.getByTestId('modo-preguntar').click();
  await page.getByTestId('entrada-asistente').fill('');
  await page.getByTestId('dictar').click();
  await voz(page, 'result', '¿Cuántas clases hay?');
  await page.getByTestId('dictar').click();
  expect(calls).toHaveLength(0);
  await page.getByTestId('enviar-asistente').click();
  await expect(page.getByTestId('conversacion')).toContainText('La pizarra está vacía.');
  expect(calls).toEqual([
    { question: '¿Cuántas clases hay?', model: { classes: [], relationships: [] } },
  ]);
});

test('cancelar la solicitud recupera el texto y evita mostrar respuestas tardías', async ({
  page,
}) => {
  await abrirAsistente(page);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route('**/assistant/question', async (route) => {
    started = true;
    await waiting;
    await route
      .fulfill({ json: { answer: 'Respuesta tardía que debe ignorarse.' } })
      .catch(() => undefined);
  });
  try {
    await page.getByTestId('modo-preguntar').click();
    await page.getByTestId('entrada-asistente').fill('¿Qué atributos faltan?');
    await page.getByTestId('enviar-asistente').click();
    await expect.poll(() => started).toBe(true);
    await page.getByTestId('cancelar-solicitud').click();
    await expect(page.getByTestId('entrada-asistente')).toHaveValue('¿Qué atributos faltan?');
    await expect(page.getByTestId('enviar-asistente')).toBeEnabled();
    release();
    await expect(page.getByTestId('conversacion')).toContainText('Solicitud cancelada');
    await expect(page.getByTestId('conversacion')).not.toContainText('Respuesta tardía');
  } finally {
    release();
  }
});
