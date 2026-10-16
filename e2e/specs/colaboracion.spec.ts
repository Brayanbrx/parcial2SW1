import { expect, test } from '@playwright/test';
import {
  abrirHerramienta,
  abrirPizarra,
  aceptarInvitacion,
  crearClase,
  crearProyecto,
  crearPizarra,
  invitar,
  posicionEnDiagrama,
  registrarActor,
  tamanoEnDiagrama,
} from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

/**
 * Las cinco pruebas de colaboracion de la seccion 15.4, mas las de seguridad y
 * validacion.
 *
 * Dos navegadores de verdad, con sesiones distintas, contra el entorno completo:
 * navegador → proxy → proceso HTTP y proceso WebSocket → PostgreSQL.
 *
 * Cada prueba monta su propio escenario. Cuesta unos segundos mas y a cambio un
 * fallo senala exactamente una cosa.
 */

test.describe('dos navegadores sobre la misma pizarra', () => {
  test('1 — A crea una clase y B la ve sin recargar (CA-022.1)', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Ventas 1');
    try {
      await crearClase(escenario.ana, 'Producto');

      // Sin recargar: B lleva en esa misma pagina desde antes.
      await expect(escenario.beto.page.getByTestId('clase-Producto')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('2 — A mueve una clase y B lo ve', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Ventas 2');
    try {
      await crearClase(escenario.ana, 'Producto');
      await expect(escenario.beto.page.getByTestId('clase-Producto')).toBeVisible();

      const antesEnBeto = await posicionEnDiagrama(escenario.beto, 'Producto');

      const tarjeta = escenario.ana.page.getByTestId('clase-Producto');
      const rectangulo = await tarjeta.boundingBox();
      expect(rectangulo).not.toBeNull();

      // Se arrastra por la cabecera, que es de donde tira una persona.
      await escenario.ana.page.mouse.move(
        rectangulo!.x + rectangulo!.width / 2,
        rectangulo!.y + 10,
      );
      await escenario.ana.page.mouse.down();
      await escenario.ana.page.mouse.move(rectangulo!.x + 250, rectangulo!.y + 160, { steps: 15 });
      await escenario.ana.page.mouse.up();

      const despuesEnAna = await posicionEnDiagrama(escenario.ana, 'Producto');
      expect(despuesEnAna.y).toBeGreaterThan(antesEnBeto.y);

      // Y B converge a la misma posicion del diagrama.
      await expect
        .poll(async () => (await posicionEnDiagrama(escenario.beto, 'Producto')).y, {
          timeout: 15_000,
        })
        .toBe(despuesEnAna.y);
    } finally {
      await escenario.cerrar();
    }
  });

  test('A redimensiona una tarjeta y B ve el tamano nuevo', async ({ browser }) => {
    // El tamano vive en el documento, no en el estado de React: por eso viaja
    // por el mismo WebSocket que todo lo demas. Si se hubiera quedado en la
    // interfaz, esta prueba fallaria y cada persona veria el suyo.
    const escenario = await montarEscenario(browser, 'Redimensionar');
    try {
      await crearClase(escenario.ana, 'Producto');
      await expect(escenario.beto.page.getByTestId('clase-Producto')).toBeVisible();

      const original = await tamanoEnDiagrama(escenario.beto, 'Producto');

      // Los tiradores solo aparecen con la tarjeta seleccionada.
      await escenario.ana.page.getByTestId('clase-Producto').click();
      const tirador = escenario.ana.page
        .locator('.react-flow__node', {
          has: escenario.ana.page.getByTestId('clase-Producto'),
        })
        .locator('.tirador-redimension.bottom.right');
      await expect(tirador).toBeVisible();

      const caja = await tirador.boundingBox();
      expect(caja).not.toBeNull();

      await escenario.ana.page.mouse.move(caja!.x + caja!.width / 2, caja!.y + caja!.height / 2);
      await escenario.ana.page.mouse.down();
      await escenario.ana.page.mouse.move(caja!.x + 140, caja!.y + 90, { steps: 12 });
      await escenario.ana.page.mouse.up();

      // Y llega al otro navegador sin recargar.
      await expect
        .poll(async () => (await tamanoEnDiagrama(escenario.beto, 'Producto')).width, {
          timeout: 15_000,
        })
        .toBeGreaterThan(original.width + 50);

      const enBeto = await tamanoEnDiagrama(escenario.beto, 'Producto');
      expect(enBeto.height).toBeGreaterThan(original.height + 30);
    } finally {
      await escenario.cerrar();
    }
  });

  test('un lector no puede redimensionar', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Redimensionar lector', {
      rol: 'lector',
      abrirAmbos: false,
    });
    try {
      await crearClase(escenario.ana, 'Producto');
      await abrirPizarra(escenario.beto, 'Ventas');
      await expect(escenario.beto.page.getByTestId('clase-Producto')).toBeVisible();

      await escenario.beto.page.getByTestId('clase-Producto').click();
      // Seleccionar si puede; redimensionar no.
      await expect(escenario.beto.page.locator('.tirador-redimension')).toHaveCount(0);
    } finally {
      await escenario.cerrar();
    }
  });

  test('3 — A cambia una multiplicidad y B lo ve', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Ventas 3');
    try {
      await crearClase(escenario.ana, 'Producto');
      await crearClase(escenario.ana, 'Venta');

      // Se conectan arrastrando de un conector a otro, como lo hace una persona.
      const origen = escenario.ana.page
        .getByTestId('clase-Producto')
        .locator('.react-flow__handle-right');
      const destino = escenario.ana.page
        .getByTestId('clase-Venta')
        .locator('.react-flow__handle-left');
      await origen.dragTo(destino);

      await expect(escenario.beto.page.locator('.react-flow__edge')).toHaveCount(1);

      await escenario.ana.page.locator('.react-flow__edge').first().click();
      await expect(escenario.ana.page.getByTestId('inspector-relacion')).toBeVisible();
      await escenario.ana.page.getByTestId('multiplicidad-destino').selectOption('0..1');

      await expect(escenario.beto.page.locator('.react-flow__edge').first()).toContainText('0..1');
    } finally {
      await escenario.cerrar();
    }
  });

  test('4 — un tercero entra tarde y recibe el estado actual (CA-024.1)', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Ventas 4');
    const carla = await registrarActor(browser, 'carla');
    try {
      await crearClase(escenario.ana, 'Producto');
      await crearClase(escenario.ana, 'Venta');
      await expect(escenario.beto.page.getByTestId('clase-Venta')).toBeVisible();

      // Carla llega cuando la pizarra ya lleva rato construyendose. RA-02: se le
      // entrega el estado actual y a partir de ahi solo deltas.
      await escenario.ana.page.goBack();
      const codigo = await invitar(escenario.ana, 'editor');
      await aceptarInvitacion(carla, codigo);
      await abrirPizarra(carla, 'Ventas');

      await expect(carla.page.getByTestId('clase-Producto')).toBeVisible();
      await expect(carla.page.getByTestId('clase-Venta')).toBeVisible();
    } finally {
      await carla.close();
      await escenario.cerrar();
    }
  });

  test('5 — dos pizarras del mismo proyecto no mezclan (CA-004.1)', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Ventas 5', {
      pizarras: ['Ventas', 'Inventario'],
      abrirAmbos: false,
    });
    try {
      await abrirPizarra(escenario.beto, 'Inventario');

      await crearClase(escenario.ana, 'Solo En Ventas');
      await expect(escenario.ana.page.getByTestId('clase-SoloEnVentas')).toBeVisible();

      // Margen para que, si hubiera fuga entre salas, diera tiempo a manifestarse.
      await escenario.beto.page.waitForTimeout(1500);

      // Son dos documentos, no dos vistas del mismo.
      await expect(escenario.beto.page.getByTestId('clase-SoloEnVentas')).toHaveCount(0);
      await expect(escenario.beto.page.getByTestId('estado-conexion')).toHaveText('En vivo');
    } finally {
      await escenario.cerrar();
    }
  });

  test('la presencia muestra a los dos participantes (RF-026)', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Ventas presencia');
    try {
      await expect(escenario.ana.page.getByTestId('presencia').locator('li')).toHaveCount(2);
      await expect(escenario.beto.page.getByTestId('presencia').locator('li')).toHaveCount(2);
    } finally {
      await escenario.cerrar();
    }
  });

  test('limpia la seleccion si otro colaborador elimina el elemento', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Eliminación remota');
    try {
      await crearClase(escenario.ana, 'Temporal');
      const claseEnBeto = escenario.beto.page.getByTestId('clase-Temporal');
      await expect(claseEnBeto).toBeVisible();

      await claseEnBeto.click();
      await expect(escenario.beto.page.getByTestId('inspector-clase')).toBeVisible();

      await escenario.ana.page.getByTestId('clase-Temporal').click();
      await escenario.ana.page.getByRole('button', { name: 'Eliminar clase' }).click();

      await expect(claseEnBeto).toHaveCount(0);
      await expect(escenario.beto.page.getByText('Nada seleccionado')).toBeVisible();
      await expect(escenario.beto.page.getByText('Elemento eliminado')).toHaveCount(0);
    } finally {
      await escenario.cerrar();
    }
  });

  test('recupera y combina cambios hechos durante una desconexion', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Reconexión colaborativa');
    const contextoAna = escenario.ana.page.context();
    let sinConexion = false;

    try {
      await contextoAna.setOffline(true);
      sinConexion = true;
      await expect(escenario.ana.page.getByTestId('estado-conexion')).toHaveText('Sin conexión');

      // Yjs conserva la edición local mientras el socket no está disponible.
      await crearClase(escenario.ana, 'Creada Sin Conexión');
      // El otro participante sigue trabajando en la misma pizarra.
      await crearClase(escenario.beto, 'Creada En Línea');

      await contextoAna.setOffline(false);
      sinConexion = false;
      await expect(escenario.ana.page.getByTestId('estado-conexion')).toHaveText('En vivo');

      // Al volver no gana una copia sobre la otra: se combinan ambos deltas.
      for (const actor of [escenario.ana, escenario.beto]) {
        await expect(actor.page.getByTestId('clase-CreadaSinConexion')).toBeVisible();
        await expect(actor.page.getByTestId('clase-CreadaEnLinea')).toBeVisible();
      }
    } finally {
      if (sinConexion) await contextoAna.setOffline(false);
      await escenario.cerrar();
    }
  });
});

test.describe('seguridad y roles', () => {
  test('un rol de solo lectura ve pero no edita (CA-A08.2)', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Con lector', {
      rol: 'lector',
      abrirAmbos: false,
    });
    try {
      await crearClase(escenario.ana, 'Visible');

      await abrirPizarra(escenario.beto, 'Ventas');
      await expect(escenario.beto.page.getByTestId('clase-Visible')).toBeVisible();

      // La interfaz lo dice y el boton no responde. El servidor, ademas, descarta
      // sus escrituras aunque las intentara por otra via (CA-A08.2).
      await expect(escenario.beto.page.getByTestId('solo-lectura')).toBeVisible();
      await expect(escenario.beto.page.getByTestId('crear-clase')).toBeDisabled();
    } finally {
      await escenario.cerrar();
    }
  });

  test('un no miembro no puede abrir la pizarra', async ({ browser }) => {
    const duena = await registrarActor(browser, 'duena');
    const extrano = await registrarActor(browser, 'extrano');

    try {
      await crearProyecto(duena, 'Proyecto privado');
      await crearPizarra(duena, 'Privada');
      await abrirPizarra(duena, 'Privada');

      // Con la direccion exacta en la mano: es lo mas cerca que puede estar
      // alguien de entrar sin permiso.
      await extrano.page.goto(duena.page.url());

      await expect(extrano.page.getByText(/no existe|no eres miembro/i)).toBeVisible();
      await expect(extrano.page.getByTestId('crear-clase')).toHaveCount(0);
    } finally {
      await duena.close();
      await extrano.close();
    }
  });
});

test.describe('validacion en pantalla', () => {
  test('la colision se marca y bloquea la generacion, sin bloquear la edicion', async ({
    browser,
  }) => {
    const actor = await registrarActor(browser, 'valida');

    try {
      await crearProyecto(actor, 'Proyecto con errores');
      await crearPizarra(actor, 'Con colision');
      await abrirPizarra(actor, 'Con colision');

      await crearClase(actor, 'Detalle de Venta');
      await crearClase(actor, 'detalle venta');

      // Las dos clases existen: el error no impide escribir el nombre.
      await expect(actor.page.getByTestId('clase-DetalleVenta')).toHaveCount(2);

      // Pero el validador lo marca y la generacion queda bloqueada.
      await expect(actor.page.getByTestId('panel-validacion')).toContainText(
        'mismo nombre tecnico',
      );
      await expect(actor.page.getByTestId('puede-generar')).toHaveText('Generación bloqueada');

      // Y al arreglarlo, se desbloquea.
      await actor.page.getByTestId('nombre-clase').fill('Detalle de Compra');
      await expect(actor.page.getByTestId('puede-generar')).toHaveText('Generación disponible');
    } finally {
      await actor.close();
    }
  });

  test('la relacion muchos a muchos se marca y dice como modelarla (RM-01)', async ({
    browser,
  }) => {
    const actor = await registrarActor(browser, 'nm');

    try {
      await crearProyecto(actor, 'Proyecto N a M');
      await crearPizarra(actor, 'Muchos a muchos');
      await abrirPizarra(actor, 'Muchos a muchos');

      await crearClase(actor, 'Alumno');
      await crearClase(actor, 'Materia');

      const origen = actor.page.getByTestId('clase-Alumno').locator('.react-flow__handle-right');
      const destino = actor.page.getByTestId('clase-Materia').locator('.react-flow__handle-left');
      await origen.dragTo(destino);

      await actor.page.locator('.react-flow__edge').first().click();
      await actor.page.getByTestId('multiplicidad-origen').selectOption('0..*');

      // RM-01: la herramienta detecta la N:M y dice como modelarla, en lugar de
      // impedir dibujarla.
      const panel = actor.page.getByTestId('panel-validacion');
      await expect(panel).toContainText('muchos a muchos');
      await expect(panel).toContainText('clase intermedia');
      await expect(actor.page.getByTestId('puede-generar')).toHaveText('Generación bloqueada');
    } finally {
      await actor.close();
    }
  });
});

test.describe('asistente por texto (RF-030 a RF-036)', () => {
  test('una instruccion se propone, se aplica y llega al otro navegador', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Con asistente');
    try {
      await crearClase(escenario.ana, 'Cliente');
      await expect(escenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();

      // Nada se aplica sin que el usuario lo vea: llega como propuesta.
      await escenario.ana.page
        .getByTestId('entrada-asistente')
        .fill('agrega telefono tipo String a Cliente');
      await escenario.ana.page.getByTestId('enviar-asistente').click();

      const propuesta = escenario.ana.page.getByTestId('propuesta');
      await expect(propuesta).toContainText('telefono');
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).not.toContainText('telefono');

      await escenario.ana.page.getByTestId('aplicar-propuesta').click();

      // Y viaja al otro navegador como cualquier otro cambio: el asistente es
      // un adaptador mas, no una via paralela.
      await expect(escenario.beto.page.getByTestId('clase-Cliente')).toContainText('telefono');
    } finally {
      await escenario.cerrar();
    }
  });

  test('tras varias instrucciones, la ultima propuesta se ve sin desplazar', async ({
    browser,
  }) => {
    // La conversacion crece hacia abajo dentro de un panel que se desplaza, y no
    // se movia sola. A la cuarta instruccion la propuesta nueva —con su boton de
    // aplicar— aparecia fuera de la vista: la persona escribe, parece que no
    // pasa nada, y vuelve a escribir.
    const escenario = await montarEscenario(browser, 'Conversacion larga');
    try {
      await crearClase(escenario.ana, 'Cliente');

      for (const atributo of ['nombre', 'correo', 'telefono', 'direccion']) {
        await escenario.ana.page
          .getByTestId('entrada-asistente')
          .fill(`agrega ${atributo} tipo String a Cliente`);
        await escenario.ana.page.getByTestId('enviar-asistente').click();

        const propuesta = escenario.ana.page.getByTestId('propuesta').last();
        await expect(propuesta).toContainText(atributo);
        await expect(propuesta.getByTestId('aplicar-propuesta')).toBeInViewport({ ratio: 1 });

        await propuesta.getByTestId('aplicar-propuesta').click();
      }

      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toContainText('direccion');
    } finally {
      await escenario.cerrar();
    }
  });

  test('RF-034 — pregunta cuando el objetivo no existe', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Asistente que pregunta');
    try {
      await crearClase(escenario.ana, 'Cliente');

      await escenario.ana.page
        .getByTestId('entrada-asistente')
        .fill('agrega telefono tipo String a Inexistente');
      await escenario.ana.page.getByTestId('enviar-asistente').click();

      const conversacion = escenario.ana.page.getByTestId('conversacion');
      await expect(conversacion).toContainText(/no (?:encuentro|existe)/i);
      await expect(escenario.ana.page.getByTestId('contexto-asistente')).toContainText(
        /recordaré la solicitud anterior/i,
      );
      // Y no propone nada que aplicar.
      await expect(escenario.ana.page.getByTestId('propuesta')).toHaveCount(0);

      // Tambien se puede descartar una aclaracion que ya no se quiere continuar.
      await escenario.ana.page.getByTestId('descartar-contexto').click();
      await expect(escenario.ana.page.getByTestId('contexto-asistente')).toHaveCount(0);
    } finally {
      await escenario.cerrar();
    }
  });

  test('RF-035 — lo destructivo pide confirmacion', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Asistente destructivo');
    try {
      await crearClase(escenario.ana, 'Cliente');
      await escenario.ana.page.getByTestId('nuevo-atributo').fill('nombre');
      await escenario.ana.page.getByRole('button', { name: 'Añadir' }).click();
      await escenario.ana.page.getByTestId('nuevo-atributo').fill('correo');
      await escenario.ana.page.getByRole('button', { name: 'Añadir' }).click();

      await escenario.ana.page.getByTestId('entrada-asistente').fill('elimina Cliente');
      await escenario.ana.page.getByTestId('enviar-asistente').click();

      await expect(escenario.ana.page.getByTestId('confirmacion')).toContainText(/confirmas/i);
      // Sigue ahi hasta que se confirma.
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toBeVisible();

      await escenario.ana.page.getByRole('button', { name: 'Sí, aplicar' }).click();
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toHaveCount(0);
    } finally {
      await escenario.cerrar();
    }
  });

  test('RF-036 — consultar no modifica la pizarra', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Asistente consultivo');
    try {
      await crearClase(escenario.ana, 'Cliente');

      await escenario.ana.page.getByTestId('modo-preguntar').click();
      await escenario.ana.page.getByTestId('entrada-asistente').fill('¿puedo generar?');
      await escenario.ana.page.getByTestId('enviar-asistente').click();

      await expect(escenario.ana.page.getByTestId('conversacion')).toContainText('1 clases');
      // Ni propuesta ni cambio.
      await expect(escenario.ana.page.getByTestId('propuesta')).toHaveCount(0);
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });
});

test.describe('importacion y exportacion (M4 y M5)', () => {
  test('RF-050 — exportar produce un archivo XMI descargable', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Con exportacion');
    try {
      await crearClase(escenario.ana, 'Cliente');
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toBeVisible();

      await abrirHerramienta(escenario.ana, 'importar');

      // Exportar ya no descarga de golpe: pide el nombre primero, que es lo que
      // permite guardarlo como se llame el modelo en Enterprise Architect.
      await escenario.ana.page.getByTestId('exportar-xmi').click();
      const campo = escenario.ana.page.getByTestId('campo-nombre-export');
      // Viene con el nombre de la pizarra, que es lo que uno querria llamarlo.
      await expect(campo).toHaveValue('Ventas');
      await campo.fill('ventas del semestre');

      const descarga = escenario.ana.page.waitForEvent('download');
      await escenario.ana.page.getByTestId('confirmar-export').click();

      const archivo = await descarga;
      // El nombre escrito, con la extension puesta por nosotros.
      expect(archivo.suggestedFilename()).toBe('ventas del semestre.xmi');
    } finally {
      await escenario.cerrar();
    }
  });

  test('el ida y vuelta por la interfaz conserva el diagrama', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Ida y vuelta', {
      pizarras: ['Origen', 'Destino'],
      abrirAmbos: false,
    });
    try {
      // Se construye en una pizarra...
      await crearClase(escenario.ana, 'Cliente');
      await escenario.ana.page.getByTestId('nuevo-atributo').fill('correo');
      await escenario.ana.page.getByRole('button', { name: 'Añadir' }).click();
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toContainText('correo');

      await abrirHerramienta(escenario.ana, 'importar');

      await escenario.ana.page.getByTestId('exportar-xmi').click();
      const descarga = escenario.ana.page.waitForEvent('download');
      await escenario.ana.page.getByTestId('confirmar-export').click();
      const ruta = await (await descarga).path();

      // ...y se importa en la otra.
      await abrirPizarra(escenario.beto, 'Destino');
      await abrirHerramienta(escenario.beto, 'importar');
      await escenario.beto.page.getByTestId('archivo-xmi').setInputFiles(ruta);

      const candidato = escenario.beto.page.getByTestId('candidato');
      await expect(candidato).toContainText('Cliente');
      // CA-042.1: nada se aplica solo.
      await expect(escenario.beto.page.getByTestId('clase-Cliente')).toHaveCount(0);

      await escenario.beto.page.getByTestId('aplicar-candidato').click();
      await expect(escenario.beto.page.getByTestId('clase-Cliente')).toContainText('correo');
    } finally {
      await escenario.cerrar();
    }
  });

  test('un XMI mayor de un MiB atraviesa el proxy y se aplica', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Archivo grande');
    try {
      await abrirHerramienta(escenario.ana, 'importar');
      await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'grande.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<?xml version="1.0"?><xmi:XMI xmi:version="2.1"
          xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
          <!-- ${'x'.repeat(1_100_000)} -->
          <uml:Model name="Grande"><packagedElement xmi:type="uml:Class" xmi:id="CLS1" name="ArchivoGrande"/></uml:Model>
          </xmi:XMI>`),
      });
      await expect(escenario.ana.page.getByTestId('candidato')).toContainText('ArchivoGrande');
      await escenario.ana.page.getByTestId('aplicar-candidato').click();
      await expect(escenario.beto.page.getByTestId('clase-ArchivoGrande')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('un XMI ya presente explica que no hay cambios y ofrece reemplazar', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'XMI repetido');
    try {
      await crearClase(escenario.ana, 'Usuario');
      await abrirHerramienta(escenario.ana, 'importar');

      await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'usuario-repetido.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="Repetido">
    <packagedElement xmi:type="uml:Class" xmi:id="CLS1" name="Usuario"/>
  </uml:Model>
</xmi:XMI>`),
      });

      const candidato = escenario.ana.page.getByTestId('candidato');
      await expect(candidato).toContainText('todo su contenido ya está en la pizarra', {
        ignoreCase: true,
      });
      await expect(
        escenario.ana.page.getByRole('button', { name: 'Reemplazar con este archivo' }),
      ).toBeVisible();
      await expect(escenario.ana.page.getByTestId('aplicar-candidato')).toHaveCount(0);
      await expect(escenario.ana.page.getByTestId('clase-Usuario')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('la vista previa XMI permite corregir nombres y tipos antes de aplicar', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'XMI editable');
    try {
      await abrirHerramienta(escenario.ana, 'importar');
      await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'cliente-borrador.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="Editable">
    <packagedElement xmi:type="uml:Class" xmi:id="CLS1" name="Cliente borrador">
      <ownedAttribute xmi:type="uml:Property" xmi:id="AT1" name="edadTexto" type="String"/>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`),
      });

      await escenario.ana.page.getByRole('textbox', { name: 'Nombre de clase 1' }).fill('Cliente');
      await expect(
        escenario.ana.page.getByRole('textbox', { name: 'Nombre de atributo 2' }),
      ).toBeInViewport({ ratio: 1 });
      await expect(escenario.ana.page.getByTestId('aplicar-candidato')).toBeInViewport({
        ratio: 1,
      });
      await escenario.ana.page.getByRole('textbox', { name: 'Nombre de atributo 2' }).fill('edad');
      await escenario.ana.page
        .getByRole('combobox', { name: 'Tipo de atributo 2' })
        .selectOption('Integer');
      await escenario.ana.page.getByTestId('aplicar-candidato').click();

      const clase = escenario.ana.page.getByTestId('clase-Cliente');
      await expect(clase).toBeVisible();
      await expect(clase).toContainText('edad');
      await expect(clase).toContainText('Integer');
      await expect(escenario.ana.page.getByTestId('clase-Cliente borrador')).toHaveCount(0);
    } finally {
      await escenario.cerrar();
    }
  });

  test('con muchos avisos, el boton de aplicar sigue a la vista', async ({ browser }) => {
    // Reproduce lo que le pasa a quien importa un archivo de otra herramienta:
    // cada atributo con un tipo que no reconocemos deja un aviso, la lista crece
    // y empuja los botones fuera del panel. La persona ve avisos, no ve ningun
    // boton, y concluye que la importacion no funciona — cuando en realidad solo
    // falta pulsar «Aplicar», que esta unos centimetros mas abajo.
    //
    // Ninguna prueba lo detectaba porque Playwright desplaza el panel antes de
    // pulsar. Las personas no.
    const escenario = await montarEscenario(browser, 'Muchos avisos');
    try {
      await abrirHerramienta(escenario.ana, 'importar');

      const atributos = ['nombre', 'correo', 'telefono', 'direccion', 'ciudad', 'pais', 'nit']
        .map(
          (nombre, indice) =>
            `<ownedAttribute xmi:type="uml:Property" xmi:id="AT${indice}" name="${nombre}" type="tipoDesconocido"/>`,
        )
        .join('\n      ');

      await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'de-otra-herramienta.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="Ajeno">
    <packagedElement xmi:type="uml:Class" xmi:id="CLS1" name="Usuario">
      ${atributos}
    </packagedElement>
  </uml:Model>
</xmi:XMI>`),
      });

      // Los avisos vienen desplegados: un candidato con avisos plegados se
      // aplicaba sin leerlos. Pulsar el resumen aqui los cerraria.
      const avisos = escenario.ana.page.getByTestId('avisos-importacion');
      await expect(escenario.ana.page.getByText(/7 avisos del archivo/i)).toBeVisible();
      await expect(avisos).toBeVisible();

      // Lo que importa: sin tocar la rueda del raton, la accion se ve.
      await expect(escenario.ana.page.getByTestId('aplicar-candidato')).toBeInViewport({
        ratio: 1,
      });

      await escenario.ana.page.getByTestId('aplicar-candidato').click();
      await expect(escenario.ana.page.getByTestId('clase-Usuario')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('con el inspector lleno, el candidato sigue teniendo su boton a la vista', async ({
    browser,
  }) => {
    // El caso real: una clase seleccionada con muchos atributos deja el
    // inspector alto, y la herramienta comparte columna con el. Si la
    // herramienta se encoge sin tope, el candidato queda reducido a su lista de
    // avisos y el boton desaparece.
    const escenario = await montarEscenario(browser, 'Inspector lleno');
    try {
      await crearClase(escenario.ana, 'Cliente');

      for (const nombre of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10']) {
        await escenario.ana.page.getByTestId('nuevo-atributo').fill(nombre);
        await escenario.ana.page.getByRole('button', { name: 'Añadir' }).click();
      }

      await abrirHerramienta(escenario.ana, 'importar');
      await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'ajeno.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="Ajeno">
    <packagedElement xmi:type="uml:Class" xmi:id="CLS1" name="Proveedor">
      <ownedAttribute xmi:type="uml:Property" xmi:id="P1" name="razon" type="raro"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="P2" name="nit" type="raro"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="P3" name="ciudad" type="raro"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="P4" name="pais" type="raro"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="P5" name="rubro" type="raro"/>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`),
      });

      await expect(escenario.ana.page.getByTestId('aplicar-candidato')).toBeInViewport({
        ratio: 1,
      });
      await escenario.ana.page.getByTestId('aplicar-candidato').click();
      await expect(escenario.ana.page.getByTestId('clase-Proveedor')).toBeVisible();

      // Y no cae encima de la que ya estaba: todo lo que se creaba sin posicion
      // —asistente e importaciones— aterrizaba en (0, 0), una clase sobre otra.
      const cliente = await escenario.ana.page.getByTestId('clase-Cliente').boundingBox();
      const proveedor = await escenario.ana.page.getByTestId('clase-Proveedor').boundingBox();
      expect(cliente).not.toBeNull();
      expect(proveedor).not.toBeNull();
      expect(
        Math.abs(proveedor!.x - cliente!.x) + Math.abs(proveedor!.y - cliente!.y),
      ).toBeGreaterThan(100);
    } finally {
      await escenario.cerrar();
    }
  });

  test('un XMI que no se entiende lo dice, sin romper la pizarra', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'XMI invalido');
    try {
      await crearClase(escenario.ana, 'Cliente');
      await abrirHerramienta(escenario.ana, 'importar');

      await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'no-es-xmi.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from('<html><body>esto no es un modelo</body></html>'),
      });

      await expect(escenario.ana.page.getByTestId('error-importacion')).toContainText(/XMI 2\.1/);
      // La pizarra sigue como estaba.
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('RF-040 a RF-043 — la foto produce un candidato que se revisa antes', async ({
    browser,
  }) => {
    const escenario = await montarEscenario(browser, 'Con fotografia');
    try {
      await abrirHerramienta(escenario.ana, 'importar');

      // Un PNG minimo: con el adaptador simulado el contenido no importa, y lo
      // que se prueba es el camino completo hasta el candidato editable.
      await escenario.ana.page.getByTestId('archivo-imagen').setInputFiles({
        name: 'pizarron.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      });

      const candidato = escenario.ana.page.getByTestId('candidato');
      await expect(candidato).toContainText('Cliente');
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toHaveCount(0);

      await escenario.ana.page.getByTestId('aplicar-candidato').click();

      // Y al aplicarlo viaja al otro navegador como cualquier otro cambio.
      await expect(escenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
      await expect(escenario.beto.page.getByTestId('clase-Pedido')).toBeVisible();
    } finally {
      await escenario.cerrar();
    }
  });

  test('el candidato se puede descartar sin tocar nada', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Descartar candidato');
    try {
      await abrirHerramienta(escenario.ana, 'importar');
      // Descartar es una conducta de la vista previa, no del proveedor de
      // visión. Un XMI fijo mantiene esta regresión determinista aunque la IA
      // interprete de forma distinta una imagen ambigua de un píxel.
      await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
        name: 'candidato.xmi',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="Descartable">
    <packagedElement xmi:type="uml:Class" xmi:id="CLS1" name="Cliente"/>
  </uml:Model>
</xmi:XMI>`),
      });

      await expect(escenario.ana.page.getByTestId('candidato')).toBeVisible();
      await escenario.ana.page.getByRole('button', { name: 'Descartar' }).click();

      await expect(escenario.ana.page.getByTestId('candidato')).toHaveCount(0);
      await expect(escenario.ana.page.getByTestId('clase-Cliente')).toHaveCount(0);
    } finally {
      await escenario.cerrar();
    }
  });
});
