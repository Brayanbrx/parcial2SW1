import { expect, test } from '@playwright/test';
import {
  abrirHerramienta,
  abrirPizarra,
  crearClase,
  crearPizarra,
  crearProyecto,
  registrarActor,
} from '../support/actors.js';

test('ayuda desde proyectos: busca dudas, recuerda progreso y funciona sin solicitudes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let writes = 0;
  const user = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'help@example.com',
    displayName: 'Ayuda',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/refresh'))
      await route.fulfill({ json: { accessToken: 'test-token', user } });
    else if (path.endsWith('/auth/me')) await route.fulfill({ json: user });
    else {
      if (route.request().method() !== 'GET') writes++;
      await route.fulfill({ json: [] });
    }
  });
  await page.goto('/proyectos');
  await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aprende a usar el software' });
  await expect(
    dialog.getByRole('heading', { name: '¿Cómo empiezo mi primer diagrama?' }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cerrar ayuda del software' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprender a usar el software' })).toBeFocused();
  await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
  await page.context().setOffline(true);
  await dialog.getByRole('checkbox', { name: 'Marcar este tema como leído' }).check();
  await expect(dialog.getByText('1 de 9 temas leídos')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuar recorrido' }).click();
  await expect(
    dialog.getByRole('heading', { name: '¿Cómo dibujo una clase y añado sus campos?' }),
  ).toBeVisible();
  await dialog.getByRole('searchbox').fill('¿Cómo invito a alguien?');
  await dialog.getByRole('button', { name: 'Invitar y colaborar' }).click();
  await expect(
    dialog.getByRole('heading', { name: '¿Cómo invito a alguien y qué puede hacer?' }),
  ).toBeVisible();
  await dialog.getByRole('searchbox').fill('astrofisica');
  await expect(dialog.getByText('No encontré un tema', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Ver todos los temas' }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  expect(writes).toBe(0);
  await page.context().setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
  await expect(dialog.getByText('1 de 9 temas leídos')).toBeVisible();
  await dialog.getByRole('button', { name: 'Reiniciar progreso' }).click();
  await expect(dialog.getByText('0 de 9 temas leídos')).toBeVisible();
  expect(errors).toEqual([]);
});

test('ayuda contextual en editor respeta el diagrama, los atajos y el borrador de IA', async ({
  browser,
}) => {
  const actor = await registrarActor(browser, 'ayuda-editor');
  const { page } = actor;
  try {
    await crearProyecto(actor, 'Ayuda del editor');
    await crearPizarra(actor, 'Aprender');
    await abrirPizarra(actor, 'Aprender');
    await crearClase(actor, 'Cliente');
    await abrirHerramienta(actor, 'asistente');
    await page.getByTestId('entrada-asistente').fill('Conservar este borrador');
    await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
    const dialog = page.getByRole('dialog', { name: 'Aprende a usar el software' });
    await expect(
      dialog.getByRole('heading', { name: '¿Cómo dibujo una clase y añado sus campos?' }),
    ).toBeVisible();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId('clase-Cliente')).toBeVisible();
    await expect(page.getByTestId('entrada-asistente')).toHaveValue('Conservar este borrador');
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const help = page.getByRole('button', { name: 'Aprender a usar el software' });
      await expect(help).toBeVisible();
      const box = await help.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await help.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cerrar ayuda del software' }).click();
    }
    await abrirHerramienta(actor, 'generar');
    await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
    await expect(
      dialog.getByRole('heading', { name: '¿Cómo descargo el backend o la aplicación Android?' }),
    ).toBeVisible();
    await expect(dialog).toContainText('no es una APK lista para instalar');
    await dialog.getByRole('button', { name: 'Cerrar ayuda del software' }).click();
    await abrirHerramienta(actor, 'importar');
    await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
    await expect(
      dialog.getByRole('heading', { name: '¿Cómo recupero un diagrama desde XMI o una imagen?' }),
    ).toBeVisible();
  } finally {
    await actor.close();
  }
});

test('la ayuda permite seguir leyendo cuando el navegador bloquea guardar progreso', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'uml.software-learning.v1') throw new DOMException('Bloqueado', 'SecurityError');
      original.call(this, key, value);
    };
  });
  const user = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'help@example.com',
    displayName: 'Ayuda',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith('/auth/refresh')
        ? { accessToken: 'test-token', user }
        : path.endsWith('/auth/me')
          ? user
          : [],
    });
  });
  await page.goto('/proyectos');
  await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aprende a usar el software' });
  await dialog.getByRole('checkbox', { name: 'Marcar este tema como leído' }).check();
  await expect(dialog).toContainText('El navegador no permite guardar el progreso');
  await dialog.getByRole('button', { name: 'Tema siguiente' }).click();
  await expect(
    dialog.getByRole('heading', { name: '¿Cómo dibujo una clase y añado sus campos?' }),
  ).toBeVisible();
});
