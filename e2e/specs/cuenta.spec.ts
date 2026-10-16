import { expect, test } from '@playwright/test';
import { registrarActor } from '../support/actors.js';

/**
 * Perfil, foto y contraseña desde el navegador (RF-A10 y RF-A11).
 *
 * Las pruebas de integración ya cubren las rutas y sus garantías. Lo que se
 * comprueba aquí es que una persona pueda llegar hasta ellas: que el menú lleve
 * a la cuenta, que la foto se recorte en el navegador y se vea después, y que
 * cambiar la contraseña sirva para volver a entrar con la nueva.
 */
test.describe('mi cuenta', () => {
  test('cambia el nombre y se refleja en la barra', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await ana.page.getByTestId('menu-usuario').click();
      await ana.page.getByTestId('mi-cuenta').click();

      await expect(ana.page.getByTestId('perfil-nombre')).toBeVisible();
      await ana.page.getByTestId('perfil-nombre').fill('Ana Torres');
      await ana.page.getByTestId('guardar-perfil').click();

      await expect(ana.page.getByTestId('perfil-guardado')).toBeVisible();
      // El nombre nuevo llega a la barra sin recargar: la ruta devuelve el
      // usuario actualizado y la sesión lo adopta.
      await expect(ana.page.getByTestId('menu-usuario')).toContainText('Ana Torres');
    } finally {
      await ana.close();
    }
  });

  test('el correo se muestra pero no se puede editar', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await ana.page.goto('/cuenta');

      const correo = ana.page.getByTestId('perfil-correo');
      await expect(correo).toBeVisible();
      // Es la identidad de la cuenta y la dirección de la recuperación.
      await expect(correo).toBeDisabled();
    } finally {
      await ana.close();
    }
  });

  test('sube una foto y aparece en la barra superior', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await ana.page.goto('/cuenta');

      // Un PNG de 2x2. El navegador lo recorta a 256x256 y lo reencoda antes
      // de subirlo, así que lo que llega al servidor no es este archivo.
      await ana.page.getByTestId('archivo-foto').setInputFiles({
        name: 'retrato.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAxMDAwMAABBoAB5kBAd1FhU4AAAAASUVORK5CYII=',
          'base64',
        ),
      });

      // La imagen del avatar de la barra deja de fallar en cuanto hay foto.
      const avatarBarra = ana.page.getByTestId('menu-usuario').locator('img.avatar');
      await expect(avatarBarra).toBeVisible({ timeout: 15_000 });

      // `naturalWidth` mayor que cero significa que el navegador decodifico la
      // imagen: no basta con que la etiqueta exista, tiene que haberse cargado.
      await expect
        .poll(
          async () =>
            avatarBarra.evaluate((elemento) =>
              elemento instanceof HTMLImageElement ? elemento.naturalWidth : 0,
            ),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
    } finally {
      await ana.close();
    }
  });

  test('cambia la contraseña y entra con la nueva', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await ana.page.goto('/cuenta');

      await ana.page.getByTestId('password-actual').fill('contrasena-de-prueba');
      await ana.page.getByTestId('password-nueva').fill('contrasena-nueva-1');
      await ana.page.getByTestId('password-repetida').fill('contrasena-nueva-1');
      await ana.page.getByTestId('cambiar-password').click();

      await expect(ana.page.getByTestId('password-cambiada')).toBeVisible();

      // Y sirve de verdad: se cierra sesión y se entra con la nueva.
      await ana.page.getByTestId('menu-usuario').click();
      await ana.page.getByTestId('salir').click();
      await expect(ana.page.getByTestId('email')).toBeVisible();

      await ana.page.getByTestId('email').fill(ana.email);
      await ana.page.getByTestId('password').fill('contrasena-nueva-1');
      await ana.page.getByTestId('enviar').click();

      await expect(ana.page.getByTestId('lista-proyectos')).toBeVisible();
    } finally {
      await ana.close();
    }
  });

  test('la repetición que no coincide bloquea el envío', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await ana.page.goto('/cuenta');

      await ana.page.getByTestId('password-actual').fill('contrasena-de-prueba');
      await ana.page.getByTestId('password-nueva').fill('contrasena-nueva-1');
      await ana.page.getByTestId('password-repetida').fill('otra-cosa');

      // Se atrapa aquí y no en el servidor: la repetición existe para detectar
      // una errata al teclear.
      await expect(ana.page.getByTestId('cambiar-password')).toBeDisabled();
    } finally {
      await ana.close();
    }
  });
});

test.describe('recuperar la contraseña', () => {
  test('pedir el enlace confirma sin decir si la cuenta existe', async ({ browser }) => {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();

    try {
      await page.goto('/entrar');
      await page.getByTestId('olvide-password').click();

      // En este modo no se pide contraseña: solo el correo.
      await expect(page.getByTestId('password')).toHaveCount(0);

      await page.getByTestId('email').fill('nadie-por-aqui@example.com');
      await page.getByTestId('enviar').click();

      // Mismo mensaje exista o no la cuenta: el formulario no puede servir para
      // averiguar qué correos están registrados.
      await expect(page.getByTestId('recuperacion-enviada')).toBeVisible();
    } finally {
      await contexto.close();
    }
  });

  test('un enlace sin código lo dice, en vez de fallar en blanco', async ({ browser }) => {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();

    try {
      await page.goto('/restablecer');
      await expect(page.getByText(/enlace está incompleto/i)).toBeVisible();
    } finally {
      await contexto.close();
    }
  });

  test('un código inventado se rechaza', async ({ browser }) => {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();

    try {
      await page.goto(`/restablecer?token=${'a'.repeat(64)}`);

      await page.getByTestId('nueva-password').fill('contrasena-nueva-1');
      await page.getByTestId('repetir-password').fill('contrasena-nueva-1');
      await page.getByTestId('guardar-password').click();

      await expect(page.getByTestId('error-restablecer')).toContainText(/ya no sirve/i);
    } finally {
      await contexto.close();
    }
  });
});
