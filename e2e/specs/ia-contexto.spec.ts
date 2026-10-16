import { expect, test } from '@playwright/test';
import type { SemanticModel } from '@uml/contracts';
import { resolveProposal } from '@uml/ai';
import { montarEscenario } from '../support/escenario.js';
import { crearClase } from '../support/actors.js';

test('conserva opciones de aclaración y recupera el pedido completo cuando cambia la pizarra', async ({
  browser,
}) => {
  const scenario = await montarEscenario(browser, 'Contexto IA');
  try {
    const { page } = scenario.ana;
    await crearClase(scenario.ana, 'Cliente');
    await expect(scenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
    const requests: {
      instruction: string;
      context: { role: string; text: string }[];
      model: SemanticModel;
    }[] = [];
    await page.route('**/assistant/instruction', async (route) => {
      const body = route.request().postDataJSON() as (typeof requests)[number];
      requests.push(body);
      if (requests.length === 1) {
        await route.fulfill({
          json: {
            kind: 'QUESTION',
            question: '¿En qué clase?',
            options: ['Cliente', 'Proveedor'],
            rationale: null,
          },
        });
        return;
      }
      const outcome = resolveProposal({
        proposal: {
          operations: [
            { op: 'ADD_ATTRIBUTE', className: 'Cliente', attributeName: 'correo', type: 'String' },
          ],
        },
        model: body.model,
        actorId: '22222222-2222-4222-8222-222222222222',
        origin: 'AI_TEXT',
      });
      await route.fulfill({ json: { ...outcome, rationale: null } });
    });
    await page.getByTestId('pestana-asistente').click();
    const input = page.getByTestId('entrada-asistente');
    await input.fill('Agrega correo String; no borres ninguna clase.');
    await page.getByTestId('enviar-asistente').click();
    await expect(page.getByTestId('conversacion')).toContainText('1. "Cliente"');
    await input.fill('la primera');
    await page.getByTestId('enviar-asistente').click();
    await expect(page.getByTestId('aplicar-propuesta')).toBeVisible();
    expect(requests[1]?.context[1]?.text).toBe('¿En qué clase?\n1. "Cliente"\n2. "Proveedor"');
    await scenario.beto.page.getByTestId('clase-Cliente').click();
    await scenario.beto.page.getByTestId('nuevo-atributo').fill('correo');
    await scenario.beto.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(page.getByTestId('clase-Cliente')).toContainText('correo');
    await page.getByTestId('aplicar-propuesta').click();
    await expect(page.getByTestId('propuesta-obsoleta')).toBeVisible();
    await expect(input).toHaveValue('la primera');
    await page.getByTestId('enviar-asistente').click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2]?.context).toEqual(requests[1]?.context);
    expect(requests[2]?.context[0]?.text).toContain('no borres ninguna clase');
  } finally {
    await scenario.cerrar();
  }
});
