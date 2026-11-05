export interface ReviewTiming {
  idleMs: number;
  retryMs: number;
  timeoutMs: number;
  cooldownMs: number;
}
export const REVIEW_TIMING: ReviewTiming = {
  idleMs: 1500,
  retryMs: 500,
  timeoutMs: 30000,
  cooldownMs: 15000,
};

/** Una tarea por pizarra, memoria acotada y un máximo de cuatro lecturas en vuelo. */
export function createReviewScheduler(options: {
  timing: ReviewTiming;
  review(boardId: string, signal: AbortSignal): Promise<'done' | 'retry' | number>;
  diagnostic(reason: string): void;
}) {
  const pending = new Map<string, { revision: number; due: number; expires: number }>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let revision = 0;
  const arm = () => {
    if (controller.signal.aborted || timer || running || !pending.size) return;
    const due = Math.min(...[...pending.values()].map((p) => Math.min(p.due, p.expires)));
    timer = setTimeout(
      () => {
        timer = undefined;
        running = tick().finally(() => {
          running = undefined;
          arm();
        });
      },
      Math.max(0, due - Date.now()),
    );
    timer.unref();
  };
  async function tick() {
    const now = Date.now();
    for (const [id, task] of pending)
      if (task.expires <= now) {
        pending.delete(id);
        options.diagnostic('review_evidence_timeout');
      }
    await Promise.all(
      [...pending]
        .filter(([, task]) => task.due <= now)
        .slice(0, 4)
        .map(async ([id, task]) => {
          let result: 'done' | 'retry' | number = 'retry';
          const taskController = new AbortController();
          const abort = () => taskController.abort();
          controller.signal.addEventListener('abort', abort, { once: true });
          const deadline = setTimeout(abort, Math.max(0, task.expires - Date.now()));
          try {
            result = await options.review(id, taskController.signal);
          } catch {
            if (!controller.signal.aborted) options.diagnostic('review_failed');
          } finally {
            clearTimeout(deadline);
            controller.signal.removeEventListener('abort', abort);
          }
          if (pending.get(id)?.revision !== task.revision) return;
          if (result === 'done') pending.delete(id);
          else task.due = Date.now() + (result === 'retry' ? options.timing.retryMs : result);
        }),
    );
  }
  return {
    notify(boardId: string) {
      if (controller.signal.aborted) return;
      if (!pending.has(boardId) && pending.size >= 200) {
        options.diagnostic('review_capacity');
        return;
      }
      const now = Date.now();
      pending.set(boardId, {
        revision: ++revision,
        due: now + options.timing.idleMs,
        expires: pending.get(boardId)?.expires ?? now + options.timing.timeoutMs,
      });
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      arm();
    },
    async close() {
      controller.abort();
      if (timer) clearTimeout(timer);
      pending.clear();
      await running;
    },
  };
}
