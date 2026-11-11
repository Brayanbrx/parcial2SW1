/** Una instancia con concurrencia acotada y turnos entre pizarras pendientes. */
export function createBoardQueue<T extends { id: string }, R>(options: {
  timeoutMs: number | ((job: T) => number);
  concurrencyPerBoard?: number;
  maxConcurrency?: number;
  claim(boardId: string, activeJobs: ReadonlyMap<string, T>): Promise<T | 'blocked' | null>;
  process(job: T, signal: AbortSignal): Promise<R>;
  complete(job: T, result: R, signal: AbortSignal): Promise<void>;
  fail(job: T, error: unknown): Promise<void>;
  onError(error: unknown): void;
}) {
  const concurrencyPerBoard = options.concurrencyPerBoard ?? 3;
  const maxConcurrency = options.maxConcurrency ?? 6;
  for (const limit of [concurrencyPerBoard, maxConcurrency])
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error('La concurrencia de IA debe ser un entero positivo.');

  const ready = new Set<string>();
  const waiting = new Set<string>();
  const active = new Map<string, { job: T; controller: AbortController }>();
  const boardCounts = new Map<string, number>();
  const tasks = new Set<Promise<void>>();
  let pumping: Promise<void> | undefined;
  let closed = false;
  let releases = 0;

  function nextBoard() {
    if (active.size >= maxConcurrency) return undefined;
    return [...ready].find((id) => (boardCounts.get(id) ?? 0) < concurrencyPerBoard);
  }

  async function run(job: T, controller: AbortController) {
    const timeoutMs =
      typeof options.timeoutMs === 'function' ? options.timeoutMs(job) : options.timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error('team_ai_timeout')), timeoutMs);
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
    }
  }

  async function pump() {
    let boardId: string | undefined;
    while (!closed && (boardId = nextBoard()) !== undefined) {
      const board = boardId;
      ready.delete(board);
      // Reclamar es secuencial; las inferencias y la publicación son independientes.
      // La instantánea permite recuperar huérfanos sin interrumpir trabajos vivos.
      const beforeClaim = releases;
      const job = await options.claim(
        board,
        new Map([...active].map(([id, entry]) => [id, entry.job])),
      );
      if (!job) continue;
      if (job === 'blocked') {
        // El trabajo sigue en cola, sin ocupar un puesto global.
        (releases === beforeClaim ? waiting : ready).add(board);
        continue;
      }
      const controller = new AbortController();
      active.set(job.id, { job, controller });
      boardCounts.set(board, (boardCounts.get(board) ?? 0) + 1);
      if (closed) controller.abort(new Error('team_ai_interrupted'));
      const task = run(job, controller)
        .catch(options.onError)
        .finally(() => {
          active.delete(job.id);
          releases++;
          const count = (boardCounts.get(board) ?? 1) - 1;
          if (count) boardCounts.set(board, count);
          else boardCounts.delete(board);
          tasks.delete(task);
          if (!closed) {
            for (const waitingBoard of waiting) ready.add(waitingBoard);
            waiting.clear();
            ready.add(board);
            schedule();
          }
        });
      tasks.add(task);
      // Reinserción al final: otra pizarra pendiente tiene el siguiente turno.
      ready.add(board);
    }
  }

  function schedule() {
    if (closed || pumping) return;
    pumping = Promise.resolve()
      .then(pump)
      .catch(options.onError)
      .finally(() => {
        pumping = undefined;
        if (!closed && nextBoard() !== undefined) schedule();
      });
  }

  return {
    notify(boardId: string) {
      if (closed) return;
      waiting.delete(boardId);
      ready.add(boardId);
      schedule();
    },
    cancel(id: string) {
      active.get(id)?.controller.abort(new Error('team_ai_cancelled'));
    },
    async close() {
      closed = true;
      for (const { controller } of active.values())
        controller.abort(new Error('team_ai_interrupted'));
      // Una reclamación en curso también debe registrar su interrupción.
      await pumping;
      await Promise.all(tasks);
      ready.clear();
      waiting.clear();
    },
  };
}
