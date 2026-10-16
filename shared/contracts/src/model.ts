import { z } from 'zod';
import {
  BOARD_TYPES,
  CONCEPTUAL_TYPES,
  MULTIPLICITIES,
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

/**
 * RTM-02: tres nombres por elemento.
 *
 * `displayName` es lo que escribe el usuario. Los otros dos los deriva el
 * normalizador de `@uml/domain-core`; nunca se escriben a mano.
 */
export const attributeSchema = z.object({
  id: idSchema,
  displayName: z.string().min(1),
  codeName: z.string().min(1),
  databaseName: z.string().min(1),
  type: z.enum(CONCEPTUAL_TYPES),
  primaryKey: z.boolean().default(false),
  nullable: z.boolean().default(true),
  unique: z.boolean().default(false),
});
export type UmlAttribute = z.infer<typeof attributeSchema>;

export const classSchema = z.object({
  id: idSchema,
  displayName: z.string().min(1),
  codeName: z.string().min(1),
  databaseName: z.string().min(1),
  attributes: z.array(attributeSchema).default([]),
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
  sourceMultiplicity: z.enum(MULTIPLICITIES),
  targetMultiplicity: z.enum(MULTIPLICITIES),
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
