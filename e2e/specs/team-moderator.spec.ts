import { expect, test } from '@playwright/test';
import { montarEscenario } from '../support/escenario.js';
import { crearClase } from '../support/actors.js';

test('moderador real: N:M nueva se comparte con autor; MOVE y recarga no duplican', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Moderador por contenido');
  try {
    const { ana, beto } = scenario;
    await crearClase(ana, 'Alumno');
    await crearClase(ana, 'Materia');
    await ana.page
      .getByTestId('clase-Alumno')
      .locator('.react-flow__handle-right')
      .dragTo(ana.page.getByTestId('clase-Materia').locator('.react-flow__handle-left'));
    await expect(beto.page.locator('.react-flow__edge')).toHaveCount(1);
    await beto.page.locator('.react-flow__edge').first().click();
    await beto.page.getByTestId('multiplicidad-origen').selectOption('0..*');
    for (const actor of [ana, beto]) {
      await expect(actor.page.getByTestId('panel-validacion')).toContainText('muchos a muchos');
      await actor.page.getByTestId('pestana-asistente').click();
      const reviews = actor.page
        .locator('[data-message-id]')
        .filter({ hasText: 'Revisión automática:' });
      await expect(reviews).toHaveCount(1, { timeout: 25000 });
      await expect(reviews).toContainText('IA → beto');
      await expect(reviews).toContainText('MANY_TO_MANY_RELATIONSHIP');
      await expect(reviews).toContainText('intermedia');
      await expect(actor.page.getByTestId('propuesta')).toHaveCount(0);
    }
    const card = ana.page.getByTestId('clase-Alumno');
    const box = await card.boundingBox();
    const audit = ana.page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/audit$/.test(response.url()),
      { timeout: 15000 },
    );
    await ana.page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
    await ana.page.mouse.down();
    await ana.page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + 65, { steps: 10 });
    await ana.page.mouse.up();
    const acknowledged = await audit;
    expect(acknowledged.status()).toBe(202);
    const request = acknowledged.request();
    expect(
      request.postDataJSON().commands.every((c: { type: string }) => c.type === 'MOVE_CLASS'),
    ).toBe(true);
    // Una segunda escritura idéntica tampoco vuelve a programar una revisión.
    const duplicate = await ana.page.request.post(request.url(), {
      headers: { authorization: request.headers()['authorization']! },
      data: request.postDataJSON(),
    });
    expect(duplicate.status()).toBe(202);
    await beto.page.reload();
    await beto.page.getByTestId('pestana-asistente').click();
    await expect(beto.page.locator('[data-message-id]')).toHaveCount(1);
    await expect(beto.page.getByTestId('conversacion')).toContainText('Revisión automática:');
    // El moderador comenta; el problema del modelo continúa hasta que alguien lo edite.
    await expect(beto.page.getByTestId('puede-generar')).toHaveText('Generación bloqueada');
  } finally {
    await scenario.cerrar();
  }
});
