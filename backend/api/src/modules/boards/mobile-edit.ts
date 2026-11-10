import { commandBatchSchema } from '@uml/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { HttpError, badRequest, notFound } from '../../lib/http-error.js';
import { currentUser } from '../../plugins/auth.js';
import { requireWriteAccess } from '../projects/membership.js';
import type { PushNotifier } from '../push/push.js';
import { recordAudit } from '../team-ai/audit-ack.js';
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
    const { userId } = currentUser(request);

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
    let result: {
      applied: boolean;
      issues: unknown[];
      model?: unknown;
    };
    try {
      const response = await fetch(`${config.COLLAB_INTERNAL_URL}/internal/apply`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.COLLAB_INTERNAL_SECRET}`,
        },
        body: JSON.stringify({ projectId: board.projectId, boardId, batch }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`collab ${response.status}`);
      result = (await response.json()) as typeof result;
    } catch (error) {
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
    return { applied: true, issues: result.issues, model: result.model };
  });
}
