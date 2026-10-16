import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { withRequestCancellation } from '../src/lib/request-cancellation.js';

const servers: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
});

it('recibir el POST completo no cancela; cerrar el cliente mientras espera sí cancela', async () => {
  // Sin forzar el cierre, Fastify espera unos cuatro segundos a la conexion que
  // el cliente abandono, y la prueba entera rozaba el limite de cinco: pasaba
  // aislada y fallaba con la suite completa en una maquina cargada.
  const app = Fastify({ forceCloseConnections: true });
  servers.push(app);
  let captured: AbortSignal | undefined;
  app.post('/', (request, reply) =>
    withRequestCancellation(request, reply, async (signal) => {
      captured = signal;
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { canceled: signal.aborted };
    }),
  );
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const response = fetch(url, {
    method: 'POST',
    body: JSON.stringify({ instruction: 'crea Cliente' }),
    headers: { 'content-type': 'application/json' },
    signal: controller.signal,
  }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(captured).toBeDefined());
  expect(captured?.aborted).toBe(false);
  controller.abort();
  await response;
  await vi.waitFor(() => expect(captured?.aborted).toBe(true));
}, 15_000);

it('una respuesta normal libera listeners sin marcar cancelación', async () => {
  const app = Fastify();
  servers.push(app);
  let captured: AbortSignal | undefined;
  app.post('/', async (request, reply) => {
    const before = reply.raw.listenerCount('close');
    const result = await withRequestCancellation(request, reply, async (signal) => {
      captured = signal;
      return { ok: true };
    });
    expect(reply.raw.listenerCount('close')).toBe(before);
    return result;
  });
  expect((await app.inject({ method: 'POST', url: '/' })).json()).toEqual({ ok: true });
  expect(captured?.aborted).toBe(false);
});
