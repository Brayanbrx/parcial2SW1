import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server } from '@hocuspocus/server';
import type { PrismaClient } from '@prisma/client';
import { collaborationRoomName } from '@uml/contracts';
import { readBoardState } from '@uml/yjs-adapter';
import * as Y from 'yjs';
import { z } from 'zod';
import type { CollaborationContext } from './auth/authorize.js';
import { loadBoardDocument } from './persistence/board-store.js';

const MAX_BYTES = 4 * 1024;

const bodySchema = z.object({
  projectId: z.string().uuid(),
  boardId: z.string().uuid(),
});

/**
 * Ruta de servicio: estado completo de una pizarra, modelo y layout.
 *
 * La app movil dibuja el diagrama con las mismas posiciones que la web, y esas
 * posiciones solo viven en el documento Yjs: el snapshot guarda el modelo
 * semantico, no el layout.
 *
 * Solo lee. Si la sala esta abierta usa el documento vivo, que puede ir por
 * delante de lo guardado. Si no, reconstruye una copia desde la base sin abrir
 * la sala: una conexion directa guardaria el documento al cerrarse, y un
 * cliente que consulta cada pocos segundos escribiria en la base cada vez.
 */
export async function handleBoardState(options: {
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

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > MAX_BYTES) {
      respond(413, { error: 'payload_too_large' });
      request.resume();
      return;
    }
    chunks.push(bytes);
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    respond(400, { error: 'invalid_body' });
    return;
  }
  if (!parsed.success) {
    respond(400, { error: 'invalid_body' });
    return;
  }

  const { projectId, boardId } = parsed.data;
  const live = server.hocuspocus.documents.get(collaborationRoomName(projectId, boardId));
  if (live !== undefined) {
    respond(200, readBoardState(live));
    return;
  }

  const copy = new Y.Doc();
  try {
    await loadBoardDocument(prisma, boardId, copy);
    respond(200, readBoardState(copy));
  } finally {
    copy.destroy();
  }
}
