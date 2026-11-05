import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoardQueue } from '../src/modules/team-ai/queue.js';
import { loadConfig } from '../src/config.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

function harness(timeoutMs = 100) {
  const pending = new Map<string, { id: string }[]>();
  const calls: { id: string; signal: AbortSignal; result: ReturnType<typeof deferred<string>> }[] =
    [];
  const complete = vi.fn(async () => {});
  const fail = vi.fn(async () => {});
  const onError = vi.fn();
  const queue = createBoardQueue({
    timeoutMs,
    claim: async (board: string) => pending.get(board)?.shift() ?? null,
    process: (job: { id: string }, signal: AbortSignal) => {
      const result = deferred<string>();
      calls.push({ id: job.id, signal, result });
      return result.promise;
    },
    complete,
    fail,
    onError,
  });
  return { ...queue, pending, calls, complete, fail, onError };
}
const tick = () => vi.advanceTimersByTimeAsync(0);

describe('cola secuencial por pizarra', () => {
  it('deduplica avisos, respeta FIFO y permite otra pizarra en paralelo', async () => {
    vi.useFakeTimers();
    const q = harness();
    q.pending.set('a', [{ id: 'a1' }, { id: 'a2' }]);
    q.pending.set('b', [{ id: 'b1' }]);
    q.notify('a');
    q.notify('a');
    q.notify('b');
    await tick();
    expect(q.calls.map((c) => c.id)).toEqual(['a1', 'b1']);
    q.calls[0]!.result.resolve('ok');
    await tick();
    expect(q.calls.map((c) => c.id)).toEqual(['a1', 'b1', 'a2']);
    await q.close();
    expect(q.complete).toHaveBeenCalledTimes(1);
    expect(q.onError).not.toHaveBeenCalled();
  });
  it('cada una de tres solicitudes recibe el timeout completo al comenzar', async () => {
    vi.useFakeTimers();
    const q = harness();
    q.pending.set('a', [{ id: '1' }, { id: '2' }, { id: '3' }]);
    q.notify('a');
    await tick();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(90);
      expect(q.calls[i]!.signal.aborted).toBe(false);
      q.calls[i]!.result.resolve('ok');
      await tick();
    }
    expect(q.complete).toHaveBeenCalledTimes(3);
    expect(q.fail).not.toHaveBeenCalled();
    await q.close();
  });
  it('timeout aborta y libera la cola aunque el proveedor ignore la señal', async () => {
    vi.useFakeTimers();
    const q = harness();
    q.pending.set('a', [{ id: '1' }, { id: '2' }]);
    q.notify('a');
    await tick();
    await vi.advanceTimersByTimeAsync(100);
    expect(q.calls[0]!.signal.aborted).toBe(true);
    expect(q.fail).toHaveBeenCalledWith(
      { id: '1' },
      expect.objectContaining({ message: 'team_ai_timeout' }),
    );
    expect(q.calls[1]!.id).toBe('2');
    q.calls[0]!.result.resolve('tardía');
    await tick();
    expect(q.complete).not.toHaveBeenCalled();
    await q.close();
  });
  it('cancelar aborta y descarta tanto respuesta como rechazo tardío', async () => {
    vi.useFakeTimers();
    const q = harness();
    q.pending.set('a', [{ id: '1' }, { id: '2' }]);
    q.notify('a');
    await tick();
    q.cancel('1');
    await tick();
    expect(q.calls[0]!.signal.aborted).toBe(true);
    q.calls[0]!.result.reject(new Error('tardío'));
    await tick();
    q.calls[1]!.result.resolve('ok');
    await tick();
    expect(q.complete).toHaveBeenCalledTimes(1);
    expect(q.fail).toHaveBeenCalledTimes(1);
    await q.close();
  });
  it('cierre interrumpe al activo y nunca reclama el siguiente', async () => {
    vi.useFakeTimers();
    const q = harness();
    q.pending.set('a', [{ id: '1' }, { id: '2' }]);
    q.notify('a');
    await tick();
    await q.close();
    q.notify('a');
    await tick();
    expect(q.calls).toHaveLength(1);
    expect(q.fail).toHaveBeenCalledWith(
      { id: '1' },
      expect.objectContaining({ message: 'team_ai_interrupted' }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('presupuesto de procesamiento', () => {
  const env = { DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'x'.repeat(48) };
  it('hereda el timeout efectivo de la cadena, incluso variables vacías de Compose', () => {
    expect(loadConfig(env).TEAM_AI_TIMEOUT_MS).toBe(120000);
    expect(loadConfig({ ...env, AI_CHAIN_TIMEOUT_MS: '180000' }).TEAM_AI_TIMEOUT_MS).toBe(180000);
    expect(
      loadConfig({ ...env, AI_CHAIN_TIMEOUT_MS: '', TEAM_AI_TIMEOUT_MS: '' }).TEAM_AI_TIMEOUT_MS,
    ).toBe(120000);
  });
  it.each(['0', '-1', 'abc', '1.5', '2147483648', '100000'])(
    'rechaza timeout inválido o menor que la cadena: %s',
    (value) => {
      expect(() => loadConfig({ ...env, TEAM_AI_TIMEOUT_MS: value })).toThrow(/TEAM_AI_TIMEOUT_MS/);
    },
  );
  it('permite ampliar el presupuesto', () => {
    expect(loadConfig({ ...env, TEAM_AI_TIMEOUT_MS: '240000' }).TEAM_AI_TIMEOUT_MS).toBe(240000);
  });
});
