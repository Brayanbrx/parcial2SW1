import { describe, expect, it } from 'vitest';
import { commandBatchSchema, hasErrors } from '@uml/contracts';
import { applyBatch } from '@uml/domain-core';
import { batch, cmd, emptyBoard, nextId } from './helpers.js';

/**
 * Aplicador de comandos.
 *
 * Lo que se prueba aqui es sobre todo RA-03: el lote es la unidad transaccional
 * y un solo error deja la pizarra exactamente como estaba.
 */

function conCliente(): { estado: ReturnType<typeof emptyBoard>; clienteId: string } {
  const clienteId = nextId();
  const resultado = applyBatch(emptyBoard(), batch(cmd.createClass(clienteId, 'Cliente')));

  if (!resultado.applied) throw new Error('el montaje de la prueba deberia aplicarse');
  return { estado: resultado.state, clienteId };
}

describe('aplicacion de un lote', () => {
  it('crea una clase con sus tres nombres derivados', () => {
    const classId = nextId();
    const resultado = applyBatch(emptyBoard(), batch(cmd.createClass(classId, 'Detalle de Venta')));

    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;

    expect(resultado.state.semantic.classes).toHaveLength(1);
    expect(resultado.state.semantic.classes[0]).toMatchObject({
      displayName: 'Detalle de Venta',
      codeName: 'DetalleVenta',
      databaseName: 'detalle_venta',
    });
  });

  it('no modifica el estado que recibe', () => {
    // Sin esto, un lote rechazado dejaria rastro y RA-03 seria una promesa vacia.
    const original = emptyBoard();
    applyBatch(original, batch(cmd.createClass(nextId(), 'Cliente')));

    expect(original.semantic.classes).toHaveLength(0);
  });

  it('aplica varios comandos como una sola unidad', () => {
    const clienteId = nextId();
    const resultado = applyBatch(
      emptyBoard(),
      batch(
        cmd.createClass(clienteId, 'Cliente'),
        cmd.addAttribute(clienteId, nextId(), 'nombre'),
        cmd.addAttribute(clienteId, nextId(), 'telefono'),
        cmd.addAttribute(clienteId, nextId(), 'correo'),
      ),
    );

    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;
    expect(resultado.state.semantic.classes[0]?.attributes).toHaveLength(3);
  });
});

describe('todo o nada (RA-03)', () => {
  it('CA-032.2 — si un comando del lote es invalido no se aplica ninguno', () => {
    const { estado, clienteId } = conCliente();
    const inexistente = nextId();

    const resultado = applyBatch(
      estado,
      batch(
        cmd.addAttribute(clienteId, nextId(), 'nombre'),
        // Esta clase no existe: el lote entero cae.
        cmd.addAttribute(inexistente, nextId(), 'telefono'),
        cmd.addAttribute(clienteId, nextId(), 'correo'),
      ),
    );

    expect(resultado.applied).toBe(false);
    if (resultado.applied) return;
    expect(resultado.issues.map((i) => i.code)).toContain('UNKNOWN_CLASS');

    // Ni siquiera el primer comando, que por si solo era valido.
    expect(estado.semantic.classes[0]?.attributes).toHaveLength(0);
  });

  it('reporta todos los fallos del lote de una vez, no solo el primero', () => {
    const resultado = applyBatch(
      emptyBoard(),
      batch(cmd.addAttribute(nextId(), nextId(), 'a'), cmd.deleteClass(nextId())),
    );

    expect(resultado.applied).toBe(false);
    if (resultado.applied) return;
    expect(resultado.issues).toHaveLength(2);
  });

  it('aplica un lote que produce dos nombres colisionantes, y lo marca', () => {
    // La colision bloquea la generacion, no la edicion (CA-017.1). Revertirle al
    // usuario lo que acaba de escribir seria peor: no sabria que paso, y la
    // pizarra que quedara asi por una fusion concurrente no se podria arreglar.
    const resultado = applyBatch(
      emptyBoard(),
      batch(
        cmd.createClass(nextId(), 'Detalle de Venta'),
        cmd.createClass(nextId(), 'detalle venta'),
      ),
    );

    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;

    expect(resultado.state.semantic.classes).toHaveLength(2);
    expect(resultado.issues.map((i) => i.code)).toContain('DUPLICATE_CLASS_NAME');
    expect(hasErrors(resultado.issues)).toBe(true);
  });

  it('rechaza un nombre que no produce identificador', () => {
    const resultado = applyBatch(emptyBoard(), batch(cmd.createClass(nextId(), '***')));

    expect(resultado.applied).toBe(false);
    if (resultado.applied) return;
    expect(resultado.issues.map((i) => i.code)).toContain('INVALID_IDENTIFIER');
  });
});

describe('el asistente modifica solo lo afectado (CA-032.1)', () => {
  it('agrega un atributo sin tocar el resto del modelo', () => {
    const { estado, clienteId } = conCliente();
    const nombreId = nextId();

    const conNombre = applyBatch(estado, batch(cmd.addAttribute(clienteId, nombreId, 'nombre')));
    expect(conNombre.applied).toBe(true);
    if (!conNombre.applied) return;

    const antes = structuredClone(conNombre.state);
    const telefonoId = nextId();

    const despues = applyBatch(
      conNombre.state,
      batch(cmd.addAttribute(clienteId, telefonoId, 'telefono', 'String')),
    );

    expect(despues.applied).toBe(true);
    if (!despues.applied) return;

    const cliente = despues.state.semantic.classes[0];
    expect(cliente?.attributes.map((a) => a.codeName)).toEqual(['nombre', 'telefono']);

    // Nada mas cambio: ni el identificador de la clase, ni sus nombres, ni el
    // atributo que ya estaba.
    expect(cliente?.id).toBe(antes.semantic.classes[0]?.id);
    expect(cliente?.attributes[0]).toEqual(antes.semantic.classes[0]?.attributes[0]);
    expect(despues.state.semantic.relationships).toEqual(antes.semantic.relationships);
  });
});

describe('identidad independiente del nombre (RA-04)', () => {
  it('renombrar una clase no rompe sus relaciones', () => {
    const clienteId = nextId();
    const ventaId = nextId();
    const relId = nextId();

    const montaje = applyBatch(
      emptyBoard(),
      batch(
        cmd.createClass(clienteId, 'Cliente'),
        cmd.createClass(ventaId, 'Venta'),
        cmd.createRelationship(relId, clienteId, ventaId),
      ),
    );
    expect(montaje.applied).toBe(true);
    if (!montaje.applied) return;

    const renombrado = applyBatch(
      montaje.state,
      batch(cmd.renameClass(clienteId, 'Cliente Corporativo')),
    );

    expect(renombrado.applied).toBe(true);
    if (!renombrado.applied) return;

    const relacion = renombrado.state.semantic.relationships[0];
    expect(relacion?.sourceClassId).toBe(clienteId);
    expect(renombrado.state.semantic.classes.find((c) => c.id === clienteId)).toMatchObject({
      displayName: 'Cliente Corporativo',
      codeName: 'ClienteCorporativo',
    });
  });
});

describe('borrado de una clase', () => {
  it('se lleva sus relaciones y su posicion', () => {
    const clienteId = nextId();
    const ventaId = nextId();

    const montaje = applyBatch(
      emptyBoard(),
      batch(
        cmd.createClass(clienteId, 'Cliente'),
        cmd.createClass(ventaId, 'Venta'),
        cmd.createRelationship(nextId(), clienteId, ventaId),
        cmd.moveClass(clienteId, 100, 200),
      ),
    );
    expect(montaje.applied).toBe(true);
    if (!montaje.applied) return;

    const borrado = applyBatch(montaje.state, batch(cmd.deleteClass(clienteId)));

    expect(borrado.applied).toBe(true);
    if (!borrado.applied) return;

    // Dejar la relacion produciria un modelo que el validador rechazaria acto
    // seguido, obligando al usuario a limpiar lo que la herramienta rompio.
    expect(borrado.state.semantic.relationships).toHaveLength(0);
    expect(borrado.state.layout.positions[clienteId]).toBeUndefined();
  });
});

describe('el layout no tiene valor semantico', () => {
  it('mover una clase no cambia el modelo', () => {
    const { estado, clienteId } = conCliente();
    const antes = structuredClone(estado.semantic);

    const resultado = applyBatch(estado, batch(cmd.moveClass(clienteId, 42, 84)));

    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;
    expect(resultado.state.semantic).toEqual(antes);
    expect(resultado.state.layout.positions[clienteId]).toEqual({ x: 42, y: 84 });
  });
});

describe('convivencia con un modelo invalido (CA-025.1)', () => {
  it('un error preexistente no bloquea los lotes siguientes', () => {
    // Dos usuarios crean concurrentemente nombres que colapsan al mismo
    // identificador. El documento converge en un modelo invalido; el validador
    // lo marca. Pero la pizarra tiene que seguir siendo editable, o nadie podria
    // aplicar el lote que arregla el problema.
    const primeraId = nextId();
    const segundaId = nextId();

    const convergido = structuredClone(emptyBoard());
    for (const [classId, displayName, codeName] of [
      [primeraId, 'Detalle de Venta', 'DetalleVenta'],
      [segundaId, 'detalle venta', 'DetalleVenta'],
    ] as const) {
      convergido.semantic.classes.push({
        id: classId,
        displayName,
        codeName,
        databaseName: 'detalle_venta',
        attributes: [],
      });
    }

    const resultado = applyBatch(convergido, batch(cmd.createClass(nextId(), 'Cliente')));

    expect(resultado.applied).toBe(true);
  });

  it('el lote que resuelve la colision se aplica', () => {
    const primeraId = nextId();
    const segundaId = nextId();

    const convergido = structuredClone(emptyBoard());
    for (const [classId, displayName] of [
      [primeraId, 'Detalle de Venta'],
      [segundaId, 'detalle venta'],
    ] as const) {
      convergido.semantic.classes.push({
        id: classId,
        displayName,
        codeName: 'DetalleVenta',
        databaseName: 'detalle_venta',
        attributes: [],
      });
    }

    const resultado = applyBatch(
      convergido,
      batch(cmd.renameClass(segundaId, 'Detalle de Compra')),
    );

    expect(resultado.applied).toBe(true);
  });
});

describe('relaciones', () => {
  it('conserva y permite cambiar el tipo UML de una relacion', () => {
    const parteId = nextId();
    const todoId = nextId();
    const relId = nextId();

    const montaje = applyBatch(
      emptyBoard(),
      batch(
        cmd.createClass(todoId, 'Pedido'),
        cmd.createClass(parteId, 'Detalle'),
        cmd.createRelationship(relId, todoId, parteId, '1', '0..*', 'COMPOSITION'),
      ),
    );
    expect(montaje.applied).toBe(true);
    if (!montaje.applied) return;
    expect(montaje.state.semantic.relationships[0]?.kind).toBe('COMPOSITION');

    const actualizado = applyBatch(
      montaje.state,
      batch(cmd.updateRelationshipKind(relId, 'AGGREGATION')),
    );
    expect(actualizado.applied).toBe(true);
    if (!actualizado.applied) return;
    expect(actualizado.state.semantic.relationships[0]?.kind).toBe('AGGREGATION');
  });

  it('permite una asociacion recursiva de una clase consigo misma', () => {
    const { estado, clienteId } = conCliente();

    const resultado = applyBatch(
      estado,
      batch(cmd.createRelationship(nextId(), clienteId, clienteId)),
    );

    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;
    expect(resultado.state.semantic.relationships).toEqual([
      expect.objectContaining({ sourceClassId: clienteId, targetClassId: clienteId }),
    ]);
  });

  it('rechaza una generalizacion de una clase hacia si misma', () => {
    const { estado, clienteId } = conCliente();

    const resultado = applyBatch(
      estado,
      batch(cmd.createRelationship(nextId(), clienteId, clienteId, '1', '1', 'GENERALIZATION')),
    );

    expect(resultado.applied).toBe(false);
    if (resultado.applied) return;
    expect(resultado.issues.map((i) => i.code)).toContain('SELF_RELATIONSHIP');
  });

  it('permite convertir una relacion en muchos a muchos, y la marca (RM-01)', () => {
    const clienteId = nextId();
    const ventaId = nextId();
    const relId = nextId();

    const montaje = applyBatch(
      emptyBoard(),
      batch(
        cmd.createClass(clienteId, 'Cliente'),
        cmd.createClass(ventaId, 'Venta'),
        cmd.createRelationship(relId, clienteId, ventaId, '1', '0..*'),
      ),
    );
    expect(montaje.applied).toBe(true);
    if (!montaje.applied) return;

    const resultado = applyBatch(
      montaje.state,
      batch(cmd.changeMultiplicity(relId, '0..*', '0..*')),
    );

    // RM-01: la herramienta *ofrece* crear la clase intermedia al detectar la
    // N:M. Impedir dibujarla no es lo que dice la regla.
    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;

    const hallazgo = resultado.issues.find((i) => i.code === 'MANY_TO_MANY_RELATIONSHIP');
    expect(hallazgo?.severity).toBe('ERROR');
    // El validador no solo marca: dice como modelarlo.
    expect(hallazgo?.suggestion).toMatch(/clase intermedia/);
  });
});

describe('tamano de una tarjeta (disposicion, no semantica)', () => {
  it('MOVE_CLASS guarda el tamano cuando viene', () => {
    const { estado, clienteId } = conCliente();

    const resultado = applyBatch(
      estado,
      batch(
        cmd.moveClass(clienteId, 10, 20, {
          width: 320,
          height: 200,
        }),
      ),
    );

    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;

    expect(resultado.state.layout.sizes[clienteId]).toEqual({ width: 320, height: 200 });
    expect(resultado.state.layout.positions[clienteId]).toEqual({ x: 10, y: 20 });
  });

  it('arrastrar despues no borra el tamano ajustado a mano', () => {
    // Es la razon de que el campo sea opcional: un arrastre emite MOVE_CLASS
    // sin tamano, y si eso lo borrara, mover una tarjeta desharia el ancho que
    // alguien acaba de darle.
    const { estado, clienteId } = conCliente();

    const conTamano = applyBatch(
      estado,
      batch(cmd.moveClass(clienteId, 0, 0, { width: 320, height: 200 })),
    );
    expect(conTamano.applied).toBe(true);
    if (!conTamano.applied) return;

    const arrastrado = applyBatch(conTamano.state, batch(cmd.moveClass(clienteId, 500, 400)));
    expect(arrastrado.applied).toBe(true);
    if (!arrastrado.applied) return;

    expect(arrastrado.state.layout.sizes[clienteId]).toEqual({ width: 320, height: 200 });
    expect(arrastrado.state.layout.positions[clienteId]).toEqual({ x: 500, y: 400 });
  });

  it('borrar la clase se lleva su tamano', () => {
    const { estado, clienteId } = conCliente();

    const conTamano = applyBatch(
      estado,
      batch(cmd.moveClass(clienteId, 0, 0, { width: 320, height: 200 })),
    );
    expect(conTamano.applied).toBe(true);
    if (!conTamano.applied) return;

    const borrado = applyBatch(conTamano.state, batch(cmd.deleteClass(clienteId)));
    expect(borrado.applied).toBe(true);
    if (!borrado.applied) return;

    expect(borrado.state.layout.sizes[clienteId]).toBeUndefined();
    expect(borrado.state.layout.positions[clienteId]).toBeUndefined();
  });

  it('el minimo lo impone el contrato, no el aplicador', () => {
    // `applyBatch` recibe comandos ya tipados y no revalida: quien filtra es el
    // esquema, en el borde por donde entra un lote —la ruta HTTP, el asistente,
    // una importacion—. Lo comprobo esta prueba al escribirla, porque la
    // primera version esperaba que el aplicador rechazara y no lo hace.
    const { clienteId } = conCliente();

    const invalido = commandBatchSchema.safeParse(
      batch(cmd.moveClass(clienteId, 0, 0, { width: 10, height: 10 })),
    );
    const valido = commandBatchSchema.safeParse(
      batch(cmd.moveClass(clienteId, 0, 0, { width: 320, height: 200 })),
    );

    expect(invalido.success).toBe(false);
    expect(valido.success).toBe(true);
  });
});
