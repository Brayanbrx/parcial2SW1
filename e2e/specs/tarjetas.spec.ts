import { expect, test } from '@playwright/test';
import {
  aceptarInvitacion,
  crearPizarra,
  crearProyecto,
  invitar,
  registrarActor,
} from '../support/actors.js';

/**
 * La tarjeta de un proyecto donde no eres propietario.
 *
 * La insignia del rol llevaba el rol en minúsculas como clase suelta, así que
 * un EDITOR obtenía `class="insignia-rol editor"` — y `.editor` es la clase del
 * armazón del editor UML, que declara `height: 100vh`. La insignia medía 720
 * píxeles y estiraba la tarjeta entera. Con OWNER no se veía, porque `.owner`
 * no choca con nada, y por eso ninguna prueba lo detectó: todas creaban sus
 * propios proyectos.
 */
test('la tarjeta de un proyecto ajeno tiene una altura normal', async ({ browser }) => {
  const ana = await registrarActor(browser, 'ana');
  const beto = await registrarActor(browser, 'beto');

  try {
    await crearProyecto(ana, 'Sistema de Ventas');
    await crearPizarra(ana, 'Diagrama de clases');
    const codigo = await invitar(ana, 'editor');
    await aceptarInvitacion(beto, codigo);

    await beto.page.goto('/proyectos');
    await expect(beto.page.getByTestId('lista-proyectos')).toBeVisible();

    // La insignia lleva el rol traducido desde `ROLE_LABEL`, no el valor del
    // contrato: `toHaveText` compara el texto del nodo y no ve la mayúscula que
    // aplica la hoja de estilo.
    const insignia = beto.page.locator('.insignia-rol').first();
    await expect(insignia).toHaveText('Editor');

    // Una insignia es una línea de texto. Cualquier cosa por encima de esto
    // significa que ha vuelto a heredar el alto de otra clase.
    const caja = await insignia.boundingBox();
    expect(caja).not.toBeNull();
    expect(caja!.height).toBeLessThan(40);

    // Y la tarjeta que la contiene tampoco se estira.
    const tarjeta = beto.page.locator('.tarjeta-recurso').first();
    const cajaTarjeta = await tarjeta.boundingBox();
    expect(cajaTarjeta!.height).toBeLessThan(220);
  } finally {
    await ana.close();
    await beto.close();
  }
});
