import { commandBatchSchema } from '@uml/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/http-error.js';
import { currentUser } from '../../plugins/auth.js';
import { requireMembership, requireWriteAccess } from '../projects/membership.js';
import type { PushNotifier } from '../push/push.js';
import { checkAuditBeforeApply, recordAudit } from '../team-ai/audit-ack.js';
import type { PublishTeamEvent } from '../team-ai/events.js';
import type { TeamModerator } from '../team-ai/moderator.js';
import { isSemanticBatch } from '../team-ai/review-evidence.js';

const boardParams = z.object({ boardId: z.string().uuid() });

/**
 * Edicion por HTTP para clientes sin protocolo Yjs (app movil).
 *
 * El lote se valida con el mismo dominio que el editor web y se escribe en la
 * sala colaborativa viva, asi que quien tenga la pizarra abierta lo ve al
 * instante. Despues se registra en la auditoria y se avisa por push al resto.
 */
export async function mobileEditRoutes(
  app: FastifyInstance,
  options: {
    config: Config;
    publish: PublishTeamEvent;
    moderator?: TeamModerator | undefined;
    push?: PushNotifier | undefined;
  },
): Promise<void> {
  const { config, publish, moderator, push } = options;
  app.addHook('preHandler', app.authenticate);

  app.post('/boards/:boardId/commands', async (request) => {
    const { boardId } = boardParams.parse(request.params);
    const batch = commandBatchSchema.parse(request.body);
    const { userId, sessionVersion = 0 } = currentUser(request);

    if (batch.actorId !== userId) {
      throw badRequest('actor_mismatch', 'El lote debe declarar a quien lo envía como autor.');
    }
    const board = await app.prisma.board.findUnique({
      where: { id: boardId },
      select: { projectId: true },
    });
    if (board === null) throw notFound('La pizarra no existe.');
    await requireWriteAccess(app.prisma, board.projectId, userId);

    if (!config.COLLAB_INTERNAL_SECRET) {
      throw new HttpError(503, 'collab_unavailable', 'La edición móvil no está configurada.');
    }
    const recorded = await checkAuditBeforeApply(
      app.prisma,
      boardId,
      userId,
      batch,
      request.body,
      publish,
    );
    let result: {
      applied: boolean;
      issues: unknown[];
      model?: unknown;
      layout?: unknown;
    };
    try {
      const response = await fetch(`${config.COLLAB_INTERNAL_URL}/internal/apply`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.COLLAB_INTERNAL_SECRET}`,
        },
        body: JSON.stringify({
          projectId: board.projectId,
          boardId,
          batch,
          recorded,
          sessionVersion,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 409)
        throw conflict('audit_conflict', 'El lote no coincide con el registro esperado.');
      if (response.status === 403) throw forbidden();
      if (!response.ok) throw new Error(`collab ${response.status}`);
      result = (await response.json()) as typeof result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      request.log.warn({ err: String(error) }, 'no se pudo aplicar el lote en colaboración');
      throw new HttpError(503, 'collab_unavailable', 'No se pudo aplicar el cambio. Reintenta.');
    }

    if (!result.applied) {
      throw new HttpError(
        422,
        'batch_rejected',
        'El cambio no es válido para el modelo actual.',
        result.issues,
      );
    }

    const audit = await recordAudit(app.prisma, boardId, userId, batch, request.body, publish);
    if (audit.created) {
      if (isSemanticBatch(batch.commands)) moderator?.notify(boardId);
      push?.notifyBatch(boardId, userId, batch);
    }
    return { applied: true, issues: result.issues, model: result.model, layout: result.layout };
  });

  /**
   * Modelo y layout vivos de la pizarra, para dibujar el diagrama como la web.
   * El snapshot de `GET /boards/:id` solo trae el modelo: las posiciones viven
   * en el documento colaborativo. Leer no exige escritura: un VIEWER tambien ve.
   */
  app.get('/boards/:boardId/state', async (request) => {
    const { boardId } = boardParams.parse(request.params);
    const { userId } = currentUser(request);
    const board = await app.prisma.board.findUnique({
      where: { id: boardId },
      select: { projectId: true },
    });
    if (board === null) throw notFound('La pizarra no existe.');
    await requireMembership(app.prisma, board.projectId, userId);

    if (!config.COLLAB_INTERNAL_SECRET) {
      throw new HttpError(503, 'collab_unavailable', 'La vista de diagrama no está configurada.');
    }
    try {
      const response = await fetch(`${config.COLLAB_INTERNAL_URL}/internal/state`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.COLLAB_INTERNAL_SECRET}`,
        },
        body: JSON.stringify({ projectId: board.projectId, boardId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`collab ${response.status}`);
      return (await response.json()) as unknown;
    } catch (error) {
      request.log.warn({ err: String(error) }, 'no se pudo leer el estado de la pizarra');
      throw new HttpError(503, 'collab_unavailable', 'No se pudo cargar el diagrama. Reintenta.');
    }
  });
}
