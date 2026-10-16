import { expect, test, type Page } from '@playwright/test';
import {
  abrirHerramienta,
  abrirPizarra,
  crearClase,
  crearPizarra,
  crearProyecto,
  registrarActor,
} from '../support/actors.js';

async function openGuide(page: Page) {
  await page.getByRole('button', { name: /Aprender a usar la IA|Repasar guía de IA/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Aprende a usar el asistente' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('guía accesible, adaptable y offline: practicar no llama a IA ni modifica la pizarra', async ({
  browser,
}) => {
  const actor = await registrarActor(browser, 'aprendizaje');
  const { page } = actor;
  let calls = 0;
  await page.route('**/api/boards/*/assistant/**', async (route) => {
    calls++;
    await route.abort();
  });
  try {
    await crearProyecto(actor, 'Aprender IA');
    await crearPizarra(actor, 'Guía');
    await abrirPizarra(actor, 'Guía');
    await abrirHerramienta(actor, 'asistente');
    const dialog = await openGuide(page);
    await expect(dialog.getByRole('button', { name: 'Cerrar guía' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprender a usar la IA' })).toBeFocused();
    await openGuide(page);
    // The lessons are bundled: no network or model is needed to learn.
    await page.context().setOffline(true);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await dialog.getByRole('button', { name: 'Siguiente' }).click();
    await expect(dialog).toContainText('Crea una clase Cliente');
    await dialog.getByRole('button', { name: 'Siguiente' }).click();
    await expect(dialog.getByRole('heading', { name: 'También puedes dictar' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Siguiente' }).click();
    await expect(dialog.getByRole('button', { name: 'Completar guía' })).toBeDisabled();
    await dialog
      .getByRole('radio', { name: 'Aplicar sin revisar porque lo propuso la IA.' })
      .check();
    await expect(dialog.getByRole('status')).toContainText('Antes de aplicar');
    await expect(dialog.getByRole('button', { name: 'Completar guía' })).toBeDisabled();
    await dialog
      .getByRole('radio', { name: 'Revisar lo que se borrará y aplicar solo si es lo que pedí.' })
      .check();
    await expect(dialog.getByRole('status')).toContainText('Correcto');
    await dialog.getByRole('button', { name: 'Completar guía' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect(page.getByTestId('entrada-asistente')).toHaveValue('');
    expect(calls).toBe(0);
    await page.context().setOffline(false);
    await page.reload();
    await abrirHerramienta(actor, 'asistente');
    await expect(page.getByRole('button', { name: 'Repasar guía de IA' })).toBeVisible();
  } finally {
    await actor.close();
  }
});

test('ejemplos contextuales conservan borradores y aclaraciones y requieren envío explícito', async ({
  browser,
}) => {
  const actor = await registrarActor(browser, 'ejemplo-ia');
  const { page } = actor;
  const calls: unknown[] = [];
  await page.route('**/api/boards/*/assistant/**', async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({
      json: { kind: 'QUESTION', question: '¿Qué longitud quieres?', rationale: null },
    });
  });
  try {
    await crearProyecto(actor, 'Ejemplos');
    await crearPizarra(actor, 'Contexto');
    await abrirPizarra(actor, 'Contexto');
    await crearClase(actor, 'Producto');
    await abrirHerramienta(actor, 'asistente');
    const input = page.getByTestId('entrada-asistente');
    await input.fill('Mi borrador importante');
    const dialog = await openGuide(page);
    await expect(dialog.getByRole('button', { name: 'Usar ejemplo como borrador' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cerrar guía' }).click();
    await expect(input).toHaveValue('Mi borrador importante');
    await input.fill('');
    await openGuide(page);
    await dialog.getByRole('button', { name: 'Usar ejemplo como borrador' }).click();
    await expect(input).toHaveValue('¿Qué clases hay en el diagrama y cómo se relacionan?');
    await expect(input).toBeFocused();
    await expect(page.getByTestId('modo-preguntar')).toHaveClass('activa');
    expect(calls).toHaveLength(0);
    await input.fill('');
    await openGuide(page);
    await dialog.getByRole('button', { name: 'Siguiente' }).click();
    await expect(dialog).toContainText(
      'Agrega el atributo notaIA de tipo String a la clase Producto.',
    );
    await dialog.getByRole('button', { name: 'Usar ejemplo como borrador' }).click();
    await expect(page.getByTestId('modo-instruir')).toHaveClass('activa');
    await expect(input).toHaveValue(
      'Agrega el atributo notaIA de tipo String a la clase Producto.',
    );
    await expect(page.getByTestId('clase-Producto')).not.toContainText('notaIA');
    expect(calls).toHaveLength(0);
    await page.getByTestId('enviar-asistente').click();
    await expect(page.getByTestId('contexto-asistente')).toBeVisible();
    await openGuide(page);
    await expect(dialog.getByRole('button', { name: 'Usar ejemplo como borrador' })).toBeDisabled();
    await expect(dialog).toContainText('aclaración en curso');
    expect(calls).toHaveLength(1);
  } finally {
    await actor.close();
  }
});
