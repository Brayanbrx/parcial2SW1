import { on, once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createAiConnections } from '../src/modules/ai-devices/connections.js';

describe('plazos y cancelación del conector de IA', () => {
  it.each([true, false])(
    'aplica el límite detrás del proxy de confianza solo si está activo (%s)',
    async (rateLimitEnabled) => {
      const server = createServer();
      const connections = createAiConnections({
        server,
        origin: 'https://uml.example',
        trustProxyHops: 1,
        rateLimitEnabled,
        timeoutMs: { DEVICE: 1000, VM: 1000 },
        authenticate: async (hello) =>
          hello.token === 'x'.repeat(32) ? { key: 'vm', valid: async () => true } : null,
        canUseVm: async () => false,
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const connect = (forwardedFor: string, token: string) =>
        new Promise<boolean>((resolve) => {
          const socket = new WebSocket(
            `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ai-devices/connect`,
            { headers: { 'X-Forwarded-For': forwardedFor } },
          );
          socket.on('error', () => resolve(false));
          socket.on('close', () => resolve(false));
          socket.on('open', () =>
            socket.send(
              JSON.stringify({
                type: 'hello',
                version: 1,
                kind: 'VM',
                token,
                models: [{ name: 'modelo', contextWindow: 4096 }],
              }),
            ),
          );
          socket.on('message', () => resolve(true));
        });
      try {
        for (let index = 1; index <= 20; index++)
          expect(await connect(`192.0.2.${index}, 198.51.100.1`, 'y'.repeat(32))).toBe(false);
        expect(await connect('192.0.2.21, 198.51.100.1', 'x'.repeat(32))).toBe(!rateLimitEnabled);
        expect(await connect('198.51.100.2', 'x'.repeat(32))).toBe(true);
      } finally {
        connections.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it('da a cada inferencia su plazo completo y permite cancelar una solicitud en espera', async () => {
    const deviceId = '10000000-0000-4000-8000-000000000001';
    const server = createServer();
    const connections = createAiConnections({
      server,
      origin: 'https://uml.example',
      timeoutMs: { DEVICE: 1000, VM: 1000 },
      authenticate: async () => ({ key: deviceId, valid: async () => true }),
      canUseVm: async () => false,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const socket = new WebSocket(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ai-devices/connect`,
    );
    const messages = on(socket, 'message', { close: ['close'] });
    const receive = async () => JSON.parse(String((await messages.next()).value[0]));
    try {
      await once(socket, 'open');
      socket.send(
        JSON.stringify({
          type: 'hello',
          version: 1,
          kind: 'DEVICE',
          token: 'x'.repeat(32),
          models: [{ name: 'local', contextWindow: 16384 }],
          maxConcurrency: 1,
        }),
      );
      expect(await receive()).toMatchObject({ type: 'ready' });
      await expect(
        connections.port({ source: 'DEVICE', deviceId, model: 'eliminado' }),
      ).rejects.toThrow('ai_engine_unavailable');
      expect(connections.status(deviceId).connected).toBe(true);
      const port = await connections.port({ source: 'DEVICE', deviceId, model: 'local' });
      const snapshot = { classes: [], relationships: [] };
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const first = port.answer({ question: 'Primera pregunta', snapshot });
      const firstTask = await receive();
      expect(firstTask).toMatchObject({ type: 'task', timeoutMs: 1000 });

      const stopped = new AbortController();
      const cancelled = port.answer({
        question: 'Cancelar antes de ejecutar',
        snapshot,
        signal: stopped.signal,
      });
      const second = port.answer({ question: 'Segunda pregunta', snapshot });
      const results = Promise.allSettled([first, cancelled, second]);
      await vi.advanceTimersByTimeAsync(700);
      const reason = new Error('team_ai_cancelled');
      stopped.abort(reason);
      socket.send(JSON.stringify({ type: 'result', id: firstTask.id, text: 'Primera respuesta' }));

      const secondTask = await receive();
      expect(secondTask).toMatchObject({ type: 'task', timeoutMs: 1000 });
      expect(secondTask.prompt).toContain('Segunda pregunta');
      await vi.advanceTimersByTimeAsync(700);
      socket.send(JSON.stringify({ type: 'result', id: secondTask.id, text: 'Segunda respuesta' }));
      expect(await results).toEqual([
        { status: 'fulfilled', value: { text: 'Primera respuesta' } },
        { status: 'rejected', reason },
        { status: 'fulfilled', value: { text: 'Segunda respuesta' } },
      ]);
    } finally {
      connections.close();
      await messages.return?.();
      vi.useRealTimers();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
