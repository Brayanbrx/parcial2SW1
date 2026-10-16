import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { SCHEMA_VERSION } from '@uml/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/http-error.js';
import { currentUser } from '../../plugins/auth.js';
import { requireMembership, requireRole } from './membership.js';

const projectBody = z.object({
  displayName: z.string().trim().min(1).max(120),
});

const inviteBody = z.object({
  // No se puede invitar como propietario: el proyecto tiene uno solo
  role: z.enum(['EDITOR', 'VIEWER']),
});

const roleBody = z.object({
  // El proyecto tiene un solo propietario, fijado en ownerId
  role: z.enum(['EDITOR', 'VIEWER']),
});

const projectParams = z.object({ projectId: z.string().uuid() });
const memberParams = projectParams.extend({ userId: z.string().uuid() });
const acceptParams = z.object({ code: z.string().min(8).max(64) });

// Proyectos, membresias e invitaciones
export async function projectRoutes(
  app: FastifyInstance,
  options: { config: Config },
): Promise<void> {
  const { config } = options;

  app.addHook('preHandler', app.authenticate);

  app.get('/projects', async (request) => {
    const { userId } = currentUser(request);

    const memberships = await app.prisma.projectMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      select: {
        role: true,
        joinedAt: true,
        project: {
          select: {
            id: true,
            displayName: true,
            ownerId: true,
            schemaVersion: true,
            createdAt: true,
            _count: { select: { boards: true, members: true } },
          },
        },
      },
    });

    return memberships.map(({ project, role, joinedAt }) => ({
      ...project,
      _count: undefined,
      boardCount: project._count.boards,
      memberCount: project._count.members,
      role,
      joinedAt,
    }));
  });

  // Quien crea el proyecto queda como propietario
  app.post('/projects', async (request, reply) => {
    const body = projectBody.parse(request.body);
    const { userId } = currentUser(request);

    const project = await app.prisma.project.create({
      data: {
        displayName: body.displayName,
        ownerId: userId,
        schemaVersion: SCHEMA_VERSION,
        members: { create: { userId, role: 'OWNER' } },
      },
    });

    reply.code(201);
    return project;
  });

  app.get('/projects/:projectId', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const { userId } = currentUser(request);
    const role = await requireMembership(app.prisma, projectId, userId);

    const project = await app.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        boards: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, displayName: true, type: true, createdAt: true },
        },
      },
    });

    return { ...project, role };
  });

  app.patch('/projects/:projectId', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const body = projectBody.parse(request.body);
    const { userId } = currentUser(request);
    await requireRole(app.prisma, projectId, userId, 'OWNER');

    return app.prisma.project.update({
      where: { id: projectId },
      data: { displayName: body.displayName },
    });
  });

  app.delete('/projects/:projectId', async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const { userId } = currentUser(request);
    await requireRole(app.prisma, projectId, userId, 'OWNER');

    // El esquema borra en cascada pizarras, documentos, snapshots y membresias.
    await app.prisma.project.delete({ where: { id: projectId } });

    reply.code(204);
    return null;
  });

  // -------------------------------------------------------------------------
  // Miembros
  // -------------------------------------------------------------------------

  app.get('/projects/:projectId/members', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const { userId } = currentUser(request);
    await requireMembership(app.prisma, projectId, userId);

    const members = await app.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { joinedAt: 'asc' },
      select: {
        role: true,
        joinedAt: true,
        user: { select: { id: true, email: true, displayName: true } },
      },
    });

    return members.map(({ user, role, joinedAt }) => ({ ...user, role, joinedAt }));
  });

  app.patch('/projects/:projectId/members/:userId', async (request) => {
    const params = memberParams.parse(request.params);
    const body = roleBody.parse(request.body);
    const actor = currentUser(request);
    await requireRole(app.prisma, params.projectId, actor.userId, 'OWNER');

    const project = await app.prisma.project.findUniqueOrThrow({
      where: { id: params.projectId },
      select: { ownerId: true },
    });

    // Degradar al propietario dejaria el proyecto sin nadie que pueda invitar
    if (params.userId === project.ownerId) {
      throw conflict('owner_immutable', 'No se puede quitar el rol al propietario del proyecto.');
    }

    const updated = await app.prisma.projectMember.updateMany({
      where: { projectId: params.projectId, userId: params.userId },
      data: { role: body.role },
    });

    if (updated.count === 0) throw notFound('Ese usuario no es miembro del proyecto.');

    return { projectId: params.projectId, userId: params.userId, role: body.role };
  });

  app.delete('/projects/:projectId/members/:userId', async (request, reply) => {
    const params = memberParams.parse(request.params);
    const actor = currentUser(request);

    // Autorizar antes de leer el propietario evita que un extra{o confirme que
    // un proyecto y su dueño existen apuntando la ruta al identificador correcto
    if (params.userId !== actor.userId) {
      await requireRole(app.prisma, params.projectId, actor.userId, 'OWNER');
    } else {
      await requireMembership(app.prisma, params.projectId, actor.userId);
    }

    const project = await app.prisma.project.findUniqueOrThrow({
      where: { id: params.projectId },
      select: { ownerId: true },
    });

    if (params.userId === project.ownerId) {
      throw conflict('owner_immutable', 'El propietario no puede salir del proyecto.');
    }

    const removed = await app.prisma.projectMember.deleteMany({
      where: { projectId: params.projectId, userId: params.userId },
    });

    if (removed.count === 0) throw notFound('Ese usuario no es miembro del proyecto.');

    reply.code(204);
    return null;
  });

  // -------------------------------------------------------------------------
  // Invitaciones
  // -------------------------------------------------------------------------

  app.post('/projects/:projectId/invites', async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const body = inviteBody.parse(request.body);
    const { userId } = currentUser(request);
    await requireRole(app.prisma, projectId, userId, 'OWNER');

    const invite = await app.prisma.projectInvite.create({
      data: {
        projectId,
        // 32 caracteres aleatorios: no es adivinable, y es lo unico que protege
        // el enlace porque no se verifica quien lo abre
        code: randomBytes(24).toString('base64url'),
        role: body.role,
        expiresAt: new Date(Date.now() + config.INVITE_TTL_SECONDS * 1000),
        createdBy: userId,
      },
      select: { id: true, code: true, role: true, expiresAt: true, createdAt: true },
    });

    reply.code(201);
    return invite;
  });

  app.get('/projects/:projectId/invites', async (request) => {
    const { projectId } = projectParams.parse(request.params);
    const { userId } = currentUser(request);
    await requireRole(app.prisma, projectId, userId, 'OWNER');

    return app.prisma.projectInvite.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, role: true, expiresAt: true, createdAt: true },
    });
  });

  // Aceptar la invitacion y quedar como miembro
  app.post('/invites/:code/accept', async (request) => {
    const { code } = acceptParams.parse(request.params);
    const { userId } = currentUser(request);

    const invite = await app.prisma.projectInvite.findUnique({
      where: { code },
      select: { projectId: true, role: true, expiresAt: true },
    });

    if (invite === null) throw notFound('Esa invitacion no existe.');
    if (invite.expiresAt <= new Date()) throw badRequest('invite_expired', 'La invitacion expiro.');

    const existing = await app.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: invite.projectId, userId } },
      select: { role: true },
    });

    // Aceptar dos veces no es un error: devuelve la membresia que ya hay
    // Un enlace compartido se abre mas de una vez y fallar la segunda solo confunde
    if (existing !== null) {
      return { projectId: invite.projectId, role: existing.role, alreadyMember: true };
    }

    try {
      const member = await app.prisma.projectMember.create({
        data: { projectId: invite.projectId, userId, role: invite.role },
        select: { projectId: true, role: true },
      });
      return { ...member, alreadyMember: false };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      // Dos pestañas pueden aceptar a la vez. Se conserva el rol que ya ganó,
      // sin convertir la segunda aceptación en un 500 ni cambiar permisos.
      const member = await app.prisma.projectMember.findUniqueOrThrow({
        where: { projectId_userId: { projectId: invite.projectId, userId } },
        select: { projectId: true, role: true },
      });
      return { ...member, alreadyMember: true };
    }
  });

  app.delete('/projects/:projectId/invites/:inviteId', async (request, reply) => {
    const { projectId } = projectParams.parse(request.params);
    const { inviteId } = z.object({ inviteId: z.string().uuid() }).parse(request.params);
    const { userId } = currentUser(request);
    await requireRole(app.prisma, projectId, userId, 'OWNER');

    const removed = await app.prisma.projectInvite.deleteMany({
      where: { id: inviteId, projectId },
    });

    if (removed.count === 0) throw notFound('Esa invitacion no existe.');

    reply.code(204);
    return null;
  });
}

export { forbidden };
