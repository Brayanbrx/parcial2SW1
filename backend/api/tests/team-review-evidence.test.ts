import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { commandSchema, emptyBoardState, type Command, type SemanticModel } from '@uml/contracts';
import { applyBatch, validateModel } from '@uml/domain-core';
import {
  hasBatchEvidence,
  reviewIssueKey,
  reviewText,
  touchedElements,
} from '../src/modules/team-ai/review-evidence.js';

const actorId = randomUUID(),
  a = randomUUID(),
  b = randomUUID(),
  attributeId = randomUUID(),
  relationshipId = randomUUID();
const command = (type: string, payload: unknown) =>
  commandSchema.parse({
    commandId: randomUUID(),
    origin: 'GUI',
    actorId,
    issuedAt: new Date().toISOString(),
    type,
    payload,
  });
const create = [
  command('CREATE_CLASS', { classId: a, displayName: 'Cliente' }),
  command('CREATE_CLASS', { classId: b, displayName: 'Venta' }),
  command('ADD_ATTRIBUTE', { classId: a, attributeId, displayName: 'nombre', type: 'String' }),
  command('CREATE_RELATIONSHIP', {
    relationshipId,
    sourceClassId: a,
    targetClassId: b,
    sourceMultiplicity: '1',
    targetMultiplicity: '0..*',
    sourceRoleName: 'comprador',
  }),
];
function apply(commands: Command[], model: SemanticModel = { classes: [], relationships: [] }) {
  const result = applyBatch(
    { ...emptyBoardState(), semantic: model },
    {
      batchId: randomUUID(),
      origin: 'GUI',
      actorId,
      issuedAt: new Date().toISOString(),
      commands,
    },
  );
  if (!result.applied) throw new Error(JSON.stringify(result.issues));
  return result.state.semantic;
}
const base = apply(create);

describe('prueba de contenido del moderador', () => {
  it('creaciones exigen nombres, flags, extremos y multiplicidades, no solo IDs', () => {
    expect(hasBatchEvidence(base, create)).toBe(true);
    for (const mutate of [
      (m: SemanticModel) => {
        m.classes[0]!.displayName = 'Otro';
      },
      (m: SemanticModel) => {
        m.classes[0]!.attributes[0]!.nullable = false;
      },
      (m: SemanticModel) => {
        m.relationships[0]!.targetClassId = a;
      },
      (m: SemanticModel) => {
        m.relationships[0]!.sourceMultiplicity = '0..*';
      },
    ]) {
      const wrong = structuredClone(base);
      mutate(wrong);
      expect(hasBatchEvidence(wrong, create)).toBe(false);
    }
  });
  it.each([
    ['RENAME_CLASS', { classId: a, displayName: 'Comprador' }],
    [
      'UPDATE_ATTRIBUTE',
      {
        classId: a,
        attributeId,
        displayName: 'titulo',
        type: 'Integer',
        nullable: false,
        unique: true,
        primaryKey: true,
      },
    ],
    [
      'UPDATE_RELATIONSHIP',
      { relationshipId, kind: 'AGGREGATION', sourceRoleName: null, targetRoleName: 'ventas' },
    ],
    [
      'CHANGE_MULTIPLICITY',
      { relationshipId, sourceMultiplicity: '0..*', targetMultiplicity: '1' },
    ],
    ['DELETE_CLASS', { classId: a }],
    ['DELETE_ATTRIBUTE', { classId: a, attributeId }],
    ['DELETE_RELATIONSHIP', { relationshipId }],
  ])('%s requiere los campos finales o ausencia', (type, payload) => {
    const commands = [command(type as string, payload)];
    expect(hasBatchEvidence(base, commands)).toBe(false);
    expect(hasBatchEvidence(apply(commands, base), commands)).toBe(true);
  });
  it('operaciones posteriores sustituyen campos y eliminaciones dentro del mismo lote', () => {
    const commands = [
      ...create,
      command('RENAME_CLASS', { classId: a, displayName: 'Comprador' }),
      command('UPDATE_ATTRIBUTE', { classId: a, attributeId, nullable: false }),
      command('CHANGE_MULTIPLICITY', { relationshipId, targetMultiplicity: '1' }),
      command('UPDATE_RELATIONSHIP', { relationshipId, sourceRoleName: null }),
      command('DELETE_CLASS', { classId: b }),
    ];
    expect(hasBatchEvidence(apply(commands), commands)).toBe(true);
    const removeAttribute = [...create, command('DELETE_ATTRIBUTE', { classId: a, attributeId })];
    expect(hasBatchEvidence(apply(removeAttribute), removeAttribute)).toBe(true);
  });
  it('MOVE no es evidencia semántica, ni afecta atribución; mixtos comprueban lo demás', () => {
    const move = command('MOVE_CLASS', { classId: a, position: { x: 5, y: 5 } });
    expect(hasBatchEvidence(base, [move])).toBe(false);
    expect(touchedElements([move]).size).toBe(0);
    expect(hasBatchEvidence(base, [...create, move])).toBe(true);
    expect(touchedElements([create[3]!])).toEqual(new Set([relationshipId]));
  });
  it('claves estables no dependen de redacción/orden y las plantillas respetan pistas', () => {
    const invalid = apply(
      [command('CHANGE_MULTIPLICITY', { relationshipId, sourceMultiplicity: '0..*' })],
      base,
    );
    const issue = validateModel(invalid).find((i) => i.code === 'MANY_TO_MANY_RELATIONSHIP')!;
    expect(reviewIssueKey(issue)).toBe(
      reviewIssueKey({
        ...issue,
        message: 'Otra redacción',
        elementIds: [...issue.elementIds].reverse(),
      }),
    );
    expect(reviewText([issue], false)).toContain('intermedia');
    expect(reviewText([issue], true)).toContain('Pista:');
    expect(reviewText([issue], true)).not.toContain('intermedia');
  });
});
