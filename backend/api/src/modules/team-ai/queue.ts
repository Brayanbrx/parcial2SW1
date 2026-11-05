/** Ejecutor de una sola instancia: un consumidor por pizarra, sin bloquear otras. */
export function createBoardQueue<T extends { id: string }, R>(options: {
  timeoutMs: number;
  claim(boardId: string): Promise<T | null>;
  process(job: T, signal: AbortSignal): Promise<R>;
  complete(job: T, result: R, signal: AbortSignal): Promise<void>;
  fail(job: T, error: unknown): Promise<void>;
  onError(error: unknown): void;
}) {
  const running = new Map<string, Promise<void>>();
  const active = new Map<string, AbortController>();
  const dirty = new Set<string>();
  let closed = false;

  async function drain(boardId: string) {
    do {
      dirty.delete(boardId);
      while (!closed) {
        const job = await options.claim(boardId);
        if (!job) break;
        const controller = new AbortController();
        active.set(job.id, controller);
        if (closed) controller.abort(new Error('team_ai_interrupted'));
        // Se crea después de reclamar PROCESSING, nunca al aceptar el POST.
        const timer = setTimeout(
          () => controller.abort(new Error('team_ai_timeout')),
          options.timeoutMs,
        );
        let onAbort: () => void = () => {};
        try {
          const interrupted = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted) onAbort();
          });
          const result = await Promise.race([
            Promise.resolve().then(() => {
              controller.signal.throwIfAborted();
              return options.process(job, controller.signal);
            }),
            interrupted,
          ]);
          controller.signal.throwIfAborted();
          await options.complete(job, result, controller.signal);
        } catch (error) {
          await options.fail(job, error);
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', onAbort);
          active.delete(job.id);
        }
      }
    } while (!closed && dirty.has(boardId));
  }

  return {
    notify(boardId: string) {
      if (closed) return;
      dirty.add(boardId);
      if (running.has(boardId)) return;
      // Instalar la promesa antes de ejecutar claim evita consumidores duplicados.
      const task = Promise.resolve()
        .then(() => drain(boardId))
        .catch(options.onError)
        .finally(() => {
          running.delete(boardId);
          dirty.delete(boardId);
        });
      running.set(boardId, task);
    },
    cancel(id: string) {
      active.get(id)?.abort(new Error('team_ai_cancelled'));
    },
    async close() {
      closed = true;
      for (const controller of active.values()) controller.abort(new Error('team_ai_interrupted'));
      await Promise.all(running.values());
      dirty.clear();
    },
  };
}
