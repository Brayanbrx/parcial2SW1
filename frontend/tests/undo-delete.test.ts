import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyBatchToDocument, readBoardState } from '@uml/yjs-adapter';
import { gui, makeBatch, type CommandBody } from '../src/features/editor/commands.js';
import { undoForDeletion } from '../src/features/editor/undo-delete.js';

const PERSONA = '11111111-1111-4111-8111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const RELACION = '33333333-3333-4333-8333-333333333333';
const ids = ['a', 'b', 'c', 'd'].map((l) => `${l.repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);

function pizarra() {
  const doc = new Y.Doc();
  const crear: CommandBody[] = [
    gui.createClass(PERSONA, 'Persona', { x: 40, y: 60 }),
    gui.moveClass(PERSONA, { x: 40, y: 60 }, { width: 260, height: 180 }),
    gui.createClass(PEDIDO, 'Pedido', { x: 400, y: 60 }),
    ...['nombre', 'uid', 'correo', 'edad'].map((nombre, i): CommandBody => ({
      type: 'ADD_ATTRIBUTE',
      payload: {
        classId: PERSONA,
        attributeId: ids[i]!,
        displayName: nombre,
        type: nombre === 'edad' ? 'Integer' : 'String',
        primaryKey: nombre === 'uid',
        nullable: nombre !== 'correo',
        unique: nombre === 'correo',
      },
    })),
    {
      type: 'CREATE_RELATIONSHIP',
      payload: {
        relationshipId: RELACION,
        kind: 'COMPOSITION',
        sourceClassId: PERSONA,
        targetClassId: PEDIDO,
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
        targetRoleName: 'pedidos',
      },
    },
  ];
  expect(applyBatchToDocument(doc, makeBatch('actor', ...crear)).applied).toBe(true);
  return doc;
}

/** Borra con `command`, deshace con lo que propone el módulo y devuelve el antes/después. */
function borrarYDeshacer(command: CommandBody) {
  const doc = pizarra();
  const antes = readBoardState(doc);
  const deshacer = undoForDeletion(antes, [command]);
  expect(deshacer).not.toBeNull();
  expect(applyBatchToDocument(doc, makeBatch('actor', command)).applied).toBe(true);
  const resultado = applyBatchToDocument(doc, makeBatch('actor', ...deshacer!.commands));
  expect(resultado.applied).toBe(true);
  return { antes, despues: readBoardState(doc), deshacer: deshacer! };
}

const porId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

describe('deshacer un borrado', () => {
  it('devuelve un atributo a su posición con el mismo identificador y propiedades', () => {
    const { antes, despues, deshacer } = borrarYDeshacer(gui.deleteAttribute(PERSONA, ids[1]!));
    expect(deshacer.message).toBe('Atributo «uid» eliminado');
    const clase = (estado: typeof antes) => estado.semantic.classes.find((c) => c.id === PERSONA);
    expect(clase(despues)?.attributes).toEqual(clase(antes)?.attributes);
  });

  it.each([true, false])(
    'recupera solo el atributo borrado aunque cambie su vecino (borrado: %s)',
    (borrado) => {
      const doc = pizarra();
      const command = gui.deleteAttribute(PERSONA, ids[1]!);
      const undo = undoForDeletion(readBoardState(doc), [command])!;
      applyBatchToDocument(doc, makeBatch('actor', command));

      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      const change = borrado
        ? gui.deleteAttribute(PERSONA, ids[2]!)
        : gui.updateAttribute(PERSONA, ids[2]!, { displayName: 'email', unique: false });
      expect(applyBatchToDocument(remote, makeBatch('remote', change)).applied).toBe(true);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));

      expect(applyBatchToDocument(doc, makeBatch('actor', ...undo.commands)).applied).toBe(true);
      const attributes = readBoardState(doc).semantic.classes.find(
        (item) => item.id === PERSONA,
      )!.attributes;
      expect(attributes.map((a) => a.displayName)).toEqual(
        borrado ? ['nombre', 'edad', 'uid'] : ['nombre', 'uid', 'email', 'edad'],
      );
      if (!borrado) expect(attributes[2]?.unique).toBe(false);
    },
  );

  it('recupera una clase con atributos, tamaño, posición y sus relaciones', () => {
    const { antes, despues, deshacer } = borrarYDeshacer(gui.deleteClass(PERSONA));
    expect(deshacer.message).toBe('Clase «Persona» eliminada con 1 relación');
    expect(deshacer.selectId).toBe(PERSONA);
    expect(porId(despues.semantic.classes)).toEqual(porId(antes.semantic.classes));
    expect(despues.semantic.relationships).toEqual(antes.semantic.relationships);
    expect(despues.layout.positions[PERSONA]).toEqual(antes.layout.positions[PERSONA]);
    expect(despues.layout.sizes[PERSONA]).toEqual(antes.layout.sizes[PERSONA]);
  });

  it('recupera una relación con su tipo, multiplicidades y roles', () => {
    const { antes, despues, deshacer } = borrarYDeshacer(gui.deleteRelationship(RELACION));
    expect(deshacer.message).toBe('Relación Persona → Pedido eliminada');
    expect(despues.semantic.relationships).toEqual(antes.semantic.relationships);
  });

  it('solo ofrece deshacer borrados sueltos de elementos que existen', () => {
    const estado = readBoardState(pizarra());
    expect(undoForDeletion(estado, [gui.renameClass(PERSONA, 'Cliente')])).toBeNull();
    expect(undoForDeletion(estado, [gui.deleteClass(PERSONA), gui.deleteClass(PEDIDO)])).toBeNull();
    expect(undoForDeletion(estado, [gui.deleteClass(RELACION)])).toBeNull();
  });

  it('no aplica nada si el diagrama cambió de forma incompatible', () => {
    const doc = pizarra();
    const deshacer = undoForDeletion(readBoardState(doc), [gui.deleteClass(PEDIDO)])!;
    applyBatchToDocument(doc, makeBatch('actor', gui.deleteClass(PEDIDO)));
    // Mientras tanto otra persona borra Persona: la relación ya no puede volver.
    applyBatchToDocument(doc, makeBatch('actor', gui.deleteClass(PERSONA)));
    const antes = readBoardState(doc);
    expect(applyBatchToDocument(doc, makeBatch('actor', ...deshacer.commands)).applied).toBe(false);
    expect(readBoardState(doc)).toEqual(antes);
  });
});
