import { BOARD_TYPES, collaborationRoomName, emptyBoardState } from '@uml/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/http-error.js';
import { currentUser } from '../../plugins/auth.js';
import { requireMembership, requireWriteAccess } from '../projects/membership.js';

const boardBody = z.object({
  displayName: z.string().trim().min(1).max(120),
  type: z.enum(BOARD_TYPES).default('CLASS_DIAGRAM'),
});

const renameBody = z.object({
  displayName: z.string().trim().min(1).max(120),
});

const projectParams = z.object({ projectId: z.string().uuid() });
const boardParams = z.object({ boardId: z.string().uuid() });

/**
 * Cada Pizarra tiene su propia sesion colaborativa y su propio documento
 * Aqui solo viven los metadatos: el estado vivo va por el proceso de
 * colaboracion, estas rutas devuelven el nombre de sala con el que conectarse
 */
export async function boardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/projects/:projectId/boards', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const { userId } = currentUser(request);
    await requireMembership(app.prisma, projectId, userId);

    const boards = await app.prisma.board.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, projectId: true, displayName: true, type: true, createdAt: true },
    });

    return boards.map((board) => ({ ...board, room: collaborationRoomName(projectId, board.id) }));
  });

  app.post('/projects/:projectId/boards', async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const body = boardBody.parse(request.body);
    const { userId } = currentUser(request);
    await requireWriteAccess(app.prisma, projectId, userId);

    const inicial = emptyBoardState();
    const board = await app.prisma.board.create({
      data: {
        projectId,
        displayName: body.displayName,
        type: body.type,
        snapshots: { create: { version: 1, canonicalJson: inicial.semantic } },
      },
      select: { id: true, projectId: true, displayName: true, type: true, createdAt: true },
    });

    reply.code(201);
    return { ...board, room: collaborationRoomName(projectId, board.id) };
  });

  app.get('/boards/:boardId', async (request) => {
    const { boardId } = boardParams.parse(request.params);
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    const role = await requireMembership(app.prisma, board.projectId, userId);

    const snapshot = await app.prisma.boardSnapshot.findUnique({
      where: { boardId_version: { boardId, version: 1 } },
      select: { version: true, canonicalJson: true, updatedAt: true },
    });

    return {
      ...board,
      role,
      room: collaborationRoomName(board.projectId, board.id),
      snapshot,
    };
  });

  app.patch('/boards/:boardId', async (request) => {
    const { boardId } = boardParams.parse(request.params);
    const body = renameBody.parse(request.body);
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    await requireWriteAccess(app.prisma, board.projectId, userId);

    return app.prisma.board.update({
      where: { id: boardId },
      data: { displayName: body.displayName },
      select: { id: true, projectId: true, displayName: true, type: true, createdAt: true },
    });
  });

  app.delete('/boards/:boardId', async (request, reply) => {
    const { boardId } = boardParams.parse(request.params);
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    await requireWriteAccess(app.prisma, board.projectId, userId);

    await app.prisma.board.delete({ where: { id: boardId } });

    reply.code(204);
    return null;
  });
}

async function findBoard(
  app: FastifyInstance,
  boardId: string,
): Promise<{ id: string; projectId: string; displayName: string; type: string; createdAt: Date }> {
  const board = await app.prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, projectId: true, displayName: true, type: true, createdAt: true },
  });

  if (board === null) throw notFound('La pizarra no existe.');
  return board;
}
