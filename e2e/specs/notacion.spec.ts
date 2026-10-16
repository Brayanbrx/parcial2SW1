import { expect, test } from '@playwright/test';
import { abrirHerramienta, crearClase } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

/**
 * Notación UML 2.5 en el lienzo.
 *
 * Lo que se fija aquí es lo que distingue un diagrama de clases de un grafo
 * cualquiera: la caja con sus compartimentos, la línea recta, y cada
 * multiplicidad en el extremo al que pertenece. Antes las dos iban juntas en el
 * medio como «1 → 0..*», y había que recordar cuál era cuál.
 */
test.describe('notacion del diagrama', () => {
  test('la clase se dibuja con sus compartimentos y sus atributos en notacion UML', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'Notacion');
    try {
      await crearClase(escenario.ana, 'Persona');
      await escenario.ana.page.getByTestId('nuevo-atributo').fill('correo');
      await escenario.ana.page.getByRole('button', { name: 'Añadir' }).click();

      const caja = escenario.ana.page.getByTestId('clase-Persona');

      // Compartimento del nombre, separado del de atributos.
      await expect(caja.locator('header .nombre')).toHaveText('Persona');

      // `- correo: String`: visibilidad, nombre y tipo.
      const fila = caja.locator('.atributos li').first();
      await expect(fila.locator('.visibilidad')).toHaveText('-');
      await expect(fila.locator('.campo')).toContainText('correo');
      await expect(fila.locator('.tipo')).toHaveText('String');
    } finally {
      await escenario.cerrar();
    }
  });

  test('la relacion es una linea con una multiplicidad en cada extremo', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Notacion relacion');
    try {
      await crearClase(escenario.ana, 'Persona');
      await crearClase(escenario.ana, 'Curso');

      await escenario.ana.page
        .getByTestId('clase-Persona')
        .locator('.react-flow__handle-right')
        .dragTo(escenario.ana.page.getByTestId('clase-Curso').locator('.react-flow__handle-left'));

      const arista = escenario.ana.page.locator('.react-flow__edge').first();

      // Dos etiquetas, una por extremo, y no una sola en el medio.
      const multiplicidades = arista.locator('text.multiplicidad');
      await expect(multiplicidades).toHaveCount(2);
      await expect(multiplicidades.nth(0)).toHaveText('1');
      await expect(multiplicidades.nth(1)).toHaveText('0..*');

      // Y el trazo es una recta: `getStraightPath` produce un `M … L …`, sin
      // curvas. Una Bezier sugiere un flujo, y esto es una asociación.
      const trazo = await arista.locator('path.asociacion-linea').getAttribute('d');
      expect(trazo).toMatch(/^M[\d\s.,-]+L[\d\s.,-]+$/);
    } finally {
      await escenario.cerrar();
    }
  });

  test('crea y conserva una asociacion recursiva como un bucle UML', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Asociacion recursiva');
    try {
      await crearClase(escenario.ana, 'Materia');

      // Primera forma: herramienta, seleccionando dos veces la misma clase.
      await escenario.ana.page.getByTestId('tool-association').click();
      await escenario.ana.page.getByTestId('clase-Materia').click();
      await expect(escenario.ana.page.getByText(/Origen: Materia/)).toBeVisible();
      await escenario.ana.page.getByTestId('clase-Materia').click();

      const bucle = escenario.ana.page.locator('[data-relationship-kind="ASSOCIATION"]');
      await expect(bucle).toBeVisible();
      await expect(bucle.locator('text.multiplicidad')).toHaveCount(2);
      await expect(bucle.locator('text.multiplicidad').nth(0)).toHaveText('1');
      await expect(bucle.locator('text.multiplicidad').nth(1)).toHaveText('0..*');
      await expect(
        escenario.ana.page.getByRole('group', { name: 'Materia · origen' }),
      ).toBeVisible();
      await expect(
        escenario.ana.page.getByRole('group', { name: 'Materia · destino' }),
      ).toBeVisible();
      await escenario.ana.page.getByTestId('rol-origen').fill('jefe');
      await escenario.ana.page.getByTestId('rol-destino').fill('subordinados');
      await expect(bucle.locator('text.rol-asociacion')).toHaveText(['jefe', 'subordinados']);

      const bucleRemoto = escenario.beto.page.locator('[data-relationship-kind="ASSOCIATION"]');
      for (const rol of ['coordinador', 'responsable', 'jefe']) {
        await escenario.ana.page.getByTestId('rol-origen').fill(rol);
        await expect(bucleRemoto.locator('text.rol-asociacion')).toHaveText([rol, 'subordinados']);
        await escenario.beto.page.getByTestId('clase-Materia').click();
        await expect(bucleRemoto).toBeVisible();
      }

      // Es un bucle ortogonal de tres segmentos, no una linea que atraviesa la
      // caja ni una arista de longitud cero.
      await expect(bucle.locator('path.asociacion-linea')).toHaveAttribute(
        'd',
        /^M[\d\s.,-]+L[\d\s.,-]+L[\d\s.,-]+L[\d\s.,-]+$/,
      );

      // La relacion es parte del documento compartido, y sigue anclada al
      // mover la clase.
      await expect(
        escenario.beto.page.locator('[data-relationship-kind="ASSOCIATION"]'),
      ).toBeVisible();
      const materia = escenario.ana.page.getByTestId('clase-Materia');
      const posicion = await materia.boundingBox();
      expect(posicion).not.toBeNull();
      if (posicion === null) throw new Error('No se pudo medir Materia');
      await escenario.ana.page.mouse.move(posicion.x + 80, posicion.y + 12);
      await escenario.ana.page.mouse.down();
      await escenario.ana.page.mouse.move(posicion.x + 220, posicion.y + 100, { steps: 10 });
      await escenario.ana.page.mouse.up();
      await expect(bucle).toBeVisible();
      await expect(
        escenario.beto.page.locator('[data-relationship-kind="ASSOCIATION"]'),
      ).toBeVisible();

      // Segunda forma: desde los conectores de la propia clase. Se borra el
      // primer bucle para comprobar que no dependemos de la herramienta.
      const puntoSeleccion = await bucle.locator('path.asociacion-zona').evaluate((elemento) => {
        const path = elemento as unknown as {
          getTotalLength(): number;
          getPointAtLength(distancia: number): { x: number; y: number };
          getScreenCTM(): {
            a: number;
            b: number;
            c: number;
            d: number;
            e: number;
            f: number;
          } | null;
        };
        const punto = path.getPointAtLength(path.getTotalLength() / 2);
        const matriz = path.getScreenCTM();
        if (matriz === null) throw new Error('El bucle no tiene transformación SVG');
        return {
          x: matriz.a * punto.x + matriz.c * punto.y + matriz.e,
          y: matriz.b * punto.x + matriz.d * punto.y + matriz.f,
        };
      });
      await escenario.ana.page.mouse.click(puntoSeleccion.x, puntoSeleccion.y);
      await expect(escenario.ana.page.getByTestId('inspector-relacion')).toBeVisible();
      await escenario.ana.page.getByRole('button', { name: 'Eliminar relación' }).click();
      await expect(bucle).toHaveCount(0);
      await materia.click();
      const conectorOrigen = await materia.locator('.conector-rapido').boundingBox();
      const conectorDestino = await materia.locator('.conector-bucle-destino').boundingBox();
      expect(conectorOrigen).not.toBeNull();
      expect(conectorDestino).not.toBeNull();
      if (conectorOrigen === null || conectorDestino === null) {
        throw new Error('No se pudieron medir los conectores del bucle');
      }
      await escenario.ana.page.mouse.move(
        conectorOrigen.x + conectorOrigen.width / 2,
        conectorOrigen.y + conectorOrigen.height / 2,
      );
      await escenario.ana.page.mouse.down();
      await escenario.ana.page.mouse.move(
        conectorDestino.x + conectorDestino.width / 2,
        conectorDestino.y + conectorDestino.height / 2,
        { steps: 8 },
      );
      await escenario.ana.page.mouse.up();
      await expect(bucle).toBeVisible();
      await expect(
        escenario.beto.page.locator('[data-relationship-kind="ASSOCIATION"]'),
      ).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('separa asociaciones paralelas con roles distintos', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Relaciones paralelas');
    try {
      await crearClase(escenario.ana, 'Cliente');
      await crearClase(escenario.ana, 'Direccion');

      const relacionar = async (rol: string): Promise<void> => {
        await escenario.ana.page.getByTestId('tool-association').click();
        await escenario.ana.page.getByTestId('clase-Cliente').click();
        await escenario.ana.page.getByTestId('clase-Direccion').click();
        await escenario.ana.page.getByTestId('rol-origen').fill(rol);
      };

      await relacionar('domicilio');
      await relacionar('facturacion');

      const aristas = escenario.ana.page.locator('.react-flow__edge');
      await expect(aristas).toHaveCount(2);
      const primerTrazo = await aristas.nth(0).locator('path.asociacion-linea').getAttribute('d');
      const segundoTrazo = await aristas.nth(1).locator('path.asociacion-linea').getAttribute('d');
      expect(primerTrazo).not.toBe(segundoTrazo);

      const roles = await aristas.locator('text.rol-asociacion').allTextContents();
      expect(roles.sort()).toEqual(['domicilio', 'facturacion']);
      await expect(escenario.beto.page.locator('.react-flow__edge')).toHaveCount(2);
      await expect(escenario.ana.page.getByTestId('puede-generar')).toHaveText(
        'Generación disponible',
      );
    } finally {
      await escenario.cerrar();
    }
  });

  test('el toolbox coloca clases y crea una composicion eligiendo sus extremos', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'Toolbox UML');
    try {
      await escenario.ana.page.setViewportSize({ width: 1366, height: 768 });
      // Primera forma de crear: se arma Clase y se coloca en el punto elegido.
      await escenario.ana.page.getByTestId('tool-class').click();
      await expect(escenario.ana.page.getByTestId('modo-lienzo')).toContainText(
        'Haz clic para colocarla',
      );
      await escenario.ana.page
        .getByTestId('pizarra-diagrama')
        .locator('.react-flow__pane')
        .click({ position: { x: 260, y: 190 } });
      await escenario.ana.page.getByTestId('nombre-clase').fill('Pedido');

      await crearClase(escenario.ana, 'Detalle');

      // Segunda forma de relacionar: herramienta, origen y destino.
      await escenario.ana.page.getByTestId('tool-composition').click();
      await escenario.ana.page.getByTestId('clase-Pedido').click();
      await expect(escenario.ana.page.getByText(/Origen: Pedido/)).toBeVisible();
      await escenario.ana.page.getByTestId('clase-Detalle').click();

      const composicion = escenario.ana.page.locator('[data-relationship-kind="COMPOSITION"]');
      await expect(composicion).toBeVisible();
      await expect(composicion.locator('.marcador-relacion.diamante.relleno')).toHaveCount(1);
      await expect(escenario.ana.page.getByTestId('tipo-relacion')).toHaveValue('COMPOSITION');

      // El tipo no es decoracion local: el otro participante recibe la misma
      // relacion y la dibuja con el mismo diamante sin recargar.
      await expect(
        escenario.beto.page.locator('[data-relationship-kind="COMPOSITION"]'),
      ).toBeVisible();

      // Al cruzar el origen al otro lado del destino, la geometria pasa de
      // usar su conector derecho al izquierdo. La relacion debe seguir
      // resolviendo ambos extremos y conservar el diamante de composicion.
      const pedido = escenario.ana.page.getByTestId('clase-Pedido');
      const posicionInicial = await pedido.boundingBox();
      expect(posicionInicial).not.toBeNull();
      if (posicionInicial === null) {
        throw new Error('No se pudo determinar la posicion de Pedido');
      }

      await escenario.ana.page.mouse.move(
        posicionInicial.x + posicionInicial.width / 2,
        posicionInicial.y + 12,
      );
      await escenario.ana.page.mouse.down();
      await escenario.ana.page.mouse.move(
        posicionInicial.x + posicionInicial.width / 2 + 430,
        posicionInicial.y + 12,
        { steps: 15 },
      );
      await escenario.ana.page.mouse.up();

      await expect(composicion).toBeVisible();
      await expect(composicion.locator('.marcador-relacion.diamante.relleno')).toHaveCount(1);
      await expect(
        escenario.beto.page.locator('[data-relationship-kind="COMPOSITION"]'),
      ).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('la generalizacion se dibuja con su triangulo y dice que hereda la subclase', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'Generalizacion');
    try {
      await crearClase(escenario.ana, 'Persona');
      await escenario.ana.page.getByTestId('nuevo-atributo').fill('nombre');
      await escenario.ana.page.getByRole('button', { name: 'Añadir' }).click();

      await crearClase(escenario.ana, 'Estudiante');
      await escenario.ana.page.getByTestId('nuevo-atributo').fill('matricula');
      await escenario.ana.page.getByRole('button', { name: 'Añadir' }).click();

      // La subclase es el origen: se elige primero, como pide el inspector.
      await escenario.ana.page.getByTestId('tool-generalization').click();
      await escenario.ana.page.getByTestId('clase-Estudiante').click();
      await escenario.ana.page.getByTestId('clase-Persona').click();

      const generalizacion = escenario.ana.page.locator(
        '[data-relationship-kind="GENERALIZATION"]',
      );
      await expect(generalizacion).toBeVisible();

      // Triangulo hueco, y ninguna multiplicidad: en una generalizacion no
      // significan nada.
      await expect(generalizacion.locator('.marcador-relacion.triangulo')).toHaveCount(1);
      await expect(generalizacion.locator('text.multiplicidad')).toHaveCount(0);

      // Y desde que la herencia se genera de verdad (RM-07), la tarjeta de la
      // subclase no cuenta toda la historia: la clave primaria y el resto de
      // columnas vienen de arriba, y eso hay que poder verlo sin abrir el ZIP.
      await escenario.ana.page.getByTestId('clase-Estudiante').click();
      const herencia = escenario.ana.page.getByTestId('herencia-clase');
      await expect(herencia).toContainText('Hereda de');
      await expect(herencia).toContainText('Persona');
      await expect(herencia.locator('.atributos-heredados li')).toContainText(['nombre']);

      // La superclase ve la relacion desde el otro lado.
      await escenario.ana.page.getByTestId('clase-Persona').click();
      await expect(escenario.ana.page.getByTestId('herencia-clase')).toContainText('Estudiante');
    } finally {
      await escenario.cerrar();
    }
  });

  test('la camara se abre en el panel y ofrece tomar la foto', async ({ browser }) => {
    // No se comprueba la foto en si: eso necesitaria una camara de verdad. Lo
    // que se fija aqui es que el boton existe, que abre la vista dentro del
    // panel —y no en un dialogo que tape el diagrama— y que un equipo sin
    // camara lo dice en vez de quedarse en blanco.
    const escenario = await montarEscenario(browser, 'Camara');
    try {
      const page = escenario.ana.page;
      await abrirHerramienta(escenario.ana, 'importar');

      await expect(page.getByTestId('importar-imagen')).toHaveText('Subir foto');
      await page.getByTestId('abrir-camara').click();

      const camara = page.getByTestId('camara');
      await expect(camara).toBeVisible();

      // Chromium sin dispositivo falla con NotFoundError, y el mensaje tiene
      // que llevar a la salida: subir el archivo.
      await expect(
        camara.getByTestId('tomar-foto').or(page.getByTestId('error-camara')),
      ).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });
});
