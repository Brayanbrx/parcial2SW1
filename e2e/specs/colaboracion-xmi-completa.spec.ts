import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseXmi } from '@uml/xmi';
import { abrirHerramienta, crearClase, invitar, posicionEnDiagrama } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

test('retirar a un participante también cierra su página de proyecto abierta', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Retirada desde proyecto', { abrirAmbos: false });
  try {
    await scenario.ana.page.getByTitle('Volver al proyecto', { exact: true }).click();
    await scenario.ana.page.getByTestId('alternar-colaboradores').click();
    scenario.ana.page.once('dialog', (dialog) => dialog.accept());
    await scenario.ana.page
      .getByRole('button', { name: `Retirar a ${scenario.beto.email}`, exact: true })
      .click();
    await expect(scenario.beto.page.getByTestId('lista-proyectos')).toBeVisible();
    await expect(
      scenario.beto.page.getByRole('link', { name: 'Retirada desde proyecto', exact: true }),
    ).toHaveCount(0);
  } finally {
    await scenario.cerrar();
  }
});

test('un participante puede salir del proyecto y desaparece de la lista del propietario', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Salida voluntaria', { abrirAmbos: false });
  try {
    await scenario.beto.page.getByTestId('alternar-colaboradores').click();
    scenario.beto.page.once('dialog', (dialog) => dialog.accept());
    await scenario.beto.page
      .getByRole('button', { name: 'Salir del proyecto', exact: true })
      .click();
    await expect(scenario.beto.page.getByTestId('lista-proyectos')).toBeVisible();
    await expect(
      scenario.beto.page.getByRole('link', { name: 'Salida voluntaria', exact: true }),
    ).toHaveCount(0);
    await scenario.ana.page.getByTitle('Volver al proyecto', { exact: true }).click();
    await expect(scenario.ana.page.getByTestId('miembros-proyecto')).toContainText(
      scenario.ana.email,
    );
    await expect(scenario.ana.page.getByText(scenario.beto.email, { exact: true })).toHaveCount(0);
  } finally {
    await scenario.cerrar();
  }
});

test('administra roles, revoca invitaciones y retira acceso desde la interfaz', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Administración completa');
  const { ana, beto } = scenario;
  try {
    await ana.page.getByTitle('Volver al proyecto', { exact: true }).click();
    await ana.page.getByTestId('alternar-colaboradores').click();
    const role = ana.page.getByRole('combobox', { name: `Rol de ${beto.email}`, exact: true });
    await role.selectOption('VIEWER');
    await expect(beto.page.getByTestId('crear-clase')).toBeDisabled();
    await expect(role).toBeEnabled();
    await role.selectOption('EDITOR');
    await expect(beto.page.getByTestId('crear-clase')).toBeEnabled();
    await crearClase(beto, 'Compartida');
    const code = await invitar(ana, 'lector');
    await ana.page.getByRole('button', { name: `Revocar invitación ${code}`, exact: true }).click();
    await expect(ana.page.getByTestId('codigo-generado')).toHaveCount(0);
    await expect(
      ana.page.getByRole('button', { name: `Revocar invitación ${code}`, exact: true }),
    ).toHaveCount(0);
    ana.page.once('dialog', (dialog) => dialog.accept());
    await ana.page.getByRole('button', { name: `Retirar a ${beto.email}`, exact: true }).click();
    await expect(ana.page.getByText(beto.email, { exact: true })).toHaveCount(0);
    await expect(beto.page.getByTestId('crear-clase')).toBeDisabled();
    await beto.page.reload();
    await expect(beto.page.getByRole('alert')).toBeVisible();
    await expect(beto.page.getByTestId('clase-Compartida')).toHaveCount(0);
  } finally {
    await scenario.cerrar();
  }
});

test('edita extremos, roles y tipo del candidato y elimina operaciones dependientes', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Candidato completo');
  const { ana, beto } = scenario;
  try {
    const xml = `<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model name="Prueba">
      <packagedElement xmi:type="uml:Class" xmi:id="a" name="Cliente"><ownedAttribute xmi:id="at" name="correo" type="String"/></packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="b" name="Pedido"/>
      <packagedElement xmi:type="uml:Class" xmi:id="c" name="Omitida"/>
      <packagedElement xmi:type="uml:Association" xmi:id="r"><ownedEnd xmi:id="r1" type="a"/><ownedEnd xmi:id="r2" type="b"/></packagedElement>
      <packagedElement xmi:type="uml:Association" xmi:id="s"><ownedEnd xmi:id="s1" type="b"/><ownedEnd xmi:id="s2" type="c"/></packagedElement>
    </uml:Model></xmi:XMI>`;
    await abrirHerramienta(ana, 'importar');
    await ana.page
      .getByTestId('archivo-xmi')
      .setInputFiles({ name: 'editar.xmi', mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await expect(ana.page.getByTestId('aplicar-candidato')).toBeEnabled();
    await ana.page.getByRole('button', { name: 'Quitar operación 4', exact: true }).click();
    await expect(ana.page.getByRole('combobox', { name: /Tipo de relación/ })).toHaveCount(1);
    await ana.page
      .getByRole('combobox', { name: 'Tipo de relación 4', exact: true })
      .selectOption('COMPOSITION');
    await ana.page.getByRole('textbox', { name: 'Rol destino 4', exact: true }).fill('pedidos');
    await ana.page
      .getByRole('combobox', { name: 'Multiplicidad destino 4', exact: true })
      .selectOption('0..*');
    await ana.page.getByRole('checkbox', { name: 'Único', exact: true }).check();
    await expect(ana.page.getByTestId('candidato')).toContainText('pedidos 0..*');
    await ana.page.getByTestId('aplicar-candidato').click();
    for (const actor of [ana, beto]) {
      await expect(actor.page.getByTestId('clase-Cliente')).toContainText('correo');
      await expect(actor.page.getByTestId('clase-Pedido')).toBeVisible();
      await expect(actor.page.getByTestId('clase-Omitida')).toHaveCount(0);
    }
    await ana.page.getByTestId('exportar-xmi').click();
    const download = ana.page.waitForEvent('download');
    await ana.page.getByTestId('confirmar-export').click();
    const parsed = parseXmi(await readFile(await (await download).path(), 'utf8'));
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.relationships[0]).toMatchObject({
      kind: 'COMPOSITION',
      targetRole: 'pedidos',
      targetMultiplicity: '0..*',
    });
    expect(parsed.classes.find((c) => c.name === 'Cliente')?.attributes[0]?.unique).toBe(true);
  } finally {
    await scenario.cerrar();
  }
});

for (const format of ['EA_21', 'UML_251'])
  test(`reemplazar el XMI ${format} descargado conserva UUID y posición para ambos usuarios y tras recargar`, async ({
    browser,
  }) => {
    const scenario = await montarEscenario(browser, 'Identidad completa');
    const { ana, beto } = scenario;
    try {
      await crearClase(ana, 'Cliente');
      await expect(beto.page.getByTestId('clase-Cliente')).toBeVisible();
      const node = ana.page.locator('.react-flow__node', {
        has: ana.page.getByTestId('clase-Cliente'),
      });
      const id = await node.getAttribute('data-id');
      const position = await posicionEnDiagrama(ana, 'Cliente');
      if (format === 'UML_251') await ana.page.setViewportSize({ width: 320, height: 568 });
      await abrirHerramienta(ana, 'importar');
      await ana.page.getByTestId('exportar-xmi').click();
      await ana.page
        .getByRole('combobox', { name: 'Formato XMI', exact: true })
        .selectOption(format);
      await expect(ana.page.getByTestId('confirmar-export')).toBeInViewport();
      const download = ana.page.waitForEvent('download');
      await ana.page.getByTestId('confirmar-export').click();
      const path = await (await download).path();
      const xml = await readFile(path, 'utf8');
      expect(xml).toContain(
        format === 'EA_21'
          ? 'xmi:version="2.1"'
          : 'xmlns:xmi="http://www.omg.org/spec/XMI/20131001"',
      );
      expect(parseXmi(xml).classes[0]?.xmiId).toBe(id);
      await ana.page.getByTestId('modo-importacion').selectOption('REPLACE');
      await ana.page.getByTestId('archivo-xmi').setInputFiles(path);
      await expect(ana.page.getByTestId('aplicar-candidato')).toBeEnabled();
      await ana.page.getByTestId('aplicar-candidato').click();
      for (const actor of [ana, beto]) {
        await expect(actor.page.getByTestId('clase-Cliente')).toBeVisible();
        await expect(
          actor.page.locator('.react-flow__node', { has: actor.page.getByTestId('clase-Cliente') }),
        ).toHaveAttribute('data-id', id!);
        expect(await posicionEnDiagrama(actor, 'Cliente')).toEqual(position);
      }
      await beto.page.reload();
      await expect(beto.page.getByTestId('estado-conexion')).toHaveText('En vivo');
      await expect(
        beto.page.locator('.react-flow__node', { has: beto.page.getByTestId('clase-Cliente') }),
      ).toHaveAttribute('data-id', id!);
      expect(await posicionEnDiagrama(beto, 'Cliente')).toEqual(position);
    } finally {
      await scenario.cerrar();
    }
  });
