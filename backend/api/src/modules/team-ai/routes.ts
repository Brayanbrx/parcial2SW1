import { isDeepStrictEqual } from 'node:util';
import { Prisma, type TeamMessage } from '@prisma/client';
import {
  DEFAULT_AI_SETTINGS,
  aiSettingsValuesSchema,
  aiProposalRejectBodySchema,
  roleCanRequestTeamMode,
  roleCanWrite,
  teamRequestBodySchema,
  teamRequestKind,
  teamHistoryCursorSchema,
  teamChangesCursorSchema,
  proposalRejectionStatus,
  type TeamRequestBody,
} from '@uml/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { PublishTeamEvent } from './events.js';
import type { TeamWorker } from './worker.js';
import { loadClarifications } from './clarifications.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../lib/http-error.js';
import { currentUser } from '../../plugins/auth.js';
import {
  expireProposalIfDue,
  lockProject,
  messageDto,
  nextTeamTimestamp,
  withTeamBoard,
} from './persistence.js';

const boardParams = z.object({ boardId: z.string().uuid() });
const resourceParams = boardParams.extend({ id: z.string().uuid() });
const projectParams = z.object({ projectId: z.string().uuid() });
const querySchema = z
  .object({
    cursor: z.string().max(2048).optional(),
    changedSince: z.string().max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((q) => !(q.cursor && q.changedSince), 'Usa cursor o changedSince.');
const historyToken = z
  .object({ boardId: z.string().uuid(), history: teamHistoryCursorSchema })
  .strict();
const changesToken = z
  .object({
    boardId: z.string().uuid(),
    messages: teamChangesCursorSchema.nullable(),
    proposals: teamChangesCursorSchema.nullable(),
  })
  .strict();
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decode<T>(token: string, schema: z.ZodType<T>, boardId: string): T {
  try {
    if (!/^[\w-]+$/.test(token)) throw new Error('encoding');
    const value = schema.parse(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
    if ((value as { boardId: string }).boardId !== boardId) throw new Error('board');
    return value;
  } catch {
    throw badRequest('invalid_cursor', 'El cursor no es válido para esta pizarra.');
  }
}
const requestConflict = () =>
  conflict('request_conflict', 'La solicitud entra en conflicto con una solicitud registrada.');
function sameRequest(saved: TeamMessage, boardId: string, userId: string, body: TeamRequestBody) {
  return (
    saved.boardId === boardId &&
    saved.authorId === userId &&
    saved.mode === body.mode &&
    saved.inputMode === body.inputMode &&
    saved.text === body.text &&
    saved.replyToId === body.replyToId &&
    isDeepStrictEqual(saved.requestModel, body.model)
  );
}

export async function teamAiRoutes(
  app: FastifyInstance,
  {
    config,
    publish,
    worker,
  }: { config: Config; publish: PublishTeamEvent; worker?: TeamWorker | undefined },
): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const boardTransaction = <T>(
    boardId: string,
    userId: string,
    work: Parameters<typeof withTeamBoard<T>>[3],
  ) => withTeamBoard(app.prisma, boardId, userId, work, publish);

  app.get('/projects/:projectId/ai-settings', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const { userId } = currentUser(request);
    return app.prisma.$transaction(async (tx) => {
      const project = await lockProject(tx, projectId, userId);
      return (
        (await tx.projectAiSettings.findUnique({ where: { projectId } })) ?? {
          projectId,
          ...DEFAULT_AI_SETTINGS,
          updatedAt: project.createdAt,
        }
      );
    });
  });
  app.put('/projects/:projectId/ai-settings', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const body = aiSettingsValuesSchema.parse(request.body);
    const { userId } = currentUser(request);
    let changed = false;
    const settings = await app.prisma.$transaction(async (tx) => {
      const project = await lockProject(tx, projectId, userId, true);
      if (project.role !== 'OWNER') throw forbidden();
      const previous = await tx.projectAiSettings.findUnique({ where: { projectId } });
      if (
        previous &&
        Object.entries(body).every(([key, value]) => previous[key as keyof typeof body] === value)
      )
        return previous;
      changed = true;
      return tx.projectAiSettings.upsert({
        where: { projectId },
        create: { projectId, ...body },
        update: body,
      });
    });
    if (changed) publish({ type: 'ai.settings', projectId });
    return settings;
  });

  app.post('/boards/:boardId/team-ai/messages', async (request, reply) => {
    const { boardId } = boardParams.parse(request.params);
    const body = teamRequestBodySchema.parse(request.body);
    const { userId } = currentUser(request);
    if (worker) {
      try {
        await worker.start();
      } catch {
        throw new HttpError(
          503,
          'team_ai_unavailable',
          'La cola de IA no está disponible. Reintenta.',
        );
      }
    }
    const accept = () =>
      boardTransaction(boardId, userId, async (tx, context) => {
        if (!roleCanRequestTeamMode(context.role, body.mode)) throw forbidden();
        const existing = await tx.teamMessage.findUnique({
          where: { clientRequestId: body.clientRequestId },
        });
        if (existing)
          return sameRequest(existing, boardId, userId, body)
            ? messageDto(existing)
            : requestConflict();
        const settings = await tx.projectAiSettings.findUnique({
          where: { projectId: context.projectId },
        });
        if (settings?.enabled === false)
          throw conflict('ai_disabled', 'La IA está deshabilitada en este proyecto.');
        if (body.mode === 'REVIEW' && settings?.reviewMode === 'OFF')
          throw conflict(
            'team_ai_review_disabled',
            'El OWNER ha desactivado la revisión del modelo.',
          );
        if (body.replyToId) {
          const parent = await tx.teamMessage.findFirst({ where: { id: body.replyToId, boardId } });
          if (!parent) throw badRequest('invalid_reply', 'El mensaje de referencia no es válido.');
          if (
            body.mode === 'INSTRUCT' &&
            (parent.kind !== 'CLARIFICATION' ||
              parent.authorKind !== 'AI' ||
              parent.addressedToId !== userId)
          ) {
            throw forbidden('Solo el destinatario puede responder a su aclaración.');
          }
          if (body.mode === 'INSTRUCT')
            await loadClarifications(tx, boardId, userId, body.replyToId);
        }
        const pending = {
          boardId,
          status: { in: ['QUEUED', 'PROCESSING'] as ('QUEUED' | 'PROCESSING')[] },
        };
        const [boardCount, userCount] = await Promise.all([
          tx.teamMessage.count({ where: pending }),
          tx.teamMessage.count({ where: { ...pending, authorId: userId } }),
        ]);
        if (
          boardCount >= config.TEAM_AI_BOARD_QUEUE_LIMIT ||
          userCount >= config.TEAM_AI_USER_QUEUE_LIMIT
        )
          throw new HttpError(
            429,
            'team_queue_full',
            'La cola de solicitudes está llena. Espera antes de reintentar.',
          );
        const now = await nextTeamTimestamp(tx, boardId);
        const message = messageDto(
          await tx.teamMessage.create({
            data: {
              boardId,
              authorKind: 'USER',
              authorId: userId,
              clientRequestId: body.clientRequestId,
              mode: body.mode,
              inputMode: body.inputMode,
              kind: teamRequestKind[body.mode],
              text: body.text,
              replyToId: body.replyToId,
              status: 'QUEUED',
              requestModel: body.model,
              createdAt: now,
              updatedAt: now,
            },
          }),
        );
        context.emit({ type: 'team.message', boardId, messageId: message.id });
        return message;
      });
    let message;
    try {
      message = await accept();
    } catch (error) {
      // La clave es global: dos pizarras pueden competir sin compartir bloqueo.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      message = await accept();
    }
    if (message.status === 'QUEUED') worker?.notify(boardId);
    return reply.code(202).send(message);
  });

  app.get('/boards/:boardId/team-ai/messages', async (request) => {
    const { boardId } = boardParams.parse(request.params);
    const query = querySchema.parse(request.query);
    const { userId } = currentUser(request);
    return boardTransaction(boardId, userId, async (tx) => {
      if (query.changedSince !== undefined) {
        const token =
          query.changedSince === 'start'
            ? { boardId, messages: null, proposals: null }
            : decode(query.changedSince, changesToken, boardId);
        const after = (cursor: z.infer<typeof teamChangesCursorSchema> | null) =>
          cursor
            ? {
                OR: [
                  { updatedAt: { gt: new Date(cursor.updatedAt) } },
                  { updatedAt: new Date(cursor.updatedAt), id: { gt: cursor.id } },
                ],
              }
            : {};
        const [messages, proposals] = await Promise.all([
          tx.teamMessage.findMany({
            where: { boardId, ...after(token.messages) },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            take: query.limit + 1,
          }),
          tx.aiProposal.findMany({
            where: { boardId, ...after(token.proposals) },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            take: query.limit + 1,
          }),
        ]);
        const pageMessages = messages.slice(0, query.limit),
          pageProposals = proposals.slice(0, query.limit);
        const end = (items: { id: string; updatedAt: Date }[], previous: typeof token.messages) => {
          const last = items.at(-1);
          return last ? { id: last.id, updatedAt: last.updatedAt.toISOString() } : previous;
        };
        return {
          messages: pageMessages.map(messageDto),
          proposals: pageProposals,
          nextCursor: encode({
            boardId,
            messages: end(pageMessages, token.messages),
            proposals: end(pageProposals, token.proposals),
          }),
          hasMore: messages.length > query.limit || proposals.length > query.limit,
        };
      }
      const cursor = query.cursor ? decode(query.cursor, historyToken, boardId).history : null;
      const rows = await tx.teamMessage.findMany({
        where: {
          boardId,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { gt: new Date(cursor.createdAt) } },
                  { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
      const messages = rows.slice(0, query.limit),
        last = messages.at(-1);
      const proposals = await tx.aiProposal.findMany({
        where: { boardId, requestMessageId: { in: messages.map((m) => m.id) } },
      });
      return {
        messages: messages.map(messageDto),
        proposals,
        hasMore: rows.length > query.limit,
        nextCursor: last
          ? encode({ boardId, history: { id: last.id, createdAt: last.createdAt.toISOString() } })
          : (query.cursor ?? null),
      };
    });
  });

  app.get('/boards/:boardId/team-ai/messages/:id', async (request) => {
    const { boardId, id } = resourceParams.parse(request.params);
    return boardTransaction(boardId, currentUser(request).userId, async (tx) => {
      const message = await tx.teamMessage.findFirst({ where: { id, boardId } });
      if (!message) throw notFound();
      return {
        message: messageDto(message),
        proposal: await tx.aiProposal.findUnique({ where: { requestMessageId: id } }),
      };
    });
  });
  app.post('/boards/:boardId/team-ai/messages/:id/cancel', async (request) => {
    const { boardId, id } = resourceParams.parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const { userId } = currentUser(request);
    const cancelled = await boardTransaction(boardId, userId, async (tx, { emit }) => {
      const message = await tx.teamMessage.findFirst({ where: { id, boardId } });
      if (!message) throw notFound();
      if (message.authorId !== userId) throw forbidden();
      if (message.status === 'CANCELLED') return messageDto(message);
      if (message.status !== 'QUEUED' && message.status !== 'PROCESSING')
        return conflict('invalid_transition', 'La solicitud ya terminó.');
      await tx.teamMessage.updateMany({
        where: { id, status: { in: ['QUEUED', 'PROCESSING'] } },
        data: { status: 'CANCELLED', updatedAt: await nextTeamTimestamp(tx, boardId) },
      });
      emit({ type: 'team.update', boardId, messageId: id, status: 'CANCELLED' });
      return messageDto(await tx.teamMessage.findUniqueOrThrow({ where: { id } }));
    });
    worker?.cancel(id);
    return cancelled;
  });
  for (const action of ['confirm', 'reject'] as const) {
    app.post(`/boards/:boardId/team-ai/proposals/:id/${action}`, async (request) => {
      const { boardId, id } = resourceParams.parse(request.params);
      const body = action === 'reject' ? aiProposalRejectBodySchema.parse(request.body) : null;
      if (action === 'confirm')
        z.object({})
          .strict()
          .parse(request.body ?? {});
      const { userId } = currentUser(request);
      return boardTransaction(boardId, userId, async (tx, { role, emit }) => {
        const proposal = await tx.aiProposal.findFirst({ where: { id, boardId } });
        if (!proposal) throw notFound();
        if (proposal.requesterId !== userId || (action === 'confirm' && !roleCanWrite(role)))
          throw forbidden();
        if (await expireProposalIfDue(tx, proposal, emit))
          return conflict('invalid_transition', 'La propuesta ya venció.');
        if (action === 'confirm' && proposal.status === 'READY') return proposal;
        const status =
          action === 'confirm'
            ? proposal.status === 'PENDING_CONFIRMATION'
              ? 'READY'
              : null
            : proposalRejectionStatus(
                { status: proposal.status, expiresAt: proposal.expiresAt.toISOString() },
                body!.reason,
                Date.now(),
              );
        if (!status) return conflict('invalid_transition', 'La propuesta no admite esta acción.');
        await tx.aiProposal.updateMany({
          where: { id, status: proposal.status },
          data: {
            status,
            rejectReason: body?.reason ?? null,
            decidedById: userId,
            decidedAt: new Date(),
            updatedAt: await nextTeamTimestamp(tx, boardId),
          },
        });
        emit({ type: 'team.update', boardId, proposalId: id, status });
        return tx.aiProposal.findUniqueOrThrow({ where: { id } });
      });
    });
  }
}
