import { roleCanWrite } from '@uml/contracts';
import type { PrismaClient } from '@prisma/client';
import type { Connection } from '@hocuspocus/server';
import type { CollaborationContext } from './authorize.js';

export async function revalidateRoomAccess(
  prisma: PrismaClient,
  boardId: string,
  connections: readonly Connection<CollaborationContext>[],
  actorId?: string,
) {
  const ids = [
    ...new Set([...connections.map((c) => c.context.userId), ...(actorId ? [actorId] : [])]),
  ];
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      projectId: true,
      project: {
        select: {
          members: {
            where: { userId: { in: ids } },
            select: {
              userId: true,
              role: true,
              user: { select: { sessionVersion: true, emailVerifiedAt: true } },
            },
          },
        },
      },
    },
  });
  const members = new Map(
    board?.project.members.filter((m) => m.user.emailVerifiedAt !== null).map((m) => [m.userId, m]),
  );
  for (const connection of connections) {
    const context = connection.context;
    const member = members.get(context.userId);
    const expired =
      context.expiresAt <= Date.now() ||
      (member !== undefined && member.user.sessionVersion !== context.sessionVersion);
    if (expired || !member || board?.projectId !== context.projectId) {
      connection.close({
        code: expired ? 4401 : 4403,
        reason: expired ? 'token-invalido' : 'sin-acceso-a-la-pizarra',
      });
      continue;
    }
    const readOnly = !roleCanWrite(member.role);
    if (connection.readOnly !== readOnly) {
      connection.readOnly = readOnly;
      connection.sendStateless(JSON.stringify({ type: 'access-changed', readOnly }));
    }
  }
  return { projectId: board?.projectId, members };
}
