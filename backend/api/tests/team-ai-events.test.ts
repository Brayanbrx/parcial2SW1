import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTeamEventPublisher } from '../src/modules/team-ai/events.js';
import { loadConfig } from '../src/config.js';
import { loadConfig as collabConfig } from '../../collab/src/config.js';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  JWT_SECRET: 'j'.repeat(48),
};
const secret = 's'.repeat(48);
const event = () => ({
  type: 'team.message' as const,
  boardId: randomUUID(),
  messageId: randomUUID(),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('emisor interno de avisos', () => {
  it('usa un secreto independiente, JSON acotado y no sigue redirecciones', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const publisher = createTeamEventPublisher(
      loadConfig({ ...env, COLLAB_INTERNAL_SECRET: secret }),
      { warn: vi.fn() },
    );
    const payload = event();
    publisher.publish(payload);
    expect(fetch).toHaveBeenCalledWith(
      'http://collab:3002/internal/team-ai/events',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      }),
    );
    await publisher.close();
  });
  it.each(['', undefined])(
    'sin secreto no hace llamadas y permite recuperación HTTP (%s)',
    async (value) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const publisher = createTeamEventPublisher(
        loadConfig({ ...env, COLLAB_INTERNAL_SECRET: value }),
        { warn: vi.fn() },
      );
      publisher.publish(event());
      await publisher.close();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('caída del servicio no rechaza la escritura ni registra contenido o secretos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(secret)));
    const warn = vi.fn();
    const publisher = createTeamEventPublisher(
      loadConfig({ ...env, COLLAB_INTERNAL_SECRET: secret }),
      { warn },
    );
    expect(() => publisher.publish(event())).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    await publisher.close();
  });
  it('limita peticiones en vuelo y las aborta al cerrar', async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options.signal!;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const warn = vi.fn();
    const publisher = createTeamEventPublisher(
      loadConfig({ ...env, COLLAB_INTERNAL_SECRET: secret }),
      { warn },
    );
    for (let i = 0; i < 100; i++) publisher.publish(event());
    expect(fetch).toHaveBeenCalledTimes(16);
    await publisher.close();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    publisher.publish(event());
    expect(fetch).toHaveBeenCalledTimes(16);
  });
  it.each([loadConfig, collabConfig])('rechaza secreto corto o reutilizado al arrancar', (load) => {
    expect(() => load({ ...env, COLLAB_INTERNAL_SECRET: 'short' })).toThrow();
    expect(() => load({ ...env, COLLAB_INTERNAL_SECRET: env.JWT_SECRET })).toThrow('distinto');
    expect(load({ ...env, COLLAB_INTERNAL_SECRET: secret }).COLLAB_INTERNAL_SECRET).toBe(secret);
  });
});
