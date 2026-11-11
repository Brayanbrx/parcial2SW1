import { isDeepStrictEqual } from 'node:util';
import { commandBatchSchema, roleCanWrite, type CommandBatch } from '@uml/contracts';
import type { PrismaClient } from '@prisma/client';
import { conflict, forbidden, HttpError } from '../../lib/http-error.js';
import {
  expireProposalIfDue,
  nextTeamTimestamp,
  withTeamBoard,
  type TeamTransaction,
} from './persistence.js';
import type { PublishTeamEvent } from './events.js';

/** El orden del conjunto puede variar. Solo dispatch puede añadir position a
 * CREATE_CLASS cuando la propuesta todavía no la fijaba. */
export function matchesProposal(expected: CommandBatch, received: CommandBatch): boolean {
  if (
    expected.batchId !== received.batchId ||
    expected.actorId !== received.actorId ||
    expected.origin !== received.origin ||
    expected.issuedAt !== received.issuedAt ||
    expected.commands.length !== received.commands.length ||
    new Set(expected.commands.map((c) => c.commandId)).size !== expected.commands.length ||
    new Set(received.commands.map((c) => c.commandId)).size !== received.commands.length
  )
    return false;
  const byId = new Map(received.commands.map((command) => [command.commandId, command]));
  return expected.commands.every((command) => {
    const actual = byId.get(command.commandId);
    if (!actual) return false;
    if (
      command.type === 'CREATE_CLASS' &&
      actual.type === 'CREATE_CLASS' &&
      command.payload.position === undefined
    ) {
      const { position: _position, ...payload } = actual.payload;
      return isDeepStrictEqual(command, { ...actual, payload });
    }
    return isDeepStrictEqual(command, actual);
  });
}

const mismatch = () => conflict('audit_conflict', 'El lote no coincide con el registro esperado.');
const auditPayload = (batch: CommandBatch) => ({
  commands: batch.commands,
  issuedAt: batch.issuedAt,
});

async function checkProposal(
  tx: TeamTransaction,
  boardId: string,
  userId: string,
  batch: CommandBatch,
  raw: unknown,
  emit: PublishTeamEvent,
) {
  const proposal = await tx.aiProposal.findUnique({
    where: { boardId_batchId: { boardId, batchId: batch.batchId } },
  });
  if (!proposal) return null;
  if (proposal.requesterId !== userId) throw forbidden();
  if (await expireProposalIfDue(tx, proposal, emit))
    return conflict('invalid_transition', 'La propuesta ya venció.');
  const expected = commandBatchSchema.safeParse(proposal.batch);
  if (!expected.success || !isDeepStrictEqual(raw, batch) || !matchesProposal(expected.data, batch))
    return mismatch();
  if (proposal.status !== 'READY' && proposal.status !== 'APPLIED')
    return conflict('invalid_transition', 'La propuesta no está lista o ya venció.');
  return proposal;
}

function sameAudit(
  saved: { actorId: string | null; origin: string; payload: unknown },
  userId: string,
  batch: CommandBatch,
) {
  return (
    saved.actorId === userId &&
    saved.origin === batch.origin &&
    isDeepStrictEqual(saved.payload, auditPayload(batch))
  );
}

/** El móvil consulta el registro antes de que el lote pueda cambiar la sala. */
export async function checkAuditBeforeApply(
  prisma: PrismaClient,
  boardId: string,
  userId: string,
  batch: CommandBatch,
  raw: unknown,
  publish: PublishTeamEvent,
) {
  return withTeamBoard<boolean>(
    prisma,
    boardId,
    userId,
    async (tx, { role, emit }) => {
      if (!roleCanWrite(role)) throw forbidden();
      const proposal = await checkProposal(tx, boardId, userId, batch, raw, emit);
      if (proposal instanceof HttpError) return proposal;
      const saved = await tx.auditOperation.findUnique({
        where: { boardId_batchId: { boardId, batchId: batch.batchId } },
      });
      if (saved && !sameAudit(saved, userId, batch)) return mismatch();
      return saved !== null;
    },
    publish,
  );
}

export async function recordAudit(
  prisma: PrismaClient,
  boardId: string,
  userId: string,
  batch: CommandBatch,
  raw: unknown,
  publish: PublishTeamEvent = () => {},
) {
  return withTeamBoard(
    prisma,
    boardId,
    userId,
    async (tx, { role, emit }) => {
      if (!roleCanWrite(role)) throw forbidden();
      const proposal = await checkProposal(tx, boardId, userId, batch, raw, emit);
      if (proposal instanceof HttpError) return proposal;
      const payload = auditPayload(batch);
      const inserted = await tx.auditOperation.createMany({
        data: [
          {
            boardId,
            batchId: batch.batchId,
            origin: batch.origin,
            actorId: userId,
            payload,
          },
        ],
        skipDuplicates: true,
      });
      const saved = await tx.auditOperation.findUniqueOrThrow({
        where: { boardId_batchId: { boardId, batchId: batch.batchId } },
      });
      if (!sameAudit(saved, userId, batch)) return mismatch();
      let changed = false;
      if (proposal?.status === 'READY') {
        const updated = await tx.aiProposal.updateMany({
          where: { id: proposal.id, status: 'READY' },
          data: {
            status: 'APPLIED',
            decidedById: userId,
            decidedAt: new Date(),
            updatedAt: await nextTeamTimestamp(tx, boardId),
          },
        });
        changed = updated.count === 1;
        if (changed)
          emit({ type: 'team.update', boardId, proposalId: proposal.id, status: 'APPLIED' });
      }
      return {
        batchId: batch.batchId,
        ...(proposal ? { proposalId: proposal.id, status: 'APPLIED' as const } : {}),
        // Metadatos internos para los pasos 4/9; no equivalen a convergencia Yjs.
        created: inserted.count === 1,
        proposalChanged: changed,
      };
    },
    publish,
  );
}
