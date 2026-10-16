import type { Command, CommandBatch, Multiplicity } from '@uml/contracts';

/** Constructores de comandos para las pruebas del proceso de colaboracion. */

let secuencia = 0;
export function nextId(): string {
  secuencia += 1;
  return `66666666-6666-4666-8666-${String(secuencia).padStart(12, '0')}`;
}

const ACTOR = '77777777-7777-4777-8777-777777777777';

type CommandBody = Pick<Command, 'type' | 'payload'>;

export function batch(...commands: readonly CommandBody[]): CommandBatch {
  const issuedAt = new Date().toISOString();
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

export const cmd = {
  createClass: (classId: string, displayName: string): CommandBody => ({
    type: 'CREATE_CLASS',
    payload: { classId, displayName, position: { x: 0, y: 0 } },
  }),
  moveClass: (classId: string, x: number, y: number): CommandBody => ({
    type: 'MOVE_CLASS',
    payload: { classId, position: { x, y } },
  }),
  addAttribute: (classId: string, attributeId: string, displayName: string): CommandBody => ({
    type: 'ADD_ATTRIBUTE',
    payload: { classId, attributeId, displayName, type: 'String' },
  }),
  createRelationship: (
    relationshipId: string,
    sourceClassId: string,
    targetClassId: string,
  ): CommandBody => ({
    type: 'CREATE_RELATIONSHIP',
    payload: {
      relationshipId,
      sourceClassId,
      targetClassId,
      sourceMultiplicity: '1',
      targetMultiplicity: '0..*',
    },
  }),
  changeMultiplicity: (
    relationshipId: string,
    sourceMultiplicity: Multiplicity,
    targetMultiplicity: Multiplicity,
  ): CommandBody => ({
    type: 'CHANGE_MULTIPLICITY',
    payload: { relationshipId, sourceMultiplicity, targetMultiplicity },
  }),
};
