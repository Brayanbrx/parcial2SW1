import { randomUUID } from 'node:crypto';
import { collaborationRoomName } from '@uml/contracts';
import type { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';

/**
 * Escenario minimo: un proyecto con tres pizarras y tres personas con roles
 * distintos.
 *
 * Se siembra escribiendo en la base directamente y no llamando al proceso HTTP:
 * lo que se prueba aqui es la autorizacion de la conexion, y meter la API por
 * medio anadiria un motivo de fallo ajeno a lo que se quiere comprobar.
 */

export interface Escenario {
  readonly projectId: string;
  readonly boardId: string;
  readonly otraBoardId: string;
  readonly terceraBoardId: string;
  readonly room: string;
  readonly otraRoom: string;
  readonly terceraRoom: string;
  readonly duenaToken: string;
  readonly editorToken: string;
  readonly lectorToken: string;
  readonly extranoToken: string;
  readonly editorId: string;
}

export async function seedProject(prisma: PrismaClient, jwtSecret: string): Promise<Escenario> {
  const clave = new TextEncoder().encode(jwtSecret);

  const crearUsuario = async (email: string): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0] as string,
        passwordHash: 'no-se-usa',
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    return user.id;
  };

  const duenaId = await crearUsuario(`duena-${randomUUID()}@example.com`);
  const editorId = await crearUsuario(`editor-${randomUUID()}@example.com`);
  const lectorId = await crearUsuario(`lector-${randomUUID()}@example.com`);
  const extranoId = await crearUsuario(`extrano-${randomUUID()}@example.com`);

  const project = await prisma.project.create({
    data: {
      displayName: 'Proyecto de colaboracion',
      ownerId: duenaId,
      schemaVersion: '1.0.0',
      members: {
        create: [
          { userId: duenaId, role: 'OWNER' },
          { userId: editorId, role: 'EDITOR' },
          { userId: lectorId, role: 'VIEWER' },
        ],
      },
    },
    select: { id: true },
  });

  const crearPizarra = async (displayName: string): Promise<string> => {
    const board = await prisma.board.create({
      data: { projectId: project.id, displayName },
      select: { id: true },
    });
    return board.id;
  };

  const boardId = await crearPizarra('Ventas');
  const otraBoardId = await crearPizarra('Inventario');
  const terceraBoardId = await crearPizarra('Persistencia');

  const token = async (userId: string, email: string): Promise<string> =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('plataforma-uml')
      .setAudience('plataforma-uml-clients')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(clave);

  return {
    projectId: project.id,
    boardId,
    otraBoardId,
    terceraBoardId,
    room: collaborationRoomName(project.id, boardId),
    otraRoom: collaborationRoomName(project.id, otraBoardId),
    terceraRoom: collaborationRoomName(project.id, terceraBoardId),
    duenaToken: await token(duenaId, 'duena@example.com'),
    editorToken: await token(editorId, 'editor@example.com'),
    lectorToken: await token(lectorId, 'lector@example.com'),
    extranoToken: await token(extranoId, 'extrano@example.com'),
    editorId,
  };
}
