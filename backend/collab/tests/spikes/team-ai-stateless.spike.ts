import assert from 'node:assert/strict';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { buildCollabServer } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { startEphemeralDatabase } from '../support/database.js';
import { seedProject } from '../support/scenario.js';

/**
 * Experimento H0, fuera de las suites y de las rutas de producción.
 * Usa PostgreSQL efímero, JWT/membresías reales y tres clientes WebSocket.
 * Ejecutar: npm run spike:team-ai
 */
const jwtSecret = randomBytes(48).toString('hex');
const serviceSecret = randomBytes(48).toString('hex');
const eventTypes = ['team.message', 'team.update', 'ai.status', 'ai.settings'] as const;
const database = await startEphemeralDatabase();
const collab = buildCollabServer(
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    JWT_SECRET: jwtSecret,
    COLLAB_HOST: '127.0.0.1',
    COLLAB_PORT: '0',
    STORE_DEBOUNCE_MS: '0',
    STORE_MAX_DEBOUNCE_MS: '1',
  }),
);
const clients: { provider: HocuspocusProvider; doc: Y.Doc; events: string[] }[] = [];
let clientEvents = 0;

// Gancho exclusivo del experimento; no instala un endpoint en buildCollabServer.
collab.server.hocuspocus.configuration.extensions.unshift({
  async onStateless() {
    clientEvents += 1; // Una solicitud del navegador nunca se retransmite.
  },
  async onRequest({ request, response }) {
    if (request.url !== '/internal/team-ai/events') return;
    const reply = (status: number) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status }));
    };
    const supplied = Buffer.from(request.headers['authorization'] ?? '');
    const expected = Buffer.from(`Bearer ${serviceSecret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      reply(403);
      return Promise.reject();
    }
    if (request.method !== 'POST') {
      reply(405);
      return Promise.reject();
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > 1024) throw new Error('payload_too_large');
        chunks.push(bytes);
      }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.ok(typeof input === 'object' && input !== null);
      assert.deepEqual(Object.keys(input).sort(), ['id', 'room', 'type']);
      const event = input as { room: string; type: (typeof eventTypes)[number]; id: string };
      assert.ok(typeof event.room === 'string' && event.room.length < 160);
      assert.ok(eventTypes.includes(event.type));
      assert.match(event.id, /^[0-9a-f-]{36}$/);
      const document = collab.server.hocuspocus.documents.get(event.room);
      if (document === undefined) {
        reply(204); // El historial HTTP debe recuperar lo perdido sin una sala activa.
      } else {
        document.broadcastStateless(JSON.stringify({ type: event.type, id: event.id }));
        reply(202);
      }
    } catch {
      reply(size > 1024 ? 413 : 400);
    }
    return Promise.reject();
  },
});

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `Timeout: ${label}`);
    await delay(25);
  }
}

async function connect(room: string, token: string) {
  const doc = new Y.Doc();
  const events: string[] = [];
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${collab.port()}`,
    name: room,
    token,
    document: doc,
    onStateless: ({ payload }) => events.push(payload),
  });
  const client = { doc, provider, events };
  clients.push(client);
  await until(() => provider.synced, 'sincronización inicial');
  return client;
}

function report(message: string) {
  process.stdout.write(`PASS ${message}\n`);
}

try {
  await collab.listen();
  const scenario = await seedProject(collab.prisma, jwtSecret);
  const owner = await connect(scenario.room, scenario.duenaToken);
  const editor = await connect(scenario.room, scenario.editorToken);
  const viewer = await connect(scenario.room, scenario.lectorToken);
  const otherBoard = await connect(scenario.otraRoom, scenario.duenaToken);
  report('tres identidades autenticadas: OWNER, EDITOR y VIEWER; otra pizarra aislada');

  const publish = (body: unknown, secret?: string) =>
    fetch(`http://127.0.0.1:${collab.port()}/internal/team-ai/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === undefined ? {} : { authorization: `Bearer ${secret}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  const event = { room: scenario.room, type: 'team.message', id: randomUUID() };
  assert.equal((await publish(event)).status, 403);
  assert.equal((await publish(event, 'invalid')).status, 403);
  assert.equal((await publish(event, scenario.duenaToken)).status, 403);
  assert.equal(
    (await publish({ ...event, text: 'no se admite texto' }, serviceSecret)).status,
    400,
  );
  assert.equal((await publish({ ...event, type: 'proposal.updated' }, serviceSecret)).status, 400);
  assert.equal((await publish({ ...event, text: 'x'.repeat(2048) }, serviceSecret)).status, 413);
  assert.equal(owner.events.length, 0);
  report('secreto de servicio obligatorio y distinto del JWT; tipos, campos y tamaño limitados');

  const baselineState = Y.encodeStateAsUpdate(owner.doc);
  for (const type of eventTypes) {
    const id = randomUUID();
    assert.equal((await publish({ ...event, type, id }, serviceSecret)).status, 202);
    await until(
      () =>
        [owner, editor, viewer].every((client) => client.events.some((raw) => raw.includes(id))),
      `recepción de ${type} en tres clientes`,
    );
  }
  assert.deepEqual(owner.events, editor.events);
  assert.deepEqual(owner.events, viewer.events);
  assert.equal(owner.events.length, 4);
  assert.equal(otherBoard.events.length, 0);
  assert.deepEqual(Y.encodeStateAsUpdate(owner.doc), baselineState);
  report(
    'cuatro eventos idénticos, una entrega por cliente, sin mezclar pizarras ni modificar Y.Doc',
  );

  owner.provider.sendStateless(JSON.stringify({ ...event, id: 'forged' }));
  await until(() => clientEvents === 1, 'mensaje del navegador procesado');
  const barrierId = randomUUID();
  assert.equal((await publish({ ...event, id: barrierId }, serviceSecret)).status, 202);
  await until(() => viewer.events.length === 5, 'barrera posterior al intento de suplantación');
  assert.ok(clients.every((client) => client.events.every((raw) => !raw.includes('forged'))));
  report('un cliente no puede difundir un evento de IA');

  let denied = false;
  const strangerDoc = new Y.Doc();
  const stranger = new HocuspocusProvider({
    url: `ws://127.0.0.1:${collab.port()}`,
    name: scenario.room,
    token: scenario.extranoToken,
    document: strangerDoc,
    onAuthenticationFailed: () => {
      denied = true;
    },
  });
  clients.push({ provider: stranger, doc: strangerDoc, events: [] });
  await until(() => denied, 'rechazo del no miembro');
  assert.equal(stranger.synced, false);
  report('un usuario ajeno al proyecto no entra en la sala');

  viewer.provider.destroy();
  viewer.doc.destroy();
  await until(
    () => collab.server.hocuspocus.documents.get(scenario.room)?.getConnectionsCount() === 2,
    'desconexión del tercer cliente',
  );
  const missedId = randomUUID();
  assert.equal((await publish({ ...event, id: missedId }, serviceSecret)).status, 202);
  await until(() => owner.events.length === 6, 'evento durante desconexión');
  const reconnected = await connect(scenario.room, scenario.lectorToken);
  const afterReconnectId = randomUUID();
  assert.equal((await publish({ ...event, id: afterReconnectId }, serviceSecret)).status, 202);
  await until(() => reconnected.events.length === 1, 'evento después de reconectar');
  assert.ok(!reconnected.events[0]?.includes(missedId));
  assert.ok(reconnected.events[0]?.includes(afterReconnectId));
  report(
    'reconexión recibe eventos nuevos, pero NO reproduce eventos perdidos: requiere catch-up HTTP',
  );
  assert.equal(
    (await publish({ ...event, room: scenario.terceraRoom }, serviceSecret)).status,
    204,
  );
  report('sala sin clientes: notificación prescindible; la persistencia debe preceder al evento');
  process.stdout.write(
    'RESULTADO: stateless viable como invalidación; API autenticada y cursor necesarios.\n',
  );
} finally {
  for (const client of clients) {
    client.provider.destroy();
    client.doc.destroy();
  }
  await collab.close();
  await database.stop();
}
