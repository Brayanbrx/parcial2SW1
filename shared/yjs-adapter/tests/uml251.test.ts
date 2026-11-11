import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { commandBatchSchema, emptyBoardState } from '@uml/contracts';
import { applyBatch } from '@uml/domain-core';
import { applyBatchToDocument, readBoardState, seedDocument } from '@uml/yjs-adapter';
import { gui, makeBatch as buildBatch } from '../../../frontend/src/features/editor/commands.js';
import { undoForDeletion } from '../../../frontend/src/features/editor/undo-delete.js';
import { uml251Fixture, umlId } from '../../domain-core/tests/uml251-fixture.js';

const makeBatch = (...args: Parameters<typeof buildBatch>) =>
  commandBatchSchema.parse(buildBatch(...args));

describe('edición colaborativa de elementos UML', () => {
  it('proyecta y persiste las propiedades nuevas sin perder las existentes', () => {
    const initial = uml251Fixture();
    const doc = new Y.Doc();
    seedDocument(doc, initial);
    expect(readBoardState(doc)).toEqual(initial);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    expect(readBoardState(replica)).toEqual(initial);
  });
  it('combina altas simultáneas de operaciones en una clase antigua sin operaciones', () => {
    const left = new Y.Doc();
    applyBatchToDocument(left, makeBatch(umlId(100), gui.createClass(umlId(1), 'Factura')));
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const operation = uml251Fixture().semantic.classes[0]!.operations![0]!;
    applyBatchToDocument(left, makeBatch(umlId(100), gui.addOperation(umlId(1), operation)));
    applyBatchToDocument(
      right,
      makeBatch(
        umlId(101),
        gui.addOperation(umlId(1), {
          ...operation,
          id: umlId(24),
          displayName: 'otra',
          parameters: [],
        }),
      ),
    );
    const l = Y.encodeStateAsUpdate(left),
      r = Y.encodeStateAsUpdate(right);
    Y.applyUpdate(left, r);
    Y.applyUpdate(right, l);
    expect(readBoardState(left)).toEqual(readBoardState(right));
    expect(readBoardState(left).semantic.classes[0]!.operations).toHaveLength(2);
  });
  it('combina cambios de nombre y visibilidad de una operación por separado', () => {
    const left = new Y.Doc();
    seedDocument(left, uml251Fixture());
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    applyBatchToDocument(
      left,
      makeBatch(umlId(100), gui.updateOperation(umlId(1), umlId(21), { displayName: 'total' })),
    );
    applyBatchToDocument(
      right,
      makeBatch(umlId(101), gui.updateOperation(umlId(1), umlId(21), { visibility: 'protected' })),
    );
    const l = Y.encodeStateAsUpdate(left),
      r = Y.encodeStateAsUpdate(right);
    Y.applyUpdate(left, r);
    Y.applyUpdate(right, l);
    expect(readBoardState(left)).toEqual(readBoardState(right));
    expect(
      readBoardState(left).semantic.classes.find((c) => c.id === umlId(1))!.operations![0],
    ).toMatchObject({ displayName: 'total', visibility: 'protected' });
    expect(
      readBoardState(left).semantic.classes.find((c) => c.id === umlId(1))!.operations![0]!
        .parameters,
    ).toHaveLength(1);
  });
  it('conserva parámetros añadidos simultáneamente y cambios en campos diferentes', () => {
    const left = new Y.Doc();
    seedDocument(left, uml251Fixture());
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const parameters = uml251Fixture().semantic.classes[0]!.operations![0]!.parameters;
    applyBatchToDocument(
      left,
      makeBatch(
        umlId(100),
        gui.updateOperation(umlId(1), umlId(21), {
          parameters: [
            { ...parameters[0]!, type: 'Integer' },
            { id: umlId(34), name: 'moneda', type: 'String', direction: 'in' },
          ],
        }),
      ),
    );
    applyBatchToDocument(
      right,
      makeBatch(
        umlId(101),
        gui.updateOperation(umlId(1), umlId(21), {
          parameters: [
            { ...parameters[0]!, name: 'tasa' },
            { id: umlId(35), name: 'descuento', type: 'Decimal', direction: 'in' },
          ],
        }),
      ),
    );
    const l = Y.encodeStateAsUpdate(left),
      r = Y.encodeStateAsUpdate(right);
    Y.applyUpdate(left, r);
    Y.applyUpdate(right, l);
    expect(readBoardState(left)).toEqual(readBoardState(right));
    const merged = readBoardState(left).semantic.classes.find((c) => c.id === umlId(1))!
      .operations![0]!.parameters;
    expect(merged).toHaveLength(3);
    expect(merged.find((p) => p.id === umlId(31))).toMatchObject({ name: 'tasa', type: 'Integer' });
  });
  it('actualiza referencias de atributos y operaciones al renombrar un tipo', () => {
    const doc = new Y.Doc();
    seedDocument(doc, uml251Fixture());
    const initial = readBoardState(doc);
    const batch = commandBatchSchema.parse(
      makeBatch(umlId(100), gui.renameClass(umlId(4), 'Importe')),
    );
    const planned = applyBatch(initial, batch);
    expect(planned.applied).toBe(true);
    applyBatchToDocument(doc, batch);
    if (planned.applied) expect(readBoardState(doc)).toEqual(planned.state);
    expect(
      readBoardState(doc).semantic.classes.find((c) => c.id === umlId(1))!.operations![0]!
        .returnType,
    ).toBe('Importe');
  });
  it('las referencias creadas en otra réplica siguen al tipo que se renombró', () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    seedDocument(left, uml251Fixture());
    // Simula una pizarra guardada antes de vincular los tipos por identidad.
    left.getMap('typeBindings').clear();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const renamed = makeBatch(umlId(100), gui.renameClass(umlId(4), 'Importe'));
    const referenced = makeBatch(
      umlId(101),
      gui.addAttribute(umlId(1), umlId(43), 'saldo', 'Dinero'),
      gui.addOperation(umlId(1), {
        id: umlId(44),
        displayName: 'convertir',
        visibility: 'public',
        isStatic: false,
        isAbstract: false,
        returnType: 'Dinero',
        parameters: [{ id: umlId(45), name: 'cantidad', type: 'Dinero', direction: 'in' }],
      }),
    );
    expect(applyBatchToDocument(left, renamed).applied).toBe(true);
    expect(applyBatchToDocument(right, referenced).applied).toBe(true);
    const a = Y.encodeStateAsUpdate(left);
    const b = Y.encodeStateAsUpdate(right);
    Y.applyUpdate(left, b);
    Y.applyUpdate(right, a);
    const merged = readBoardState(left);
    expect(merged).toEqual(readBoardState(right));
    const classifier = merged.semantic.classes.find((c) => c.id === umlId(1))!;
    expect(classifier.attributes.find((p) => p.id === umlId(43))?.type).toBe('Importe');
    expect(classifier.operations?.find((o) => o.id === umlId(44))).toMatchObject({
      returnType: 'Importe',
      parameters: [{ type: 'Importe' }],
    });
    expect(classifier.operations?.find((o) => o.id === umlId(21))?.returnType).toBe('Importe');
    left.destroy();
    right.destroy();
  });
  it('deshace operaciones y clases completas conservando identidad, orden y metadatos', () => {
    const doc = new Y.Doc();
    seedDocument(doc, uml251Fixture());
    const initial = readBoardState(doc);
    for (const command of [gui.deleteOperation(umlId(1), umlId(21)), gui.deleteClass(umlId(1))]) {
      const undo = undoForDeletion(readBoardState(doc), [command])!;
      expect(applyBatchToDocument(doc, makeBatch(umlId(100), command)).applied).toBe(true);
      expect(applyBatchToDocument(doc, makeBatch(umlId(100), ...undo.commands)).applied).toBe(true);
      expect(readBoardState(doc)).toEqual(initial);
    }
  });
  it('una referencia borrada conserva el último nombre aunque se reutilice el nombre anterior', () => {
    const doc = new Y.Doc();
    seedDocument(doc, uml251Fixture());
    const actor = umlId(100);
    applyBatchToDocument(doc, makeBatch(actor, gui.renameClass(umlId(4), 'Importe')));
    applyBatchToDocument(doc, makeBatch(actor, gui.createClass(umlId(46), 'Dinero')));
    applyBatchToDocument(doc, makeBatch(actor, gui.deleteClass(umlId(4))));
    expect(
      readBoardState(doc).semantic.classes.find((c) => c.id === umlId(1))?.operations?.[0]
        ?.returnType,
    ).toBe('Importe');
    applyBatchToDocument(doc, makeBatch(actor, gui.createClass(umlId(47), 'Importe')));
    expect(
      readBoardState(doc).semantic.classes.find((c) => c.id === umlId(1))?.operations?.[0]
        ?.returnType,
    ).toContain('tipo eliminado');
    doc.destroy();
  });

  it('desempata parámetros automáticos simultáneos y conserva nombres manuales', () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    seedDocument(left, uml251Fixture());
    const operationId = umlId(21);
    applyBatchToDocument(
      left,
      makeBatch(umlId(100), gui.updateOperation(umlId(1), operationId, { parameters: [] })),
    );
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    for (const [doc, id] of [
      [left, umlId(55)],
      [right, umlId(56)],
    ] as const) {
      applyBatchToDocument(
        doc,
        makeBatch(
          umlId(100),
          gui.updateOperation(
            umlId(1),
            operationId,
            {
              parameters: [{ id, name: 'parametro1', type: 'String', direction: 'in' }],
            },
            id,
          ),
        ),
      );
    }
    const a = Y.encodeStateAsUpdate(left),
      b = Y.encodeStateAsUpdate(right);
    Y.applyUpdate(left, b);
    Y.applyUpdate(right, a);
    const params = (doc: Y.Doc) =>
      readBoardState(doc).semantic.classes.find((c) => c.id === umlId(1))!.operations![0]!
        .parameters;
    expect(params(left)).toEqual(params(right));
    expect(params(left).map((p) => p.name)).toEqual(['parametro1', 'parametro2']);
    const edited = params(left).map((p, i) => (i === 1 ? { ...p, name: 'importe' } : p));
    applyBatchToDocument(
      left,
      makeBatch(umlId(100), gui.updateOperation(umlId(1), operationId, { parameters: edited })),
    );
    expect(params(left).map((p) => p.name)).toEqual(['parametro1', 'importe']);
    left.destroy();
    right.destroy();
  });
  it('rechaza un lote completo si una operación ya no existe', () => {
    const doc = new Y.Doc();
    seedDocument(doc, emptyBoardState());
    const before = readBoardState(doc);
    const outcome = applyBatchToDocument(
      doc,
      makeBatch(
        umlId(100),
        gui.createClass(umlId(1), 'Factura'),
        gui.deleteOperation(umlId(1), umlId(90)),
      ),
    );
    expect(outcome.applied).toBe(false);
    expect(readBoardState(doc)).toEqual(before);
  });
});
