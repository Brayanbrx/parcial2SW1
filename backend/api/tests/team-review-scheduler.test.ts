import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReviewScheduler } from '../src/modules/team-ai/review-scheduler.js';
afterEach(() => vi.useRealTimers());
const timing = { idleMs: 100, retryMs: 50, timeoutMs: 500, cooldownMs: 150 };

describe('moderador: programación acotada', () => {
  it('aborta también una lectura activa que supera el plazo de evidencia', async () => {
    vi.useFakeTimers();
    let received!: AbortSignal;
    const review = vi.fn(
      (_id: string, signal: AbortSignal) =>
        new Promise<'done'>((resolve) => {
          received = signal;
          signal.addEventListener('abort', () => resolve('done'), { once: true });
        }),
    );
    const scheduler = createReviewScheduler({ timing, review, diagnostic: vi.fn() });
    scheduler.notify('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(received.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(received.aborted).toBe(true);
    await scheduler.close();
  });
  it('agrupa por inactividad y reintenta evidencia sin bloquear notify', async () => {
    vi.useFakeTimers();
    const review = vi.fn().mockResolvedValueOnce('retry').mockResolvedValue('done');
    const scheduler = createReviewScheduler({ timing, review, diagnostic: vi.fn() });
    scheduler.notify('a');
    await vi.advanceTimersByTimeAsync(80);
    scheduler.notify('a');
    await vi.advanceTimersByTimeAsync(99);
    expect(review).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(51);
    expect(review).toHaveBeenCalledTimes(2);
    await scheduler.close();
  });
  it('timeout y capacidad omiten trabajo; close cancela temporizadores', async () => {
    vi.useFakeTimers();
    const diagnostic = vi.fn();
    const review = vi.fn().mockResolvedValue('retry');
    const scheduler = createReviewScheduler({ timing, review, diagnostic });
    for (let i = 0; i < 201; i++) scheduler.notify(String(i));
    expect(diagnostic).toHaveBeenCalledWith('review_capacity');
    await vi.advanceTimersByTimeAsync(501);
    expect(diagnostic).toHaveBeenCalledWith('review_evidence_timeout');
    await scheduler.close();
    const count = review.mock.calls.length;
    scheduler.notify('late');
    await vi.advanceTimersByTimeAsync(1000);
    expect(review).toHaveBeenCalledTimes(count);
  });
  it('aviso recibido en vuelo no se pierde y cierre aborta trabajo activo', async () => {
    vi.useFakeTimers();
    let resolve!: (value: 'done') => void;
    const review = vi.fn(
      (_id: string, signal: AbortSignal) =>
        new Promise<'done'>((done) => {
          resolve = done;
          signal.addEventListener('abort', () => done('done'));
        }),
    );
    const scheduler = createReviewScheduler({ timing, review, diagnostic: vi.fn() });
    scheduler.notify('a');
    await vi.advanceTimersByTimeAsync(100);
    scheduler.notify('a');
    resolve('done');
    await vi.advanceTimersByTimeAsync(100);
    expect(review).toHaveBeenCalledTimes(2);
    await scheduler.close();
    expect(review.mock.calls[1]![1].aborted).toBe(true);
  });
});
