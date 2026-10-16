import { expect, test } from '@playwright/test';
import { crearClase } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

test('recupera una edicion offline tras cerrar la pestaña y la combina con cambios remotos', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Borradores offline');
  const context = scenario.ana.page.context();
  try {
    await crearClase(scenario.ana, 'Cliente');
    await expect(scenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await expect(scenario.ana.page.getByTestId('offline-disponible')).toBeVisible();
    const url = scenario.ana.page.url();
    await context.setOffline(true);
    await expect(scenario.ana.page.getByTestId('estado-conexion')).toHaveText('Sin conexión');
    await scenario.ana.page.getByTestId('nuevo-atributo').fill('telefono');
    await scenario.ana.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(scenario.ana.page.getByTestId('clase-Cliente')).toContainText('telefono');
    await expect(scenario.beto.page.getByTestId('clase-Cliente')).not.toContainText('telefono');
    // Close while offline, so reconnection cannot rescue an in-memory document.
    await scenario.ana.page.close();
    await scenario.beto.page.getByTestId('clase-Cliente').click();
    await scenario.beto.page.getByTestId('nuevo-atributo').fill('correo');
    await scenario.beto.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    const reopened = await context.newPage();
    await reopened.goto(url);
    await expect(reopened.getByTestId('clase-Cliente')).toContainText('telefono');
    await expect(reopened.getByTestId('modo-offline')).toBeVisible();
    await reopened.reload();
    await expect(reopened.getByTestId('clase-Cliente')).toContainText('telefono');
    await context.setOffline(false);
    await expect(reopened.getByTestId('estado-conexion')).toHaveText('En vivo');
    for (const page of [reopened, scenario.beto.page]) {
      await expect(page.getByTestId('clase-Cliente')).toContainText('telefono');
      await expect(page.getByTestId('clase-Cliente')).toContainText('correo');
      await expect(page.getByTestId('clase-Cliente').locator('.atributos > li')).toHaveCount(2);
    }
    await reopened.reload();
    await expect(reopened.getByTestId('clase-Cliente').locator('.atributos > li')).toHaveCount(2);
  } finally {
    await context.setOffline(false);
    await scenario.cerrar();
  }
});
