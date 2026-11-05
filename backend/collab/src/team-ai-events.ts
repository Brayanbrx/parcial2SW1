import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Connection, Server } from '@hocuspocus/server';
import type { PrismaClient } from '@prisma/client';
import {
  MAX_TEAM_AI_EVENT_BYTES,
  collaborationRoomName,
  teamAiEventPayloadSchema,
} from '@uml/contracts';
import { parseRoomName, type CollaborationContext } from './auth/authorize.js';

/** Ruta de servicio: nunca acepta JWT de usuarios ni contenido de mensajes. */
export async function handleTeamAiEvent(options: {
  request: IncomingMessage;
  secret: string | undefined;
  server: Server<CollaborationContext>;
  prisma: PrismaClient;
  respond: (status: number, body: unknown) => void;
}): Promise<void> {
  const { request, secret, server, prisma, respond } = options;
  const supplied = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    respond(403, { error: 'forbidden' });
    return;
  }
  if (request.method !== 'POST') {
    respond(405, { error: 'method_not_allowed' });
    return;
  }
  // Drenar sin retener un cuerpo excesivo permite responder 413 sin destruir el socket.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size <= MAX_TEAM_AI_EVENT_BYTES) chunks.push(bytes);
    else {
      respond(413, { error: 'payload_too_large' });
      request.resume();
      return;
    }
  }
  const parsed = teamAiEventPayloadSchema.safeParse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed.success) {
    respond(400, { error: 'invalid_event' });
    return;
  }
  const event = parsed.data;
  const documents = [...server.hocuspocus.documents.values()].filter((document) => {
    const room = parseRoomName(document.name);
    return event.type === 'ai.settings'
      ? room.projectId === event.projectId
      : room.boardId === event.boardId;
  });
  let delivered = false;
  for (const document of documents) {
    const room = parseRoomName(document.name);
    const connections = document.getConnections() as Connection<CollaborationContext>[];
    const board = await prisma.board.findUnique({
      where: { id: room.boardId },
      select: {
        projectId: true,
        project: {
          select: {
            members: {
              where: { userId: { in: connections.map((c) => c.context.userId) } },
              select: { userId: true, user: { select: { sessionVersion: true } } },
            },
          },
        },
      },
    });
    const versions = new Map(board?.project.members.map((m) => [m.userId, m.user.sessionVersion]));
    const allowed = new Set<Connection<CollaborationContext>>();
    for (const connection of connections) {
      const context = connection.context;
      if (
        board?.projectId === context.projectId &&
        document.name === collaborationRoomName(context.projectId, context.boardId) &&
        context.expiresAt > Date.now() &&
        versions.get(context.userId) === context.sessionVersion
      ) {
        allowed.add(connection);
      } else {
        connection.close({ code: 4403, reason: 'sin-acceso-a-la-pizarra' });
      }
    }
    // La lista fija evita incluir conexiones llegadas mientras la consulta esperaba.
    document.broadcastStateless(JSON.stringify(event), (connection) =>
      allowed.has(connection as Connection<CollaborationContext>),
    );
    delivered ||= allowed.size > 0;
  }
  respond(delivered ? 202 : 204, delivered ? { accepted: true } : undefined);
}
