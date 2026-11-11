import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isIP } from 'node:net';
import {
  connectorHelloSchema,
  connectorResultSchema,
  type AiExecutionTarget,
} from '@uml/contracts';
import { ProviderUnavailableError, type LlmPort } from '@uml/ai';
import { createConnectorLlmPort } from '@uml/ai';

type Hello = ReturnType<typeof connectorHelloSchema.parse>;
export interface ConnectorIdentity {
  key: string;
  valid(): Promise<boolean>;
}
type Connection = {
  socket: WebSocket;
  identity: ConnectorIdentity;
  models: Hello['models'];
  limit: number;
  alive: boolean;
  pending: Map<string, Task>;
};
type Task = {
  id: string;
  model: string;
  system: string;
  prompt: string;
  json: boolean;
  timeoutMs: number;
  sent: boolean;
  start(): void;
  finish(text?: string): void;
};
type ConnectorSource = 'DEVICE' | 'VM';

/** Solo transporta inferencia; no concede acceso a la API ni al documento Yjs. */
export function createAiConnections(options: {
  server: Server;
  origin: string;
  timeoutMs: Record<ConnectorSource, number>;
  trustProxyHops?: number;
  rateLimitEnabled?: boolean;
  authenticate(hello: Hello): Promise<ConnectorIdentity | null>;
  canUseVm(userId: string): Promise<boolean>;
}) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 1_100_000 });
  const connections = new Map<string, Connection>();
  const attempts = new Map<string, number>();
  let closed = false;
  const unavailable = () => new ProviderUnavailableError('connector', 'ai_engine_unavailable');
  function disconnect(connection: Connection) {
    if (connections.get(connection.identity.key) === connection)
      connections.delete(connection.identity.key);
    connection.socket.terminate();
    for (const task of [...connection.pending.values()]) task.finish();
  }
  function flush(connection: Connection) {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    let active = [...connection.pending.values()].filter((task) => task.sent).length;
    for (const task of connection.pending.values()) {
      if (task.sent || active >= connection.limit) continue;
      task.sent = true;
      task.start();
      active++;
      connection.socket.send(
        JSON.stringify({
          type: 'task',
          id: task.id,
          model: task.model,
          system: task.system,
          prompt: task.prompt,
          json: task.json,
          timeoutMs: task.timeoutMs,
        }),
      );
    }
  }

  const heartbeat = setInterval(() => {
    attempts.clear();
    for (const connection of connections.values()) {
      if (!connection.alive) {
        disconnect(connection);
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
      void connection.identity
        .valid()
        .then((valid) => {
          if (!valid) disconnect(connection);
        })
        .catch(() => disconnect(connection));
    }
  }, 20_000);
  heartbeat.unref();

  // El handler tipado aparte permite retirarlo al cerrar la aplicación.
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (
      closed ||
      request.url !== '/ai-devices/connect' ||
      server.clients.size >= 200 ||
      (request.headers.origin && request.headers.origin !== options.origin)
    ) {
      socket.destroy();
      return;
    }
    if (options.rateLimitEnabled !== false) {
      // Igual que en HTTP, los saltos de confianza se cuentan desde el proxy inmediato.
      const hops = options.trustProxyHops ?? 0;
      const header = request.headers['x-forwarded-for'];
      const forwarded = (Array.isArray(header) ? header.join(',') : header)
        ?.split(',')
        .at(-hops)
        ?.trim();
      const ip =
        hops > 0 && forwarded && isIP(forwarded) ? forwarded : (request.socket.remoteAddress ?? '');
      const previous = attempts.get(ip);
      if ((previous ?? 0) >= 20 || (previous === undefined && attempts.size >= 1000)) {
        socket.destroy();
        return;
      }
      attempts.set(ip, (previous ?? 0) + 1);
    }
    server.handleUpgrade(request, socket, head, (ws) => server.emit('connection', ws));
  };
  options.server.on('upgrade', onUpgrade);
  server.on('connection', (socket) => {
    let connection: Connection | undefined;
    let authenticating = false;
    const authDeadline = setTimeout(() => socket.terminate(), 5000);
    socket.on('error', () => socket.terminate());
    socket.on('pong', () => {
      if (connection) connection.alive = true;
    });
    socket.on('close', () => {
      clearTimeout(authDeadline);
      if (connection) disconnect(connection);
    });
    let received = 0;
    let windowStart = Date.now();
    socket.on('message', (raw) => {
      void (async () => {
        if (Date.now() - windowStart > 20_000) {
          received = 0;
          windowStart = Date.now();
        }
        if (++received > 200) {
          socket.terminate();
          return;
        }
        const value: unknown = JSON.parse(raw.toString());
        if (!connection) {
          if (authenticating) throw new Error('auth_pending');
          authenticating = true;
          const hello = connectorHelloSchema.parse(value);
          const identity = await options.authenticate(hello);
          if (!identity || socket.readyState !== WebSocket.OPEN) {
            socket.terminate();
            return;
          }
          const previous = connections.get(identity.key);
          if (previous) disconnect(previous);
          connection = {
            socket,
            identity,
            models: hello.models,
            limit: hello.maxConcurrency,
            alive: true,
            pending: new Map(),
          };
          connections.set(identity.key, connection);
          clearTimeout(authDeadline);
          socket.send(JSON.stringify({ type: 'ready', version: 1 }));
          return;
        }
        const result = connectorResultSchema.parse(value);
        if (!(await connection.identity.valid())) {
          disconnect(connection);
          return;
        }
        const task = connection.pending.get(result.id);
        // Una salida tardía o de otra conexión nunca resuelve una tarea nueva.
        if (task?.sent) task.finish(result.type === 'result' ? result.text : undefined);
      })().catch(() => socket.terminate());
    });
  });

  return {
    canUseVm: options.canUseVm,
    capacity(key: string) {
      return connections.get(key)?.limit;
    },
    processingBudgetMs(source: ConnectorSource) {
      // La espera de turno y la inferencia tienen plazos independientes.
      return 2 * options.timeoutMs[source];
    },
    status(key: string) {
      const connection = connections.get(key);
      return {
        connected: !!connection,
        models: connection?.models ?? [],
        active: [...(connection?.pending.values() ?? [])].filter((t) => t.sent).length,
      };
    },
    disconnect(key: string) {
      const c = connections.get(key);
      if (c) disconnect(c);
    },
    async port(target: Extract<AiExecutionTarget, { source: 'VM' | 'DEVICE' }>): Promise<LlmPort> {
      const key = target.source === 'VM' ? 'vm' : target.deviceId;
      const connection = connections.get(key);
      const model = connection?.models.find((m) => m.name === target.model);
      if (!connection || !model) throw unavailable();
      if (!(await connection.identity.valid())) {
        disconnect(connection);
        throw unavailable();
      }
      const timeoutMs = options.timeoutMs[target.source];
      return createConnectorLlmPort({
        name: target.source === 'VM' ? 'IA de VM' : 'Mi computadora',
        contextWindow: model.contextWindow,
        timeoutMs,
        async complete(input) {
          input.signal?.throwIfAborted();
          if (
            !(await connection.identity.valid()) ||
            connections.get(key) !== connection ||
            connection.pending.size >= 20
          )
            throw unavailable();
          return new Promise<string>((resolve, reject) => {
            const id = randomUUID();
            let timer: ReturnType<typeof setTimeout>;
            const cancel = (error: unknown) => {
              if (task.sent && connection.socket.readyState === WebSocket.OPEN)
                connection.socket.send(JSON.stringify({ type: 'cancel', id }));
              finish(undefined, error);
            };
            const abort = () => cancel(input.signal?.reason);
            const expire = () => cancel(new Error('team_ai_timeout'));
            const finish = (text?: string, error?: unknown) => {
              if (!connection.pending.delete(id)) return;
              clearTimeout(timer);
              input.signal?.removeEventListener('abort', abort);
              if (text !== undefined) resolve(text);
              else reject(error ?? unavailable());
              flush(connection);
            };
            const task: Task = {
              id,
              ...input,
              model: target.model,
              timeoutMs,
              sent: false,
              start() {
                clearTimeout(timer);
                timer = setTimeout(expire, timeoutMs);
              },
              finish,
            };
            timer = setTimeout(expire, timeoutMs);
            connection.pending.set(id, task);
            input.signal?.addEventListener('abort', abort, { once: true });
            if (input.signal?.aborted) abort();
            else flush(connection);
          });
        },
      });
    },
    close() {
      closed = true;
      clearInterval(heartbeat);
      options.server.off('upgrade', onUpgrade);
      for (const connection of [...connections.values()]) disconnect(connection);
      for (const socket of server.clients) socket.terminate();
      server.close();
    },
  };
}
export type AiConnections = ReturnType<typeof createAiConnections>;
