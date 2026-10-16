import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { activarCuentaEIniciarSesion, nuevoCorreo } from '../support/actors.js';

const pantallas = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
];

for (const viewport of pantallas) {
  test.describe(`movil ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test('permite usar acceso, proyectos, cuenta y editor con tacto', async ({
      page,
    }, testInfo) => {
      await page.goto('/entrar');
      await expect(page.getByTestId('email')).toBeVisible();
      await comprobarAncho(page, testInfo, 'acceso', viewport.width);
      await page.getByRole('button', { name: 'Crear cuenta', exact: true }).tap();
      const email = nuevoCorreo('movil');
      await page.getByTestId('email').fill(email);
      await page.getByTestId('displayName').fill('Usuario de prueba en móvil');
      await page.getByTestId('password').fill('contrasena-de-prueba');
      await page.getByTestId('enviar').tap();
      await activarCuentaEIniciarSesion(page, email);
      await expect(page.getByTestId('lista-proyectos')).toBeVisible();
      await comprobarAncho(page, testInfo, 'proyectos', viewport.width);

      await page.getByTestId('menu-usuario').tap();
      await page.getByTestId('mi-cuenta').tap();
      await page.getByTestId('perfil-nombre').fill('Nombre móvil actualizado');
      await page.getByTestId('guardar-perfil').tap();
      await expect(page.getByTestId('perfil-guardado')).toBeVisible();
      await comprobarAncho(page, testInfo, 'cuenta', viewport.width);

      await page.getByRole('link', { name: 'UMLFORGE AI, ir a mis proyectos' }).tap();
      await page
        .getByTestId('nombre-proyecto')
        .fill('Proyecto de modelado desde un teléfono móvil');
      await page.getByTestId('crear-proyecto').tap();
      await expect(page.getByTestId('lista-pizarras')).toBeVisible();
      await expect(page.getByTestId('alternar-colaboradores')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(page.locator('#detalle-colaboradores')).toBeHidden();
      await page.getByTestId('alternar-colaboradores').tap();
      await expect(page.locator('#detalle-colaboradores')).toBeVisible();
      await page.getByTestId('alternar-colaboradores').tap();
      await page.getByTestId('invitar-editor').tap();
      await expect(page.getByTestId('codigo-generado')).toBeVisible();
      await expect(page.locator('#detalle-colaboradores')).toBeVisible();
      await comprobarAncho(page, testInfo, 'pizarras', viewport.width);
      await page.getByTestId('nombre-pizarra').fill('Diagrama de ventas y clientes desde el móvil');
      await page.getByTestId('crear-pizarra').tap();
      await page.getByTestId('alternar-colaboradores').tap();
      await comprobarAncho(page, testInfo, 'pizarras-compactas', viewport.width);
      await page.getByRole('link', { name: 'Diagrama de ventas y clientes desde el móvil' }).tap();
      await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
      await expect(page.getByRole('link', { name: 'Proyecto', exact: true })).toBeInViewport();
      const canvas = await page.getByTestId('pizarra-diagrama').boundingBox();
      expect(canvas!.height).toBeGreaterThanOrEqual(240);
      const crear = await page.getByTestId('crear-clase').boundingBox();
      if (viewport.width <= 640 || viewport.height <= 500)
        expect(crear!.height).toBeGreaterThanOrEqual(44);
      await comprobarAncho(page, testInfo, 'editor-vacio', viewport.width);
      await page.getByTestId('crear-clase').tap();
      await page.getByTestId('nombre-clase').fill('Cliente');
      await page.getByTestId('nuevo-atributo').fill('nombre');
      await page.getByRole('button', { name: 'Añadir', exact: true }).tap();
      await expect(page.getByTestId('clase-Cliente')).toContainText('nombre');
      await comprobarAncho(page, testInfo, 'editor-propiedades', viewport.width);

      for (const herramienta of ['importar', 'generar', 'asistente']) {
        await page.getByTestId(`pestana-${herramienta}`).tap();
        if (herramienta === 'generar') {
          const checkbox = page.getByTestId('incluir-flutter');
          const bounds = await checkbox.boundingBox();
          expect(bounds!.height).toBeLessThanOrEqual(20);
          expect(bounds!.width).toBeLessThanOrEqual(20);
          const label = page.locator('label.opcion-checkbox');
          expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await label.tap();
          await expect(checkbox).toBeChecked();
          await page.getByTestId('pestana-importar').tap();
          await page.getByTestId('pestana-generar').tap();
          await expect(checkbox).toBeChecked();
          await label.tap();
          await expect(checkbox).not.toBeChecked();
        }
        await comprobarAncho(page, testInfo, `editor-${herramienta}`, viewport.width);
      }
      await page.getByTestId('alternar-panel').tap();
      await expect(page.locator('#panel-editor')).toBeHidden();
      await page.getByTestId('alternar-toolbox').tap();
      await expect(page.locator('#editor-toolbox')).toBeHidden();
      await comprobarAncho(page, testInfo, 'solo-diagrama', viewport.width);
      const lienzo = await page.getByTestId('pizarra-diagrama').boundingBox();
      expect(lienzo!.width).toBeGreaterThan(viewport.width - 5);
      await page.getByTestId('alternar-panel').tap();
      await expect(page.locator('#panel-editor')).toBeVisible();
      await page.getByTestId('salir').tap();
      await expect(page.getByTestId('email')).toBeVisible();
    });
  });
}

async function comprobarAncho(page: Page, info: TestInfo, paso: string, width: number) {
  const medidas = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    controlesFuera: [...document.querySelectorAll('button, input, select, textarea')]
      .filter((element) => !element.closest('.react-flow'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .map((element) => element.getAttribute('data-testid') ?? element.textContent?.trim()),
  }));
  await info.attach(paso, { body: JSON.stringify(medidas), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath(`${paso}.png`), fullPage: true });
  expect.soft(medidas.documentWidth, `${paso}: ancho de documento`).toBeLessThanOrEqual(width + 1);
  expect.soft(medidas.controlesFuera, `${paso}: controles fuera de pantalla`).toEqual([]);
}
