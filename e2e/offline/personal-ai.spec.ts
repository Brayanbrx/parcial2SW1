import { expect, test } from '@playwright/test';
import { personalAiChoiceSchema } from '@uml/contracts';

test.beforeEach(async ({ request }) => {
  await request.post('/test/reset');
});
test('un selector permite cambiar de IA de VM a un modelo de la laptop o a la nube', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let choice = personalAiChoiceSchema.parse({ source: 'PROJECT' });
  const model = { name: 'modelo-vm', contextWindow: 32768 };
  const deviceId = '10000000-0000-4000-8000-000000000001';
  let laptopConnected = true;
  await page.route('**/api/ai-devices', (route) =>
    route.fulfill({
      json: {
        choice,
        vm: { allowed: true, connected: true, models: [model], active: 0 },
        devices: [
          {
            id: deviceId,
            name: 'Laptop de Ana',
            connected: laptopConnected,
            models: laptopConnected
              ? [
                  { ...model, name: 'gemma:4b' },
                  { ...model, name: 'qwen:8b' },
                ]
              : [],
            active: 0,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        ],
      },
    }),
  );
  await page.route('**/api/ai-devices/preference', async (route) => {
    choice = personalAiChoiceSchema.parse(route.request().postDataJSON());
    await route.fulfill({ json: choice });
  });
  await page.goto('/entrar');
  await page.getByTestId('email').fill('ana@example.com');
  await page.getByTestId('password').fill('password-test');
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
  await page.goto('/pizarras/00000000-0000-4000-8000-000000000010');
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.getByTestId('pestana-asistente').click();
  const trigger = page.getByTestId('mi-motor-ia');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Mi motor de IA' });
  const selector = dialog.getByLabel('Motor y modelo');
  const save = dialog.getByRole('button', { name: 'Guardar motor' });
  await expect(dialog.getByRole('combobox')).toHaveCount(1);
  await expect(selector).toBeEnabled();
  await selector.selectOption({ label: `IA de VM · ${model.name}` });
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toContainText(`IA de VM · ${model.name}`);
  await expect(trigger).toBeFocused();
  expect(choice).toEqual({ source: 'VM', model: model.name, deviceId: null });
  await trigger.click();
  await expect(selector.locator('option:checked')).toHaveText(`IA de VM · ${model.name}`);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Guardar motor' })).toBeInViewport();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`motor-ia-${width}.png`) });
  }
  await selector.selectOption({ label: 'Laptop de Ana · qwen:8b' });
  await save.click();
  await expect(trigger).toContainText('Laptop de Ana · qwen:8b');
  expect(choice).toEqual({ source: 'DEVICE', model: 'qwen:8b', deviceId });
  laptopConnected = false;
  await trigger.click();
  await expect(selector.locator('option:checked')).toHaveText(
    'Laptop de Ana · qwen:8b · no disponible',
  );
  await expect(save).toBeDisabled();
  await selector.selectOption({ label: 'Proveedores en la nube' });
  await save.click();
  await expect(trigger).toContainText('Nube');
  expect(choice).toEqual({ source: 'PROVIDERS', model: null, deviceId: null });
  // Otro cliente guardó la preferencia. El panel debe consultarla sin abrir el selector.
  choice = personalAiChoiceSchema.parse({ source: 'VM', model: model.name });
  await page.evaluate(() => {
    const channel = new BroadcastChannel('uml-personal-ai');
    channel.postMessage('changed');
    channel.close();
  });
  await expect(trigger).toContainText(`IA de VM · ${model.name}`);
  expect(errors).toEqual([]);
});
