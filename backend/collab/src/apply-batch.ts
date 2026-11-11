import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Connection, Server } from '@hocuspocus/server';
import type { PrismaClient } from '@prisma/client';
import { collaborationRoomName, commandBatchSchema, roleCanWrite } from '@uml/contracts';
import { applyBatchToDocument, readBoardState } from '@uml/yjs-adapter';
import { z } from 'zod';
import type { CollaborationContext } from './auth/authorize.js';
import { revalidateRoomAccess } from './auth/room-access.js';

const MAX_BYTES = 256 * 1024;

const bodySchema = z.object({
  projectId: z.string().uuid(),
  boardId: z.string().uuid(),
  batch: commandBatchSchema,
  recorded: z.boolean().default(false),
  sessionVersion: z.number().int().nonnegative().default(0),
});

/**
 * Ruta de servicio: aplica un lote de comandos sobre el documento vivo.
 *
 * La usa el proceso HTTP para clientes que no hablan el protocolo Yjs (la app
 * movil). El lote ya llega autenticado y autorizado por la API; aqui solo se
 * valida con el mismo dominio que el editor y se escribe dentro de la sala, de
 * modo que quien tenga la pizarra abierta vea el cambio al instante y el
 * guardado habitual lo persista.
 */
export async function handleApplyBatch(options: {
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

  const { projectId, boardId, batch, recorded, sessionVersion } = parsed.data;
  const room = collaborationRoomName(projectId, boardId);
  const connection = await server.hocuspocus.openDirectConnection(room, {
    projectId,
    boardId,
  } as unknown as CollaborationContext);
  let status = 200;
  let body: unknown;
  try {
    const document = server.hocuspocus.documents.get(room);
    if (!document) throw new Error('No se abrió el documento.');
    const access = await revalidateRoomAccess(
      prisma,
      boardId,
      document.getConnections() as Connection<CollaborationContext>[],
      batch.actorId,
    );
    const actor = access.members.get(batch.actorId);
    if (
      access.projectId !== projectId ||
      !actor ||
      !roleCanWrite(actor.role) ||
      actor.user.sessionVersion !== sessionVersion
    ) {
      status = 403;
      body = { error: 'forbidden' };
    } else {
      const fingerprint = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
      await connection.transact((live) => {
        // Se guarda junto al cambio. Un reintento tras perder la respuesta puede
        // llegar antes de que la API haya escrito la auditoría en PostgreSQL.
        const receipts = live.getMap<string>('mobileBatchReceipts');
        const previous = receipts.get(batch.batchId);
        if (previous !== undefined && previous !== fingerprint) {
          status = 409;
          body = { error: 'audit_conflict' };
          return;
        }
        const outcome =
          previous !== undefined || recorded
            ? { applied: true, issues: [] }
            : applyBatchToDocument(live, batch, 'mobile-api');
        if (outcome.applied) {
          if (!recorded && previous === undefined) receipts.set(batch.batchId, fingerprint);
          const state = readBoardState(live);
          body = { ...outcome, model: state.semantic, layout: state.layout };
        } else body = outcome;
      });
    }
  } finally {
    await connection.disconnect();
  }
  respond(status, body);
}
