import { expect, test } from '@playwright/test';
import { abrirHerramienta } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('captura con camara simulada', async ({ browser }, info) => {
  const escenario = await montarEscenario(browser, 'Captura');
  try {
    const page = escenario.ana.page;
    await abrirHerramienta(escenario.ana, 'importar');
    await page.getByTestId('abrir-camara').click();
    await expect(page.getByTestId('tomar-foto')).toBeEnabled({ timeout: 15_000 });
    await page.screenshot({ path: info.outputPath('camara.png') });
  } finally {
    await escenario.cerrar();
  }
});
