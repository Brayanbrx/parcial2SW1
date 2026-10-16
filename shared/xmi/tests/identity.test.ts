import { describe, expect, it } from 'vitest';
import { emptyBoardState, type Layout } from '@uml/contracts';
import { applyBatch } from '@uml/domain-core';
import { fixture, VALID_FIXTURE_IDS } from '@uml/fixtures';
import {
  parseXmi,
  serializeToXmi,
  serializeToXmi251,
  serializeToEnterpriseArchitect,
  xmiToBatch,
} from '@uml/xmi';
import { applyBatchToDocument, readBoardState, seedDocument } from '@uml/yjs-adapter';
import * as Y from 'yjs';

const actorId = '11111111-1111-4111-8111-111111111111';
for (const serializer of [serializeToXmi, serializeToXmi251, serializeToEnterpriseArchitect]) {
  describe(serializer.name, () => {
    for (const id of VALID_FIXTURE_IDS)
      it(`${id}: conserva identidad, atributos, relaciones y geometría al reemplazar`, () => {
        const model = fixture(id).model;
        const layout: Layout = {
          positions: Object.fromEntries(
            model.classes.map((c, i) => [c.id, { x: -50 + 350 * i, y: 120 + 20 * i }]),
          ),
          sizes: Object.fromEntries(model.classes.map((c) => [c.id, { width: 300, height: 240 }])),
        };
        const imported = parseXmi(serializer(model, { modelName: id, layout }));
        const batch = xmiToBatch(imported, { mode: 'REPLACE', current: model, actorId }).batch;
        const result = applyBatch({ ...emptyBoardState(), semantic: model }, batch);
        expect(result.applied).toBe(true);
        if (!result.applied) throw new Error(JSON.stringify(result.issues));
        expect(result.state.semantic.classes).toEqual(model.classes);
        expect(
          [...result.state.semantic.relationships].sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual([...model.relationships].sort((a, b) => a.id.localeCompare(b.id)));
        expect(result.state.layout).toEqual(layout);
        const doc = new Y.Doc();
        seedDocument(doc, { ...emptyBoardState(), semantic: model });
        expect(applyBatchToDocument(doc, batch).applied).toBe(true);
        const actual = readBoardState(doc);
        expect(actual.semantic.classes).toEqual(
          [...model.classes].sort((a, b) => a.id.localeCompare(b.id)),
        );
        expect(actual.semantic.relationships).toEqual(
          [...model.relationships].sort((a, b) => a.id.localeCompare(b.id)),
        );
        expect(actual.layout).toEqual(layout);
        doc.destroy();
      });
  });
}
it('añadir reconoce elementos renombrados por su identidad y no los duplica', () => {
  const model = fixture('T01').model;
  const imported = parseXmi(serializeToXmi(model, { modelName: 'Antes' }));
  const current = {
    ...model,
    classes: model.classes.map((c) => ({
      ...c,
      displayName: `${c.displayName} Nuevo`,
      attributes: c.attributes.map((a) => ({ ...a, displayName: `${a.displayName} Nuevo` })),
    })),
  };
  const result = xmiToBatch(imported, { mode: 'ADD', current, actorId });
  expect(result.batch.commands).toHaveLength(0);
  expect(result.skipped.length).toBeGreaterThan(0);
});

it('reasigna UUID repetidos sin perder los dos atributos del archivo', () => {
  const model = fixture('T01').model;
  const imported = parseXmi(serializeToXmi(model, { modelName: 'Prueba' }));
  const first = imported.classes[0]!;
  const original = first.attributes[0]!;
  const modified = {
    ...imported,
    classes: [{ ...first, attributes: [original, { ...original, name: 'copia' }] }],
    relationships: [],
  };
  const result = xmiToBatch(modified, {
    mode: 'ADD',
    current: emptyBoardState().semantic,
    actorId,
  });
  const attributes = result.batch.commands.filter((c) => c.type === 'ADD_ATTRIBUTE');
  expect(attributes).toHaveLength(2);
  expect(new Set(attributes.map((c) => c.payload.attributeId)).size).toBe(2);
  expect(result.skipped).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining('identificador') }),
    ]),
  );
});
