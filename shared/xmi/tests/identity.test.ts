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

it.each(['ADD', 'REPLACE'] as const)(
  'conserva los extremos por identidad si dos clases del XMI tienen el mismo nombre (%s)',
  (mode) => {
    const first = '20000000-0000-4000-8000-000000000001';
    const second = '20000000-0000-4000-8000-000000000002';
    const order = '20000000-0000-4000-8000-000000000003';
    const imported = parseXmi(`<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model name="Ventas">
      <packagedElement xmi:type="uml:Package" name="Norte">
        <packagedElement xmi:type="uml:Class" xmi:id="${first}" name="Cliente">
          <generalization xmi:id="herencia" general="${second}"/>
        </packagedElement>
      </packagedElement>
      <packagedElement xmi:type="uml:Package" name="Sur">
        <packagedElement xmi:type="uml:Class" xmi:id="${second}" name="Cliente"/>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="${order}" name="Pedido"/>
      <packagedElement xmi:type="uml:Association" xmi:id="asociacion">
        <ownedEnd xmi:type="uml:Property" xmi:id="extremo1"><type xmi:idref="${first}"/></ownedEnd>
        <ownedEnd xmi:type="uml:Property" xmi:id="extremo2"><type xmi:idref="${order}"/></ownedEnd>
      </packagedElement>
      <packagedElement xmi:type="uml:Association" xmi:id="ambigua">
        <ownedEnd xmi:type="uml:Property" xmi:id="extremo3" type="Cliente"/>
        <ownedEnd xmi:type="uml:Property" xmi:id="extremo4" type="Pedido"/>
      </packagedElement>
    </uml:Model></xmi:XMI>`);
    const existing = {
      id: '20000000-0000-4000-8000-000000000004',
      displayName: 'Cliente',
      codeName: 'Cliente',
      databaseName: 'cliente',
      attributes: [],
    };
    const state = { ...emptyBoardState(), semantic: { classes: [existing], relationships: [] } };
    const { batch, skipped } = xmiToBatch(imported, { mode, current: state.semantic, actorId });
    const result = applyBatch(state, batch);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.state.semantic.classes.map((item) => item.id)).toEqual(
      expect.arrayContaining([first, second, order]),
    );
    expect(result.state.semantic.relationships).toEqual([
      expect.objectContaining({ sourceClassId: first, targetClassId: order }),
      expect.objectContaining({
        kind: 'GENERALIZATION',
        sourceClassId: first,
        targetClassId: second,
      }),
    ]);
    expect(skipped).toContainEqual({
      element: 'Cliente → Pedido',
      reason: 'Se omitió la relación porque no se pudieron identificar ambos extremos.',
    });
  },
);

it.each(['constructor', '__proto__'])('importa el tipo desconocido %s como String', (type) => {
  const imported = parseXmi(`<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model name="Ventas">
    <packagedElement xmi:type="uml:Class" xmi:id="Cliente" name="Cliente">
      <ownedAttribute xmi:type="uml:Property" name="Nombre" type="${type}"/>
    </packagedElement>
  </uml:Model></xmi:XMI>`);
  const state = emptyBoardState();
  const { batch } = xmiToBatch(imported, { mode: 'ADD', current: state.semantic, actorId });
  const result = applyBatch(state, batch);
  expect(result.applied).toBe(true);
  if (!result.applied) return;
  expect(result.state.semantic.classes[0]?.attributes[0]?.type).toBe('String');
  expect(imported.warnings[0]?.reason).toContain('se importa como String');
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
