import { describe, expect, it } from 'vitest';
import { attributeNotation, multiplicitySchema, operationNotation } from '@uml/contracts';
import { validateModel, validateUmlModel } from '@uml/domain-core';
import { uml251Fixture, umlId } from './uml251-fixture.js';

describe('modelo de clases UML 2.5.1', () => {
  it('acepta interfaces, enumeraciones, tipos propios y operaciones sin imponer reglas de persistencia', () => {
    const model = uml251Fixture().semantic;
    expect(validateUmlModel(model)).toEqual([]);
    const restrictions = validateModel(model).filter((issue) => issue.severity === 'ERROR');
    expect(restrictions.length).toBeGreaterThan(0);
    expect(restrictions.every((issue) => issue.scope === 'GENERATION')).toBe(true);
  });
  it.each(['0', '1', '*', '2', '2..5', '3..*', '0..0'])('acepta la multiplicidad %s', (value) => {
    expect(multiplicitySchema.safeParse(value).success).toBe(true);
  });
  it.each(['-1', '5..2', 'a..b', '1...5', '01', '2.5', '9007199254740992', ''])(
    'rechaza la multiplicidad %s',
    (value) => {
      expect(multiplicitySchema.safeParse(value).success).toBe(false);
    },
  );
  it('distingue una realización incorrecta de una restricción del generador', () => {
    const model = uml251Fixture().semantic;
    model.relationships[0]!.targetClassId = umlId(3);
    expect(validateUmlModel(model)).toContainEqual(
      expect.objectContaining({ scope: 'UML', code: 'INVALID_UML_MODEL', elementIds: [umlId(41)] }),
    );
  });
  it('detecta ciclos por cualquier superclase, incluso cuando hay herencia múltiple', () => {
    const model = uml251Fixture().semantic;
    model.relationships.push(
      {
        id: umlId(51),
        kind: 'GENERALIZATION',
        sourceClassId: umlId(1),
        targetClassId: umlId(6),
        sourceMultiplicity: '1',
        targetMultiplicity: '1',
      },
      {
        id: umlId(52),
        kind: 'GENERALIZATION',
        sourceClassId: umlId(6),
        targetClassId: umlId(1),
        sourceMultiplicity: '1',
        targetMultiplicity: '1',
      },
    );
    expect(validateUmlModel(model).some((issue) => issue.code === 'INHERITANCE_CYCLE')).toBe(true);
  });
  it('genera firmas con visibilidad, dirección, multiplicidad, valores iniciales y retorno', () => {
    const c = uml251Fixture().semantic.classes[0]!;
    expect(attributeNotation(c.attributes[1]!)).toBe(
      '# /etiquetas: String [2..5] = "venta" {readOnly}',
    );
    expect(operationNotation(c.operations![0]!)).toBe(
      '+ calcularTotal(inout impuesto: Decimal [0..1] = 0): Dinero [0..1]',
    );
  });
});
