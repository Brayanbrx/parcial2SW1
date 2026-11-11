/**
 * Vocabulario cerrado de la plataforma.
 *
 * Todo lo que esta aqui es una lista finita y deliberada. Ampliarla es una
 * decision de alcance, no un detalle de implementacion.
 */

/** RA-09: todo modelo persistido declara la version de su esquema. */
export const SCHEMA_VERSION = '1.1.0' as const;

/** Vocabulario cerrado de comandos (plan maestro 4.7). RA-06: nunca mutacion arbitraria. */
export const COMMAND_TYPES = [
  'CREATE_CLASS',
  'RENAME_CLASS',
  'UPDATE_CLASS',
  'ADD_OPERATION',
  'UPDATE_OPERATION',
  'DELETE_OPERATION',
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
export type Multiplicity = string;

export const VISIBILITIES = ['public', 'private', 'protected', 'package'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_SYMBOLS: Readonly<Record<Visibility, string>> = {
  public: '+',
  private: '-',
  protected: '#',
  package: '~',
};
export const CLASSIFIER_KINDS = ['CLASS', 'INTERFACE', 'ENUMERATION', 'DATA_TYPE'] as const;
export type ClassifierKind = (typeof CLASSIFIER_KINDS)[number];

/** UML 7.5: a nonnegative integer or an ordered lower..upper range. */
export function multiplicityBounds(value: string): { lower: number; upper: number } | null {
  if (value === '*') return { lower: 0, upper: Infinity };
  if (!/^(0|[1-9]\d*)(?:\.\.(?:0|[1-9]\d*|\*))?$/.test(value)) return null;
  const [lowerText, upperText] = value.split('..');
  const lower = Number(lowerText);
  const upper = upperText === '*' ? Infinity : Number(upperText ?? lowerText);
  return Number.isSafeInteger(lower) &&
    (upper === Infinity || Number.isSafeInteger(upper)) &&
    lower <= upper
    ? { lower, upper }
    : null;
}

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
  'DEPENDENCY',
  'REALIZATION',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** Multiplicidades que representan «muchos». Usarlas para detectar N:M (RM-01). */
export const COLLECTION_MULTIPLICITIES = [
  '0..*',
  '1..*',
] as const satisfies readonly Multiplicity[];

export function isCollectionMultiplicity(multiplicity: Multiplicity): boolean {
  return (multiplicityBounds(multiplicity)?.upper ?? 0) > 1;
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
export const UML_PRIMITIVE_TYPES: readonly string[] = [
  ...CONCEPTUAL_TYPES,
  'Real',
  'UnlimitedNatural',
];

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
