import { expect, test, type Page } from '@playwright/test';
import { montarEscenario } from '../support/escenario.js';
import { crearClase } from '../support/actors.js';
import { hablarConIa } from '../support/destino.js';

async function send(page: Page, text: string) {
  await hablarConIa(page);
  await page.getByTestId('entrada-asistente').fill(text);
  await page.getByTestId('enviar-asistente').click();
}

test('contexto real Beto/Ana/Beto: tema compartido, cambio de tema y memoria personal', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Contexto real');
  try {
    const { ana, beto } = scenario;
    for (const actor of [ana, beto]) await actor.page.getByTestId('modo-preguntar').click();
    await send(beto.page, '¿Qué es un atributo derivado?');
    await expect(ana.page.getByTestId('conversacion')).toContainText(
      'beto, sobre tu consulta: Un atributo derivado',
    );
    await send(ana.page, '¿Eso aplica a Venta?');
    await expect(beto.page.getByTestId('conversacion')).toContainText(
      'ana, sobre la consulta de beto: Un atributo derivado',
    );
    await send(ana.page, 'Explica herencia');
    await expect(beto.page.getByTestId('conversacion')).toContainText(
      'ana, sobre tu consulta: La herencia',
    );
    await send(beto.page, 'Dame otro ejemplo');
    for (const actor of [ana, beto]) {
      await expect(actor.page.locator('[data-message-id]')).toHaveCount(8);
      const last = actor.page.locator('[data-message-id]').last();
      await expect(last).toContainText('IA → beto');
      await expect(last).toContainText('Un atributo derivado');
      await expect(last).not.toContainText('La herencia');
    }
    await beto.page.reload();
    await expect(beto.page.locator('[data-message-id]')).toHaveCount(8);
    await expect(beto.page.locator('[data-message-id]').last()).toContainText(
      'Un atributo derivado',
    );
  } finally {
    await scenario.cerrar();
  }
});

test('aclaración real conserva opciones y dueño; recarga no reanuda y Empezar de nuevo limpia la cadena', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Aclaraciones reales');
  try {
    const { ana, beto } = scenario;
    await crearClase(ana, 'Cliente');
    await crearClase(ana, 'Proveedor');
    const requests: { text: string; replyToId: string | null }[] = [];
    ana.page.on('request', (request) => {
      if (request.method() === 'POST' && /\/team-ai\/messages$/.test(request.url()))
        requests.push(request.postDataJSON());
    });
    await send(ana.page, 'agrega correo tipo String a Fantasma');
    await expect(ana.page.getByTestId('conversacion')).toContainText(/[12]\. "Cliente"/);
    await expect(ana.page.getByTestId('conversacion')).toContainText(/[12]\. "Proveedor"/);
    // La proyección Yjs ordena por IDs: la posición no depende del orden de creación.
    const displayed = await ana.page.getByTestId('conversacion').innerText();
    const clientOption = displayed.match(/([12])\. "Cliente"/)![1];
    await expect(ana.page.getByTestId('contexto-asistente')).toContainText(
      'recordaré la solicitud anterior',
    );
    await expect(beto.page.getByRole('button', { name: 'Responder aclaración' })).toHaveCount(0);
    await ana.page.reload();
    await expect(ana.page.getByRole('button', { name: 'Responder aclaración' })).toBeVisible();
    await expect(ana.page.getByTestId('contexto-asistente')).toHaveCount(0);
    await ana.page.getByRole('button', { name: 'Responder aclaración' }).click();
    await expect(ana.page.getByTestId('contexto-asistente')).toBeVisible();
    await send(ana.page, clientOption === '1' ? 'la primera' : 'la segunda');
    await expect(ana.page.getByTestId('propuesta')).toContainText('correo');
    await expect(ana.page.getByTestId('contexto-asistente')).toHaveCount(0);
    await ana.page.getByTestId('aplicar-propuesta').click();
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('correo');
    await send(ana.page, 'agrega telefono tipo String');
    await expect(ana.page.getByTestId('contexto-asistente')).toBeVisible();
    await ana.page.getByTestId('descartar-contexto').click();
    await expect(ana.page.getByTestId('contexto-asistente')).toHaveCount(0);
    await send(ana.page, 'Crea Factura');
    const lastProposal = ana.page.getByTestId('propuesta').last();
    await expect(lastProposal).toContainText('Factura');
    await expect(lastProposal).not.toContainText('telefono');
    expect(requests).toHaveLength(4);
    expect(requests[1]!.replyToId).not.toBeNull();
    expect(requests[3]!.replyToId).toBeNull();
  } finally {
    await scenario.cerrar();
  }
});
