import { expect, test } from '@playwright/test';
import { abrirHerramienta, crearClase } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

const xmi = (content: string): string =>
  `<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model xmi:type="uml:Model" name="Revisión">${content}</uml:Model></xmi:XMI>`;
const claseNueva = xmi('<packagedElement xmi:type="uml:Class" xmi:id="new" name="Importada"/>');

for (const cambio of ['atributo', 'clase'] as const) {
  test(`reemplazar XMI exige revisar otra vez si otro usuario añade una ${cambio === 'clase' ? 'clase' : 'propiedad'}`, async ({
    browser,
  }) => {
    const scenario = await montarEscenario(browser, `Reemplazo concurrente ${cambio}`);
    const { ana, beto } = scenario;
    try {
      await crearClase(ana, 'Cliente');
      await expect(beto.page.getByTestId('clase-Cliente')).toBeVisible();
      await abrirHerramienta(ana, 'importar');
      await ana.page.getByTestId('modo-importacion').selectOption('REPLACE');
      await ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'nuevo.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from(claseNueva),
      });
      await expect(ana.page.getByTestId('aplicar-candidato')).toBeEnabled();
      await expect(ana.page.getByTestId('modo-importacion')).toBeDisabled();
      if (cambio === 'atributo') {
        await beto.page.getByTestId('clase-Cliente').click();
        await beto.page.getByTestId('nuevo-atributo').fill('datoReciente');
        await beto.page.getByRole('button', { name: 'Añadir', exact: true }).click();
        await expect(ana.page.getByTestId('clase-Cliente')).toContainText('datoReciente');
      } else {
        await crearClase(beto, 'Producto');
        await expect(ana.page.getByTestId('clase-Producto')).toBeVisible();
      }
      await ana.page.getByTestId('aplicar-candidato').click();
      await expect(ana.page.getByTestId('error-importacion')).toContainText('La pizarra cambió');
      await expect(ana.page.getByTestId('aplicar-candidato')).toBeDisabled();
      for (const actor of [ana, beto]) {
        await expect(actor.page.getByTestId('clase-Cliente')).toBeVisible();
        await expect(actor.page.getByTestId('clase-Importada')).toHaveCount(0);
      }
      await ana.page.getByTestId('repreparar-importacion').click();
      await expect(ana.page.getByTestId('aplicar-candidato')).toBeEnabled();
      await ana.page.getByTestId('aplicar-candidato').click();
      for (const actor of [ana, beto]) {
        await expect(actor.page.getByTestId('clase-Importada')).toBeVisible();
        await expect(actor.page.getByTestId('clase-Cliente')).toHaveCount(0);
        await expect(actor.page.getByTestId('clase-Producto')).toHaveCount(0);
      }
    } finally {
      await scenario.cerrar();
    }
  });
}

test('corrige atributos XMI que colisionan antes de compartirlos', async ({ browser }) => {
  const scenario = await montarEscenario(browser, 'Atributos XMI');
  try {
    const xml = xmi(
      '<packagedElement xmi:type="uml:Class" xmi:id="a" name="Venta"><ownedAttribute xmi:id="a1" name="fecha de venta" type="Date"/><ownedAttribute xmi:id="a2" name="fechaVenta" type="Date"/></packagedElement>',
    );
    await abrirHerramienta(scenario.ana, 'importar');
    await scenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
      name: 'atributos.xmi',
      mimeType: 'application/xml',
      buffer: Buffer.from(xml),
    });
    await expect(scenario.ana.page.getByTestId('aplicar-candidato')).toBeEnabled();
    await scenario.ana.page
      .getByRole('textbox', { name: 'Nombre de atributo 3', exact: true })
      .fill('fechaPago');
    await scenario.ana.page.getByTestId('aplicar-candidato').click();
    for (const actor of [scenario.ana, scenario.beto]) {
      await expect(actor.page.getByTestId('clase-Venta')).toContainText('fecha de venta');
      await expect(actor.page.getByTestId('clase-Venta')).toContainText('fechaPago');
    }
  } finally {
    await scenario.cerrar();
  }
});

test('combina cambios concurrentes del nombre y tipo de un atributo y los conserva al recargar', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Campos concurrentes');
  const { ana, beto } = scenario;
  try {
    await crearClase(ana, 'Cliente');
    await ana.page.getByTestId('nuevo-atributo').fill('dato');
    await ana.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(beto.page.getByTestId('clase-Cliente')).toContainText('dato');
    await beto.page.getByTestId('clase-Cliente').click();
    await ana.page.context().setOffline(true);
    await expect(ana.page.getByTestId('estado-conexion')).toHaveText('Sin conexión');
    await ana.page
      .getByRole('textbox', { name: 'Nombre del atributo dato', exact: true })
      .fill('edad');
    await beto.page
      .getByRole('combobox', { name: 'Tipo del atributo dato', exact: true })
      .selectOption('Integer');
    await ana.page.context().setOffline(false);
    for (const actor of [ana, beto]) {
      await expect(actor.page.getByTestId('estado-conexion')).toHaveText('En vivo');
      await expect(actor.page.getByTestId('clase-Cliente')).toContainText('edad');
      await expect(actor.page.getByTestId('clase-Cliente')).toContainText('Integer');
      await actor.page.reload();
      await expect(actor.page.getByTestId('clase-Cliente')).toContainText('edad');
      await expect(actor.page.getByTestId('clase-Cliente')).toContainText('Integer');
    }
  } finally {
    await ana.page.context().setOffline(false);
    await scenario.cerrar();
  }
});
