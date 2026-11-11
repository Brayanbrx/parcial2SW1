import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server } from '@hocuspocus/server';
import { collaborationRoomName, commandBatchSchema, type BoardState } from '@uml/contracts';
import { applyBatchToDocument, readBoardState } from '@uml/yjs-adapter';
import { z } from 'zod';
import type { CollaborationContext } from './auth/authorize.js';

const MAX_BYTES = 256 * 1024;

const bodySchema = z.object({
  projectId: z.string().uuid(),
  boardId: z.string().uuid(),
  batch: commandBatchSchema,
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
  respond: (status: number, body: unknown) => void;
}): Promise<void> {
  const { request, secret, server, respond } = options;
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

  const { projectId, boardId, batch } = parsed.data;
  const connection = await server.hocuspocus.openDirectConnection(
    collaborationRoomName(projectId, boardId),
    { projectId, boardId } as unknown as CollaborationContext,
  );
  try {
    let outcome: ReturnType<typeof applyBatchToDocument> | undefined;
    let state: BoardState | undefined;
    await connection.transact((document) => {
      outcome = applyBatchToDocument(document, batch, 'mobile-api');
      if (outcome.applied) state = readBoardState(document);
    });
    if (!outcome) {
      respond(500, { error: 'not_applied' });
      return;
    }
    const { applied, issues } = outcome;
    respond(200, {
      applied,
      issues,
      // Modelo y layout ya con el cambio: el cliente no espera al guardado diferido.
      ...(applied && state ? { model: state.semantic, layout: state.layout } : {}),
    });
  } finally {
    await connection.disconnect();
  }
}
