import { expect, test } from '@playwright/test';
import { montarEscenario } from '../support/escenario.js';

test('el equipo conversa sin la IA, se menciona con @ y solo @IA le pide una respuesta', async ({
  browser,
}) => {
  const escenario = await montarEscenario(browser, 'Conversación del equipo');
  try {
    const { ana, beto } = escenario;
    const entrada = ana.page.getByTestId('entrada-asistente');
    const equipo = ana.page.getByTestId('destino-equipo');
    // Por defecto se escribe al equipo.
    await expect(equipo).toHaveAttribute('aria-pressed', 'true');
    // Beto mira otra herramienta: la mención le llega como aviso.
    await beto.page.getByTestId('pestana-importar').click();

    await entrada.fill('hola @be');
    await expect(entrada).toHaveAttribute('aria-expanded', 'true');
    await expect(
      ana.page.getByTestId('sugerencias-mencion').getByRole('option', { name: /beto/ }),
    ).toBeVisible();
    await entrada.press('Enter');
    await expect(entrada).toHaveValue('hola @beto ');
    await expect(entrada).toHaveAttribute('aria-expanded', 'false');
    await entrada.pressSequentially('¿revisas Pedido?');
    await ana.page.getByTestId('enviar-asistente').click();

    const conversacionAna = ana.page.getByTestId('conversacion');
    await expect(conversacionAna).toContainText('ana → beto');
    await expect(beto.page.getByTestId('mensajes-nuevos')).toHaveText('@1');
    await beto.page.getByTestId('pestana-asistente').click();
    const mencion = beto.page.locator('[data-message-id]').last();
    await expect(mencion).toHaveClass(/menciona-me/);
    await expect(mencion.locator('.team-mencion.yo')).toHaveText('@beto');
    // La IA no respondió: un mensaje entre personas no se encola.
    await expect(ana.page.locator('[data-message-id]')).toHaveCount(1);
    await expect(conversacionAna).not.toContainText('IA →');

    // @IA dirige solo ese mensaje a la IA, con el último modo elegido.
    await ana.page.getByTestId('modo-preguntar').click();
    await equipo.click();
    await entrada.pressSequentially('@IA ¿Qué es un atributo derivado?');
    await expect(ana.page.getByTestId('modo-preguntar')).toHaveAttribute('aria-pressed', 'true');
    await expect(entrada).toHaveValue('¿Qué es un atributo derivado?');
    await ana.page.getByTestId('enviar-asistente').click();
    await expect(conversacionAna).toContainText('ana → IA');
    await expect(conversacionAna).toContainText('IA → ana');
    await expect(ana.page.locator('[data-message-id]')).toHaveCount(3);
    await expect(equipo).toHaveAttribute('aria-pressed', 'true');

    // «Mis intervenciones» de Beto incluye lo que lo menciona.
    await beto.page.getByLabel('Mis intervenciones').check();
    await expect(beto.page.locator('[data-message-id]')).toHaveCount(1);
  } finally {
    await escenario.cerrar();
  }
});
