import { expect, test, type Page } from '@playwright/test';
import {
  abrirHerramienta,
  abrirPizarra,
  crearClase,
  crearPizarra,
  crearProyecto,
  registrarActor,
  invitar,
  aceptarInvitacion,
} from '../support/actors.js';

async function startTour(page: Page, resume = false) {
  await page.getByRole('button', { name: 'Aprender a usar el software' }).click();
  await page
    .getByRole('button', {
      name: resume ? 'Retomar recorrido interactivo' : 'Guiarme en esta pantalla',
    })
    .click();
  return page.locator('.tour-coach');
}

test('acompaña acciones reales de proyecto a pizarra, detecta escritura y permite retomar', async ({
  browser,
}) => {
  const actor = await registrarActor(browser, 'tour');
  const { page } = actor;
  try {
    const coach = await startTour(page);
    await expect(coach.getByRole('heading', { name: 'Ponle nombre a tu proyecto' })).toBeVisible();
    await expect(page.getByTestId('lista-proyectos').locator('li.tarjeta-recurso')).toHaveCount(0);
    await expect(page.getByTestId('nombre-proyecto')).toHaveValue('');
    await expect(coach.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await coach.getByRole('button', { name: 'Ir al control' }).click();
    await expect(page.getByTestId('nombre-proyecto')).toBeFocused();
    await page.getByTestId('nombre-proyecto').fill('Proyecto guiado');
    await expect(coach.getByRole('status')).toContainText('Acción detectada');
    await coach.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByTestId('crear-proyecto').click();
    await expect(coach.getByRole('heading', { name: 'Nombra tu diagrama' })).toBeVisible();
    await page.getByTestId('nombre-pizarra').fill('Diagrama guiado');
    await coach.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByTestId('crear-pizarra').click();
    await expect(page.getByRole('link', { name: 'Diagrama guiado' })).toBeVisible();
    await coach.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('link', { name: 'Diagrama guiado' }).click();
    await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
    await expect(coach.getByRole('heading', { name: 'Añade tu primera clase' })).toBeVisible();
    await page.getByTestId('crear-clase').click();
    await coach.getByRole('button', { name: 'Siguiente' }).click();
    await expect(
      coach.getByRole('heading', { name: 'Dale un nombre que describa el concepto' }),
    ).toBeVisible();
    await page.getByTestId('nombre-clase').fill('Cliente guiado');
    await page.keyboard.press('Escape');
    await expect(coach).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprender a usar el software' })).toBeFocused();
    await page.reload();
    await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
    await startTour(page, true);
    await expect(
      coach.getByRole('heading', { name: 'Dale un nombre que describa el concepto' }),
    ).toBeVisible();
    await expect(coach.getByRole('status')).toContainText('Selecciona una clase');
    await coach.getByRole('button', { name: 'Omitir paso' }).click();
    await expect(coach.getByRole('heading', { name: 'Describe sus datos' })).toBeVisible();
  } finally {
    await actor.close();
  }
});

test('revela paneles sin modificar datos, se adapta al tamaño y finaliza sin generar', async ({
  browser,
}) => {
  const actor = await registrarActor(browser, 'tour-panel');
  const { page } = actor;
  try {
    await crearProyecto(actor, 'Recorrido de paneles');
    await crearPizarra(actor, 'Paneles');
    await abrirPizarra(actor, 'Paneles');
    await crearClase(actor, 'Cliente');
    await page.getByTestId('alternar-panel').click();
    const coach = await startTour(page);
    await coach.getByRole('button', { name: 'Omitir paso' }).click();
    await expect(coach.getByRole('button', { name: 'Mostrar control' })).toBeVisible();
    await coach.getByRole('button', { name: 'Mostrar control' }).click();
    await expect(page.getByTestId('nombre-clase')).toBeVisible();
    await expect(page.getByTestId('nombre-clase')).toBeFocused();
    await expect(page.getByTestId('nombre-clase')).toHaveValue('Cliente');
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByTestId('tour-spotlight')).toBeVisible();
      const box = await coach.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(801);
      expect(await coach.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    await coach.getByRole('button', { name: 'Pausar recorrido' }).click();
    await abrirHerramienta(actor, 'generar');
    await startTour(page);
    await expect(
      coach.getByRole('heading', { name: 'Elige lo que vas a construir' }),
    ).toBeVisible();
    await expect(page.getByTestId('incluir-flutter')).not.toBeChecked();
    await coach.getByRole('button', { name: 'Siguiente' }).click();
    await coach.getByRole('button', { name: 'Terminar recorrido' }).click();
    await expect(coach.getByRole('heading', { name: 'Recorrido terminado' })).toBeVisible();
    await expect(page.getByTestId('descargar-spring')).toHaveCount(0);
    await coach.getByRole('button', { name: 'Cerrar recorrido' }).click();
    await expect(page.getByTestId('clase-Cliente')).toBeVisible();
  } finally {
    await actor.close();
  }
});

test('lector puede omitir controles bloqueados sin ejecutar acciones de edición', async ({
  browser,
}) => {
  const owner = await registrarActor(browser, 'tour-owner');
  const reader = await registrarActor(browser, 'tour-reader');
  try {
    await crearProyecto(owner, 'Recorrido lector');
    await crearPizarra(owner, 'Solo lectura');
    const code = await invitar(owner, 'lector');
    await aceptarInvitacion(reader, code);
    await abrirPizarra(reader, 'Solo lectura');
    const coach = await startTour(reader.page);
    await expect(coach.getByRole('status')).toContainText('no está disponible');
    await expect(coach.getByRole('button', { name: 'Ir al control' })).toBeDisabled();
    await coach.getByRole('button', { name: 'Omitir paso' }).click();
    await expect(
      coach.getByRole('heading', { name: 'Dale un nombre que describa el concepto' }),
    ).toBeVisible();
    await reader.page.keyboard.press('Escape');
    await expect(reader.page.locator('.react-flow__node')).toHaveCount(0);
  } finally {
    await owner.close();
    await reader.close();
  }
});
