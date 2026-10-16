import { test, expect, type Page } from '@playwright/test';
import {
  registrarActor,
  crearProyecto,
  crearPizarra,
  abrirPizarra,
  crearClase,
} from '../support/actors.js';

async function chooseTheme(page: Page, theme: string): Promise<void> {
  await page.getByRole('button', { name: 'Apariencia', exact: true }).click();
  await page
    .getByRole('menuitemradio', {
      name: theme === 'dark' ? 'Oscuro' : theme === 'light' ? 'Claro' : 'Sistema',
      exact: true,
    })
    .click();
}

test('el menú de apariencia admite teclado, Escape y cierre al pulsar fuera', async ({ page }) => {
  await page.goto('/entrar');
  const trigger = page.getByRole('button', { name: 'Apariencia', exact: true });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Sistema', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Oscuro', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText('Oscuro');
  await trigger.click();
  await expect(page.getByRole('menuitemradio', { name: 'Oscuro', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.screenshot({ path: 'reports/apariencia/menu-oscuro.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.click();
  await page.getByTestId('email').click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('claro, oscuro y sistema se conservan y se sincronizan sin perder el formulario', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/entrar');
  const appearance = page.getByRole('button', { name: 'Apariencia', exact: true });
  await expect(appearance).toHaveText('Sistema');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('email').fill('borrador@example.com');
  await chooseTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('email')).toHaveValue('borrador@example.com');
  await page.reload();
  await expect(appearance).toHaveText('Oscuro');
  const other = await context.newPage();
  await other.goto('/entrar');
  await expect(other.getByRole('button', { name: 'Apariencia', exact: true })).toHaveText('Oscuro');
  await chooseTheme(page, 'light');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await chooseTheme(page, 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    path: 'reports/apariencia/acceso-claro.png',
    fullPage: true,
    animations: 'disabled',
  });
  await other.close();
});

test('el tema funciona con almacenamiento restringido', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Restringido', 'SecurityError');
      },
    });
  });
  await page.goto('/entrar');
  await chooseTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('enviar')).toBeVisible();
});

test('el editor conserva su modelo al cambiar apariencia y no recorta las observaciones', async ({
  browser,
}) => {
  const actor = await registrarActor(browser, 'revision-visual');
  const { page } = actor;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await chooseTheme(page, 'light');
    await crearProyecto(actor, 'Estudio de arquitectura');
    await crearPizarra(actor, 'Modelo de ventas');
    await page.screenshot({
      path: 'reports/apariencia/proyecto-claro.png',
      fullPage: true,
      animations: 'disabled',
    });
    await abrirPizarra(actor, 'Modelo de ventas');
    await crearClase(actor, 'Cliente');
    const node = page.getByTestId('clase-Cliente');
    const id = await node.locator('..').getAttribute('data-id');
    for (const theme of ['light', 'dark', 'system']) {
      await chooseTheme(page, theme);
      await expect(node).toBeVisible();
      await expect(node.locator('..')).toHaveAttribute('data-id', id!);
      await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
      const panel = page.getByTestId('panel-validacion');
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      if (theme !== 'system')
        await page.screenshot({
          path: `reports/apariencia/editor-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
    }
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Ajustar diagrama a la vista', exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await expect(page.getByRole('button', { name: 'Apariencia', exact: true })).toBeVisible();
      await page.screenshot({
        path: `reports/apariencia/editor-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.reload();
    await expect(page.getByTestId('clase-Cliente')).toBeVisible();
  } finally {
    await actor.close();
  }
});
