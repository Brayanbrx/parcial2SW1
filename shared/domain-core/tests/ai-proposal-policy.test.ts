import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  commandSchema,
  WARNING_CODES,
  type CommandBatch,
  type SemanticModel,
  type UmlClass,
} from '@uml/contracts';
import {
  evaluateAiProposal,
  inputAllowsAutoApply,
  normalizeName,
  validateModel,
} from '@uml/domain-core';

const actorId = randomUUID();
function cls(displayName: string, attribute?: string): UmlClass {
  const names = normalizeName(displayName, 'CLASS');
  return {
    id: randomUUID(),
    displayName,
    codeName: names.codeName,
    databaseName: names.databaseName,
    attributes: attribute
      ? [
          {
            id: randomUUID(),
            displayName: attribute,
            codeName: attribute,
            databaseName: attribute,
            type: 'Integer',
            nullable: true,
            unique: false,
            primaryKey: false,
          },
        ]
      : [],
  };
}
const a = cls('Cliente', 'id'),
  b = cls('Venta');
const rel = {
  id: randomUUID(),
  sourceClassId: a.id,
  targetClassId: b.id,
  sourceMultiplicity: '1' as const,
  targetMultiplicity: '0..*' as const,
};
const model: SemanticModel = { classes: [a, b], relationships: [rel] };
const command = (type: string, payload: unknown) =>
  commandSchema.parse({
    commandId: randomUUID(),
    actorId,
    origin: 'AI_VOICE',
    issuedAt: new Date().toISOString(),
    type,
    payload,
  });
const batch = (type: string, payload: unknown): CommandBatch => ({
  batchId: randomUUID(),
  actorId,
  origin: 'AI_VOICE',
  issuedAt: new Date().toISOString(),
  commands: [command(type, payload)],
});

describe('política AUTO_SAFE compartida', () => {
  it.each([
    ['CREATE_CLASS', { classId: randomUUID(), displayName: 'Factura' }, true],
    [
      'ADD_ATTRIBUTE',
      { classId: a.id, attributeId: randomUUID(), displayName: 'correo', type: 'String' },
      true,
    ],
    ['RENAME_CLASS', { classId: a.id, displayName: 'Comprador' }, false],
    [
      'UPDATE_ATTRIBUTE',
      { classId: a.id, attributeId: a.attributes[0]!.id, nullable: false },
      false,
    ],
    ['UPDATE_RELATIONSHIP', { relationshipId: rel.id, sourceRoleName: 'cliente' }, false],
    ['CHANGE_MULTIPLICITY', { relationshipId: rel.id, targetMultiplicity: '0..1' }, false],
    ['DELETE_CLASS', { classId: b.id }, false],
    ['DELETE_ATTRIBUTE', { classId: a.id, attributeId: a.attributes[0]!.id }, false],
    ['DELETE_RELATIONSHIP', { relationshipId: rel.id }, false],
    ['MOVE_CLASS', { classId: a.id, position: { x: 5, y: 5 } }, false],
  ])('%s tiene clasificación %s', (type, payload, safe) => {
    const result = evaluateAiProposal(model, batch(type as string, payload));
    expect(result.applicable).toBe(true);
    expect(result.safe).toBe(safe);
  });
  it.each([undefined, 'ASSOCIATION', 'GENERALIZATION', 'COMPOSITION', 'AGGREGATION'] as const)(
    'kind %s',
    (kind) => {
      const result = evaluateAiProposal(
        { ...model, relationships: [] },
        batch('CREATE_RELATIONSHIP', {
          relationshipId: randomUUID(),
          sourceClassId: a.id,
          targetClassId: b.id,
          sourceMultiplicity: '1',
          targetMultiplicity: '1',
          ...(kind ? { kind } : {}),
        }),
      );
      expect(result.safe).toBe(kind === undefined || kind === 'ASSOCIATION');
    },
  );
  it.each(['PROPOSE_ONLY', 'AUTO_SAFE_VOICE', 'AUTO_SAFE_ALL'] as const)(
    'entrada/política %s',
    (mode) => {
      expect(inputAllowsAutoApply('DICTATION', mode)).toBe(false);
      expect(inputAllowsAutoApply('TEXT', mode)).toBe(mode === 'AUTO_SAFE_ALL');
      expect(inputAllowsAutoApply('VOICE_COMMAND', mode)).toBe(mode !== 'PROPOSE_ONLY');
    },
  );
  it('lote mixto con un solo DELETE requiere confirmación completa', () => {
    const value = batch('CREATE_CLASS', { classId: randomUUID(), displayName: 'Factura' });
    value.commands.push(
      command('DELETE_ATTRIBUTE', { classId: a.id, attributeId: a.attributes[0]!.id }),
    );
    expect(evaluateAiProposal(model, value)).toMatchObject({ applicable: true, safe: false });
  });
  it('N:M es ERROR nuevo aunque el aplicador permita dibujarlo; errores previos no bloquean una creación segura', () => {
    const invalid: SemanticModel = {
      ...model,
      relationships: [{ ...rel, sourceMultiplicity: '0..*' }],
    };
    const value = batch('CREATE_RELATIONSHIP', {
      relationshipId: randomUUID(),
      sourceClassId: a.id,
      targetClassId: b.id,
      sourceMultiplicity: '0..*',
      targetMultiplicity: '0..*',
    });
    const result = evaluateAiProposal({ ...model, relationships: [] }, value);
    expect(result).toMatchObject({ applicable: true, safe: false });
    expect(result.newErrors.map((i) => i.code)).toContain('MANY_TO_MANY_RELATIONSHIP');
    expect(
      evaluateAiProposal(
        invalid,
        batch('CREATE_CLASS', { classId: randomUUID(), displayName: 'Factura' }),
      ).safe,
    ).toBe(true);
  });
  it('rechazo de precondición no se confunde con advertencia ni se autoejecuta', () => {
    expect(
      evaluateAiProposal(model, batch('CREATE_CLASS', { classId: a.id, displayName: 'Repetida' })),
    ).toMatchObject({ applicable: false, safe: false });
  });
  it('todos los WARNING actuales se presentan sin bloquear una operación segura', () => {
    const parent = cls('Persona', 'id'),
      child = cls('Empleado'),
      normalized = cls('Número de teléfono'),
      reserved = cls('Order'),
      isolated = cls('Aislada');
    const before: SemanticModel = {
      classes: [parent, child, normalized, reserved, isolated],
      relationships: [
        {
          id: randomUUID(),
          sourceClassId: child.id,
          targetClassId: parent.id,
          kind: 'GENERALIZATION',
          sourceMultiplicity: '1',
          targetMultiplicity: '1',
        },
      ],
    };
    const result = evaluateAiProposal(
      before,
      batch('CREATE_CLASS', { classId: randomUUID(), displayName: 'Factura' }),
    );
    expect(new Set(result.warnings.map((i) => i.code))).toEqual(new Set(WARNING_CODES));
    expect(validateModel(before).filter((i) => i.severity === 'ERROR')).toHaveLength(0);
    expect(result.safe).toBe(true);
  });
});
