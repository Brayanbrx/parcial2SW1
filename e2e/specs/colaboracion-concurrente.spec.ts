import { expect, test } from '@playwright/test';
import { crearClase } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

test('conserva atributos concurrentes de la misma clase al reconectar y recargar', async ({
  browser,
}, testInfo) => {
  const escenario = await montarEscenario(browser, 'Atributos concurrentes');
  const { ana, beto } = escenario;
  const contextoAna = ana.page.context();
  let sinConexion = false;

  try {
    await crearClase(ana, 'Cliente');
    await expect(beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await beto.page.getByTestId('clase-Cliente').click();

    // La desconexion garantiza que ninguno parte del atributo nuevo del otro;
    // dos clics casi simultaneos en loopback no garantizan esa concurrencia.
    await contextoAna.setOffline(true);
    sinConexion = true;
    await expect(ana.page.getByTestId('estado-conexion')).toHaveText('Sin conexión');
    await ana.page.getByTestId('nuevo-atributo').fill('telefono');
    await ana.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await beto.page.getByTestId('nuevo-atributo').fill('correo');
    await beto.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(ana.page.getByTestId('clase-Cliente')).toContainText('telefono');
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('correo');
    await expect(ana.page.getByTestId('clase-Cliente').locator('.atributos > li')).toHaveCount(1);
    await expect(beto.page.getByTestId('clase-Cliente').locator('.atributos > li')).toHaveCount(1);

    await contextoAna.setOffline(false);
    sinConexion = false;
    for (const actor of [ana, beto]) {
      await expect(actor.page.getByTestId('estado-conexion')).toHaveText('En vivo');
      const clase = actor.page.getByTestId('clase-Cliente');
      await expect(clase.locator('.atributos > li')).toHaveCount(2);
      await expect(clase).toContainText('telefono');
      await expect(clase).toContainText('correo');
    }

    const orden = await ana.page
      .getByTestId('clase-Cliente')
      .locator('.atributos > li')
      .allTextContents();
    // Recargar destruye ambas replicas del navegador y abre documentos nuevos.
    // La rehidratacion desde PostgreSQL se comprueba ademas en integracion RA-11.
    await Promise.all([ana.page.reload(), beto.page.reload()]);
    for (const actor of [ana, beto]) {
      await expect(actor.page.getByTestId('estado-conexion')).toHaveText('En vivo');
      await expect(actor.page.getByTestId('clase-Cliente').locator('.atributos > li')).toHaveText(
        orden,
      );
      await actor.page.screenshot({ path: testInfo.outputPath(`${actor.displayName}.png`) });
    }
  } finally {
    if (sinConexion) await contextoAna.setOffline(false);
    await escenario.cerrar();
  }
});
