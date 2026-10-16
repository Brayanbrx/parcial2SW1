import { PROJECT_ROLES, roleCanWrite, type ProjectRole } from '@uml/contracts';
import type { PrismaClient } from '@prisma/client';
import { forbidden, notFound } from '../../lib/http-error.js';

/**
 * Autorizacion por proyecto
 * 1. OWNER: Todo, mas invitar, cambiar roles y eliminar el proyecto
 * 2. EDITOR: Crear y editar pizarras, usar el asistente, generar codigo
 * 3. VIEWER: Ver pizarras y consultar al asistente sin modificar
 */
export const ROLE_RANK: Readonly<Record<ProjectRole, number>> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};

export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

/**
 * Devuelve el rol del usuario en el proyecto
 * Un no miembro recibe 404 y no 403: responder "no tienes permiso" confirmaria
 * que el proyecto existe a quien solo esta probando identificadores
 */
export async function requireMembership(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
): Promise<ProjectRole> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });

  if (membership === null) throw notFound('El proyecto no existe o no eres miembro.');
  return membership.role;
}

export async function requireRole(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  minimum: ProjectRole,
): Promise<ProjectRole> {
  const role = await requireMembership(prisma, projectId, userId);

  if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
    throw forbidden(`Esta operacion requiere el rol ${minimum} y el tuyo es ${role}.`);
  }
  return role;
}

// Escritura sobre pizarras: OWNER y EDITOR si, VIEWER no
export async function requireWriteAccess(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
): Promise<ProjectRole> {
  const role = await requireMembership(prisma, projectId, userId);
  if (!roleCanWrite(role)) {
    throw forbidden('Tu rol es de solo lectura en este proyecto.');
  }
  return role;
}
