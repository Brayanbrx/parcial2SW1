import { expect, test, type Page } from '@playwright/test';
import { montarEscenario } from '../support/escenario.js';
import { crearClase } from '../support/actors.js';

async function send(page: Page, text: string) {
  await page.getByTestId('entrada-asistente').fill(text);
  await page.getByTestId('enviar-asistente').click();
}

test('mentor real: OWNER cambia pistas/soluciones, REVIEW explica hallazgos y OFF se comparte', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Mentor configurable');
  try {
    const { ana, beto } = scenario;
    await crearClase(ana, 'Cliente');
    await crearClase(ana, 'Proveedor');
    const configure = async (solution: string, review = 'ON_DEMAND') => {
      await ana.page.getByRole('button', { name: 'Configurar IA' }).click();
      const dialog = ana.page.getByRole('dialog', { name: 'IA del proyecto' });
      await dialog
        .getByRole('combobox', { name: 'Respuestas', exact: true })
        .selectOption(solution);
      await dialog
        .getByRole('combobox', { name: 'Revisión del modelo', exact: true })
        .selectOption(review);
      await dialog.getByRole('button', { name: 'Guardar configuración' }).click();
      await expect(dialog).not.toBeVisible();
    };
    await configure('HINTS_ONLY');
    await expect(beto.page.getByTestId('team-teaching-policy')).toContainText('Solo pistas');
    await beto.page.getByTestId('modo-preguntar').click();
    await send(beto.page, 'Dame un ejemplo resuelto de atributo derivado');
    await expect(beto.page.locator('[data-message-id]').last()).toContainText('IA → beto');
    await expect(beto.page.locator('[data-message-id]').last()).toContainText('Solo pistas');
    await expect(beto.page.locator('[data-message-id]').last()).not.toContainText('total =');
    await configure('ON_REQUEST');
    await expect(beto.page.getByTestId('team-teaching-policy')).toContainText(
      'Soluciones a petición',
    );
    await send(beto.page, 'Dame un ejemplo resuelto de atributo derivado');
    await expect(ana.page.locator('[data-message-id]').last()).toContainText(
      'total = cantidad × precio',
    );
    await beto.page.getByTestId('modo-revisar').click();
    await send(beto.page, 'Revisa las clases y sus relaciones');
    await expect(beto.page.locator('[data-message-id]').last()).toContainText(
      'Revisión del modelo enviado',
    );
    await expect(beto.page.locator('[data-message-id]').last()).toContainText(
      'CLASS_WITHOUT_RELATIONSHIPS',
    );
    await expect(beto.page.locator('[data-message-id]').last()).toContainText('Pista:');
    await expect(beto.page.getByTestId('propuesta')).toHaveCount(0);
    await expect(beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await expect(beto.page.getByTestId('clase-Proveedor')).toBeVisible();
    await configure('ON_REQUEST', 'OFF');
    await expect(beto.page.getByTestId('modo-revisar')).toBeDisabled();
    await beto.page.getByTestId('entrada-asistente').fill('Revisar otra vez');
    await expect(beto.page.getByTestId('enviar-asistente')).toBeDisabled();
    await beto.page.getByTestId('modo-preguntar').click();
    await expect(beto.page.getByTestId('enviar-asistente')).toBeEnabled();
    await beto.page.reload();
    await expect(beto.page.getByTestId('modo-revisar')).toBeDisabled();
    await expect(beto.page.locator('[data-message-id]')).toHaveCount(6);
    await expect(beto.page.getByTestId('conversacion')).toContainText(
      'Revisión del modelo enviado',
    );
  } finally {
    await scenario.cerrar();
  }
});
