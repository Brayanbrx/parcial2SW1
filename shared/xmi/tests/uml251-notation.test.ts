import { describe, expect, it } from 'vitest';
import {
  parseXmi,
  serializeToXmi,
  serializeToXmi251,
  serializeToEnterpriseArchitect,
  xmiToBatch,
} from '@uml/xmi';
import { applyBatch, validateUmlModel } from '@uml/domain-core';
import { emptyBoardState } from '@uml/contracts';
import { uml251Fixture, umlId } from '../../domain-core/tests/uml251-fixture.js';
import { XMLParser } from 'fast-xml-parser';

describe('intercambio de la notación de clases ampliada', () => {
  it.each([
    ['XMI 2.1', serializeToXmi],
    ['UML 2.5.1', serializeToXmi251],
    ['Enterprise Architect', serializeToEnterpriseArchitect],
  ] as const)(
    '%s conserva clasificadores, operaciones, referencias y multiplicidades',
    (_name, serialize) => {
      const initial = uml251Fixture();
      const xml = serialize(initial.semantic, { modelName: 'UML 2.5.1', layout: initial.layout });
      expect(xml).not.toContain('undefined');
      const parsed = parseXmi(xml);
      expect(parsed.warnings).toEqual([]);
      const { batch } = xmiToBatch(parsed, {
        mode: 'REPLACE',
        current: emptyBoardState().semantic,
        actorId: umlId(100),
      });
      const result = applyBatch(emptyBoardState(), batch);
      expect(result.applied).toBe(true);
      if (!result.applied) return;
      expect(validateUmlModel(result.state.semantic)).toEqual([]);
      expect(
        result.state.semantic.classes.map((c) => [c.id, c.kind, c.isAbstract, c.literals]),
      ).toEqual(initial.semantic.classes.map((c) => [c.id, c.kind, c.isAbstract, c.literals]));
      expect(result.state.semantic.classes[0]!.attributes[1]).toEqual(
        initial.semantic.classes[0]!.attributes[1],
      );
      expect(result.state.semantic.classes[0]!.operations).toEqual(
        initial.semantic.classes[0]!.operations,
      );
      expect(
        result.state.semantic.relationships.toSorted((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(initial.semantic.relationships.toSorted((a, b) => a.id.localeCompare(b.id)));
    },
  );
  it('escribe la agregación compuesta en la propiedad tipada por la parte, opuesta al diamante', () => {
    const xml = serializeToXmi251(uml251Fixture().semantic, { modelName: 'Composición' });
    const document = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => ['packagedElement', 'ownedEnd'].includes(name),
    }).parse(xml);
    const association = document['xmi:XMI']['uml:Model'].packagedElement.find(
      (e: Record<string, unknown>) => e['@_xmi:type'] === 'uml:Association',
    );
    const composite = association.ownedEnd.find(
      (e: Record<string, unknown>) => e['@_aggregation'] === 'composite',
    );
    expect(composite.type['@_xmi:idref']).toBe(`_${umlId(6)}`);
  });
});
