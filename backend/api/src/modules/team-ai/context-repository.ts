import type { Prisma, PrismaClient, TeamMessage } from '@prisma/client';
import type { TeamTurn, TeamContextInput } from '@uml/ai';
import { loadClarifications } from './clarifications.js';

export interface ContextLimits {
  groupLimit: number;
  personalLimit: number;
}
const select = {
  id: true,
  boardId: true,
  authorKind: true,
  authorId: true,
  addressedToId: true,
  replyToId: true,
  kind: true,
  text: true,
  createdAt: true,
} satisfies Prisma.TeamMessageSelect;

/** Solo columnas de conversación. requestModel nunca se carga como memoria. */
export async function loadTeamHistory(db: PrismaClient, job: TeamMessage, limits: ContextLimits) {
  const where: Prisma.TeamMessageWhereInput = {
    boardId: job.boardId,
    id: { not: job.id },
    OR: [{ authorKind: 'USER', status: 'DONE' }, { authorKind: { in: ['AI', 'SYSTEM'] } }],
  };
  const orderBy = [
    { createdAt: 'desc' },
    { id: 'desc' },
  ] satisfies Prisma.TeamMessageOrderByWithRelationInput[];
  const [group, personal, reference, context] = await Promise.all([
    db.teamMessage.findMany({ where, select, orderBy, take: limits.groupLimit }),
    db.teamMessage.findMany({
      where: {
        AND: [where, { OR: [{ authorId: job.authorId! }, { addressedToId: job.authorId! }] }],
      },
      select,
      orderBy,
      take: limits.personalLimit,
    }),
    job.replyToId
      ? db.teamMessage.findFirst({ where: { boardId: job.boardId, id: job.replyToId }, select })
      : null,
    job.mode === 'INSTRUCT'
      ? loadClarifications(db, job.boardId, job.authorId!, job.replyToId)
      : [],
  ]);
  const ancestors: typeof group = [];
  const seen = new Set(reference ? [reference.id] : []);
  let parentId = reference?.replyToId;
  while (parentId && ancestors.length < 10 && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = await db.teamMessage.findFirst({
      where: { id: parentId, boardId: job.boardId },
      select,
    });
    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.replyToId;
  }
  const ids = new Set([
    job.authorId!,
    ...group.flatMap((t) => (t.authorId ? [t.authorId] : [])),
    ...personal.flatMap((t) => (t.authorId ? [t.authorId] : [])),
    ...(reference?.authorId ? [reference.authorId] : []),
    ...ancestors.flatMap((t) => (t.authorId ? [t.authorId] : [])),
  ]);
  const users = await db.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, displayName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  const name = (id: string | null) => (id ? (names.get(id) ?? 'Participante') : 'Equipo');
  const turn = (row: (typeof group)[number]): TeamTurn => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    authorName:
      row.authorKind === 'USER' ? name(row.authorId) : row.authorKind === 'AI' ? 'IA' : 'Sistema',
  });
  const history: Omit<TeamContextInput, 'request'> = {
    boardId: job.boardId,
    requesterId: job.authorId!,
    requesterName: name(job.authorId),
    groupTurns: group.map(turn),
    personalTurns: personal.map(turn),
    ...limits,
    ...(job.replyToId ? { replyToId: job.replyToId } : {}),
    ...(reference ? { referencedTurn: turn(reference) } : {}),
    referenceTurns: ancestors.map(turn),
  };
  return { history, context };
}
