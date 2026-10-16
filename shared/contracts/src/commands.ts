import { z } from 'zod';
import {
  BATCH_ORIGINS,
  CONCEPTUAL_TYPES,
  MULTIPLICITIES,
  RELATIONSHIP_KINDS,
} from './vocabulary.js';
import { idSchema, positionSchema, sizeSchema } from './model.js';

/**
 * Comandos y lotes (plan maestro 4.7).
 *
 * Este archivo es el que se convierte en esquema JSON y se le entrega al modelo
 * de lenguaje como formato de salida obligatorio. Por eso el vocabulario es
 * cerrado y los payloads son planos: un modelo produce mejor una estructura
 * predecible que una anidada.
 *
 * El modelo nunca resuelve identificadores. Devuelve nombres cuando hace falta y
 * el resolver los busca; los comandos ya llevan identificadores resueltos.
 */

const createClass = z.object({
  type: z.literal('CREATE_CLASS'),
  payload: z.object({
    classId: idSchema,
    displayName: z.string().min(1),
    position: positionSchema.optional(),
  }),
});

const renameClass = z.object({
  type: z.literal('RENAME_CLASS'),
  payload: z.object({
    classId: idSchema,
    displayName: z.string().min(1),
  }),
});

const deleteClass = z.object({
  type: z.literal('DELETE_CLASS'),
  payload: z.object({ classId: idSchema }),
});

/**
 * Toca unicamente el layout: no tiene valor semantico.
 *
 * Lleva tambien el tamano, opcional, porque redimensionar una tarjeta es
 * colocarla: no cambia el modelo, no puede invalidarlo y no llega al codigo
 * generado. Anadirlo aqui mantiene cerrado el vocabulario de once comandos
 * (RA-06) en lugar de abrir un duodecimo para una variante de lo mismo.
 *
 * Opcional a proposito: arrastrar emite `MOVE_CLASS` sin tamano, y en ese caso
 * el que hubiera se conserva. Ademas, todos los lotes anteriores a este cambio
 * siguen validando.
 */
const moveClass = z.object({
  type: z.literal('MOVE_CLASS'),
  payload: z.object({
    classId: idSchema,
    position: positionSchema,
    size: sizeSchema.optional(),
  }),
});

const addAttribute = z.object({
  type: z.literal('ADD_ATTRIBUTE'),
  payload: z.object({
    classId: idSchema,
    attributeId: idSchema,
    displayName: z.string().min(1),
    type: z.enum(CONCEPTUAL_TYPES),
    primaryKey: z.boolean().optional(),
    nullable: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
});

const updateAttribute = z.object({
  type: z.literal('UPDATE_ATTRIBUTE'),
  payload: z.object({
    classId: idSchema,
    attributeId: idSchema,
    displayName: z.string().min(1).optional(),
    type: z.enum(CONCEPTUAL_TYPES).optional(),
    primaryKey: z.boolean().optional(),
    nullable: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
});

const deleteAttribute = z.object({
  type: z.literal('DELETE_ATTRIBUTE'),
  payload: z.object({
    classId: idSchema,
    attributeId: idSchema,
  }),
});

const createRelationship = z.object({
  type: z.literal('CREATE_RELATIONSHIP'),
  payload: z.object({
    relationshipId: idSchema,
    kind: z.enum(RELATIONSHIP_KINDS).optional(),
    sourceClassId: idSchema,
    targetClassId: idSchema,
    sourceMultiplicity: z.enum(MULTIPLICITIES),
    targetMultiplicity: z.enum(MULTIPLICITIES),
    sourceRoleName: z.string().min(1).optional(),
    targetRoleName: z.string().min(1).optional(),
  }),
});

/** Cambia la clase UML de la relacion o sus roles. La multiplicidad tiene su propio comando. */
const updateRelationship = z.object({
  type: z.literal('UPDATE_RELATIONSHIP'),
  payload: z.object({
    relationshipId: idSchema,
    kind: z.enum(RELATIONSHIP_KINDS).optional(),
    sourceRoleName: z.string().min(1).nullable().optional(),
    targetRoleName: z.string().min(1).nullable().optional(),
  }),
});

const deleteRelationship = z.object({
  type: z.literal('DELETE_RELATIONSHIP'),
  payload: z.object({ relationshipId: idSchema }),
});

const changeMultiplicity = z.object({
  type: z.literal('CHANGE_MULTIPLICITY'),
  payload: z.object({
    relationshipId: idSchema,
    sourceMultiplicity: z.enum(MULTIPLICITIES).optional(),
    targetMultiplicity: z.enum(MULTIPLICITIES).optional(),
  }),
});

/** Lo que todo comando lleva ademas de su tipo y su carga. */
const commandEnvelope = z.object({
  commandId: idSchema,
  origin: z.enum(BATCH_ORIGINS),
  actorId: idSchema,
  issuedAt: z.string().datetime(),
});

export const commandSchema = z.discriminatedUnion('type', [
  createClass.merge(commandEnvelope),
  renameClass.merge(commandEnvelope),
  deleteClass.merge(commandEnvelope),
  moveClass.merge(commandEnvelope),
  addAttribute.merge(commandEnvelope),
  updateAttribute.merge(commandEnvelope),
  deleteAttribute.merge(commandEnvelope),
  createRelationship.merge(commandEnvelope),
  updateRelationship.merge(commandEnvelope),
  deleteRelationship.merge(commandEnvelope),
  changeMultiplicity.merge(commandEnvelope),
]);
export type Command = z.infer<typeof commandSchema>;

/** Un comando de un tipo concreto, para que el aplicador no necesite aserciones. */
export type CommandOf<T extends Command['type']> = Extract<Command, { type: T }>;

/**
 * RA-03: el lote es la unidad transaccional. Todo o nada.
 *
 * Un lote vacio se rechaza en lugar de tratarse como exito silencioso: quien lo
 * emitio creia estar cambiando algo.
 */
export const commandBatchSchema = z.object({
  batchId: idSchema,
  origin: z.enum(BATCH_ORIGINS),
  actorId: idSchema,
  issuedAt: z.string().datetime(),
  commands: z.array(commandSchema).min(1),
});
export type CommandBatch = z.infer<typeof commandBatchSchema>;

/**
 * Lo que propone la capa de IA antes de resolverse a un lote.
 *
 * Se separa de `CommandBatch` porque una propuesta puede llegar incompleta o
 * ambigua, y el resolver estructural tiene que poder devolver una pregunta en
 * lugar de un lote (plan maestro 6.6).
 */
export const batchProposalSchema = z.object({
  commands: z.array(commandSchema).min(1),
  rationale: z.string().optional(),
});
export type BatchProposal = z.infer<typeof batchProposalSchema>;
