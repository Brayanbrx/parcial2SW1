import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  DEFAULT_AI_SETTINGS,
  teamChatBodySchema,
  teamMessageSchema,
  teamRequestBodySchema,
  teamRequestKind,
  type TeamChatBody,
  type TeamMessage,
  type TeamRequestBody,
  type TeamRequestMessage,
} from '@uml/contracts';
import { commandSpeech, installCommandSpeech, speakCommand } from '../support/voice-command.js';
import { hablarConIa } from '../support/destino.js';

const boardId = '00000000-0000-4000-8000-000000000010';
const projectId = '00000000-0000-4000-8000-000000000020';
const userId = '00000000-0000-4000-8000-000000000001';

async function openBoard(page: Page) {
  await page.route(`**/api/boards/${boardId}`, (route) =>
    route.fulfill({
      json: { id: boardId, projectId, displayName: 'Prueba', room: boardId, role: 'EDITOR' },
    }),
  );
  await page.route(`**/api/projects/${projectId}/ai-settings`, (route) =>
    route.fulfill({
      json: { ...DEFAULT_AI_SETTINGS, projectId, updatedAt: new Date().toISOString() },
    }),
  );
  await page.goto('/entrar');
  await page.getByTestId('email').fill('ana@example.com');
  await page.getByTestId('password').fill('password-test');
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
  await page.goto(`/pizarras/${boardId}`);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.getByTestId('pestana-asistente').click();
}

// UI real con errores deterministas del worker; la suite de integración cubre PostgreSQL.
async function setup(
  page: Page,
  status: 'FAILED' | 'INTERRUPTED' | 'CANCELLED',
  clarification = false,
  loseFirstResponse = false,
) {
  const messages: TeamMessage[] = [];
  const requests: TeamRequestBody[] = [];
  let time = Date.now();
  const stamp = () => new Date(++time).toISOString();
  const makeRequest = (body: TeamRequestBody): TeamRequestMessage => ({
    id: randomUUID(),
    boardId,
    authorKind: 'USER',
    authorId: userId,
    addressedToId: null,
    clientRequestId: body.clientRequestId,
    replyToId: body.replyToId,
    mode: body.mode,
    inputMode: body.inputMode,
    kind: 'INSTRUCTION',
    text: body.text,
    mentions: body.mentions,
    status: 'QUEUED',
    errorCode: null,
    createdAt: stamp(),
    updatedAt: stamp(),
  });
  const clarificationId = randomUUID();
  if (clarification) {
    const request = makeRequest({
      clientRequestId: randomUUID(),
      replyToId: null,
      mode: 'INSTRUCT',
      inputMode: 'TEXT',
      text: 'Añade un atributo a Cliente',
      model: { classes: [], relationships: [] },
      mentions: [],
    });
    messages.push({ ...request, status: 'DONE' });
    messages.push({
      ...request,
      id: clarificationId,
      authorKind: 'AI',
      authorId: null,
      addressedToId: userId,
      clientRequestId: null,
      replyToId: request.id,
      mode: null,
      inputMode: null,
      kind: 'CLARIFICATION',
      text: '¿Cómo se llama el atributo?',
      mentions: [],
      status: null,
      errorCode: null,
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  }
  await page.route(`**/api/boards/${boardId}/team-ai/messages**`, async (route) => {
    if (route.request().url().endsWith('/cancel')) {
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      const index = messages.findIndex((message) => message.id === id);
      const message = messages[index];
      if (message?.authorKind !== 'USER' || message.kind === 'CHAT')
        throw new Error('Solicitud inexistente');
      messages[index] = { ...message, status: 'CANCELLED', updatedAt: stamp() };
      await route.fulfill({ json: messages[index] });
    } else if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as TeamRequestBody;
      requests.push(body);
      const existing = messages.find((message) => message.clientRequestId === body.clientRequestId);
      if (existing) {
        await route.fulfill({ status: 202, json: existing });
        return;
      }
      const accepted = makeRequest(body);
      messages.push({
        ...accepted,
        status: status === 'CANCELLED' ? 'QUEUED' : status,
        errorCode: status === 'CANCELLED' ? null : 'team_ai_failed',
        updatedAt: stamp(),
      });
      if (loseFirstResponse && requests.length === 1) {
        await route.abort('connectionreset');
        return;
      }
      await route.fulfill({ status: 202, json: accepted });
    } else {
      await route.fulfill({
        json: { messages, proposals: [], nextCursor: String(time), hasMore: false },
      });
    }
  });
  await openBoard(page);
  return { requests, clarificationId };
}

test.beforeEach(async ({ request }) => {
  await request.post('/test/reset');
});

test('al ocultar la conversación interrumpe el dictado y conserva el texto reconocido', async ({
  page,
}) => {
  const { requests } = await setup(page, 'FAILED');
  await installCommandSpeech(page);
  const composer = page.getByTestId('entrada-asistente');
  const dictate = page.getByTestId('dictar');
  await composer.fill('Crea Cliente');
  await dictate.click();
  await expect(dictate).toHaveText('Parar');
  await commandSpeech(page, 'result', 'con nombre', false);
  await expect(composer).toHaveValue('Crea Cliente con nombre');

  await page.getByTestId('pestana-importar').click();
  await expect(dictate).toBeHidden();
  await commandSpeech(page, 'result', 'texto recibido después de ocultar el panel');
  await page.getByTestId('pestana-asistente').click();
  await expect(dictate).toHaveText('Dictar');
  await expect(composer).toHaveValue('Crea Cliente con nombre');
  expect(requests).toHaveLength(0);
});

test('termina de cargar el historial antes de contar mensajes nuevos con el panel oculto', async ({
  page,
}) => {
  const stamp = '2026-11-01T00:00:00.000Z';
  const message = (text: string): TeamMessage => ({
    id: randomUUID(),
    boardId,
    authorKind: 'USER',
    authorId: '00000000-0000-4000-8000-000000000002',
    addressedToId: null,
    clientRequestId: randomUUID(),
    replyToId: null,
    mode: 'ASK',
    inputMode: 'TEXT',
    kind: 'QUESTION',
    text,
    mentions: [],
    status: 'DONE',
    errorCode: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const firstPage = Array.from({ length: 100 }, (_, i) => message(`Mensaje anterior ${i}`));
  const last = message('Último mensaje del historial');
  const next = message('Mensaje nuevo');
  let secondPageRequested = false;
  let deliverNew = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/boards/${boardId}/team-ai/messages**`, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('changedSince');
    const send = (messages: TeamMessage[], nextCursor: string, hasMore = false) =>
      route.fulfill({ json: { messages, proposals: [], nextCursor, hasMore } });
    if (cursor === 'start') return send(firstPage, 'first', true);
    if (cursor === 'first') {
      secondPageRequested = true;
      await gate;
      return send([last], 'last');
    }
    if (cursor === 'last' && deliverNew) return send([next], 'new');
    return send([], cursor ?? 'last');
  });
  try {
    await openBoard(page);
    await expect.poll(() => secondPageRequested).toBe(true);
    await expect(page.getByText('Mensaje anterior 99', { exact: true })).toBeVisible();
    await page.getByTestId('pestana-importar').click();
    release();
    await expect(page.getByText(last.text, { exact: true })).toBeAttached();
    const badge = page.getByTestId('ia-mensajes-nuevos');
    await expect(badge).toHaveCount(0);

    deliverNew = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(badge).toHaveText('1');
  } finally {
    release();
  }
});

test('reutiliza la misma solicitud si se pierde la respuesta y luego cambia la pizarra', async ({
  page,
}) => {
  const { requests } = await setup(page, 'FAILED', false, true);
  const composer = page.getByTestId('entrada-asistente');
  await hablarConIa(page);
  await composer.fill('Crea la clase Cliente');
  await page.getByTestId('enviar-asistente').click();
  await expect(page.getByText('No se pudo contactar al servidor.', { exact: true })).toBeVisible();

  await page.getByTestId('crear-clase').click();
  await page.getByTestId('nombre-clase').fill('Producto');
  await page.getByTestId('nombre-clase').press('Tab');
  await expect(page.getByTestId('clase-Producto')).toBeVisible();
  await page.getByTestId('enviar-asistente').click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
});

for (const status of ['FAILED', 'INTERRUPTED', 'CANCELLED'] as const) {
  test(`un reintento tras ${status} conserva el hilo de aclaración`, async ({ page }) => {
    const { requests, clarificationId } = await setup(page, status, true);
    await page.getByRole('button', { name: 'Responder aclaración' }).click();
    await page.getByTestId('entrada-asistente').fill('correo');
    await page.getByTestId('enviar-asistente').click();
    if (status === 'CANCELLED') {
      await page.getByTestId('cancelar-solicitud').click();
      await expect(page.getByTestId('conversacion')).toContainText('Solicitud cancelada');
    } else {
      await expect(page.getByRole('button', { name: 'Reintentar con este texto' })).toBeVisible();
    }
    await expect(page.getByTestId('entrada-asistente')).toHaveValue('correo');
    await expect(page.getByTestId('contexto-asistente')).toBeVisible();
    await page.getByTestId('enviar-asistente').click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests.map((body) => body.replyToId)).toEqual([clarificationId, clarificationId]);
    expect(requests[0]!.clientRequestId).not.toBe(requests[1]!.clientRequestId);
  });
}

test('un comando de voz fallido conserva el borrador escrito y permite recuperar su transcripción', async ({
  page,
}) => {
  await setup(page, 'FAILED');
  await installCommandSpeech(page);
  await page.getByTestId('entrada-asistente').fill('Borrador pendiente de otra consulta');
  await speakCommand(page, 'Crea Factura');
  const retry = page.getByRole('button', { name: 'Reintentar con este texto' });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('entrada-asistente')).toHaveValue(
    'Borrador pendiente de otra consulta',
  );
  await expect(page.getByTestId('transcripcion-comando-voz')).toContainText('Crea Factura');
  await retry.click();
  await expect(page.getByTestId('entrada-asistente')).toHaveValue('Crea Factura');
});

for (const draft of ['', 'Borrador pendiente']) {
  test(`cancelar voz recupera la transcripción sin reemplazar el borrador ${JSON.stringify(draft)}`, async ({
    page,
  }) => {
    await setup(page, 'CANCELLED');
    await installCommandSpeech(page);
    await page.getByTestId('entrada-asistente').fill(draft);
    await speakCommand(page, 'Crea Factura');
    await page.getByTestId('cancelar-solicitud').click();
    await expect(page.getByTestId('conversacion')).toContainText('Solicitud cancelada');
    await expect(page.getByTestId('entrada-asistente')).toHaveValue(draft || 'Crea Factura');
    await expect(page.getByTestId('transcripcion-comando-voz')).toContainText('Crea Factura');
  });
}

test('escribe al equipo con menciones por ID y @IA convierte solo ese mensaje en solicitud', async ({
  page,
}, info) => {
  const betoId = '00000000-0000-4000-8000-000000000002';
  const otroBetoId = '00000000-0000-4000-8000-000000000003';
  const messages: TeamMessage[] = [];
  const chats: TeamChatBody[] = [];
  const requests: TeamRequestBody[] = [];
  let time = Date.now();
  const stamp = () => new Date(++time).toISOString();
  await page.route(`**/api/projects/${projectId}/members`, (route) =>
    route.fulfill({
      json: [
        { id: userId, email: 'ana@example.com', displayName: 'Ana', role: 'OWNER' },
        { id: betoId, email: 'beto@example.com', displayName: 'Beto Díaz', role: 'EDITOR' },
        { id: otroBetoId, email: 'otro@example.com', displayName: 'Beto Díaz', role: 'VIEWER' },
      ],
    }),
  );
  await page.route(`**/api/boards/${boardId}/team-ai/chat`, async (route) => {
    const body = teamChatBodySchema.parse(route.request().postDataJSON());
    chats.push(body);
    const now = stamp();
    const message = teamMessageSchema.parse({
      ...body,
      id: randomUUID(),
      boardId,
      authorKind: 'USER',
      authorId: userId,
      addressedToId: null,
      replyToId: null,
      mode: null,
      kind: 'CHAT',
      status: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    messages.push(message);
    await route.fulfill({ status: 201, json: message });
  });
  await page.route(`**/api/boards/${boardId}/team-ai/messages**`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({
        json: { messages, proposals: [], nextCursor: String(time), hasMore: false },
      });
      return;
    }
    const body = teamRequestBodySchema.parse(route.request().postDataJSON());
    requests.push(body);
    const { model: _model, ...rest } = body;
    const now = stamp();
    const request = teamMessageSchema.parse({
      ...rest,
      id: randomUUID(),
      boardId,
      authorKind: 'USER',
      authorId: userId,
      addressedToId: null,
      kind: teamRequestKind[body.mode],
      status: 'DONE',
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    const answered = stamp();
    messages.push(request, {
      ...request,
      id: randomUUID(),
      authorKind: 'AI',
      authorId: null,
      addressedToId: userId,
      replyToId: request.id,
      clientRequestId: null,
      mode: null,
      inputMode: null,
      kind: 'ANSWER',
      text: 'Una composición es una relación todo-parte.',
      mentions: [],
      status: null,
      errorCode: null,
      createdAt: answered,
      updatedAt: answered,
    });
    await route.fulfill({ status: 202, json: request });
  });
  await openBoard(page);
  const composer = page.getByTestId('entrada-asistente');
  const team = page.getByTestId('destino-equipo');
  await expect(team).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveAttribute('role', 'combobox');

  // Dos personas se llaman igual: lo elegido en la lista decide a quién se avisa.
  await composer.fill('hola @be');
  await expect(composer).toHaveAttribute('aria-expanded', 'true');
  const options = page.getByTestId('sugerencias-mencion').getByRole('option');
  await expect(options).toHaveCount(2);
  await composer.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page
    .getByTestId('asistente')
    .screenshot({ path: info.outputPath('sugerencias-mencion.png') });
  await expect(composer).toHaveAttribute(
    'aria-activedescendant',
    (await options.nth(1).getAttribute('id'))!,
  );
  await composer.press('Enter');
  await expect(composer).toHaveValue('hola @Beto Díaz ');
  await composer.pressSequentially('¿revisas Pedido?');
  // Shift + Enter salta de línea; Enter envía y la caja queda lista para seguir.
  await composer.press('Shift+Enter');
  await composer.pressSequentially('gracias');
  expect(chats).toHaveLength(0);
  await composer.press('Enter');
  await expect.poll(() => chats.length).toBe(1);
  expect(chats[0]).toMatchObject({
    text: 'hola @Beto Díaz ¿revisas Pedido?\ngracias',
    mentions: [otroBetoId],
  });
  await expect(composer).toHaveValue('');
  await expect(composer).toBeFocused();
  await expect(page.getByRole('button', { name: 'Cancelar solicitud' })).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await expect(page.getByTestId('conversacion')).toContainText('Ana → Beto Díaz');
  await expect(page.locator('.team-mencion')).toHaveText('@Beto Díaz');

  // Escape cierra las sugerencias sin tocar el texto.
  await composer.fill('@');
  await expect(composer).toHaveAttribute('aria-expanded', 'true');
  await composer.press('Escape');
  await expect(composer).toHaveAttribute('aria-expanded', 'false');
  await expect(composer).toHaveValue('@');
  await composer.fill('');

  // «@IA » cambia el destino de ese mensaje y no queda en el texto.
  await page.getByTestId('modo-preguntar').click();
  await team.click();
  await composer.pressSequentially('@IA ¿qué es una composición?');
  await expect(page.getByTestId('modo-preguntar')).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('¿qué es una composición?');
  await page.getByTestId('enviar-asistente').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    mode: 'ASK',
    text: '¿qué es una composición?',
    mentions: [],
  });
  await expect(page.getByTestId('conversacion')).toContainText('Ana → IA');
  await expect(page.getByTestId('conversacion')).toContainText('IA → Ana');
  // Tras ese mensaje se vuelve a escribir al equipo.
  await expect(team).toHaveAttribute('aria-pressed', 'true');
  expect(chats).toHaveLength(1);
  await page
    .getByTestId('asistente')
    .screenshot({ path: info.outputPath('conversacion-equipo.png') });
});
