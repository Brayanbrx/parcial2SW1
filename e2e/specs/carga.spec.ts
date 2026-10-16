import { expect, test } from '@playwright/test';
import type { SemanticModel } from '@uml/contracts';
import { serializeToXmi } from '@uml/xmi';
import { abrirHerramienta, posicionEnDiagrama } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

test('RNF-03 — edita y sincroniza una pizarra de 30 clases, 100 atributos y 40 relaciones', async ({
  browser,
}, testInfo) => {
  const escenario = await montarEscenario(browser, 'Carga del editor');
  try {
    const classes: SemanticModel['classes'] = Array.from({ length: 30 }, (_, index) => ({
      id: crypto.randomUUID(),
      displayName: `Entidad${index}`,
      codeName: `Entidad${index}`,
      databaseName: `entidad_${index}`,
      attributes: Array.from({ length: index < 10 ? 4 : 3 }, (_, attribute) => ({
        id: crypto.randomUUID(),
        displayName: `campo${attribute}`,
        codeName: `campo${attribute}`,
        databaseName: `campo_${attribute}`,
        type: 'String',
        nullable: true,
        primaryKey: false,
        unique: false,
      })),
    }));
    const model: SemanticModel = {
      classes,
      relationships: Array.from({ length: 40 }, (_, index) => ({
        id: crypto.randomUUID(),
        sourceClassId: classes[index % 30]!.id,
        targetClassId: classes[((index % 30) + (index < 30 ? 1 : 2)) % 30]!.id,
        sourceMultiplicity: '0..1',
        targetMultiplicity: '0..*',
        sourceRoleName: `origen${index}`,
        targetRoleName: `destino${index}`,
      })),
    };
    await abrirHerramienta(escenario.ana, 'importar');
    await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
      name: 'carga.xmi',
      mimeType: 'application/xml',
      buffer: Buffer.from(serializeToXmi(model, { modelName: 'Carga' })),
    });
    await expect(escenario.ana.page.getByTestId('candidato')).toBeVisible();
    const started = performance.now();
    await escenario.ana.page.getByTestId('aplicar-candidato').click();
    await expect(escenario.beto.page.locator('.react-flow__node')).toHaveCount(30);
    await expect(escenario.beto.page.locator('.react-flow__edge')).toHaveCount(40);
    const importedMs = performance.now() - started;
    const before = await posicionEnDiagrama(escenario.beto, 'Entidad0');
    const node = escenario.ana.page.locator('.react-flow__node', {
      has: escenario.ana.page.getByTestId('clase-Entidad0'),
    });
    await node.focus();
    // El foco permite recorrer nodos; Enter selecciona el que moveran las flechas.
    await escenario.ana.page.keyboard.press('Enter');
    await expect(node).toHaveClass(/selected/);
    const movedAt = performance.now();
    await escenario.ana.page.keyboard.press('ArrowRight');
    await expect.poll(() => posicionEnDiagrama(escenario.beto, 'Entidad0')).not.toEqual(before);
    const propagatedMs = performance.now() - movedAt;
    expect(propagatedMs).toBeLessThan(2000);
    await testInfo.attach('medicion-local', {
      body: JSON.stringify({
        classes: 30,
        attributes: 100,
        relationships: 40,
        importedMs,
        propagatedMs,
      }),
      contentType: 'application/json',
    });
    await escenario.ana.page.getByRole('button', { name: 'Ajustar diagrama a la vista' }).click();
    await escenario.ana.page.screenshot({
      path: testInfo.outputPath('editor-30-clases.png'),
      fullPage: true,
    });
    await escenario.ana.page.setViewportSize({ width: 820, height: 720 });
    await escenario.ana.page.screenshot({
      path: testInfo.outputPath('editor-820px.png'),
      fullPage: true,
    });
  } finally {
    await escenario.cerrar();
  }
});
