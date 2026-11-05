import { z } from 'zod';
import { commandBatchSchema } from './commands.js';
import { idSchema, semanticModelSchema } from './model.js';
import { roleCanWrite, type ProjectRole } from './vocabulary.js';

export const TEAM_MODES = ['ASK', 'INSTRUCT', 'REVIEW'] as const;
export const TEAM_INPUT_MODES = ['TEXT', 'DICTATION', 'VOICE_COMMAND'] as const;
export const TEAM_AUTHOR_KINDS = ['USER', 'AI', 'SYSTEM'] as const;
export const TEAM_MESSAGE_KINDS = [
  'QUESTION',
  'INSTRUCTION',
  'REVIEW_REQUEST',
  'ANSWER',
  'CLARIFICATION',
  'PROPOSAL',
  'REVIEW',
  'SYSTEM',
] as const;
export const TEAM_REQUEST_STATUSES = [
  'QUEUED',
  'PROCESSING',
  'DONE',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
] as const;
export const AI_PROPOSAL_STATUSES = [
  'READY',
  'PENDING_CONFIRMATION',
  'APPLIED',
  'STALE',
  'REJECTED',
  'EXPIRED',
] as const;
export const AI_REJECT_REASONS = ['USER', 'STALE', 'APPLY_FAILED'] as const;
export const AI_SOLUTION_MODES = ['HINTS_ONLY', 'ON_REQUEST'] as const;
export const AI_EXECUTION_MODES = ['PROPOSE_ONLY', 'AUTO_SAFE_VOICE', 'AUTO_SAFE_ALL'] as const;
export const AI_REVIEW_MODES = ['OFF', 'ON_DEMAND', 'ON_ISSUES'] as const;
export const TEAM_AI_EVENT_TYPES = [
  'team.message',
  'team.update',
  'ai.status',
  'ai.settings',
] as const;
export const MAX_TEAM_REQUEST_TEXT = 2000;
export const MAX_TEAM_AI_EVENT_BYTES = 2048;
export const AI_PROPOSAL_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_TEAM_BOARD_QUEUE_LIMIT = 20;
export const DEFAULT_TEAM_USER_QUEUE_LIMIT = 3;

export const teamModeSchema = z.enum(TEAM_MODES);
export const teamInputModeSchema = z.enum(TEAM_INPUT_MODES);
export const teamRequestStatusSchema = z.enum(TEAM_REQUEST_STATUSES);
export const aiProposalStatusSchema = z.enum(AI_PROPOSAL_STATUSES);
export const aiRejectReasonSchema = z.enum(AI_REJECT_REASONS);
export type TeamMode = z.infer<typeof teamModeSchema>;
export type TeamInputMode = z.infer<typeof teamInputModeSchema>;
export type TeamRequestStatus = z.infer<typeof teamRequestStatusSchema>;
export type AiProposalStatus = z.infer<typeof aiProposalStatusSchema>;
export type AiRejectReason = z.infer<typeof aiRejectReasonSchema>;

const timestampSchema = z.string().datetime();
const requestTextSchema = z.string().trim().min(1).max(MAX_TEAM_REQUEST_TEXT);
const errorCodeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_.-]+$/);

/** El cliente no elige autor, destinatario, kind, status ni permisos. */
export const teamRequestBodySchema = z
  .object({
    clientRequestId: idSchema,
    mode: teamModeSchema,
    inputMode: teamInputModeSchema,
    text: requestTextSchema,
    replyToId: idSchema.nullable().default(null),
    model: semanticModelSchema,
  })
  .strict();
export type TeamRequestBody = z.infer<typeof teamRequestBodySchema>;

export const teamRequestKind = {
  ASK: 'QUESTION',
  INSTRUCT: 'INSTRUCTION',
  REVIEW: 'REVIEW_REQUEST',
} as const satisfies Record<TeamMode, (typeof TEAM_MESSAGE_KINDS)[number]>;

const messageFields = {
  id: idSchema,
  boardId: idSchema,
  addressedToId: idSchema.nullable(),
  replyToId: idSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};
const responseOnlyFields = {
  authorId: z.null(),
  clientRequestId: z.null(),
  mode: z.null(),
  inputMode: z.null(),
  status: z.null(),
  errorCode: z.null(),
};

/** DTO de lectura: null explícito para columnas ausentes; USER es una solicitud. */
export const teamMessageSchema = z
  .discriminatedUnion('authorKind', [
    z
      .object({
        ...messageFields,
        authorKind: z.literal('USER'),
        authorId: idSchema,
        addressedToId: z.null(),
        clientRequestId: idSchema,
        mode: teamModeSchema,
        inputMode: teamInputModeSchema,
        kind: z.enum(['QUESTION', 'INSTRUCTION', 'REVIEW_REQUEST']),
        text: requestTextSchema,
        status: teamRequestStatusSchema,
        errorCode: errorCodeSchema.nullable(),
      })
      .strict(),
    z
      .object({
        ...messageFields,
        ...responseOnlyFields,
        authorKind: z.literal('AI'),
        kind: z.enum(['ANSWER', 'CLARIFICATION', 'PROPOSAL', 'REVIEW']),
        text: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...messageFields,
        ...responseOnlyFields,
        authorKind: z.literal('SYSTEM'),
        kind: z.literal('SYSTEM'),
        text: z.string().min(1),
      })
      .strict(),
  ])
  .superRefine((message, ctx) => {
    if (Date.parse(message.updatedAt) < Date.parse(message.createdAt)) {
      ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Anterior a createdAt.' });
    }
    if (message.authorKind === 'USER' && message.kind !== teamRequestKind[message.mode]) {
      ctx.addIssue({ code: 'custom', path: ['kind'], message: 'kind no corresponde al modo.' });
    }
    if (
      message.authorKind === 'AI' &&
      message.kind !== 'REVIEW' &&
      (message.replyToId === null || message.addressedToId === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['replyToId'],
        message: 'La respuesta necesita solicitud y destinatario.',
      });
    }
  });
export type TeamMessage = z.infer<typeof teamMessageSchema>;

/** Los defaults se resuelven al leer configuración ausente, nunca en un PUT parcial. */
export const aiSettingsValuesSchema = z
  .object({
    enabled: z.boolean(),
    solutionMode: z.enum(AI_SOLUTION_MODES),
    executionMode: z.enum(AI_EXECUTION_MODES),
    reviewMode: z.enum(AI_REVIEW_MODES),
  })
  .strict();
export type AiSettingsValues = z.infer<typeof aiSettingsValuesSchema>;
export const DEFAULT_AI_SETTINGS: Readonly<AiSettingsValues> = Object.freeze({
  enabled: true,
  solutionMode: 'ON_REQUEST',
  executionMode: 'AUTO_SAFE_VOICE',
  reviewMode: 'ON_ISSUES',
});
export const projectAiSettingsSchema = aiSettingsValuesSchema
  .extend({
    projectId: idSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type ProjectAiSettings = z.infer<typeof projectAiSettingsSchema>;

export const aiProposalSchema = z
  .object({
    id: idSchema,
    boardId: idSchema,
    requestMessageId: idSchema,
    requesterId: idSchema,
    batchId: idSchema,
    batch: commandBatchSchema,
    expectedSemantic: semanticModelSchema,
    status: aiProposalStatusSchema,
    rejectReason: aiRejectReasonSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    expiresAt: timestampSchema,
    decidedAt: timestampSchema.nullable(),
    decidedById: idSchema.nullable(),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    const issue = (field: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [field], message });
    if (proposal.batchId !== proposal.batch.batchId)
      issue('batchId', 'El ID no coincide con el lote.');
    if (proposal.requesterId !== proposal.batch.actorId)
      issue('requesterId', 'El actor debe ser el solicitante.');
    if (proposal.batch.origin !== 'AI_TEXT' && proposal.batch.origin !== 'AI_VOICE') {
      issue('batch', 'Una propuesta IA necesita origen AI_TEXT o AI_VOICE.');
    }
    if (
      proposal.batch.commands.some(
        (command) =>
          command.actorId !== proposal.requesterId || command.origin !== proposal.batch.origin,
      )
    ) {
      issue('batch', 'Los comandos deben conservar actor y origen del lote.');
    }
    if (
      new Set(proposal.batch.commands.map((command) => command.commandId)).size !==
      proposal.batch.commands.length
    ) {
      issue('batch', 'Los commandId deben ser únicos dentro del lote.');
    }
    if (Date.parse(proposal.expiresAt) - Date.parse(proposal.createdAt) !== AI_PROPOSAL_TTL_MS) {
      issue('expiresAt', 'La propuesta vence 15 minutos después de su creación.');
    }
    if (Date.parse(proposal.updatedAt) < Date.parse(proposal.createdAt))
      issue('updatedAt', 'Anterior a createdAt.');
    if (
      proposal.status === 'STALE'
        ? proposal.rejectReason !== 'STALE'
        : proposal.status === 'REJECTED'
          ? !['USER', 'APPLY_FAILED'].includes(proposal.rejectReason ?? '')
          : proposal.rejectReason !== null
    ) {
      issue('rejectReason', 'Motivo incompatible con el estado de propuesta.');
    }
    if (proposal.decidedById !== null && proposal.decidedById !== proposal.requesterId) {
      issue('decidedById', 'Solo el solicitante decide sobre la propuesta.');
    }
  });
export type AiProposal = z.infer<typeof aiProposalSchema>;
export const teamFeedPageSchema = z
  .object({
    messages: z.array(teamMessageSchema).max(100),
    proposals: z.array(aiProposalSchema).max(100),
    nextCursor: z.string().min(1).max(2048),
    hasMore: z.boolean(),
  })
  .strict();
export type TeamFeedPage = z.infer<typeof teamFeedPageSchema>;
export const aiProposalRejectBodySchema = z.object({ reason: aiRejectReasonSchema }).strict();
export type AiProposalRejectBody = z.infer<typeof aiProposalRejectBodySchema>;

/** Cursores tipados para paginación estable; codificación HTTP en el paso 3. */
export const teamHistoryCursorSchema = z
  .object({ createdAt: timestampSchema, id: idSchema })
  .strict();
export const teamChangesCursorSchema = z
  .object({ updatedAt: timestampSchema, id: idSchema })
  .strict();
export type TeamHistoryCursor = z.infer<typeof teamHistoryCursorSchema>;
export type TeamChangesCursor = z.infer<typeof teamChangesCursorSchema>;

export const teamAiEventSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('team.message'), boardId: idSchema, messageId: idSchema }).strict(),
    z
      .object({
        type: z.literal('team.update'),
        boardId: idSchema,
        messageId: idSchema.optional(),
        proposalId: idSchema.optional(),
        status: z.enum([...TEAM_REQUEST_STATUSES, ...AI_PROPOSAL_STATUSES]),
      })
      .strict(),
    z
      .object({
        type: z.literal('ai.status'),
        boardId: idSchema,
        state: z.enum(['IDLE', 'PROCESSING']),
        forUserId: idSchema.optional(),
        queued: z.number().int().nonnegative().safe(),
      })
      .strict(),
    z.object({ type: z.literal('ai.settings'), projectId: idSchema }).strict(),
  ])
  .superRefine((event, ctx) => {
    if (event.type === 'team.update') {
      if (event.proposalId === undefined && event.messageId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['messageId'],
          message: 'Falta el recurso actualizado.',
        });
      }
      const validStatus =
        event.proposalId === undefined
          ? teamRequestStatusSchema.safeParse(event.status).success
          : aiProposalStatusSchema.safeParse(event.status).success;
      if (!validStatus)
        ctx.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Estado incompatible con el recurso.',
        });
    }
    if (
      event.type === 'ai.status' &&
      (event.state === 'PROCESSING') !== (event.forUserId !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['forUserId'],
        message: 'Solo PROCESSING identifica al solicitante activo.',
      });
    }
  });
export type TeamAiEvent = z.infer<typeof teamAiEventSchema>;

/** Usar en la frontera stateless: tamaño UTF-8 antes de interpretar JSON. */
export const teamAiEventPayloadSchema = z
  .string()
  .max(MAX_TEAM_AI_EVENT_BYTES)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_TEAM_AI_EVENT_BYTES,
    'Evento mayor a 2 KiB.',
  )
  .transform((value, ctx): unknown => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'JSON de evento inválido.' });
      return z.NEVER;
    }
  })
  .pipe(teamAiEventSchema);

const requestTransitions: Record<TeamRequestStatus, readonly TeamRequestStatus[]> = {
  QUEUED: ['PROCESSING', 'CANCELLED', 'INTERRUPTED'],
  PROCESSING: ['DONE', 'FAILED', 'CANCELLED', 'INTERRUPTED'],
  DONE: [],
  FAILED: [],
  CANCELLED: [],
  INTERRUPTED: [],
};
const proposalTransitions: Record<AiProposalStatus, readonly AiProposalStatus[]> = {
  READY: ['APPLIED', 'STALE', 'REJECTED', 'EXPIRED'],
  PENDING_CONFIRMATION: ['READY', 'REJECTED', 'EXPIRED'],
  APPLIED: [],
  STALE: [],
  REJECTED: [],
  EXPIRED: [],
};

/** Validan aristas del contrato; el servidor deberá hacer CAS/transacción y autorizar. */
export function canTransitionTeamRequest(from: TeamRequestStatus, to: TeamRequestStatus): boolean {
  return requestTransitions[from].includes(to);
}
export function canTransitionAiProposal(from: AiProposalStatus, to: AiProposalStatus): boolean {
  return proposalTransitions[from].includes(to);
}
export function proposalStatusAt(
  proposal: Pick<AiProposal, 'status' | 'expiresAt'>,
  now: number,
): AiProposalStatus {
  return (proposal.status === 'READY' || proposal.status === 'PENDING_CONFIRMATION') &&
    now >= Date.parse(proposal.expiresAt)
    ? 'EXPIRED'
    : proposal.status;
}
export function proposalRejectionStatus(
  proposal: Pick<AiProposal, 'status' | 'expiresAt'>,
  reason: AiRejectReason,
  now: number,
): 'STALE' | 'REJECTED' | null {
  const from = proposalStatusAt(proposal, now);
  if (reason === 'STALE') return from === 'READY' ? 'STALE' : null;
  if (reason === 'APPLY_FAILED') return from === 'READY' ? 'REJECTED' : null;
  return canTransitionAiProposal(from, 'REJECTED') ? 'REJECTED' : null;
}
export function roleCanRequestTeamMode(role: ProjectRole, mode: TeamMode): boolean {
  return mode !== 'INSTRUCT' || roleCanWrite(role);
}
export function batchOriginForTeamInput(inputMode: TeamInputMode): 'AI_TEXT' | 'AI_VOICE' {
  return inputMode === 'VOICE_COMMAND' ? 'AI_VOICE' : 'AI_TEXT';
}
/** Solo habilita el control; NO acredita lote seguro, permisos, vigencia ni precondiciones. */
export function allowsAutomaticTeamInput(
  executionMode: AiSettingsValues['executionMode'],
  inputMode: TeamInputMode,
): boolean {
  return (
    inputMode !== 'DICTATION' &&
    executionMode !== 'PROPOSE_ONLY' &&
    (inputMode === 'VOICE_COMMAND' || executionMode === 'AUTO_SAFE_ALL')
  );
}

// Aclaraciones compartidas: mismo formato visible que el enviado al proveedor.
export interface PendingTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}
export const MAX_CONTEXT_TURNS = 10;
export function clarificationText(question: string, options: readonly string[] = []): string {
  return [
    question,
    ...options.map((option, index) => `${index + 1}. ${JSON.stringify(option)}`),
  ].join('\n');
}
export function exceedsContext(context: readonly PendingTurn[]): boolean {
  return (
    context.length > MAX_CONTEXT_TURNS ||
    context.some((turn) => turn.text.length > MAX_TEAM_REQUEST_TEXT)
  );
}
export function appendClarification(
  context: readonly PendingTurn[],
  instruction: string,
  question: string,
  options: readonly string[] = [],
): readonly PendingTurn[] {
  return [
    ...context,
    { role: 'user', text: instruction },
    { role: 'assistant', text: clarificationText(question, options) },
  ];
}
export function contextToDraft(context: readonly PendingTurn[], draft: string): string {
  return [
    ...context.map((turn) => `${turn.role === 'user' ? 'Solicitud' : 'Pregunta'}: ${turn.text}`),
    draft,
  ]
    .filter(Boolean)
    .join('\n');
}
