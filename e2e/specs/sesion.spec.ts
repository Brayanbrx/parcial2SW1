import { expect, test } from '@playwright/test';
import { registrarActor } from '../support/actors.js';

test('restablecer con una sesion abierta permite volver al formulario de acceso', async ({
  browser,
}) => {
  const ana = await registrarActor(browser, 'restablecer');
  try {
    // La integracion prueba el consumo real del enlace. Aqui se aisla el estado
    // de React tras una recuperacion exitosa, sin enviar correo ni leer secretos.
    await ana.page.route('**/api/auth/password/reset', (route) =>
      route.fulfill({ json: { reset: true } }),
    );
    await ana.page.goto(`/restablecer?token=${'a'.repeat(64)}`);
    await ana.page.getByTestId('nueva-password').fill('contrasena-renovada');
    await ana.page.getByTestId('repetir-password').fill('contrasena-renovada');
    await ana.page.getByTestId('guardar-password').click();
    await expect(ana.page.getByTestId('password-restablecida')).toBeVisible();
    await ana.page.getByTestId('ir-a-entrar').click();
    await expect(ana.page).toHaveURL(/\/entrar$/);
    await expect(ana.page.getByTestId('password')).toBeVisible();
    await ana.page.reload();
    await expect(ana.page.getByTestId('password')).toBeVisible();
  } finally {
    await ana.close();
  }
});
