import { commandBatchSchema } from '@uml/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/http-error.js';
import { currentUser } from '../../plugins/auth.js';
import { requireMembership, requireWriteAccess } from '../projects/membership.js';

const boardParams = z.object({ boardId: z.string().uuid() });
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Auditoria de lotes
 * El protocolo colaborativo transporta actualizaciones del documento, no comandos de dominio
 * El comando se aplica localmente y viaja la actualizacion resultante
 * Los comandos se registran para auditoria, no para sincronizar y por eso el registro va aparte
 * por HTTP, donde ya hay una sesion autenticada.
 */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.post('/boards/:boardId/audit', async (request, reply) => {
    const { boardId } = boardParams.parse(request.params);
    const batch = commandBatchSchema.parse(request.body);
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    await requireWriteAccess(app.prisma, board.projectId, userId);

    // Idempotente por batchId: reintentar envio tras corte de red no duplica entrada del registro
    // El lote es la unidad transaccional y tambien es la unidad de identidad
    await app.prisma.auditOperation.upsert({
      where: { boardId_batchId: { boardId, batchId: batch.batchId } },
      update: {},
      create: {
        boardId,
        batchId: batch.batchId,
        origin: batch.origin,
        actorId: userId,
        payload: { commands: batch.commands, issuedAt: batch.issuedAt },
      },
    });

    reply.code(202);
    return { batchId: batch.batchId };
  });

  app.get('/boards/:boardId/audit', async (request) => {
    const { boardId } = boardParams.parse(request.params);
    const { limit } = historyQuery.parse(request.query ?? {});
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    // Leer el historial no modifica nada: un VIEWER puede revisar quien cambio
    // que, que es para lo que sirve un registro de auditoria
    await requireMembership(app.prisma, board.projectId, userId);

    const operaciones = await app.prisma.auditOperation.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        batchId: true,
        origin: true,
        actorId: true,
        payload: true,
        createdAt: true,
      },
    });

    return operaciones.map((operacion) => ({
      id: operacion.id,
      batchId: operacion.batchId,
      origin: operacion.origin,
      actorId: operacion.actorId,
      createdAt: operacion.createdAt,
      // El historial se lee para saber quien hizo que, no para reproducir el
      // modelo: se resume en lugar de devolver cada carga entera
      commands: resumir(operacion.payload),
    }));
  });
}

function resumir(payload: unknown): readonly string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const commands = (payload as { commands?: unknown }).commands;
  if (!Array.isArray(commands)) return [];

  return commands.map((command) =>
    typeof command === 'object' && command !== null && 'type' in command
      ? String((command as { type: unknown }).type)
      : 'DESCONOCIDO',
  );
}

async function findBoard(
  app: FastifyInstance,
  boardId: string,
): Promise<{ id: string; projectId: string }> {
  const board = await app.prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, projectId: true },
  });

  if (board === null) throw notFound('La pizarra no existe.');
  return board;
}
