import { expect, test, type Page } from '@playwright/test';
import { resolveProposal } from '@uml/ai';
import { createTeamAiMock } from '../support/team-ai.js';
import { montarEscenario } from '../support/escenario.js';
import { aceptarInvitacion, crearClase, registrarActor, type Actor } from '../support/actors.js';
import { hablarConIa } from '../support/destino.js';

async function session(actor: Actor) {
  const response = await actor.page.request.post('/api/auth/login', {
    data: { email: actor.email, password: 'contrasena-de-prueba' },
  });
  expect(response.ok()).toBe(true);
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { authorization: `Bearer ${accessToken}` };
}
async function send(page: Page, text: string) {
  await hablarConIa(page);
  await page.getByTestId('entrada-asistente').fill(text);
  await page.getByTestId('enviar-asistente').click();
}

test('tres cuentas comparten feed durable, configuración OWNER y consulta VIEWER tras recargar', async ({
  browser,
}, info) => {
  const scenario = await montarEscenario(browser, 'Feed real');
  const carla = await registrarActor(browser, 'carla');
  try {
    const { ana, beto } = scenario;
    const errors: string[] = [];
    for (const actor of [ana, beto, carla])
      actor.page.on('pageerror', (error) => errors.push(error.message));
    const headers = await session(ana);
    const boardId = new URL(ana.page.url()).pathname.split('/').pop()!;
    const board = (await (
      await ana.page.request.get(`/api/boards/${boardId}`, { headers })
    ).json()) as { projectId: string };
    const invitation = await ana.page.request.post(`/api/projects/${board.projectId}/invites`, {
      headers,
      data: { role: 'VIEWER' },
    });
    const { code } = (await invitation.json()) as { code: string };
    await aceptarInvitacion(carla, code);
    await carla.page.goto(ana.page.url());
    for (const actor of [ana, beto, carla]) {
      await expect(actor.page.getByTestId('estado-conexion')).toHaveText('En vivo');
      await actor.page.getByTestId('pestana-asistente').click();
      await actor.page.getByTestId('modo-preguntar').click();
    }
    await expect(carla.page.getByTestId('modo-instruir')).toBeDisabled();
    await expect(beto.page.getByRole('button', { name: 'Configurar IA' })).toHaveCount(0);
    await send(beto.page, '¿Qué es un atributo derivado?');
    for (const actor of [ana, beto, carla]) {
      await expect(actor.page.getByTestId('conversacion')).toContainText(
        '¿Qué es un atributo derivado?',
      );
      await expect(actor.page.getByTestId('conversacion')).toContainText('beto');
    }
    await carla.page.getByTestId('modo-revisar').click();
    await send(carla.page, 'Quiero revisar las clases.');
    await expect(ana.page.getByTestId('conversacion')).toContainText('carla');
    await carla.page.reload();
    await carla.page.getByTestId('pestana-asistente').click();
    // El worker del paso 6 completa ambas solicitudes y persiste sus respuestas.
    await expect(carla.page.locator('[data-message-id]')).toHaveCount(4);
    await expect(carla.page.getByTestId('conversacion')).toContainText('IA → beto');
    await expect(carla.page.getByTestId('conversacion')).toContainText('IA → carla');
    await carla.page.getByLabel('Mis intervenciones').check();
    await expect(carla.page.locator('[data-message-id]')).toHaveCount(2);
    await carla.page.getByLabel('Mis intervenciones').uncheck();
    // Cancelar un proveedor en vuelo se prueba de forma controlada en integración;
    // una respuesta mock terminada ya no debe ofrecer cancelación.
    await expect(carla.page.getByRole('button', { name: 'Cancelar esta solicitud' })).toHaveCount(
      0,
    );
    await carla.page.context().setOffline(true);
    await expect(carla.page.getByTestId('enviar-asistente')).toBeDisabled();
    await send(ana.page, 'Mensaje durante la desconexión');
    await carla.page.context().setOffline(false);
    await expect(carla.page.getByTestId('conversacion')).toContainText(
      'Mensaje durante la desconexión',
    );
    await expect(carla.page.locator('[data-message-id]')).toHaveCount(6);
    const configure = ana.page.getByRole('button', { name: 'Configurar IA' });
    await configure.focus();
    await ana.page.keyboard.press('Enter');
    const dialog = ana.page.getByRole('dialog', { name: 'IA del proyecto' });
    await expect(dialog).toBeVisible();
    await ana.page.keyboard.press('Escape');
    await expect(configure).toBeFocused();
    await ana.page.keyboard.press('Enter');
    await dialog
      .getByRole('combobox', { name: 'Respuestas', exact: true })
      .selectOption('HINTS_ONLY');
    await dialog.getByLabel('Habilitar nuevas solicitudes').uncheck();
    await dialog.getByRole('button', { name: 'Guardar configuración' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      beto.page.getByText(
        'La IA está deshabilitada en este proyecto. El equipo puede seguir conversando aquí.',
      ),
    ).toBeVisible();
    await expect(carla.page.getByTestId('enviar-asistente')).toBeDisabled();
    for (const width of [320, 768, 1024, 1440]) {
      await ana.page.setViewportSize({ width, height: 900 });
      await expect(ana.page.getByTestId('entrada-asistente')).toBeVisible();
      expect(
        await ana.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await ana.page.screenshot({ path: info.outputPath(`feed-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
    await ana.page.screenshot({ path: info.outputPath('feed-colectivo.png'), fullPage: true });
  } finally {
    await carla.close();
    await scenario.cerrar();
  }
});

test('propuesta compartida: solo el solicitante confirma, recargar no aplica y rechazo llega al equipo', async ({
  browser,
}, info) => {
  const scenario = await montarEscenario(browser, 'Propuesta grupal');
  const mock = createTeamAiMock((turn) =>
    resolveProposal({
      model: turn.model,
      actorId: turn.authorId,
      origin: 'AI_TEXT',
      proposal: { operations: [{ op: 'DELETE_CLASS', className: 'Cliente' }] },
    }),
  );
  try {
    const { ana, beto } = scenario;
    await mock.install(ana.page);
    await mock.install(beto.page);
    await crearClase(ana, 'Cliente');
    for (const attribute of ['nombre', 'correo']) {
      await ana.page.getByTestId('nuevo-atributo').fill(attribute);
      await ana.page.getByRole('button', { name: 'Añadir', exact: true }).click();
      await expect(ana.page.getByTestId('clase-Cliente')).toContainText(attribute);
    }
    await expect(beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await send(ana.page, 'Elimina Cliente');
    await expect(ana.page.getByTestId('confirmacion')).toContainText('¿Confirmas?');
    await expect(beto.page.getByTestId('propuesta')).toContainText('Pendiente de confirmación');
    await expect(beto.page.getByTestId('aplicar-propuesta')).toHaveCount(0);
    await expect(beto.page.getByTestId('confirmacion')).toHaveCount(0);
    await expect(beto.page.getByTestId('conversacion')).toContainText('IA → ana');
    await ana.page.reload();
    await expect(ana.page.getByTestId('propuesta')).toBeVisible();
    await expect(ana.page.getByTestId('clase-Cliente')).toBeVisible();
    await ana.page.getByRole('button', { name: 'Rechazar', exact: true }).click();
    await expect(beto.page.getByTestId('propuesta')).toContainText('Propuesta rechazada');
    await expect(ana.page.getByTestId('clase-Cliente')).toBeVisible();
    await send(ana.page, 'Elimina Cliente');
    const ownCard = ana.page.getByTestId('propuesta').last();
    await expect(ownCard.getByRole('button', { name: 'Sí, aplicar' })).toBeVisible();
    await ana.page.screenshot({ path: info.outputPath('confirmacion-solicitante.png') });
    await ownCard.getByRole('button', { name: 'Sí, aplicar' }).click();
    await expect(beto.page.getByTestId('clase-Cliente')).toHaveCount(0);
    await expect(beto.page.getByTestId('propuesta').last()).toContainText('Aplicado.');
  } finally {
    await scenario.cerrar();
  }
});

test('reintenta tras fallo de red con la misma clave sin duplicar la solicitud', async ({
  browser,
}) => {
  const actor = await registrarActor(browser, 'reintento');
  const { crearProyecto, crearPizarra, abrirPizarra } = await import('../support/actors.js');
  const mock = createTeamAiMock();
  try {
    await crearProyecto(actor, 'Reintento');
    await crearPizarra(actor, 'Red');
    await abrirPizarra(actor, 'Red');
    await mock.install(actor.page);
    const ids: string[] = [];
    let lost = false;
    await actor.page.route('**/team-ai/messages', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      const body = route.request().postDataJSON() as { clientRequestId: string };
      ids.push(body.clientRequestId);
      if (!lost) {
        lost = true;
        await route.abort('failed');
      } else await route.fallback();
    });
    await actor.page.getByTestId('modo-preguntar').click();
    await send(actor.page, 'Consulta conservada');
    await expect(actor.page.getByRole('alert')).toContainText('No se pudo contactar');
    await expect(actor.page.getByTestId('entrada-asistente')).toHaveValue('Consulta conservada');
    await actor.page.getByTestId('enviar-asistente').click();
    await expect(actor.page.getByTestId('conversacion')).toContainText('Consulta conservada');
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(mock.requests).toHaveLength(1);
  } finally {
    await actor.close();
  }
});

test('worker real propone por texto, solo el solicitante aplica y la auditoría confirma al equipo', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Worker real');
  try {
    const { ana, beto } = scenario;
    await ana.page.getByTestId('modo-instruir').click();
    await send(ana.page, 'Crea la clase Producto');
    const proposal = ana.page.getByTestId('propuesta');
    await expect(proposal).toContainText('Producto');
    await expect(beto.page.getByTestId('propuesta')).toContainText('Producto');
    await expect(ana.page.getByTestId('clase-Producto')).toHaveCount(0);
    await expect(beto.page.getByTestId('aplicar-propuesta')).toHaveCount(0);
    await proposal.getByTestId('aplicar-propuesta').click();
    await expect(ana.page.getByTestId('clase-Producto')).toBeVisible();
    await expect(beto.page.getByTestId('clase-Producto')).toBeVisible();
    await expect(beto.page.getByTestId('propuesta')).toContainText('Aplicado.');
    await ana.page.reload();
    await expect(ana.page.getByTestId('propuesta')).toContainText('Aplicado.');
    await expect(ana.page.getByTestId('clase-Producto')).toHaveCount(1);
    await expect(ana.page.locator('[data-message-id]')).toHaveCount(2);
  } finally {
    await scenario.cerrar();
  }
});
