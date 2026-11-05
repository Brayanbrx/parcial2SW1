import {
  commandBatchSchema,
  semanticModelSchema,
  type CommandBatch,
  type TeamAiEvent,
} from '@uml/contracts';
import { validateModel } from '@uml/domain-core';
import type { PrismaClient, AuditOperation } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { nextTeamTimestamp } from './persistence.js';
import type { PublishTeamEvent } from './events.js';
import {
  hasBatchEvidence,
  isSemanticBatch,
  reviewIssueKey,
  reviewText,
  touchedElements,
} from './review-evidence.js';
import { createReviewScheduler, REVIEW_TIMING, type ReviewTiming } from './review-scheduler.js';

function batchOf(audit: AuditOperation): CommandBatch | undefined {
  const payload =
    typeof audit.payload === 'object' && audit.payload !== null && !Array.isArray(audit.payload)
      ? audit.payload
      : {};
  const parsed = commandBatchSchema.safeParse({
    ...payload,
    batchId: audit.batchId,
    origin: audit.origin,
    actorId: audit.actorId,
  });
  return parsed.success ? parsed.data : undefined;
}

export function createTeamModerator(options: {
  prisma: PrismaClient;
  publish: PublishTeamEvent;
  log: Pick<FastifyBaseLogger, 'warn'>;
  timing?: Partial<ReviewTiming>;
}) {
  const timing = { ...REVIEW_TIMING, ...options.timing };
  const { prisma } = options;
  const diagnostic = (reason: string) =>
    options.log.warn({ reason }, 'moderador: intervención omitida o diferida');
  return createReviewScheduler({
    timing,
    diagnostic,
    async review(boardId, signal) {
      const events: TeamAiEvent[] = [];
      const result = await prisma.$transaction(
        async (tx): Promise<'done' | 'retry' | number> => {
          const board = await tx.board.findUnique({
            where: { id: boardId },
            select: { projectId: true },
          });
          if (!board) return 'done';
          // Mismo orden que auditoría/configuración; ningún proveedor o red dentro de la transacción.
          await tx.$queryRaw`SELECT id FROM projects WHERE id = ${board.projectId}::uuid FOR SHARE`;
          await tx.$queryRaw`SELECT "userId" FROM project_members WHERE "projectId" = ${board.projectId}::uuid FOR SHARE`;
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
          if (!locked.length) return 'done';
          // El snapshot v1 es mutable. Mantener su versión leída hasta el commit del aviso.
          await tx.$queryRaw`SELECT "boardId" FROM board_snapshots WHERE "boardId" = ${boardId}::uuid AND version = 1 FOR SHARE`;
          const snapshot = await tx.boardSnapshot.findUnique({
            where: { boardId_version: { boardId, version: 1 } },
          });
          const parsed = semanticModelSchema.safeParse(snapshot?.canonicalJson);
          if (!parsed.success) return 'retry';
          const model = parsed.data;
          const audits = await tx.auditOperation.findMany({
            where: { boardId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 100,
          });
          const batches = audits.flatMap((audit) => {
            const batch = batchOf(audit);
            return batch && isSemanticBatch(batch.commands) ? [{ audit, batch }] : [];
          });
          const latest = batches[0];
          if (!latest) return 'done';
          const state = await tx.aiReviewState.findUnique({ where: { boardId } });
          if (state?.lastReviewedBatchId === latest.batch.batchId) return 'done';
          const issues = validateModel(model).filter((issue) => issue.severity === 'ERROR');
          const keys = issues.map(reviewIssueKey);
          const settings = await tx.projectAiSettings.findUnique({
            where: { projectId: board.projectId },
          });
          const enabled =
            settings?.enabled !== false && (settings?.reviewMode ?? 'ON_ISSUES') === 'ON_ISSUES';
          const baseline = !state?.lastReviewAt;
          // Una instalación previa sin línea base no permite distinguir problemas antiguos.
          if (!baseline && !hasBatchEvidence(model, latest.batch.commands)) return 'retry';
          const previous = new Set(
            Array.isArray(state?.lastIssueKeys)
              ? state.lastIssueKeys.filter((key): key is string => typeof key === 'string')
              : [],
          );
          const fresh = issues.filter((issue) => !previous.has(reviewIssueKey(issue)));
          const elapsed = Date.now() - (state?.lastInterventionAt?.getTime() ?? 0);
          if (!baseline && enabled && fresh.length && elapsed < timing.cooldownMs)
            return timing.cooldownMs - elapsed;
          signal.throwIfAborted();
          let intervention = false;
          if (!baseline && enabled && fresh.length) {
            const boundary = batches.findIndex(
              ({ batch }) => batch.batchId === state?.lastReviewedBatchId,
            );
            const candidates = boundary < 0 ? batches : batches.slice(0, boundary);
            const authors = fresh.map((issue) => {
              const touching = candidates.filter(({ batch }) =>
                issue.elementIds.some((id) => touchedElements(batch.commands).has(id)),
              );
              const candidate = touching[0];
              // Un empate temporal con autores distintos no prueba cuál fue el último.
              if (
                !candidate ||
                touching.some(
                  (other) =>
                    other.audit.createdAt.getTime() === candidate.audit.createdAt.getTime() &&
                    other.audit.actorId !== candidate.audit.actorId,
                ) ||
                !hasBatchEvidence(model, candidate.batch.commands)
              )
                return null;
              return candidate.audit.actorId;
            });
            const author = authors[0];
            const addressedToId =
              author &&
              authors.every((id) => id === author) &&
              (await tx.projectMember.findUnique({
                where: { projectId_userId: { projectId: board.projectId, userId: author } },
              }))
                ? author
                : null;
            const now = await nextTeamTimestamp(tx, boardId);
            const message = await tx.teamMessage.create({
              data: {
                boardId,
                authorKind: 'AI',
                kind: 'REVIEW',
                addressedToId,
                text: reviewText(fresh, settings?.solutionMode === 'HINTS_ONLY'),
                createdAt: now,
                updatedAt: now,
              },
            });
            events.push({ type: 'team.message', boardId, messageId: message.id });
            intervention = true;
          }
          const data = {
            lastReviewedBatchId: latest.batch.batchId,
            lastIssueKeys: keys,
            lastReviewAt: new Date(),
            ...(intervention ? { lastInterventionAt: new Date() } : {}),
          };
          await tx.aiReviewState.upsert({
            where: { boardId },
            create: { boardId, ...data },
            update: data,
          });
          signal.throwIfAborted();
          return 'done';
        },
        { timeout: 10000, maxWait: 10000 },
      );
      for (const event of events) options.publish(event);
      return result;
    },
  });
}
export type TeamModerator = ReturnType<typeof createTeamModerator>;
