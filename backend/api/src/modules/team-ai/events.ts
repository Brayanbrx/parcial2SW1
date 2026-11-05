import { teamAiEventPayloadSchema, type TeamAiEvent } from '@uml/contracts';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config.js';

/** Avisos prescindibles: el cursor HTTP es la recuperación durable. */
export type PublishTeamEvent = (event: TeamAiEvent) => void;

export function createTeamEventPublisher(config: Config, log: Pick<FastifyBaseLogger, 'warn'>) {
  const active = new Set<Promise<void>>();
  const shutdown = new AbortController();
  const publish: PublishTeamEvent = (event) => {
    if (!config.COLLAB_INTERNAL_SECRET || shutdown.signal.aborted) return;
    // Una caída de colaboración no puede crear una cola ilimitada ni frenar HTTP.
    if (active.size >= 16) {
      log.warn({ type: event.type }, 'aviso team-ai omitido por saturación; recuperar por cursor');
      return;
    }
    const body = JSON.stringify(event);
    if (!teamAiEventPayloadSchema.safeParse(body).success) {
      log.warn({ type: event.type }, 'aviso team-ai inválido');
      return;
    }
    const task = (async () => {
      try {
        const response = await fetch(`${config.COLLAB_INTERNAL_URL}/internal/team-ai/events`, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.COLLAB_INTERNAL_SECRET}`,
          },
          body,
          signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(2000)]),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error('delivery_failed');
      } catch {
        if (!shutdown.signal.aborted)
          log.warn({ type: event.type }, 'aviso team-ai no entregado; recuperar por cursor');
      }
    })();
    active.add(task);
    void task.finally(() => active.delete(task));
  };
  return {
    publish,
    async close() {
      shutdown.abort();
      await Promise.all(active);
    },
  };
}
