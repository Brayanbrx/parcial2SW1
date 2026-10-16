import {
  emptyBoardState,
  type BoardState,
  type Command,
  type CommandBatch,
  type ConceptualType,
  type Multiplicity,
  type RelationshipKind,
} from '@uml/contracts';

/**
 * Constructores minimos para las pruebas del nucleo.
 *
 * No cargan fixtures ni tocan disco: RNF-15 exige que este paquete se pruebe sin
 * sistema de archivos.
 */

export const ACTOR = '11111111-1111-4111-8111-111111111111';

let secuencia = 0;
export function nextId(): string {
  secuencia += 1;
  return `22222222-2222-4222-8222-${String(secuencia).padStart(12, '0')}`;
}

type CommandBody = Pick<Command, 'type' | 'payload'>;

export function batch(...commands: readonly CommandBody[]): CommandBatch {
  const issuedAt = new Date('2026-09-01T12:00:00.000Z').toISOString();

  return {
    batchId: nextId(),
    origin: 'GUI',
    actorId: ACTOR,
    issuedAt,
    commands: commands.map(
      (body) =>
        ({
          ...body,
          commandId: nextId(),
          origin: 'GUI',
          actorId: ACTOR,
          issuedAt,
        }) as Command,
    ),
  };
}

export const cmd = {
  createClass: (classId: string, displayName: string): CommandBody => ({
    type: 'CREATE_CLASS',
    payload: { classId, displayName },
  }),

  renameClass: (classId: string, displayName: string): CommandBody => ({
    type: 'RENAME_CLASS',
    payload: { classId, displayName },
  }),

  deleteClass: (classId: string): CommandBody => ({
    type: 'DELETE_CLASS',
    payload: { classId },
  }),

  moveClass: (
    classId: string,
    x: number,
    y: number,
    size?: { width: number; height: number },
  ): CommandBody => ({
    type: 'MOVE_CLASS',
    payload: { classId, position: { x, y }, ...(size === undefined ? {} : { size }) },
  }),

  addAttribute: (
    classId: string,
    attributeId: string,
    displayName: string,
    type: ConceptualType = 'String',
    extra: { primaryKey?: boolean; nullable?: boolean; unique?: boolean } = {},
  ): CommandBody => ({
    type: 'ADD_ATTRIBUTE',
    payload: { classId, attributeId, displayName, type, ...extra },
  }),

  deleteAttribute: (classId: string, attributeId: string): CommandBody => ({
    type: 'DELETE_ATTRIBUTE',
    payload: { classId, attributeId },
  }),

  createRelationship: (
    relationshipId: string,
    sourceClassId: string,
    targetClassId: string,
    sourceMultiplicity: Multiplicity = '1',
    targetMultiplicity: Multiplicity = '0..*',
    kind?: RelationshipKind,
  ): CommandBody => ({
    type: 'CREATE_RELATIONSHIP',
    payload: {
      relationshipId,
      ...(kind === undefined ? {} : { kind }),
      sourceClassId,
      targetClassId,
      sourceMultiplicity,
      targetMultiplicity,
    },
  }),

  updateRelationshipKind: (relationshipId: string, kind: RelationshipKind): CommandBody => ({
    type: 'UPDATE_RELATIONSHIP',
    payload: { relationshipId, kind },
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

export function emptyBoard(): BoardState {
  return emptyBoardState();
}
