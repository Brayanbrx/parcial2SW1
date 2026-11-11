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

function harness(timeoutMs = 100, concurrencyPerBoard = 1, maxConcurrency = 6) {
  const pending = new Map<string, { id: string }[]>();
  const calls: { id: string; signal: AbortSignal; result: ReturnType<typeof deferred<string>> }[] =
    [];
  const complete = vi.fn(async () => {});
  const fail = vi.fn(async () => {});
  const onError = vi.fn();
  const queue = createBoardQueue({
    timeoutMs,
    concurrencyPerBoard,
    maxConcurrency,
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

describe('cola de IA con concurrencia acotada', () => {
  it('procesa tres solicitudes de la misma pizarra antes de que termine ninguna', async () => {
    vi.useFakeTimers();
    const q = harness(100, 3);
    q.pending.set('a', [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }]);
    q.notify('a');
    q.notify('a');
    await tick();
    expect(q.calls.map((c) => c.id)).toEqual(['1', '2', '3']);
    // Puede terminar primero la segunda; libera un lugar sin esperar a la primera.
    q.calls[1]!.result.resolve('segunda');
    await tick();
    expect(q.complete).toHaveBeenCalledWith({ id: '2' }, 'segunda', expect.any(AbortSignal));
    expect(q.calls.map((c) => c.id)).toEqual(['1', '2', '3', '4']);
    expect(q.calls[0]!.signal.aborted).toBe(false);
    await q.close();
    expect(q.fail).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('respeta el límite global y da turnos a otra pizarra cuando se libera un lugar', async () => {
    vi.useFakeTimers();
    const q = harness(100, 2, 3);
    q.pending.set('a', [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    q.pending.set('b', [{ id: 'b1' }, { id: 'b2' }]);
    q.pending.set('c', [{ id: 'c1' }]);
    q.notify('a');
    q.notify('b');
    q.notify('c');
    await tick();
    expect(q.calls.map((c) => c.id)).toEqual(['a1', 'b1', 'c1']);
    q.calls[0]!.result.resolve('ok');
    await tick();
    expect(q.calls.map((c) => c.id)).toEqual(['a1', 'b1', 'c1', 'a2']);
    q.calls[3]!.result.resolve('ok');
    await tick();
    expect(q.calls[4]!.id).toBe('b2');
    await q.close();
    expect(q.pending.get('a')).toEqual([{ id: 'a3' }]);
  });

  it('cancelar un trabajo paralelo no aborta a los demás y descarta su salida tardía', async () => {
    vi.useFakeTimers();
    const q = harness(100, 2);
    q.pending.set('a', [{ id: '1' }, { id: '2' }, { id: '3' }]);
    q.notify('a');
    await tick();
    q.cancel('1');
    await tick();
    expect(q.calls.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(q.calls[1]!.signal.aborted).toBe(false);
    q.calls[0]!.result.resolve('tardía');
    q.calls[1]!.result.resolve('válida');
    q.calls[2]!.result.resolve('válida');
    await tick();
    expect(q.complete).toHaveBeenCalledTimes(2);
    expect(q.fail).toHaveBeenCalledTimes(1);
    await q.close();
  });

  it('cada trabajo paralelo o en espera conserva su propio plazo de procesamiento', async () => {
    vi.useFakeTimers();
    const q = harness(100, 2);
    q.pending.set('a', [{ id: '1' }, { id: '2' }, { id: '3' }]);
    q.notify('a');
    await tick();
    await vi.advanceTimersByTimeAsync(80);
    q.calls[1]!.result.resolve('ok');
    await tick();
    await vi.advanceTimersByTimeAsync(20);
    expect(q.calls[0]!.signal.aborted).toBe(true);
    expect(q.calls[2]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(79);
    expect(q.calls[2]!.signal.aborted).toBe(false);
    q.calls[2]!.result.resolve('ok');
    await tick();
    expect(q.fail).toHaveBeenCalledTimes(1);
    expect(q.complete).toHaveBeenCalledTimes(2);
    await q.close();
  });

  it('informa los trabajos activos al reclamar y cierra también una reclamación en curso', async () => {
    vi.useFakeTimers();
    const claiming = deferred<{ id: string } | null>();
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ id: '1' })
      .mockImplementationOnce(() => claiming.promise);
    const process = vi.fn(() => new Promise<string>(() => {}));
    const fail = vi.fn(async () => {});
    const q = createBoardQueue({
      timeoutMs: 100,
      claim,
      process,
      complete: vi.fn(async () => {}),
      fail,
      onError: vi.fn(),
    });
    q.notify('a');
    await tick();
    expect(claim.mock.calls[1]).toEqual(['a', new Map([['1', { id: '1' }]])]);
    const closing = q.close();
    claiming.resolve({ id: '2' });
    await closing;
    expect(process).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(2);
    expect(fail.mock.calls).toEqual(
      expect.arrayContaining([
        [{ id: '1' }, expect.objectContaining({ message: 'team_ai_interrupted' })],
        [{ id: '2' }, expect.objectContaining({ message: 'team_ai_interrupted' })],
      ]),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no pierde una notificación recibida mientras una reclamación vacía está en curso', async () => {
    vi.useFakeTimers();
    const claiming = deferred<{ id: string } | null>();
    const claim = vi
      .fn()
      .mockImplementationOnce(() => claiming.promise)
      .mockResolvedValueOnce({ id: 'nuevo' })
      .mockResolvedValue(null);
    const process = vi.fn(async () => 'respuesta');
    const complete = vi.fn(async () => {});
    const q = createBoardQueue({
      timeoutMs: 100,
      claim,
      process,
      complete,
      fail: vi.fn(async () => {}),
      onError: vi.fn(),
    });
    q.notify('a');
    await tick();
    q.notify('a');
    claiming.resolve(null);
    await tick();
    expect(process).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    await q.close();
  });

  it('un fallo al persistir libera su lugar sin cancelar otra inferencia activa', async () => {
    vi.useFakeTimers();
    const q = harness(100, 2);
    const error = new Error('database unavailable');
    q.complete.mockRejectedValueOnce(error);
    q.fail.mockRejectedValueOnce(error);
    q.pending.set('a', [{ id: '1' }, { id: '2' }, { id: '3' }]);
    q.notify('a');
    await tick();
    q.calls[0]!.result.resolve('ok');
    await tick();
    expect(q.onError).toHaveBeenCalledWith(error);
    expect(q.calls.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(q.calls[1]!.signal.aborted).toBe(false);
    q.calls[1]!.result.resolve('ok');
    q.calls[2]!.result.resolve('ok');
    await tick();
    await q.close();
    expect(q.complete).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

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
  it('activa concurrencia por defecto y permite reducirla para un servidor local', () => {
    const config = loadConfig(env);
    expect(config.TEAM_AI_BOARD_CONCURRENCY).toBe(3);
    expect(config.TEAM_AI_MAX_CONCURRENCY).toBe(6);
    const custom = loadConfig({
      ...env,
      TEAM_AI_BOARD_CONCURRENCY: '2',
      TEAM_AI_MAX_CONCURRENCY: '1',
    });
    expect(custom.TEAM_AI_BOARD_CONCURRENCY).toBe(2);
    expect(custom.TEAM_AI_MAX_CONCURRENCY).toBe(1);
    expect(loadConfig({ ...env, TEAM_AI_BOARD_CONCURRENCY: '' }).TEAM_AI_BOARD_CONCURRENCY).toBe(3);
    expect(loadConfig({ ...env, TEAM_AI_MAX_CONCURRENCY: '' }).TEAM_AI_MAX_CONCURRENCY).toBe(6);
  });
  it.each([
    ['TEAM_AI_BOARD_CONCURRENCY', '0'],
    ['TEAM_AI_BOARD_CONCURRENCY', '33'],
    ['TEAM_AI_MAX_CONCURRENCY', '-1'],
    ['TEAM_AI_MAX_CONCURRENCY', '1.5'],
    ['TEAM_AI_MAX_CONCURRENCY', '65'],
    ['TEAM_AI_MAX_CONCURRENCY', 'abc'],
  ])('rechaza %s=%s', (key, value) => {
    expect(() => loadConfig({ ...env, [key]: value })).toThrow(key);
  });
});
