import { SCHEMA_VERSION, collaborationRoomName, semanticModelSchema } from '@uml/contracts';
import {
  buildGenerationIr,
  InvalidGenerationModelError,
  type GenerationIr,
} from '@uml/generation-ir';
import { InvalidIdentifierError, isJavaReserved } from '@uml/domain-core';
import {
  generateSpringProject,
  generateMobileProject,
  sha256,
  templatesFingerprint,
} from '@uml/generator-backend';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { HttpError, notFound } from '../../lib/http-error.js';
import { currentUser } from '../../plugins/auth.js';
import { requireMembership, requireWriteAccess } from '../projects/membership.js';

const boardParams = z.object({ boardId: z.string().uuid() });
const generationParams = z.object({ generationId: z.string().uuid() });

const generateBody = z.object({
  includeMobile: z.boolean().default(false),
  /** Paquete Java raiz del proyecto generado. */
  basePackage: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'No es un paquete Java valido.')
    .refine(
      (value) => value.split('.').every((segment) => !isJavaReserved(segment)),
      'El paquete contiene una palabra reservada de Java.',
    )
    .optional(),
});

const downloadQuery = z.object({
  target: z.enum(['spring', 'mobile']).default('spring'),
});

/**
 * Generacion de codigo desde una pizarra
 *
 * Generar hace dos cosas antes de emitir nada: pide al proceso de colaboracion que escriba el
 * documento vivo, y copia esa proyeccion a una version nueva que ya nadie
 * volvera a tocar.
 * Cada generacion congela nombre, paquete, version de esquema, huella de
 * plantillas y el SHA-256 de cada objetivo
 */
export async function generationRoutes(
  app: FastifyInstance,
  options: { config: Config },
): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.post('/boards/:boardId/generations', async (request, reply) => {
    const { boardId } = boardParams.parse(request.params);
    const body = generateBody.parse(request.body ?? {});
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    // Generar no modifica la pizarra, produce el entregable del proyecto
    await requireWriteAccess(app.prisma, board.projectId, userId);

    // Lo que la persona ve en pantalla puede ir por delante de la base
    await volcarDocumento(options.config, board, request.headers.authorization);

    const { snapshot, value: ir } = await congelarSnapshot(app, boardId, (congelado) =>
      construirIr(congelado, board.displayName, body.basePackage),
    );

    const generation = await app.prisma.generation.create({
      data: {
        boardId,
        snapshotVersion: snapshot.version,
        createdBy: userId,
        projectName: board.displayName,
        artifactId: ir.project.artifactId,
        basePackage: ir.project.groupId,
        schemaVersion: SCHEMA_VERSION,
        templatesHash: await templatesFingerprint(),
        status: 'CREATING',
      },
      select: { id: true, snapshotVersion: true, createdAt: true },
    });

    // La fila nace CREATING y pasa a READY cuando el artefacto se ha emitido
    let huellas: { spring: string; mobile?: string };
    try {
      huellas = await emitirHuellas(ir, body.includeMobile);
    } catch (error) {
      await app.prisma.generation.update({
        where: { id: generation.id },
        // Solo el mensaje, nunca la traza: esto se muestra en la interfaz.
        data: { status: 'FAILED', error: mensajeDeError(error) },
      });
      throw error;
    }

    await app.prisma.generation.update({
      where: { id: generation.id },
      data: { status: 'READY', springSha256: huellas.spring, mobileSha256: huellas.mobile ?? null },
    });

    reply.code(201);
    return {
      ...generation,
      boardId,
      status: 'READY',
      artifactName: `${ir.project.artifactId}.zip`,
      basePackage: ir.project.groupId,
      entities: ir.entities.length,
      sha256: huellas,
      downloads: {
        spring: `/api/generations/${generation.id}/download?target=spring`,
        ...(huellas.mobile
          ? { mobile: `/api/generations/${generation.id}/download?target=mobile` }
          : {}),
      },
    };
  });

  app.get('/boards/:boardId/generations', async (request) => {
    const { boardId } = boardParams.parse(request.params);
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    await requireMembership(app.prisma, board.projectId, userId);
    await marcarInterrumpidas(app, { boardId });

    return app.prisma.generation.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        snapshotVersion: true,
        createdAt: true,
        status: true,
        projectName: true,
        basePackage: true,
        templatesHash: true,
        springSha256: true,
        mobileSha256: true,
        error: true,
        author: { select: { id: true, displayName: true, email: true } },
      },
    });
  });

  app.get('/generations/:generationId/download', async (request, reply) => {
    const { generationId } = generationParams.parse(request.params);
    // Se sigue validando aunque solo haya un objetivo
    const { target } = downloadQuery.parse(request.query ?? {});
    const { userId } = currentUser(request);

    const access = await app.prisma.generation.findUnique({
      where: { id: generationId },
      select: { board: { select: { projectId: true } } },
    });
    if (access === null) throw notFound('La generacion no existe.');
    await requireMembership(app.prisma, access.board.projectId, userId);
    await marcarInterrumpidas(app, { generationId });

    const generation = await app.prisma.generation.findUnique({
      where: { id: generationId },
      select: {
        snapshotVersion: true,
        status: true,
        error: true,
        projectName: true,
        basePackage: true,
        templatesHash: true,
        springSha256: true,
        mobileSha256: true,
        board: { select: { id: true, projectId: true } },
        snapshot: { select: { canonicalJson: true } },
      },
    });

    if (generation === null) throw notFound('La generacion no existe.');
    if (generation.status !== 'READY') {
      throw new HttpError(
        409,
        'generation_not_ready',
        generation.status === 'FAILED'
          ? `Esa generacion fallo y no tiene artefacto: ${generation.error ?? 'sin detalle'}`
          : 'Esa generacion todavia se esta emitiendo.',
      );
    }

    const ir = construirIr(
      { version: generation.snapshotVersion, canonicalJson: generation.snapshot.canonicalJson },
      generation.projectName,
      generation.basePackage,
    );

    if (target === 'mobile' && generation.mobileSha256 === null)
      throw new HttpError(
        409,
        'mobile_not_generated',
        'Esta version no incluye Android. Genera de nuevo activando la opcion Flutter.',
      );
    const { nombre, zip } = await armarArtefacto(ir, target);

    const registrado = target === 'mobile' ? generation.mobileSha256 : generation.springSha256;
    const actual = sha256(zip);

    if (registrado !== null && registrado !== actual) {
      throw new HttpError(
        409,
        'artifact_drifted',
        'Esta generacion ya no se puede reproducir: el codigo emitido hoy no coincide ' +
          'byte a byte con el que se registro. Genera de nuevo desde la pizarra.',
        {
          registrado,
          actual,
          plantillasRegistradas: generation.templatesHash,
          plantillasActuales: await templatesFingerprint(),
        },
      );
    }

    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${nombre}"`)
      .header('content-length', String(zip.byteLength))
      // Permite comprobar la descarga sin abrirla, y es lo que compara la prueba
      .header('x-artifact-sha256', actual);

    return reply.send(zip);
  });

  // Elimina una generacion del historial
  app.delete('/generations/:generationId', async (request, reply) => {
    const { generationId } = generationParams.parse(request.params);
    const { userId } = currentUser(request);

    const generation = await app.prisma.generation.findUnique({
      where: { id: generationId },
      select: { boardId: true, snapshotVersion: true, board: { select: { projectId: true } } },
    });
    if (generation === null) throw notFound('La generacion no existe.');
    await requireWriteAccess(app.prisma, generation.board.projectId, userId);

    await app.prisma.$transaction(async (tx) => {
      await tx.generation.delete({ where: { id: generationId } });

      // Cada generacion congela su propia copia, pero se comprueba igual
      const referencias = await tx.generation.count({
        where: { boardId: generation.boardId, snapshotVersion: generation.snapshotVersion },
      });
      if (generation.snapshotVersion > 1 && referencias === 0) {
        await tx.boardSnapshot.delete({
          where: {
            boardId_version: { boardId: generation.boardId, version: generation.snapshotVersion },
          },
        });
      }
    });

    return reply.code(204).send();
  });
}

/**
 * Una fila CREATING solo vive mientras la peticion POST esta emitiendo
 */
async function marcarInterrumpidas(
  app: FastifyInstance,
  filtro: { boardId: string } | { generationId: string },
): Promise<void> {
  await app.prisma.generation.updateMany({
    where: {
      ...('boardId' in filtro ? { boardId: filtro.boardId } : { id: filtro.generationId }),
      status: 'CREATING',
      createdAt: { lt: new Date(Date.now() - 5 * 60_000) },
    },
    data: {
      status: 'FAILED',
      error: 'La emision se interrumpio antes de terminar. Genera el proyecto nuevamente.',
    },
  });
}

/**
 * Emite los dos objetivos y devuelve su huella
 */
async function emitirHuellas(
  ir: GenerationIr,
  mobile = false,
): Promise<{ spring: string; mobile?: string }> {
  const spring = await armarArtefacto(ir);
  return {
    spring: sha256(spring.zip),
    ...(mobile ? { mobile: sha256((await armarArtefacto(ir, 'mobile')).zip) } : {}),
  };
}

/** Lo que se le puede enseñar a un usuario de un fallo del servidor. */
function mensajeDeError(error: unknown): string {
  const mensaje = error instanceof Error ? error.message : String(error);
  return mensaje.length > 500 ? `${mensaje.slice(0, 500)}…` : mensaje;
}

async function armarArtefacto(
  ir: GenerationIr,
  target: 'spring' | 'mobile' = 'spring',
): Promise<{ nombre: string; zip: Buffer }> {
  const proyecto = await (target === 'mobile' ? generateMobileProject : generateSpringProject)(ir);
  return { nombre: proyecto.artifactName, zip: proyecto.zip };
}

function construirIr(
  snapshot: { version: number; canonicalJson: unknown },
  projectName: string,
  basePackage?: string,
): GenerationIr {
  try {
    return buildGenerationIr({
      model: semanticModelSchema.parse(snapshot.canonicalJson),
      snapshotVersion: snapshot.version,
      projectName,
      ...(basePackage === undefined ? {} : { basePackage }),
    });
  } catch (error) {
    // Un modelo con errores no se genera, los errores bloquean la generacion, no la edicion
    if (error instanceof InvalidGenerationModelError) {
      throw new HttpError(
        422,
        'model_not_generable',
        'El modelo tiene errores y no se puede generar.',
        { issues: error.issues },
      );
    }
    if (error instanceof InvalidIdentifierError) {
      throw new HttpError(
        422,
        'project_name_not_generable',
        'El nombre de la pizarra no puede convertirse en identificadores de codigo.',
        { reason: error.message },
      );
    }
    throw error;
  }
}

/**
 * Pide al proceso de colaboracion que escriba el documento vivo
 */
async function volcarDocumento(
  config: Config,
  board: { id: string; projectId: string },
  authorization: string | undefined,
): Promise<void> {
  const token = authorization?.replace(/^Bearer /i, '') ?? '';

  let respuesta: Response;
  try {
    respuesta = await fetch(`${config.COLLAB_INTERNAL_URL}/flush`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: collaborationRoomName(board.projectId, board.id), token }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(
      503,
      'collab_unreachable',
      'No se pudo contactar con el proceso de colaboracion para congelar la pizarra. ' +
        'Reintenta en unos segundos.',
    );
  }

  if (!respuesta.ok) {
    throw new HttpError(
      503,
      'collab_flush_failed',
      'El proceso de colaboracion no pudo guardar el estado actual de la pizarra.',
    );
  }
}

/**
 * Congela una version inmutable a partir de la proyeccion viva
 */
async function congelarSnapshot<T>(
  app: FastifyInstance,
  boardId: string,
  preparar: (snapshot: { version: number; canonicalJson: unknown }) => T,
): Promise<{ snapshot: { version: number; canonicalJson: unknown }; value: T }> {
  // Leer el maximo y despues insertar maximo+1 son dos operaciones, y dos
  // generaciones simultaneas leian el mismo maximo: la segunda moria con un 500
  // por clave duplicada, sin ninguna explicacion util.

  // Se bloquea la fila de la version viva mientras se decide el numero. Las
  // generaciones de la **misma** pizarra se ponen en fila —son milisegundos— y
  // las de pizarras distintas no se estorban.
  return app.prisma.$transaction(async (tx) => {
    const bloqueada = await tx.$queryRaw<{ canonicalJson: unknown }[]>`
      SELECT "canonicalJson"
      FROM "board_snapshots"
      WHERE "boardId" = ${boardId}::uuid AND "version" = 1
      FOR UPDATE
    `;

    const viva = bloqueada[0];
    if (viva === undefined) throw notFound('La pizarra no tiene ningun snapshot todavia.');

    const numeros = await tx.$queryRaw<{ version: number }[]>`
      SELECT (COALESCE(MAX("version"), 1) + 1)::int AS "version"
      FROM "board_snapshots"
      WHERE "boardId" = ${boardId}::uuid
    `;

    const version = numeros[0]?.version;
    if (version === undefined) {
      throw new HttpError(500, 'snapshot_no_congelado', 'No se pudo congelar la version.');
    }

    const snapshot = { version, canonicalJson: viva.canonicalJson };
    const value = preparar(snapshot);

    await tx.$executeRaw`
      INSERT INTO "board_snapshots" ("boardId", "version", "canonicalJson", "updatedAt")
      VALUES (${boardId}::uuid, ${version}, ${viva.canonicalJson}::jsonb, NOW())
    `;

    return { snapshot, value };
  });
}

async function findBoard(
  app: FastifyInstance,
  boardId: string,
): Promise<{ id: string; projectId: string; displayName: string }> {
  const board = await app.prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, projectId: true, displayName: true },
  });

  if (board === null) throw notFound('La pizarra no existe.');
  return board;
}
