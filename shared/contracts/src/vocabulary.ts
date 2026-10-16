/**
 * Vocabulario cerrado de la plataforma.
 *
 * Todo lo que esta aqui es una lista finita y deliberada. Ampliarla es una
 * decision de alcance, no un detalle de implementacion.
 */

/** RA-09: todo modelo persistido declara la version de su esquema. */
export const SCHEMA_VERSION = '1.0.0' as const;

/** Vocabulario cerrado de comandos (plan maestro 4.7). RA-06: nunca mutacion arbitraria. */
export const COMMAND_TYPES = [
  'CREATE_CLASS',
  'RENAME_CLASS',
  'DELETE_CLASS',
  'MOVE_CLASS',
  'ADD_ATTRIBUTE',
  'UPDATE_ATTRIBUTE',
  'DELETE_ATTRIBUTE',
  'CREATE_RELATIONSHIP',
  'UPDATE_RELATIONSHIP',
  'DELETE_RELATIONSHIP',
  'CHANGE_MULTIPLICITY',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

/** Origen de un lote de comandos (plan maestro 4.7). */
export const BATCH_ORIGINS = ['GUI', 'AI_TEXT', 'AI_VOICE', 'IMAGE', 'XMI'] as const;
export type BatchOrigin = (typeof BATCH_ORIGINS)[number];

/** RM-04: multiplicidades soportadas. */
export const MULTIPLICITIES = ['1', '0..1', '0..*', '1..*'] as const;
export type Multiplicity = (typeof MULTIPLICITIES)[number];

/**
 * Relaciones UML que expone el editor simplificado.
 *
 * Las cuatro forman parte del mismo modelo relacional para la generacion. La
 * diferencia se conserva porque es informacion de diseno y porque cada una se
 * dibuja con su notacion UML propia.
 */
export const RELATIONSHIP_KINDS = [
  'ASSOCIATION',
  'GENERALIZATION',
  'COMPOSITION',
  'AGGREGATION',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** Multiplicidades que representan «muchos». Usarlas para detectar N:M (RM-01). */
export const COLLECTION_MULTIPLICITIES = [
  '0..*',
  '1..*',
] as const satisfies readonly Multiplicity[];

export function isCollectionMultiplicity(multiplicity: Multiplicity): boolean {
  return (COLLECTION_MULTIPLICITIES as readonly Multiplicity[]).includes(multiplicity);
}

/** RTM-01: tipos conceptuales soportados. */
export const CONCEPTUAL_TYPES = [
  'String',
  'Integer',
  'Long',
  'Decimal',
  'Boolean',
  'Date',
  'DateTime',
  'UUID',
] as const;
export type ConceptualType = (typeof CONCEPTUAL_TYPES)[number];

/** Roles por proyecto (plan maestro 5.5). */
export const PROJECT_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Solo OWNER y EDITOR escriben. VIEWER consulta y usa el asistente sin modificar. */
export function roleCanWrite(role: ProjectRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

/** Tipos de pizarra. Hoy solo hay uno; existe para no tener que migrar despues. */
export const BOARD_TYPES = ['CLASS_DIAGRAM'] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

/** Nombre de la sala de colaboracion de una pizarra (plan maestro 4.6). */
export function collaborationRoomName(projectId: string, boardId: string): string {
  return `project:${projectId}:board:${boardId}`;
}
