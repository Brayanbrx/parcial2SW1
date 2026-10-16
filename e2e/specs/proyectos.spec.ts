import { expect, test } from '@playwright/test';
import { crearPizarra, crearProyecto, registrarActor } from '../support/actors.js';

/**
 * Administrar proyectos y pizarras desde la interfaz (RF-001 y RF-003).
 *
 * Las rutas existían desde la fase 3 y estaban probadas por HTTP, pero **no
 * había forma de llegar a ellas desde el navegador**: se podía crear una pizarra
 * y nunca renombrarla ni borrarla. Se descubrió comparando la aplicación con el
 * manual de usuario de otro proyecto de la misma materia.
 *
 * Borrar pide escribir el nombre: no hay papelera, y un «¿seguro?» se acepta sin
 * leerlo. Estas pruebas responden al `prompt` como lo haría la persona.
 */
test.describe('administrar proyectos y pizarras', () => {
  test('dos pestanas de la misma cuenta pueden renovar su sesion a la vez', async ({ browser }) => {
    const ana = await registrarActor(browser, 'multipestana');
    try {
      const second = await ana.page.context().newPage();
      await Promise.all([ana.page.reload(), second.goto('/proyectos')]);
      await expect(ana.page.getByTestId('lista-proyectos')).toBeVisible();
      await expect(second.getByTestId('lista-proyectos')).toBeVisible();
    } finally {
      await ana.close();
    }
  });
  test('un proyecto inexistente muestra el error y permite volver', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await ana.page.goto('/proyectos/00000000-0000-4000-8000-000000000000');
      await expect(ana.page.getByRole('alert')).toBeVisible();
      await expect(ana.page.getByText('Cargando el proyecto…')).toHaveCount(0);
      await ana.page.getByRole('link', { name: 'Volver a mis proyectos' }).click();
      await expect(ana.page.getByTestId('lista-proyectos')).toBeVisible();
    } finally {
      await ana.close();
    }
  });
  test('RF-003 — una pizarra se renombra desde la lista', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await crearProyecto(ana, 'Con pizarras');
      await crearPizarra(ana, 'Ventas');

      ana.page.once('dialog', (dialogo) => void dialogo.accept('Ventas y Compras'));
      await ana.page.getByTestId('renombrar-Ventas').click();

      await expect(ana.page.getByRole('link', { name: 'Ventas y Compras' })).toBeVisible();
      await expect(ana.page.getByRole('link', { name: 'Ventas', exact: true })).toHaveCount(0);
    } finally {
      await ana.close();
    }
  });

  test('RF-003 — una pizarra se elimina, escribiendo su nombre', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await crearProyecto(ana, 'Para borrar');
      await crearPizarra(ana, 'Sobrante');
      await crearPizarra(ana, 'Se queda');

      ana.page.once('dialog', (dialogo) => void dialogo.accept('Sobrante'));
      await ana.page.getByTestId('eliminar-pizarra-Sobrante').click();

      await expect(ana.page.getByRole('link', { name: 'Sobrante' })).toHaveCount(0);
      await expect(ana.page.getByRole('link', { name: 'Se queda' })).toBeVisible();
    } finally {
      await ana.close();
    }
  });

  test('escribir mal el nombre no borra nada', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await crearProyecto(ana, 'Sin accidentes');
      await crearPizarra(ana, 'Importante');

      // Es la razón de pedir el nombre: un clic distraído no puede llevarse un
      // diagrama por delante.
      ana.page.once('dialog', (dialogo) => void dialogo.accept('importante'));
      await ana.page.getByTestId('eliminar-pizarra-Importante').click();

      await expect(ana.page.getByRole('link', { name: 'Importante' })).toBeVisible();
    } finally {
      await ana.close();
    }
  });

  test('cancelar el diálogo tampoco borra', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await crearProyecto(ana, 'Cancelado');
      await crearPizarra(ana, 'Intacta');

      ana.page.once('dialog', (dialogo) => void dialogo.dismiss());
      await ana.page.getByTestId('eliminar-pizarra-Intacta').click();

      await expect(ana.page.getByRole('link', { name: 'Intacta' })).toBeVisible();
    } finally {
      await ana.close();
    }
  });

  test('RF-001 — un proyecto se elimina con sus pizarras', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await crearProyecto(ana, 'Desechable');
      await crearPizarra(ana, 'Una');
      await ana.page.goto('/proyectos');

      ana.page.once('dialog', (dialogo) => void dialogo.accept('Desechable'));
      await ana.page.getByTestId('eliminar-proyecto-Desechable').click();

      await expect(ana.page.getByRole('link', { name: /Desechable/ })).toHaveCount(0);
    } finally {
      await ana.close();
    }
  });

  test('un lector no ve las acciones de administrar', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    const beto = await registrarActor(browser, 'beto');
    try {
      const projectId = await crearProyecto(ana, 'Solo lectura');
      await crearPizarra(ana, 'Ventas');

      await ana.page.getByTestId('invitar-lector').click();
      const codigo = (await ana.page.getByTestId('codigo-generado').textContent()) as string;

      await beto.page.goto('/proyectos');
      await beto.page.getByTestId('codigo-invitacion').fill(codigo);
      await beto.page.getByTestId('aceptar-invitacion').click();
      await beto.page.goto(`/proyectos/${projectId}`);

      // El servidor lo rechazaría igualmente; no ofrecerlo evita el intento.
      await expect(beto.page.getByRole('link', { name: 'Ventas' })).toBeVisible();
      await expect(beto.page.getByTestId('renombrar-Ventas')).toHaveCount(0);
      await expect(beto.page.getByTestId('eliminar-pizarra-Ventas')).toHaveCount(0);
      await expect(beto.page.getByTestId('eliminar-proyecto-Solo lectura')).toHaveCount(0);
    } finally {
      await ana.close();
      await beto.close();
    }
  });

  test('se puede cerrar sesion desde el editor', async ({ browser }) => {
    const ana = await registrarActor(browser, 'ana');
    try {
      await crearProyecto(ana, 'Con salida');
      await crearPizarra(ana, 'Ventas');
      await ana.page.getByRole('link', { name: 'Ventas' }).click();

      await ana.page.getByTestId('salir').click();

      // Tener que volver a la lista de proyectos para salir invita a dejar la
      // sesión abierta en una máquina compartida.
      await expect(ana.page.getByTestId('email')).toBeVisible();
    } finally {
      await ana.close();
    }
  });
});
