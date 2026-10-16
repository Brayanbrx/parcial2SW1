import {
  emptyBoardState,
  type Command,
  type CommandBatch,
  type Multiplicity,
  type RelationshipKind,
} from '@uml/contracts';
import { applyBatch } from '@uml/domain-core';
import { fixture } from '@uml/fixtures';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyBatchToDocument, readBoardState, seedDocument } from '@uml/yjs-adapter';

/**
 * Pruebas del documento colaborativo, sin servidor y sin red: dos `Y.Doc` en
 * memoria intercambiando actualizaciones bastan para comprobar convergencia.
 */

let secuencia = 0;
function nextId(): string {
  secuencia += 1;
  return `44444444-4444-4444-8444-${String(secuencia).padStart(12, '0')}`;
}

const ACTOR = '55555555-5555-4555-8555-555555555555';

type CommandBody = Pick<Command, 'type' | 'payload'>;

function batch(...commands: readonly CommandBody[]): CommandBatch {
  const issuedAt = new Date('2026-09-01T12:00:00.000Z').toISOString();
  return {
    batchId: nextId(),
    origin: 'GUI',
    actorId: ACTOR,
    issuedAt,
    commands: commands.map(
      (body) =>
        ({ ...body, commandId: nextId(), origin: 'GUI', actorId: ACTOR, issuedAt }) as Command,
    ),
  };
}

const cmd = {
  createClass: (classId: string, displayName: string): CommandBody => ({
    type: 'CREATE_CLASS',
    payload: { classId, displayName, position: { x: 10, y: 20 } },
  }),
  renameClass: (classId: string, displayName: string): CommandBody => ({
    type: 'RENAME_CLASS',
    payload: { classId, displayName },
  }),
  deleteClass: (classId: string): CommandBody => ({ type: 'DELETE_CLASS', payload: { classId } }),
  moveClass: (
    classId: string,
    x: number,
    y: number,
    size?: { width: number; height: number },
  ): CommandBody => ({
    type: 'MOVE_CLASS',
    payload: { classId, position: { x, y }, ...(size === undefined ? {} : { size }) },
  }),
  addAttribute: (classId: string, attributeId: string, displayName: string): CommandBody => ({
    type: 'ADD_ATTRIBUTE',
    payload: { classId, attributeId, displayName, type: 'String' },
  }),
  updateAttribute: (classId: string, attributeId: string, displayName: string): CommandBody => ({
    type: 'UPDATE_ATTRIBUTE',
    payload: { classId, attributeId, displayName },
  }),
  deleteAttribute: (classId: string, attributeId: string): CommandBody => ({
    type: 'DELETE_ATTRIBUTE',
    payload: { classId, attributeId },
  }),
  createRelationship: (
    relationshipId: string,
    sourceClassId: string,
    targetClassId: string,
    kind?: RelationshipKind,
  ): CommandBody => ({
    type: 'CREATE_RELATIONSHIP',
    payload: {
      relationshipId,
      ...(kind === undefined ? {} : { kind }),
      sourceClassId,
      targetClassId,
      sourceMultiplicity: '1' as Multiplicity,
      targetMultiplicity: '0..*' as Multiplicity,
    },
  }),
  updateRelationshipKind: (relationshipId: string, kind: RelationshipKind): CommandBody => ({
    type: 'UPDATE_RELATIONSHIP',
    payload: { relationshipId, kind },
  }),
  changeMultiplicity: (relationshipId: string): CommandBody => ({
    type: 'CHANGE_MULTIPLICITY',
    payload: { relationshipId, sourceMultiplicity: '1', targetMultiplicity: '1' },
  }),
  deleteRelationship: (relationshipId: string): CommandBody => ({
    type: 'DELETE_RELATIONSHIP',
    payload: { relationshipId },
  }),
};

function nuevoDocumento(): Y.Doc {
  const doc = new Y.Doc();
  seedDocument(doc);
  return doc;
}

/** Replica el documento como lo haria la red: intercambiando actualizaciones. */
function sincronizar(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('proyeccion del documento', () => {
  it('un documento vacio proyecta un modelo vacio', () => {
    expect(readBoardState(nuevoDocumento())).toEqual(emptyBoardState());
  });

  it('sembrar y proyectar devuelve el mismo estado', () => {
    const doc = new Y.Doc();
    const t01 = fixture('T01').boardState;

    seedDocument(doc, t01);

    expect(readBoardState(doc)).toEqual({
      ...t01,
      // La proyeccion ordena por identificador para ser identica en todas las
      // replicas; el estado sembrado venia en orden de declaracion.
      semantic: {
        classes: [...t01.semantic.classes].sort((l, r) => (l.id < r.id ? -1 : 1)),
        relationships: [...t01.semantic.relationships].sort((l, r) => (l.id < r.id ? -1 : 1)),
      },
    });
  });

  it('conserva el orden de los atributos', () => {
    const doc = nuevoDocumento();
    const classId = nextId();
    const ids = [nextId(), nextId(), nextId()];

    applyBatchToDocument(
      doc,
      batch(
        cmd.createClass(classId, 'Cliente'),
        cmd.addAttribute(classId, ids[0] as string, 'nombre'),
        cmd.addAttribute(classId, ids[1] as string, 'correo'),
        cmd.addAttribute(classId, ids[2] as string, 'telefono'),
      ),
    );

    // El orden de los atributos se ve: es el de la tarjeta y el del codigo
    // generado. Por eso van en Y.Array y no en Y.Map.
    expect(readBoardState(doc).semantic.classes[0]?.attributes.map((a) => a.codeName)).toEqual([
      'nombre',
      'correo',
      'telefono',
    ]);
  });

  it('actualizar un atributo no lo mueve de sitio', () => {
    const doc = nuevoDocumento();
    const classId = nextId();
    const ids = [nextId(), nextId()];

    applyBatchToDocument(
      doc,
      batch(
        cmd.createClass(classId, 'Cliente'),
        cmd.addAttribute(classId, ids[0] as string, 'nombre'),
        cmd.addAttribute(classId, ids[1] as string, 'correo'),
      ),
    );
    applyBatchToDocument(
      doc,
      batch(cmd.updateAttribute(classId, ids[0] as string, 'nombre completo')),
    );

    expect(readBoardState(doc).semantic.classes[0]?.attributes.map((a) => a.codeName)).toEqual([
      'nombreCompleto',
      'correo',
    ]);
  });
});

describe('aplicacion de lotes sobre el documento', () => {
  it('deriva los nombres tecnicos igual que el dominio', () => {
    const doc = nuevoDocumento();
    const classId = nextId();

    applyBatchToDocument(doc, batch(cmd.createClass(classId, 'Detalle de Venta')));

    expect(readBoardState(doc).semantic.classes[0]).toMatchObject({
      displayName: 'Detalle de Venta',
      codeName: 'DetalleVenta',
      databaseName: 'detalle_venta',
    });
  });

  it('RA-03 — un lote invalido no escribe nada en el documento', () => {
    const doc = nuevoDocumento();
    const classId = nextId();
    applyBatchToDocument(doc, batch(cmd.createClass(classId, 'Cliente')));

    const antes = Y.encodeStateAsUpdate(doc);

    const resultado = applyBatchToDocument(
      doc,
      batch(
        cmd.addAttribute(classId, nextId(), 'nombre'),
        cmd.addAttribute(nextId(), nextId(), 'huerfano'),
      ),
    );

    expect(resultado.applied).toBe(false);
    // Ni el estado ni el historial del documento cambiaron.
    expect(Y.encodeStateAsUpdate(doc)).toEqual(antes);
  });

  it('el lote entero produce una sola actualizacion a los demas', () => {
    const doc = nuevoDocumento();
    const classId = nextId();

    let actualizaciones = 0;
    doc.on('update', () => {
      actualizaciones += 1;
    });

    applyBatchToDocument(
      doc,
      batch(
        cmd.createClass(classId, 'Cliente'),
        cmd.addAttribute(classId, nextId(), 'nombre'),
        cmd.addAttribute(classId, nextId(), 'correo'),
        cmd.addAttribute(classId, nextId(), 'telefono'),
      ),
    );

    // La transaccion agrupa el cambio: cuatro comandos, un solo mensaje.
    expect(actualizaciones).toBe(1);
  });

  it('borrar una clase se lleva sus relaciones y su posicion', () => {
    const doc = nuevoDocumento();
    const clienteId = nextId();
    const ventaId = nextId();

    applyBatchToDocument(
      doc,
      batch(
        cmd.createClass(clienteId, 'Cliente'),
        cmd.createClass(ventaId, 'Venta'),
        cmd.createRelationship(nextId(), clienteId, ventaId),
      ),
    );
    applyBatchToDocument(doc, batch(cmd.deleteClass(clienteId)));

    const estado = readBoardState(doc);
    expect(estado.semantic.classes).toHaveLength(1);
    expect(estado.semantic.relationships).toHaveLength(0);
    expect(estado.layout.positions[clienteId]).toBeUndefined();
  });

  it('mover una clase no toca el modelo', () => {
    const doc = nuevoDocumento();
    const classId = nextId();
    applyBatchToDocument(doc, batch(cmd.createClass(classId, 'Cliente')));

    const antes = readBoardState(doc).semantic;
    applyBatchToDocument(doc, batch(cmd.moveClass(classId, 300, 400)));

    const despues = readBoardState(doc);
    expect(despues.semantic).toEqual(antes);
    expect(despues.layout.positions[classId]).toEqual({ x: 300, y: 400 });
  });
});

describe('convergencia entre dos replicas (RF-025)', () => {
  it('el tipo UML de una relacion se sincroniza y se puede cambiar', () => {
    const a = nuevoDocumento();
    const b = new Y.Doc();
    sincronizar(a, b);

    const todoId = nextId();
    const parteId = nextId();
    const relationshipId = nextId();
    applyBatchToDocument(
      a,
      batch(
        cmd.createClass(todoId, 'Pedido'),
        cmd.createClass(parteId, 'Detalle'),
        cmd.createRelationship(relationshipId, todoId, parteId, 'COMPOSITION'),
      ),
    );
    sincronizar(a, b);
    expect(readBoardState(b).semantic.relationships[0]?.kind).toBe('COMPOSITION');

    applyBatchToDocument(b, batch(cmd.updateRelationshipKind(relationshipId, 'AGGREGATION')));
    sincronizar(a, b);
    expect(readBoardState(a).semantic.relationships[0]?.kind).toBe('AGGREGATION');
  });

  it('lo que crea A aparece en B', () => {
    const a = nuevoDocumento();
    const b = new Y.Doc();
    sincronizar(a, b);

    const classId = nextId();
    applyBatchToDocument(a, batch(cmd.createClass(classId, 'Producto')));
    sincronizar(a, b);

    expect(readBoardState(b).semantic.classes[0]?.codeName).toBe('Producto');
  });

  it('el tamano de una tarjeta viaja a la otra replica', () => {
    // Es lo que convierte el redimensionado en colaborativo: el tamano vive en
    // el documento, no en el estado de React, asi que viaja por el mismo canal
    // que todo lo demas y sobrevive a una recarga.
    const a = nuevoDocumento();
    const b = new Y.Doc();
    sincronizar(a, b);

    const classId = nextId();
    applyBatchToDocument(a, batch(cmd.createClass(classId, 'Producto')));
    applyBatchToDocument(a, batch(cmd.moveClass(classId, 40, 60, { width: 340, height: 220 })));
    sincronizar(a, b);

    expect(readBoardState(b).layout.sizes[classId]).toEqual({ width: 340, height: 220 });

    // Y arrastrar en la otra replica no lo borra.
    applyBatchToDocument(b, batch(cmd.moveClass(classId, 700, 500)));
    sincronizar(b, a);

    expect(readBoardState(a).layout.sizes[classId]).toEqual({ width: 340, height: 220 });
    expect(readBoardState(a).layout.positions[classId]).toEqual({ x: 700, y: 500 });
  });

  it('dos clases creadas a la vez sobreviven las dos', () => {
    const a = nuevoDocumento();
    const b = new Y.Doc();
    sincronizar(a, b);

    // Sin sincronizar entre medias: cada replica ignora lo que hizo la otra.
    applyBatchToDocument(a, batch(cmd.createClass(nextId(), 'Cliente')));
    applyBatchToDocument(b, batch(cmd.createClass(nextId(), 'Producto')));

    sincronizar(a, b);

    const enA = readBoardState(a).semantic.classes.map((c) => c.codeName);
    const enB = readBoardState(b).semantic.classes.map((c) => c.codeName);

    expect(enA).toEqual(enB);
    expect(new Set(enA)).toEqual(new Set(['Cliente', 'Producto']));
  });

  it('CA-025.1 — dos nombres que colapsan convergen, y el validador los marca', () => {
    const a = nuevoDocumento();
    const b = new Y.Doc();
    sincronizar(a, b);

    applyBatchToDocument(a, batch(cmd.createClass(nextId(), 'Detalle de Venta')));
    applyBatchToDocument(b, batch(cmd.createClass(nextId(), 'detalle venta')));

    sincronizar(a, b);

    // RA-12: convergencia estructural, no validez semantica.
    expect(readBoardState(a)).toEqual(readBoardState(b));
    expect(readBoardState(a).semantic.classes).toHaveLength(2);

    // Y el error existe, listo para bloquear la generacion.
    const revalidado = applyBatch(readBoardState(a), batch(cmd.createClass(nextId(), 'Cliente')));
    expect(revalidado.applied).toBe(true);
  });

  it('las dos replicas convergen tras ediciones cruzadas', () => {
    const a = nuevoDocumento();
    const b = new Y.Doc();
    const clienteId = nextId();

    applyBatchToDocument(a, batch(cmd.createClass(clienteId, 'Cliente')));
    sincronizar(a, b);

    applyBatchToDocument(a, batch(cmd.addAttribute(clienteId, nextId(), 'nombre')));
    applyBatchToDocument(b, batch(cmd.moveClass(clienteId, 999, 888)));
    applyBatchToDocument(b, batch(cmd.renameClass(clienteId, 'Cliente Corporativo')));

    sincronizar(a, b);

    expect(readBoardState(a)).toEqual(readBoardState(b));
    expect(readBoardState(a).semantic.classes[0]?.codeName).toBe('ClienteCorporativo');
    expect(readBoardState(a).layout.positions[clienteId]).toEqual({ x: 999, y: 888 });
  });

  it('conserva cambios concurrentes en campos distintos del mismo atributo', () => {
    const a = nuevoDocumento(),
      b = new Y.Doc();
    const classId = nextId(),
      attributeId = nextId();
    applyBatchToDocument(
      a,
      batch(cmd.createClass(classId, 'Cliente'), cmd.addAttribute(classId, attributeId, 'dato')),
    );
    sincronizar(a, b);
    applyBatchToDocument(a, batch(cmd.updateAttribute(classId, attributeId, 'edad')));
    applyBatchToDocument(
      b,
      batch({ type: 'UPDATE_ATTRIBUTE', payload: { classId, attributeId, type: 'Integer' } }),
    );
    sincronizar(a, b);
    expect(readBoardState(a)).toEqual(readBoardState(b));
    expect(readBoardState(a).semantic.classes[0]?.attributes[0]).toMatchObject({
      displayName: 'edad',
      codeName: 'edad',
      databaseName: 'edad',
      type: 'Integer',
    });
  });

  it('conserva el rol y la cardinalidad modificados simultáneamente', () => {
    const a = nuevoDocumento(),
      b = new Y.Doc();
    const from = nextId(),
      to = nextId(),
      id = nextId();
    applyBatchToDocument(
      a,
      batch(
        cmd.createClass(from, 'Cliente'),
        cmd.createClass(to, 'Venta'),
        cmd.createRelationship(id, from, to),
      ),
    );
    applyBatchToDocument(
      a,
      batch({
        type: 'UPDATE_RELATIONSHIP',
        payload: { relationshipId: id, sourceRoleName: 'vendedor' },
      }),
    );
    sincronizar(a, b);
    applyBatchToDocument(
      a,
      batch({
        type: 'UPDATE_RELATIONSHIP',
        payload: { relationshipId: id, sourceRoleName: 'comprador' },
      }),
    );
    applyBatchToDocument(
      b,
      batch({
        type: 'CHANGE_MULTIPLICITY',
        payload: { relationshipId: id, targetMultiplicity: '1..*' },
      }),
    );
    sincronizar(a, b);
    expect(readBoardState(a)).toEqual(readBoardState(b));
    expect(readBoardState(a).semantic.relationships[0]).toMatchObject({
      sourceRoleName: 'comprador',
      targetMultiplicity: '1..*',
    });
  });

  it('conserva cambios simultáneos de cardinalidad en extremos distintos', () => {
    const a = nuevoDocumento(),
      b = new Y.Doc();
    const from = nextId(),
      to = nextId(),
      id = nextId();
    applyBatchToDocument(
      a,
      batch(
        cmd.createClass(from, 'Cliente'),
        cmd.createClass(to, 'Venta'),
        cmd.createRelationship(id, from, to),
      ),
    );
    sincronizar(a, b);
    applyBatchToDocument(
      a,
      batch({
        type: 'CHANGE_MULTIPLICITY',
        payload: { relationshipId: id, sourceMultiplicity: '0..1' },
      }),
    );
    applyBatchToDocument(
      b,
      batch({
        type: 'CHANGE_MULTIPLICITY',
        payload: { relationshipId: id, targetMultiplicity: '1..*' },
      }),
    );
    sincronizar(a, b);
    expect(readBoardState(a)).toEqual(readBoardState(b));
    expect(readBoardState(a).semantic.relationships[0]).toMatchObject({
      sourceMultiplicity: '0..1',
      targetMultiplicity: '1..*',
    });
  });

  it('CA-024.1 — quien se incorpora tarde recibe todo el estado', () => {
    const veterano = nuevoDocumento();

    for (let i = 0; i < 10; i += 1) {
      const classId = nextId();
      applyBatchToDocument(veterano, batch(cmd.createClass(classId, `Entidad ${i + 1}`)));
      applyBatchToDocument(veterano, batch(cmd.addAttribute(classId, nextId(), 'nombre')));
    }

    // RA-02: snapshot solo al incorporarse; a partir de ahi, deltas.
    const recienLlegado = new Y.Doc();
    Y.applyUpdate(recienLlegado, Y.encodeStateAsUpdate(veterano));

    expect(readBoardState(recienLlegado).semantic.classes).toHaveLength(10);
    expect(readBoardState(recienLlegado)).toEqual(readBoardState(veterano));
  });

  it('RA-02 — tras el estado inicial solo viajan deltas', () => {
    const a = nuevoDocumento();
    const b = new Y.Doc();

    for (let i = 0; i < 10; i += 1) {
      applyBatchToDocument(a, batch(cmd.createClass(nextId(), `Entidad ${i + 1}`)));
    }
    const inicial = Y.encodeStateAsUpdate(a);
    Y.applyUpdate(b, inicial);

    applyBatchToDocument(a, batch(cmd.createClass(nextId(), 'Una mas')));
    const delta = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));

    // La actualizacion incremental es una fraccion del estado completo. Sin esta
    // propiedad, cada tecla enviaria el diagrama entero a los demas (CA-023.1).
    expect(delta.length).toBeLessThan(inicial.length / 2);
  });
});

describe('equivalencia con el nucleo de dominio (RA-05)', () => {
  it('la proyeccion coincide con el estado que calculo el dominio', () => {
    // Este es el guardian contra la divergencia: `@uml/domain-core` muta objetos
    // planos y este paquete muta el arbol Yjs. Si algun dia dejan de producir lo
    // mismo, falla aqui y no el dia de la defensa.
    const doc = nuevoDocumento();
    let esperado = emptyBoardState();

    const clienteId = nextId();
    const ventaId = nextId();
    const atributoId = nextId();
    const relacionId = nextId();

    const lotes = [
      batch(cmd.createClass(clienteId, 'Cliente'), cmd.createClass(ventaId, 'Venta')),
      batch(cmd.addAttribute(clienteId, atributoId, 'Número de Teléfono')),
      batch(cmd.updateAttribute(clienteId, atributoId, 'telefono')),
      batch(cmd.createRelationship(relacionId, clienteId, ventaId)),
      batch(cmd.changeMultiplicity(relacionId)),
      batch(cmd.moveClass(clienteId, 42, 84)),
      batch(cmd.renameClass(ventaId, 'Venta Anulada')),
      batch(cmd.addAttribute(ventaId, nextId(), 'fecha')),
      batch(cmd.deleteAttribute(clienteId, atributoId)),
      batch(cmd.deleteRelationship(relacionId)),
      batch(cmd.deleteClass(ventaId)),
    ];

    for (const lote of lotes) {
      const enDocumento = applyBatchToDocument(doc, lote);
      const enDominio = applyBatch(esperado, lote);

      expect(enDocumento.applied).toBe(enDominio.applied);
      if (!enDominio.applied) continue;
      esperado = enDominio.state;

      expect(readBoardState(doc).semantic).toEqual({
        classes: [...esperado.semantic.classes].sort((l, r) => (l.id < r.id ? -1 : 1)),
        relationships: [...esperado.semantic.relationships].sort((l, r) => (l.id < r.id ? -1 : 1)),
      });
      expect(readBoardState(doc).layout.positions).toEqual(esperado.layout.positions);
    }
  });
});
