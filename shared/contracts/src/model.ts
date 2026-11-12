import { z } from 'zod';
import {
  BOARD_TYPES,
  CLASSIFIER_KINDS,
  VISIBILITIES,
  multiplicityBounds,
  PROJECT_ROLES,
  RELATIONSHIP_KINDS,
  SCHEMA_VERSION,
} from './vocabulary.js';

/**
 * Modelo canonico (plan maestro 4.6).
 *
 * Lo que este modelo NO contiene, a proposito: `mappedBy`, lado propietario,
 * columnas de union, `cascade` ni `fetch`. Son decisiones de persistencia y
 * viven en la representacion intermedia (RA-13).
 */

/** RA-04: identidad interna independiente del nombre. Renombrar no rompe relaciones. */
export const idSchema = z.string().uuid();

export const multiplicitySchema = z
  .string()
  .refine(
    (value) => multiplicityBounds(value) !== null,
    'Usa un entero o un rango UML válido, como 0..1, 2..5 o 1..*.',
  );
export const umlTypeSchema = z.string().trim().min(1).max(200);
export const memberPropertiesSchema = z.object({
  visibility: z.enum(VISIBILITIES).optional(),
  isStatic: z.boolean().optional(),
  multiplicity: multiplicitySchema.optional(),
  defaultValue: z.string().max(2000).optional(),
  isDerived: z.boolean().optional(),
  isReadOnly: z.boolean().optional(),
});
export const parameterSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1),
  type: umlTypeSchema,
  direction: z.enum(['in', 'out', 'inout']).default('in'),
  multiplicity: multiplicitySchema.optional(),
  defaultValue: z.string().optional(),
});
export type UmlParameter = z.infer<typeof parameterSchema>;
export const operationSchema = z.object({
  id: idSchema,
  displayName: z.string().trim().min(1),
  visibility: z.enum(VISIBILITIES).default('public'),
  isStatic: z.boolean().default(false),
  isAbstract: z.boolean().default(false),
  parameters: z.array(parameterSchema).default([]),
  returnType: umlTypeSchema.optional(),
  returnMultiplicity: multiplicitySchema.optional(),
});
export type UmlOperation = z.infer<typeof operationSchema>;
export const classifierPropertiesSchema = z.object({
  kind: z.enum(CLASSIFIER_KINDS).optional(),
  isAbstract: z.boolean().optional(),
  literals: z.array(z.string().trim().min(1)).optional(),
});

/**
 * RTM-02: tres nombres por elemento.
 *
 * `displayName` es lo que escribe el usuario. Los otros dos los deriva el
 * normalizador de `@uml/domain-core`; nunca se escriben a mano.
 */
export const attributeSchema = memberPropertiesSchema.extend({
  id: idSchema,
  displayName: z.string().min(1),
  codeName: z.string().min(1),
  databaseName: z.string().min(1),
  type: umlTypeSchema,
  primaryKey: z.boolean().default(false),
  nullable: z.boolean().default(true),
  unique: z.boolean().default(false),
});
export type UmlAttribute = z.infer<typeof attributeSchema>;

export const classSchema = classifierPropertiesSchema.extend({
  id: idSchema,
  displayName: z.string().min(1),
  codeName: z.string().min(1),
  databaseName: z.string().min(1),
  attributes: z.array(attributeSchema).default([]),
  operations: z.array(operationSchema).optional(),
});
export type UmlClass = z.infer<typeof classSchema>;

/**
 * RM-02: relaciones directas solo entre dos clases. Tres o mas participantes se
 * modelan como entidad.
 */
export const relationshipSchema = z.object({
  id: idSchema,
  /** Ausente en documentos 1.0 antiguos significa asociacion. */
  kind: z.enum(RELATIONSHIP_KINDS).optional(),
  sourceClassId: idSchema,
  targetClassId: idSchema,
  /** Tarjeta que representa la parte de clase de esta asociación binaria. */
  associationClassId: idSchema.optional(),
  sourceMultiplicity: multiplicitySchema,
  targetMultiplicity: multiplicitySchema,
  name: z.string().optional(),
  sourceNavigability: z.enum(['unspecified', 'navigable', 'nonNavigable']).optional(),
  targetNavigability: z.enum(['unspecified', 'navigable', 'nonNavigable']).optional(),
  sourceRoleName: z.string().min(1).optional(),
  targetRoleName: z.string().min(1).optional(),
});
export type UmlRelationship = z.infer<typeof relationshipSchema>;

export const semanticModelSchema = z.object({
  classes: z.array(classSchema).default([]),
  relationships: z.array(relationshipSchema).default([]),
});
export type SemanticModel = z.infer<typeof semanticModelSchema>;

/** Posicion y viewport. Sin valor semantico: no entra en el snapshot de generacion. */
export const positionSchema = z.object({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof positionSchema>;

/**
 * Tamano de una tarjeta en el lienzo.
 *
 * Como la posicion, es disposicion pura: no entra en el snapshot que congela la
 * generacion —ese se construye con el modelo semantico— asi que redimensionar
 * una clase no puede cambiar una linea del codigo generado ni del XMI.
 *
 * Los minimos evitan el unico estropicio posible: encoger una tarjeta hasta que
 * no se lea su nombre y perderla de vista en el diagrama.
 */
export const MIN_CLASS_WIDTH = 180;
export const MIN_CLASS_HEIGHT = 80;

export const sizeSchema = z.object({
  width: z.number().min(MIN_CLASS_WIDTH),
  height: z.number().min(MIN_CLASS_HEIGHT),
});
export type Size = z.infer<typeof sizeSchema>;

export const layoutSchema = z.object({
  positions: z.record(idSchema, positionSchema).default({}),
  /**
   * Tamanos elegidos a mano, por clase.
   *
   * Solo estan los que alguien ajusto. Una clase sin entrada aqui se dibuja con
   * el alto que le corresponde por su numero de atributos, que es como se
   * comportaba todo antes de que esto existiera.
   */
  sizes: z.record(idSchema, sizeSchema).default({}),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
});
export type Layout = z.infer<typeof layoutSchema>;

/**
 * Estado completo de una pizarra: lo semantico mas lo visual.
 *
 * El aplicador de comandos recibe y devuelve esta pareja, porque `MOVE_CLASS`
 * toca layout y `CREATE_CLASS` toca ambos.
 */
export const boardStateSchema = z.object({
  schemaVersion: z.string().default(SCHEMA_VERSION),
  semantic: semanticModelSchema,
  layout: layoutSchema,
});
export type BoardState = z.infer<typeof boardStateSchema>;

export function emptyBoardState(): BoardState {
  return {
    schemaVersion: SCHEMA_VERSION,
    semantic: { classes: [], relationships: [] },
    layout: { positions: {}, sizes: {} },
  };
}

/** Metadatos de la pizarra. El estado vivo viaja aparte, en `BoardState`. */
export const boardSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  displayName: z.string().min(1),
  type: z.enum(BOARD_TYPES).default('CLASS_DIAGRAM'),
});
export type Board = z.infer<typeof boardSchema>;

export const projectSchema = z.object({
  id: idSchema,
  displayName: z.string().min(1),
  ownerId: idSchema,
  schemaVersion: z.string().default(SCHEMA_VERSION),
});
export type Project = z.infer<typeof projectSchema>;

export const projectRoleSchema = z.enum(PROJECT_ROLES);
