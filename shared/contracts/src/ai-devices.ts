import { z } from 'zod';
import { idSchema } from './model.js';

export const personalAiChoiceSchema = z
  .object({
    source: z.enum(['PROJECT', 'PROVIDERS', 'DEVICE', 'VM']),
    deviceId: idSchema.nullable().default(null),
    model: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()
  .superRefine((choice, ctx) => {
    if ((choice.source === 'DEVICE') !== (choice.deviceId !== null))
      ctx.addIssue({ code: 'custom', path: ['deviceId'], message: 'Elige tu dispositivo.' });
    if (['DEVICE', 'VM'].includes(choice.source) !== (choice.model !== null))
      ctx.addIssue({ code: 'custom', path: ['model'], message: 'Elige un modelo conectado.' });
  });
export type PersonalAiChoice = z.infer<typeof personalAiChoiceSchema>;

/** Decisión congelada al aceptar el trabajo; jamás contiene credenciales. */
export const aiExecutionTargetSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('PROVIDERS') }).strict(),
  z.object({ source: z.literal('LOCAL') }).strict(),
  z.object({ source: z.literal('VM'), model: z.string().min(1).max(200) }).strict(),
  z
    .object({ source: z.literal('DEVICE'), deviceId: idSchema, model: z.string().min(1).max(200) })
    .strict(),
]);
export type AiExecutionTarget = z.infer<typeof aiExecutionTargetSchema>;

export const connectorModelSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    contextWindow: z.number().int().min(4096).max(131072),
  })
  .strict();
export const connectorHelloSchema = z
  .object({
    type: z.literal('hello'),
    version: z.literal(1),
    kind: z.enum(['DEVICE', 'VM']),
    token: z.string().min(32).max(256),
    models: z.array(connectorModelSchema).min(1).max(20),
    maxConcurrency: z.number().int().min(1).max(4).default(1),
  })
  .strict();
export const connectorResultSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('result'), id: idSchema, text: z.string().min(1).max(500000) })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      id: idSchema,
      code: z.enum(['busy', 'unavailable', 'invalid_response']),
    })
    .strict(),
]);
export const connectorTaskSchema = z
  .object({
    type: z.literal('task'),
    id: idSchema,
    model: z.string().min(1).max(200),
    system: z.string().min(1).max(100000),
    prompt: z.string().min(1).max(1000000),
    json: z.boolean(),
    timeoutMs: z.number().int().min(1000).max(300000),
  })
  .strict();
export type ConnectorTask = z.infer<typeof connectorTaskSchema>;

const connectedEngineSchema = z.object({
  connected: z.boolean(),
  models: z.array(connectorModelSchema),
  active: z.number().int().nonnegative(),
});
export const personalAiStateSchema = z.object({
  choice: personalAiChoiceSchema,
  vm: connectedEngineSchema.extend({ allowed: z.boolean() }),
  devices: z.array(
    connectedEngineSchema.extend({
      id: idSchema,
      name: z.string(),
      expiresAt: z.string().datetime(),
    }),
  ),
});
export type PersonalAiState = z.infer<typeof personalAiStateSchema>;
