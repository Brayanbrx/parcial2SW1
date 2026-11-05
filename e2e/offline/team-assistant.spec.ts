import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_AI_SETTINGS, type TeamMessage, type TeamRequestBody } from '@uml/contracts';
import { installCommandSpeech, speakCommand } from '../support/voice-command.js';

const boardId = '00000000-0000-4000-8000-000000000010';
const projectId = '00000000-0000-4000-8000-000000000020';
const userId = '00000000-0000-4000-8000-000000000001';

// UI real con errores deterministas del worker; la suite de integración cubre PostgreSQL.
async function setup(
  page: Page,
  status: 'FAILED' | 'INTERRUPTED' | 'CANCELLED',
  clarification = false,
) {
  const messages: TeamMessage[] = [];
  const requests: TeamRequestBody[] = [];
  let time = Date.now();
  const stamp = () => new Date(++time).toISOString();
  const makeRequest = (body: TeamRequestBody): Extract<TeamMessage, { authorKind: 'USER' }> => ({
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
      status: null,
      errorCode: null,
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  }
  await page.route(`**/api/boards/${boardId}`, (route) =>
    route.fulfill({
      json: { id: boardId, projectId, displayName: 'Prueba', room: boardId, role: 'EDITOR' },
    }),
  );
  await page.route(`**/api/projects/${projectId}/ai-settings`, (route) =>
    route.fulfill({ json: { ...DEFAULT_AI_SETTINGS, projectId, updatedAt: stamp() } }),
  );
  await page.route(`**/api/boards/${boardId}/team-ai/messages**`, async (route) => {
    if (route.request().url().endsWith('/cancel')) {
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      const index = messages.findIndex((message) => message.id === id);
      const message = messages[index];
      if (message?.authorKind !== 'USER') throw new Error('Solicitud inexistente');
      messages[index] = { ...message, status: 'CANCELLED', updatedAt: stamp() };
      await route.fulfill({ json: messages[index] });
    } else if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as TeamRequestBody;
      requests.push(body);
      const accepted = makeRequest(body);
      messages.push({
        ...accepted,
        status: status === 'CANCELLED' ? 'QUEUED' : status,
        errorCode: status === 'CANCELLED' ? null : 'team_ai_failed',
        updatedAt: stamp(),
      });
      await route.fulfill({ status: 202, json: accepted });
    } else {
      await route.fulfill({
        json: { messages, proposals: [], nextCursor: String(time), hasMore: false },
      });
    }
  });
  await page.goto('/entrar');
  await page.getByTestId('email').fill('ana@example.com');
  await page.getByTestId('password').fill('password-test');
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
  await page.goto(`/pizarras/${boardId}`);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.getByTestId('pestana-asistente').click();
  return { requests, clarificationId };
}

test.beforeEach(async ({ request }) => {
  await request.post('/test/reset');
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
