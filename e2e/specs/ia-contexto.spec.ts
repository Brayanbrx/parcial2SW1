import { expect, test } from '@playwright/test';
import type { SemanticModel } from '@uml/contracts';
import { resolveProposal } from '@uml/ai';
import { montarEscenario } from '../support/escenario.js';
import { crearClase } from '../support/actors.js';
import { createTeamAiMock } from '../support/team-ai.js';
import { hablarConIa } from '../support/destino.js';

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
    const mock = createTeamAiMock((turn) => {
      const body = { instruction: turn.text, model: turn.model, context: [...turn.context] };
      requests.push(body);
      if (requests.length === 1) {
        return {
          kind: 'QUESTION',
          question: '¿En qué clase?',
          options: ['Cliente', 'Proveedor'],
        };
      }
      const outcome = resolveProposal({
        proposal: {
          operations: [
            { op: 'ADD_ATTRIBUTE', className: 'Cliente', attributeName: 'correo', type: 'String' },
          ],
        },
        model: body.model,
        actorId: turn.authorId,
        origin: 'AI_TEXT',
      });
      return outcome;
    });
    await mock.install(page);
    await page.getByTestId('pestana-asistente').click();
    const input = page.getByTestId('entrada-asistente');
    await hablarConIa(page);
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
