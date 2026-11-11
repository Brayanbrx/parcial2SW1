import type {
  Command,
  CommandBatch,
  CommandOf,
  UmlAttribute,
  UmlOperation,
  Visibility,
  Multiplicity,
  Position,
  RelationshipKind,
  Size,
} from '@uml/contracts';

/**
 * Fabrica de lotes desde la interfaz grafica.
 *
 * Todo lo que hace el usuario en el lienzo pasa por aqui y sale como comandos
 * del vocabulario cerrado. La interfaz no escribe el documento directamente:
 * es un adaptador mas, exactamente igual que el asistente o la importacion
 * (RA-01).
 */

export type CommandBody = Pick<Command, 'type' | 'payload'>;

export function newId(): string {
  return crypto.randomUUID();
}

export function makeBatch(actorId: string, ...commands: readonly CommandBody[]): CommandBatch {
  const issuedAt = new Date().toISOString();

  return {
    batchId: newId(),
    origin: 'GUI',
    actorId,
    issuedAt,
    commands: commands.map(
      (body) => ({ ...body, commandId: newId(), origin: 'GUI', actorId, issuedAt }) as Command,
    ),
  };
}

export const gui = {
  createClass: (classId: string, displayName: string, position?: Position): CommandBody => ({
    type: 'CREATE_CLASS',
    payload: { classId, displayName, ...(position === undefined ? {} : { position }) },
  }),

  renameClass: (classId: string, displayName: string): CommandBody => ({
    type: 'RENAME_CLASS',
    payload: { classId, displayName },
  }),

  updateClass: (
    classId: string,
    changes: Omit<CommandOf<'UPDATE_CLASS'>['payload'], 'classId'>,
  ): CommandBody => ({ type: 'UPDATE_CLASS', payload: { classId, ...changes } }),
  addOperation: (classId: string, operation: UmlOperation): CommandBody => ({
    type: 'ADD_OPERATION',
    payload: { classId, operation },
  }),
  updateOperation: (
    classId: string,
    operationId: string,
    changes: CommandOf<'UPDATE_OPERATION'>['payload']['changes'],
    autoParameterId?: string,
  ): CommandBody => ({
    type: 'UPDATE_OPERATION',
    payload: { classId, operationId, changes, ...(autoParameterId ? { autoParameterId } : {}) },
  }),
  deleteOperation: (classId: string, operationId: string): CommandBody => ({
    type: 'DELETE_OPERATION',
    payload: { classId, operationId },
  }),

  deleteClass: (classId: string): CommandBody => ({ type: 'DELETE_CLASS', payload: { classId } }),

  /**
   * Coloca una clase, y opcionalmente le fija el tamano.
   *
   * Sin `size` el tamano que hubiera se conserva: arrastrar no puede deshacer
   * un ajuste manual de ancho.
   */
  moveClass: (classId: string, position: Position, size?: Size): CommandBody => ({
    type: 'MOVE_CLASS',
    payload: { classId, position, ...(size === undefined ? {} : { size }) },
  }),

  addAttribute: (
    classId: string,
    attributeId: string,
    displayName: string,
    type: string,
    visibility?: Visibility,
  ): CommandBody => ({
    type: 'ADD_ATTRIBUTE',
    payload: {
      classId,
      attributeId,
      displayName,
      type,
      ...(visibility === undefined ? {} : { visibility }),
    },
  }),

  updateAttribute: (
    classId: string,
    attributeId: string,
    cambios: Partial<Omit<UmlAttribute, 'id' | 'codeName' | 'databaseName'>>,
  ): CommandBody => ({
    type: 'UPDATE_ATTRIBUTE',
    payload: { classId, attributeId, ...cambios },
  }),

  deleteAttribute: (classId: string, attributeId: string): CommandBody => ({
    type: 'DELETE_ATTRIBUTE',
    payload: { classId, attributeId },
  }),

  createRelationship: (
    relationshipId: string,
    sourceClassId: string,
    targetClassId: string,
    kind: RelationshipKind = 'ASSOCIATION',
    sourceMultiplicity?: Multiplicity,
    targetMultiplicity?: Multiplicity,
  ): CommandBody => {
    const defaults = ['GENERALIZATION', 'DEPENDENCY', 'REALIZATION'].includes(kind)
      ? ({ source: '1', target: '1' } as const)
      : ({ source: '1', target: '0..*' } as const);

    return {
      type: 'CREATE_RELATIONSHIP',
      payload: {
        relationshipId,
        kind,
        sourceClassId,
        targetClassId,
        sourceMultiplicity: sourceMultiplicity ?? defaults.source,
        targetMultiplicity: targetMultiplicity ?? defaults.target,
      },
    };
  },

  updateRelationship: (
    relationshipId: string,
    changes: Omit<CommandOf<'UPDATE_RELATIONSHIP'>['payload'], 'relationshipId'>,
  ): CommandBody => ({
    type: 'UPDATE_RELATIONSHIP',
    payload: { relationshipId, ...changes },
  }),

  changeMultiplicity: (
    relationshipId: string,
    sourceMultiplicity?: Multiplicity,
    targetMultiplicity?: Multiplicity,
  ): CommandBody => ({
    type: 'CHANGE_MULTIPLICITY',
    payload: {
      relationshipId,
      ...(sourceMultiplicity === undefined ? {} : { sourceMultiplicity }),
      ...(targetMultiplicity === undefined ? {} : { targetMultiplicity }),
    },
  }),

  deleteRelationship: (relationshipId: string): CommandBody => ({
    type: 'DELETE_RELATIONSHIP',
    payload: { relationshipId },
  }),
};
