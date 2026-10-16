import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { parseXmi } from '@uml/xmi';
import { abrirHerramienta } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

test('PracticaProbar importa Inscripcion como entidad intermedia y la conserva al exportar', async ({
  browser,
}, testInfo) => {
  const escenario = await montarEscenario(browser, 'Clase asociativa EA');
  try {
    const page = escenario.ana.page;
    await abrirHerramienta(escenario.ana, 'importar');
    await page
      .getByTestId('archivo-xmi')
      .setInputFiles(
        fileURLToPath(
          new URL('../../shared/xmi/tests/fixtures/ea-association-class.xmi', import.meta.url),
        ),
      );
    await expect(page.getByTestId('candidato')).toContainText('entidad intermedia');
    await expect(page.getByTestId('clase-Inscripcion')).toHaveCount(0);
    await page.getByTestId('aplicar-candidato').click();
    for (const actor of [escenario.ana, escenario.beto]) {
      const node = actor.page.getByTestId('clase-Inscripcion');
      await expect(node).toHaveCount(1);
      await expect(node).toContainText('fecha');
      await expect(node).toContainText('notaFinal');
      await expect(node).toContainText('idInscripcion');
    }
    await page.getByTestId('exportar-xmi').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('confirmar-export').click();
    const path = await (await download).path();
    const result = parseXmi(readFileSync(path, 'utf8'));
    const links = result.relationships.filter(
      (r) => r.sourceName === 'Inscripcion' || r.targetName === 'Inscripcion',
    );
    expect(links).toHaveLength(3);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: 'Estudiante',
          targetName: 'Inscripcion',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        }),
        expect.objectContaining({
          sourceName: 'Curso',
          targetName: 'Inscripcion',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        }),
        expect.objectContaining({
          sourceName: 'Inscripcion',
          targetName: 'Calificacion',
          kind: 'COMPOSITION',
        }),
      ]),
    );
    expect(
      result.relationships.some(
        (r) => [r.sourceName, r.targetName].sort().join() === 'Curso,Estudiante',
      ),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath('inscripcion-importada.png'),
      fullPage: true,
    });
  } finally {
    await escenario.cerrar();
  }
});
