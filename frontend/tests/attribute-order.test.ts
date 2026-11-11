import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { commandBatchSchema } from '@uml/contracts';
import { validateModel } from '@uml/domain-core';
import { applyBatchToDocument, classesMap, readBoardState, seedDocument } from '@uml/yjs-adapter';
import { gui, makeBatch, type CommandBody } from '../src/features/editor/commands.js';
import { parseAttributeText, reorderAttributes } from '../src/features/editor/attribute-order.js';

const CLASE = '11111111-1111-4111-8111-111111111111';
const ids = ['a', 'b', 'c', 'd'].map((l) => `${l.repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);

function pizarra() {
  const doc = new Y.Doc();
  const crear: CommandBody[] = [
    {
      type: 'CREATE_CLASS',
      payload: { classId: CLASE, displayName: 'Persona', position: { x: 0, y: 0 } },
    },
    ...['nombre', 'uid', 'correo', 'edad'].map((nombre, i): CommandBody => ({
      type: 'ADD_ATTRIBUTE',
      payload: {
        classId: CLASE,
        attributeId: ids[i]!,
        displayName: nombre,
        type: nombre === 'edad' ? 'Integer' : 'String',
        primaryKey: nombre === 'uid',
        nullable: nombre !== 'correo',
        unique: nombre === 'correo',
      },
    })),
  ];
  expect(applyBatchToDocument(doc, makeBatch('actor', ...crear)).applied).toBe(true);
  return doc;
}

const clase = (doc: Y.Doc) => readBoardState(doc).semantic.classes[0]!;

describe('reordenar atributos sobre el diagrama', () => {
  it('sube un atributo en el documento Yjs conservando identificadores y propiedades', () => {
    const doc = pizarra();
    const antes = clase(doc).attributes;

    const comandos = reorderAttributes(clase(doc), 1, 0);
    expect(applyBatchToDocument(doc, makeBatch('actor', ...comandos)).applied).toBe(true);

    const despues = clase(doc).attributes;
    expect(despues.map((a) => a.displayName)).toEqual(['uid', 'nombre', 'correo', 'edad']);
    for (const atributo of antes)
      expect(despues.find((a) => a.id === atributo.id)).toEqual(atributo);
  });

  it.each([false, true])('conserva movimientos independientes con orden legado: %s', (legacy) => {
    const doc = pizarra();
    if (legacy)
      classesMap(doc)
        .get(CLASE)!
        .set('attributeOrder', [...ids].reverse());
    const original = clase(doc).attributes.map(({ id }) => id);
    expect(original).toEqual(legacy ? [...ids].reverse() : ids);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));

    const left = reorderAttributes(clase(doc), 0, 1);
    const right = reorderAttributes(clase(remote), 2, 3);
    expect(applyBatchToDocument(doc, makeBatch('actor', ...left)).applied).toBe(true);
    expect(applyBatchToDocument(remote, makeBatch('remote', ...right)).applied).toBe(true);

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(clase(doc).attributes).toEqual(clase(remote).attributes);
    expect(clase(doc).attributes.map(({ id }) => id)).toEqual([
      original[1],
      original[0],
      original[3],
      original[2],
    ]);
  });

  it('combina movimientos simultáneos, cambios de propiedades y altas sin duplicar atributos', () => {
    const doc = pizarra();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const move = reorderAttributes(clase(doc), 0, 3);
    const newId = 'eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(
      applyBatchToDocument(doc, commandBatchSchema.parse(makeBatch(CLASE, ...move))).applied,
    ).toBe(true);
    expect(applyBatchToDocument(remote, makeBatch('remote', ...move)).applied).toBe(true);
    expect(
      applyBatchToDocument(
        remote,
        makeBatch(
          'remote',
          gui.updateAttribute(CLASE, ids[0]!, { displayName: 'nombreCompleto', nullable: false }),
          gui.addAttribute(CLASE, newId, 'telefono', 'String'),
        ),
      ).applied,
    ).toBe(true);

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(clase(doc).attributes).toEqual(clase(remote).attributes);
    expect(clase(doc).attributes.map((a) => a.id)).toEqual([...ids.slice(1), ids[0], newId]);
    expect(clase(doc).attributes[3]).toMatchObject({
      displayName: 'nombreCompleto',
      nullable: false,
    });
  });

  it('recupera la proyección de una pizarra antigua con duplicados y bloquea un snapshot dañado', () => {
    const original = pizarra();
    const damaged = readBoardState(original);
    const attributes = damaged.semantic.classes[0]!.attributes;
    attributes.push({ ...attributes[0]! });
    expect(validateModel(damaged.semantic)).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_ID',
        severity: 'ERROR',
      }),
    );

    const restored = new Y.Doc();
    seedDocument(restored, damaged);
    expect(readBoardState(restored)).toEqual(readBoardState(original));
    applyBatchToDocument(restored, makeBatch('actor', gui.deleteAttribute(CLASE, ids[0]!)));
    expect(clase(restored).attributes.map((a) => a.id)).toEqual(ids.slice(1));
  });

  it('no genera comandos para movimientos nulos o fuera de rango', () => {
    const doc = pizarra();
    expect(reorderAttributes(clase(doc), 2, 2)).toEqual([]);
    expect(reorderAttributes(clase(doc), -1, 0)).toEqual([]);
    expect(reorderAttributes(clase(doc), 0, 9)).toEqual([]);
  });
});

describe('texto de atributo en notación UML', () => {
  it('lee nombre y tipo, sin distinguir mayúsculas en el tipo', () => {
    expect(parseAttributeText('- fechaAlta: date')).toEqual({
      name: 'fechaAlta',
      type: 'Date',
      unknownType: null,
      visibility: 'private',
    });
    expect(parseAttributeText('correo')).toEqual({ name: 'correo', type: null, unknownType: null });
  });
  it('rechaza nombres vacíos y señala tipos desconocidos', () => {
    expect(parseAttributeText('  : String')).toBeNull();
    expect(parseAttributeText('precio: Dinero')?.unknownType).toBe('Dinero');
  });
});
