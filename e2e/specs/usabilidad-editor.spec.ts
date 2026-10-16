import { expect, test } from '@playwright/test';
import { crearClase, posicionEnDiagrama } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

test.describe('usabilidad del editor UML', () => {
  test('orienta una pizarra vacia y permite ganar espacio ocultando paneles', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'Editor amigable');
    try {
      await escenario.ana.page.setViewportSize({ width: 1280, height: 720 });
      const erroresDePagina: string[] = [];
      escenario.ana.page.on('pageerror', (error) => erroresDePagina.push(error.message));

      const vacio = escenario.ana.page.getByTestId('lienzo-vacio');
      await expect(vacio).toContainText('Empieza con una clase');
      await vacio.getByRole('button', { name: 'Crear primera clase' }).click();

      await expect(vacio).toHaveCount(0);
      await expect(escenario.ana.page.getByTestId('inspector-clase')).toBeVisible();
      await expect(escenario.ana.page.getByLabel('Nombre del nuevo atributo')).toBeVisible();

      await escenario.ana.page.getByTestId('tool-composition').click();
      await escenario.ana.page.getByRole('button', { name: /Cancelar/ }).click();
      await expect(escenario.ana.page.getByTestId('modo-lienzo')).toHaveCount(0);
      await expect(escenario.ana.page.getByTestId('tool-select')).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      const tablero = escenario.ana.page.getByTestId('pizarra-diagrama');
      const anchoInicial = (await tablero.boundingBox())?.width ?? 0;

      const alternarToolbox = escenario.ana.page.getByTestId('alternar-toolbox');
      await alternarToolbox.click();
      await expect(alternarToolbox).toHaveAttribute('aria-expanded', 'false');
      await expect(escenario.ana.page.getByLabel('Caja de herramientas UML')).toBeHidden();

      const anchoSinToolbox = (await tablero.boundingBox())?.width ?? 0;
      expect(anchoSinToolbox).toBeGreaterThan(anchoInicial + 100);

      const alternarPanel = escenario.ana.page.getByTestId('alternar-panel');
      await alternarPanel.click();
      await expect(alternarPanel).toHaveAttribute('aria-expanded', 'false');
      await expect(escenario.ana.page.locator('#panel-editor')).toBeHidden();

      const anchoCompleto = (await tablero.boundingBox())?.width ?? 0;
      expect(anchoCompleto).toBeGreaterThan(anchoSinToolbox + 200);
      expect(erroresDePagina).toEqual([]);
    } finally {
      await escenario.cerrar();
    }
  });

  test('selecciona, mueve y elimina una clase con teclado y sincroniza el cambio', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'Teclado UML');
    try {
      await crearClase(escenario.ana, 'Cliente');
      const pagina = escenario.ana.page;
      const tarjeta = pagina.getByTestId('clase-Cliente');
      const nodo = pagina.locator('.react-flow__node', { has: tarjeta });

      await pagina
        .getByTestId('pizarra-diagrama')
        .locator('.react-flow__pane')
        .click({ position: { x: 20, y: 20 } });
      await nodo.focus();
      await pagina.keyboard.press('Enter');
      await expect(pagina.getByTestId('inspector-clase')).toBeVisible();

      const antes = await posicionEnDiagrama(escenario.beto, 'Cliente');
      await pagina.keyboard.press('ArrowRight');
      await expect
        .poll(async () => (await posicionEnDiagrama(escenario.beto, 'Cliente')).x)
        .toBeGreaterThan(antes.x);

      await pagina.keyboard.press('Delete');
      await expect(pagina.getByTestId('clase-Cliente')).toHaveCount(0);
      await expect(escenario.beto.page.getByTestId('clase-Cliente')).toHaveCount(0);
    } finally {
      await escenario.cerrar();
    }
  });

  test('expone ambos extremos UML y las pestanas responden a las flechas', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Propiedades UML');
    try {
      await crearClase(escenario.ana, 'Pedido');
      await crearClase(escenario.ana, 'Cliente');

      // Una clase creada desde la barra siempre queda completa dentro del
      // lienzo, aunque la camara estuviera centrada en la anterior.
      await expect
        .poll(async () => {
          const tablero = await escenario.ana.page.getByTestId('pizarra-diagrama').boundingBox();
          const cliente = await escenario.ana.page
            .locator('.react-flow__node', {
              has: escenario.ana.page.getByTestId('clase-Cliente'),
            })
            .boundingBox();
          if (tablero === null || cliente === null) return false;
          return (
            cliente.x >= tablero.x &&
            cliente.x + cliente.width <= tablero.x + tablero.width &&
            cliente.y >= tablero.y &&
            cliente.y + cliente.height <= tablero.y + tablero.height
          );
        })
        .toBe(true);

      await escenario.ana.page
        .getByTestId('clase-Pedido')
        .locator('.react-flow__handle-right')
        .dragTo(
          escenario.ana.page.getByTestId('clase-Cliente').locator('.react-flow__handle-left'),
        );

      await expect(escenario.ana.page.getByTestId('rol-origen')).toBeVisible();
      await expect(escenario.ana.page.getByTestId('rol-destino')).toBeVisible();
      await escenario.ana.page.getByTestId('rol-origen').fill('pedidos');
      await escenario.ana.page.getByTestId('rol-destino').fill('cliente');
      await expect(escenario.ana.page.locator('.rol-asociacion')).toHaveCount(2);
      await expect(escenario.ana.page.locator('.rol-asociacion').nth(0)).toHaveText('pedidos');
      await expect(escenario.ana.page.locator('.rol-asociacion').nth(1)).toHaveText('cliente');

      await escenario.ana.page.getByTestId('tipo-relacion').selectOption('GENERALIZATION');
      await expect(escenario.ana.page.getByTestId('multiplicidad-origen')).toHaveCount(0);
      await expect(escenario.ana.page.getByTestId('multiplicidad-destino')).toHaveCount(0);
      await expect(escenario.ana.page.locator('.rol-asociacion')).toHaveCount(0);

      const pestanaAsistente = escenario.ana.page.getByTestId('pestana-asistente');
      await pestanaAsistente.focus();
      await escenario.ana.page.keyboard.press('End');
      await expect(escenario.ana.page.getByTestId('pestana-generar')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(escenario.ana.page.locator('#panel-generar')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('mantiene los controles principales utilizables en una pantalla estrecha', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'Editor estrecho');
    try {
      await escenario.ana.page.setViewportSize({ width: 820, height: 720 });

      await expect(escenario.ana.page.getByTestId('pizarra-diagrama')).toBeVisible();
      await expect(escenario.ana.page.getByTestId('crear-clase')).toBeVisible();
      await expect(escenario.ana.page.getByTestId('alternar-toolbox')).toBeVisible();
      await expect(escenario.ana.page.getByTestId('alternar-panel')).toBeVisible();
      await expect(escenario.ana.page.locator('.react-flow__minimap')).toBeHidden();

      const tieneDesbordeHorizontal = await escenario.ana.page.evaluate(
        'document.documentElement.scrollWidth > window.innerWidth',
      );
      expect(tieneDesbordeHorizontal).toBe(false);
    } finally {
      await escenario.cerrar();
    }
  });
});
