import { ProviderContractError, ProviderUnavailableError, TeamContextError } from '@uml/ai';
import { HttpError } from '../../lib/http-error.js';
import {
  AI_PROPOSAL_TTL_MS,
  roleCanRequestTeamMode,
  type ProjectRole,
  type TeamAiEvent,
} from '@uml/contracts';
import type { PrismaClient, TeamMessage } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { createBoardQueue } from './queue.js';
import { nextTeamTimestamp, type TeamTransaction } from './persistence.js';
import type { PublishTeamEvent } from './events.js';
import type { TeamProcessor, TeamWorkResult } from './orchestrator.js';

const pending = ['QUEUED', 'PROCESSING'] as const;

/** Único propietario de trabajo en el proceso. PostgreSQL conserva estados y resultados. */
export function createTeamWorker(options: {
  prisma: PrismaClient;
  publish: PublishTeamEvent;
  process: TeamProcessor;
  timeoutMs: number | ((job: TeamMessage) => number);
  concurrencyPerBoard?: number;
  maxConcurrency?: number;
  admission?(
    job: TeamMessage,
    activeJobs: ReadonlyMap<string, TeamMessage>,
  ): 'ready' | 'wait' | 'expired';
  log: Pick<FastifyBaseLogger, 'warn'>;
}) {
  const { prisma, publish } = options;
  let closed = false;
  let initialized = false;
  let starting: Promise<void> | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  let scan: Promise<void> | undefined;
  const logError = () =>
    options.log.warn('fallo del worker team-ai; se reintentará la recuperación');

  // Mismo orden de bloqueos que HTTP: proyecto, membresía si existe, pizarra.
  // La recuperación puede finalizar solicitudes cuyo autor ya no sea miembro.
  async function transaction<T>(
    boardId: string,
    work: (tx: TeamTransaction, projectId: string, emit: PublishTeamEvent) => Promise<T>,
  ): Promise<T | null> {
    const events: TeamAiEvent[] = [];
    const result = await prisma.$transaction(
      async (tx) => {
        const board = await tx.board.findUnique({ where: { id: boardId } });
        if (!board) return null;
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${board.projectId}::uuid FOR SHARE`;
        // Bloquear las membresías antes de la pizarra permite revalidar permisos sin carreras.
        await tx.$queryRaw`SELECT "userId" FROM project_members WHERE "projectId" = ${board.projectId}::uuid FOR SHARE`;
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
        if (!locked.length) return null;
        return work(tx, board.projectId, (event) => events.push(event));
      },
      { timeout: 10_000, maxWait: 10_000 },
    );
    for (const event of events) publish(event);
    return result;
  }

  async function accessError(tx: TeamTransaction, projectId: string, job: TeamMessage) {
    const member = job.authorId
      ? await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: job.authorId } },
        })
      : null;
    if (!member || !job.mode || !roleCanRequestTeamMode(member.role as ProjectRole, job.mode))
      return 'team_ai_access_revoked';
    const settings = await tx.projectAiSettings.findUnique({ where: { projectId } });
    if (settings?.enabled === false) return 'ai_disabled';
    if (job.mode === 'REVIEW' && settings?.reviewMode === 'OFF') return 'team_ai_review_disabled';
    return null;
  }

  async function transition(
    tx: TeamTransaction,
    job: TeamMessage,
    status: 'FAILED' | 'INTERRUPTED' | 'PROCESSING' | 'DONE',
    emit: PublishTeamEvent,
    errorCode: string | null = null,
  ) {
    const changed = await tx.teamMessage.updateMany({
      where: { id: job.id, status: job.status },
      data: { status, errorCode, updatedAt: await nextTeamTimestamp(tx, job.boardId) },
    });
    if (changed.count)
      emit({ type: 'team.update', boardId: job.boardId, messageId: job.id, status });
    return changed.count > 0;
  }

  async function interruptPending() {
    const boards = await prisma.teamMessage.findMany({
      where: { status: { in: [...pending] } },
      select: { boardId: true },
      distinct: ['boardId'],
    });
    for (const { boardId } of boards)
      await transaction(boardId, async (tx, _projectId, emit) => {
        const jobs = await tx.teamMessage.findMany({
          where: { boardId, status: { in: [...pending] } },
        });
        for (const job of jobs)
          await transition(tx, job, 'INTERRUPTED', emit, 'team_ai_interrupted');
      });
  }

  const queue = createBoardQueue<TeamMessage, TeamWorkResult>({
    timeoutMs: options.timeoutMs,
    ...(options.concurrencyPerBoard === undefined
      ? {}
      : { concurrencyPerBoard: options.concurrencyPerBoard }),
    ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
    onError: logError,
    async claim(boardId, activeJobs) {
      return transaction(boardId, async (tx, projectId, emit) => {
        // Si falló la escritura final por BD, no volver a llamar al proveedor.
        const stranded = await tx.teamMessage.findMany({
          where: { boardId, status: 'PROCESSING' },
        });
        for (const job of stranded)
          if (!activeJobs.has(job.id))
            await transition(tx, job, 'INTERRUPTED', emit, 'team_ai_interrupted');
        const jobs = await tx.teamMessage.findMany({
          where: { boardId, status: 'QUEUED' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        let blocked = false;
        for (const job of jobs) {
          const errorCode = await accessError(tx, projectId, job);
          if (errorCode) {
            await transition(tx, job, 'FAILED', emit, errorCode);
            continue;
          }
          const admission = options.admission?.(job, activeJobs);
          if (admission === 'wait') {
            blocked = true;
            continue;
          }
          if (admission === 'expired') {
            await transition(tx, job, 'FAILED', emit, 'team_ai_timeout');
            continue;
          }
          if (await transition(tx, job, 'PROCESSING', emit))
            return { ...job, status: 'PROCESSING' as const };
        }
        return blocked ? ('blocked' as const) : null;
      });
    },
    async process(job, signal) {
      // Una cancelación puede haber ganado durante el commit de claim.
      const current = await prisma.teamMessage.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (current?.status !== 'PROCESSING') throw new Error('team_ai_cancelled');
      signal.throwIfAborted();
      return options.process(job, signal);
    },
    async complete(job, result, signal) {
      await transaction(job.boardId, async (tx, projectId, emit) => {
        signal.throwIfAborted();
        const current = await tx.teamMessage.findUnique({ where: { id: job.id } });
        if (current?.status !== 'PROCESSING') return;
        const errorCode = await accessError(tx, projectId, current);
        if (errorCode) {
          await transition(tx, current, 'FAILED', emit, errorCode);
          return;
        }
        if (!result.text.trim()) throw new Error('team_ai_invalid_response');
        if (job.mode !== 'INSTRUCT') {
          if (result.proposal || result.kind !== (job.mode === 'REVIEW' ? 'REVIEW' : 'ANSWER'))
            throw new Error('team_ai_invalid_response');
          const settings = await tx.projectAiSettings.findUnique({ where: { projectId } });
          if (
            result.solutionMode &&
            result.solutionMode !== (settings?.solutionMode ?? 'ON_REQUEST')
          ) {
            await transition(tx, current, 'FAILED', emit, 'team_ai_settings_changed');
            return;
          }
        }
        if (!(await transition(tx, current, 'DONE', emit))) return;
        const now = await nextTeamTimestamp(tx, job.boardId);
        const response = await tx.teamMessage.create({
          data: {
            boardId: job.boardId,
            authorKind: 'AI',
            addressedToId: current.authorId,
            replyToId: job.id,
            ...(job.executionTarget ? { executionTarget: job.executionTarget } : {}),
            kind: result.kind,
            text: result.text,
            createdAt: now,
            updatedAt: now,
          },
        });
        emit({ type: 'team.message', boardId: job.boardId, messageId: response.id });
        if (result.proposal) {
          const createdAt = await nextTeamTimestamp(tx, job.boardId);
          const proposal = await tx.aiProposal.create({
            data: {
              boardId: job.boardId,
              requestMessageId: job.id,
              requesterId: current.authorId!,
              batchId: result.proposal.batch.batchId,
              ...result.proposal,
              createdAt,
              updatedAt: createdAt,
              expiresAt: new Date(createdAt.getTime() + AI_PROPOSAL_TTL_MS),
            },
          });
          emit({
            type: 'team.update',
            boardId: job.boardId,
            proposalId: proposal.id,
            status: proposal.status,
          });
        }
        signal.throwIfAborted();
      });
    },
    async fail(job, error) {
      const code = errorCode(error);
      await transaction(job.boardId, async (tx, _projectId, emit) => {
        await transition(
          tx,
          job,
          code === 'team_ai_interrupted' ? 'INTERRUPTED' : 'FAILED',
          emit,
          code,
        );
      });
    },
  });

  async function scanPending() {
    const jobs = await prisma.teamMessage.findMany({
      where: { status: { in: [...pending] } },
      select: { boardId: true },
      distinct: ['boardId'],
    });
    for (const { boardId } of jobs) queue.notify(boardId);
  }

  return {
    async start() {
      if (closed) throw new Error('team_ai_interrupted');
      if (initialized) return;
      starting ??= interruptPending()
        .then(() => {
          initialized = true;
          if (closed) return;
          polling = setInterval(() => {
            if (!scan)
              scan = scanPending()
                .catch(logError)
                .finally(() => {
                  scan = undefined;
                });
          }, 2000);
          polling.unref();
        })
        .finally(() => {
          starting = undefined;
        });
      await starting;
    },
    notify: queue.notify,
    cancel: queue.cancel,
    async close() {
      closed = true;
      if (polling) clearInterval(polling);
      await starting?.catch(logError);
      await scan;
      await queue.close();
      if (initialized) await interruptPending();
    },
  };
}
export type TeamWorker = ReturnType<typeof createTeamWorker>;

function errorCode(error: unknown): string {
  if (error instanceof TeamContextError) return error.code;
  if (
    error instanceof HttpError &&
    ['invalid_clarification', 'team_ai_context_limit', 'ai_engine_unavailable'].includes(error.code)
  )
    return error.code;
  if (error instanceof ProviderUnavailableError)
    return error.provider === 'connector' ? 'ai_engine_unavailable' : 'ai_provider_unavailable';
  if (error instanceof ProviderContractError) return 'ai_provider_contract';
  const known = [
    'ai_disabled',
    'team_ai_review_disabled',
    'team_ai_timeout',
    'team_ai_interrupted',
    'team_ai_cancelled',
    'team_ai_invalid_context',
    'team_ai_invalid_proposal',
    'team_ai_invalid_response',
  ];
  return error instanceof Error && known.includes(error.message) ? error.message : 'team_ai_failed';
}
