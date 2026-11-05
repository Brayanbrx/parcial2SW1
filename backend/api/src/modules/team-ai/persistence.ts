import type { AiProposal, Prisma, PrismaClient, TeamMessage } from '@prisma/client';
import type { ProjectRole, TeamAiEvent } from '@uml/contracts';
import { HttpError, notFound } from '../../lib/http-error.js';
import type { PublishTeamEvent } from './events.js';

export type TeamTransaction = Prisma.TransactionClient;

// La entrada UML es privada; solo el DTO publico sale al historial.
export function messageDto({ requestModel: _model, ...message }: TeamMessage) {
  return message;
}

export async function lockProject(
  tx: TeamTransaction,
  projectId: string,
  userId: string,
  write = false,
) {
  const projects = write
    ? await tx.$queryRaw<
        { id: string; createdAt: Date }[]
      >`SELECT id, "createdAt" FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`
    : await tx.$queryRaw<
        { id: string; createdAt: Date }[]
      >`SELECT id, "createdAt" FROM projects WHERE id = ${projectId}::uuid FOR SHARE`;
  const memberships = await tx.$queryRaw<{ role: ProjectRole }[]>`
    SELECT role FROM project_members WHERE "projectId" = ${projectId}::uuid AND "userId" = ${userId}::uuid FOR SHARE`;
  const project = projects[0];
  const membership = memberships[0];
  if (!project || !membership) throw notFound();
  return { ...project, role: membership.role };
}

/** Todas las escrituras del feed, incluido el worker, deben tomar este
 * bloqueo. Evita commits tardíos detrás de un cursor y serializa decisiones.
 * No se mantiene abierto durante llamadas a proveedores o a colaboración. */
export async function withTeamBoard<T>(
  prisma: PrismaClient,
  boardId: string,
  userId: string,
  work: (
    tx: TeamTransaction,
    context: { projectId: string; role: ProjectRole; emit: PublishTeamEvent },
  ) => Promise<T | HttpError>,
  publish: PublishTeamEvent = () => {},
): Promise<T> {
  const events: TeamAiEvent[] = [];
  const emit: PublishTeamEvent = (event) => events.push(event);
  const result = await prisma.$transaction(
    async (tx) => {
      const board = await tx.board.findUnique({ where: { id: boardId } });
      if (!board) throw notFound();
      const project = await lockProject(tx, board.projectId, userId);
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
      if (!locked.length) throw notFound();
      const expired = await tx.aiProposal.updateManyAndReturn({
        where: {
          boardId,
          status: { in: ['READY', 'PENDING_CONFIRMATION'] },
          expiresAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED', updatedAt: await nextTeamTimestamp(tx, boardId) },
        select: { id: true },
      });
      for (const proposal of expired)
        emit({ type: 'team.update', boardId, proposalId: proposal.id, status: 'EXPIRED' });
      return work(tx, { projectId: board.projectId, role: project.role, emit });
    },
    { timeout: 10_000, maxWait: 10_000 },
  );
  // Solo después del commit; un rollback no puede producir una notificación.
  for (const event of events) publish(event);
  // La expiración perezosa se confirma incluso si la acción solicitada da 409.
  if (result instanceof HttpError) throw result;
  return result;
}

export async function nextTeamTimestamp(tx: TeamTransaction, boardId: string): Promise<Date> {
  const [message, proposal] = await Promise.all([
    tx.teamMessage.findFirst({
      where: { boardId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { updatedAt: true },
    }),
    tx.aiProposal.findFirst({
      where: { boardId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { updatedAt: true },
    }),
  ]);
  return new Date(
    Math.max(
      Date.now(),
      (message?.updatedAt.getTime() ?? 0) + 1,
      (proposal?.updatedAt.getTime() ?? 0) + 1,
    ),
  );
}

/** Recomprueba la frontera temporal al decidir, además de la limpieza al leer. */
export async function expireProposalIfDue(
  tx: TeamTransaction,
  proposal: AiProposal,
  emit: PublishTeamEvent = () => {},
): Promise<boolean> {
  if (
    (proposal.status !== 'READY' && proposal.status !== 'PENDING_CONFIRMATION') ||
    proposal.expiresAt.getTime() > Date.now()
  )
    return false;
  await tx.aiProposal.updateMany({
    where: { id: proposal.id, status: proposal.status },
    data: {
      status: 'EXPIRED',
      updatedAt: await nextTeamTimestamp(tx, proposal.boardId),
    },
  });
  emit({
    type: 'team.update',
    boardId: proposal.boardId,
    proposalId: proposal.id,
    status: 'EXPIRED',
  });
  return true;
}
