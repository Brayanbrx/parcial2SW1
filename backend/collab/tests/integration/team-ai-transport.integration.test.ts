import { randomBytes, randomUUID } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createAiPorts, loadAiConfig } from '@uml/ai';
import {
  AI_PROPOSAL_TTL_MS,
  DEFAULT_AI_SETTINGS,
  projectAiSettingsSchema,
  teamFeedPageSchema,
  type CommandBatch,
  type TeamAiEvent,
} from '@uml/contracts';
import { buildCollabServer, type CollabServer } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { buildApp as buildApplication } from '../../../api/src/app.js';
import { loadConfig as apiConfig } from '../../../api/src/config.js';
import {
  startEphemeralDatabase,
  type EphemeralDatabase,
} from '../../../api/tests/support/database.js';
import { seedProject, type Escenario } from '../support/scenario.js';
import { createTeamFeedTransport } from '../../../../frontend/src/features/team-assistant/transport.js';
import { withTeamBoard } from '../../../api/src/modules/team-ai/persistence.js';
import { createTeamWorker } from '../../../api/src/modules/team-ai/worker.js';
import { createTeamProcessor } from '../../../api/src/modules/team-ai/orchestrator.js';
import { createTeamEventPublisher } from '../../../api/src/modules/team-ai/events.js';

// Transporte aislado del consumidor; los estados se controlan desde las pruebas.
const buildApp = (config: Parameters<typeof buildApplication>[0]) =>
  buildApplication(config, { teamAi: false });

const jwtSecret = randomBytes(48).toString('hex');
const serviceSecret = randomBytes(48).toString('hex');
const model = { classes: [], relationships: [] };
const until = async (check: () => boolean) =>
  expect.poll(check, { timeout: 10_000, interval: 20 }).toBe(true);

describe('paso 4: API, PostgreSQL y stateless de producción', () => {
  let database: EphemeralDatabase, collab: CollabServer, api: FastifyInstance, scenario: Escenario;
  const clients: { provider: HocuspocusProvider; doc: Y.Doc; events: TeamAiEvent[] }[] = [];
  const feeds: ReturnType<typeof createTeamFeedTransport>[] = [];
  const url = () => `http://127.0.0.1:${collab.port()}`;
  const messages = () => `/boards/${scenario.boardId}/team-ai/messages`;
  const request = async (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    token: string,
    body?: unknown,
  ) => {
    const response = await api.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: response.statusCode, body: response.json() as Record<string, unknown> };
  };
  const publish = (event: unknown, secret: string | undefined = serviceSecret, method = 'POST') =>
    fetch(`${url()}/internal/team-ai/events`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(event) }),
      signal: AbortSignal.timeout(5000),
    });
  const post = (token = scenario.editorToken, data = {}) =>
    request('POST', messages(), token, {
      clientRequestId: randomUUID(),
      mode: 'ASK',
      inputMode: 'TEXT',
      text: 'Explica una clase',
      model,
      ...data,
    });
  async function seedProposal(requestMessageId: string) {
    const now = new Date(),
      batchId = randomUUID();
    const batch: CommandBatch = {
      batchId,
      actorId: scenario.editorId,
      origin: 'AI_TEXT',
      issuedAt: now.toISOString(),
      commands: [
        {
          commandId: randomUUID(),
          actorId: scenario.editorId,
          origin: 'AI_TEXT',
          issuedAt: now.toISOString(),
          type: 'CREATE_CLASS',
          payload: { classId: randomUUID(), displayName: 'Persona' },
        },
      ],
    };
    const proposal = await collab.prisma.aiProposal.create({
      data: {
        boardId: scenario.boardId,
        requestMessageId,
        requesterId: scenario.editorId,
        batchId,
        batch,
        expectedSemantic: model,
        status: 'PENDING_CONFIRMATION',
        createdAt: now,
        expiresAt: new Date(now.getTime() + AI_PROPOSAL_TTL_MS),
      },
    });
    return { proposal, batch };
  }
  async function connect(token: string, room = scenario.room) {
    const doc = new Y.Doc(),
      events: TeamAiEvent[] = [];
    const provider = new HocuspocusProvider({
      url: url().replace('http:', 'ws:'),
      name: room,
      token,
      document: doc,
      onStateless: ({ payload }) => events.push(JSON.parse(payload) as TeamAiEvent),
    });
    const client = { provider, doc, events };
    clients.push(client);
    await until(() => provider.synced);
    return client;
  }
  function feed(token: string, client: Awaited<ReturnType<typeof connect>>) {
    const transport = createTeamFeedTransport({
      boardId: scenario.boardId,
      projectId: scenario.projectId,
      async loadPage(cursor) {
        const response = await request(
          'GET',
          `${messages()}?changedSince=${cursor}&limit=1`,
          token,
        );
        expect(response.status).toBe(200);
        return teamFeedPageSchema.parse(response.body);
      },
      async loadSettings() {
        const response = await request('GET', `/projects/${scenario.projectId}/ai-settings`, token);
        expect(response.status).toBe(200);
        return projectAiSettingsSchema.parse(response.body);
      },
      onChange() {},
      onError(error) {
        throw error;
      },
    });
    client.provider.on('stateless', ({ payload }: { payload: string }) =>
      transport.acceptEvent(payload),
    );
    transport.setVisible(true);
    feeds.push(transport);
    return transport;
  }
  beforeAll(async () => {
    database = await startEphemeralDatabase();
    collab = buildCollabServer(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: database.url,
        JWT_SECRET: jwtSecret,
        COLLAB_INTERNAL_SECRET: serviceSecret,
        COLLAB_HOST: '127.0.0.1',
        COLLAB_PORT: '0',
        STORE_DEBOUNCE_MS: '0',
        STORE_MAX_DEBOUNCE_MS: '1',
      }),
    );
    await collab.listen();
    api = await buildApp(
      apiConfig({
        NODE_ENV: 'test',
        DATABASE_URL: database.url,
        JWT_SECRET: jwtSecret,
        COLLAB_INTERNAL_URL: url(),
        COLLAB_INTERNAL_SECRET: serviceSecret,
      }),
    );
  });
  beforeEach(async () => {
    scenario = await seedProject(collab.prisma, jwtSecret);
  });
  afterEach(() => {
    feeds.splice(0).forEach((transport) => transport.stop());
    clients.splice(0).forEach(({ provider, doc }) => {
      provider.destroy();
      doc.destroy();
    });
  });
  afterAll(async () => {
    await api?.close();
    await collab?.close();
    await database?.stop();
  });

  it('exige credencial de servicio y rechaza tipos, campos, método y tamaño inválidos', async () => {
    const event = { type: 'team.message', boardId: scenario.boardId, messageId: randomUUID() };
    for (const secret of ['', 'wrong', scenario.duenaToken])
      expect((await publish(event, secret)).status).toBe(403);
    expect((await publish(event, serviceSecret, 'GET')).status).toBe(405);
    expect((await publish({ ...event, text: 'privado' })).status).toBe(400);
    expect((await publish({ ...event, type: 'proposal.updated' })).status).toBe(400);
    expect((await publish({ ...event, text: 'x'.repeat(4096) })).status).toBe(413);
    expect((await publish(event)).status).toBe(204);
  });

  it('entrega los cuatro eventos a tres identidades, aísla salas y no altera Y.Doc', async () => {
    const owner = await connect(scenario.duenaToken),
      editor = await connect(scenario.editorToken),
      viewer = await connect(scenario.lectorToken);
    const other = await connect(scenario.duenaToken, scenario.otraRoom);
    const baseline = Y.encodeStateAsUpdate(owner.doc);
    const events: TeamAiEvent[] = [
      { type: 'team.message', boardId: scenario.boardId, messageId: randomUUID() },
      { type: 'team.update', boardId: scenario.boardId, proposalId: randomUUID(), status: 'STALE' },
      {
        type: 'ai.status',
        boardId: scenario.boardId,
        state: 'PROCESSING',
        forUserId: scenario.editorId,
        queued: 1,
      },
      { type: 'ai.settings', projectId: scenario.projectId },
    ];
    for (const event of events) expect((await publish(event)).status).toBe(202);
    await until(() => [owner, editor, viewer].every((c) => c.events.length === 4));
    expect(owner.events).toEqual(events);
    expect(editor.events).toEqual(events);
    expect(viewer.events).toEqual(events);
    expect(other.events).toEqual([events[3]]);
    expect(Y.encodeStateAsUpdate(owner.doc)).toEqual(baseline);
    const forgedId = randomUUID();
    owner.provider.sendStateless(JSON.stringify({ ...events[0], messageId: forgedId }));
    const barrier: TeamAiEvent = {
      type: 'ai.status',
      boardId: scenario.boardId,
      state: 'IDLE',
      queued: 0,
    };
    await publish(barrier);
    await until(() => viewer.events.length >= 5);
    expect(viewer.events).toHaveLength(5);
    expect(viewer.events.at(-1)).toEqual(barrier);
  });

  it('tres sesiones recuperan mensajes y estados perdidos, sin duplicados al reconectar o recargar', async () => {
    const owner = await connect(scenario.duenaToken),
      editor = await connect(scenario.editorToken),
      viewer = await connect(scenario.lectorToken);
    const a = feed(scenario.duenaToken, owner),
      b = feed(scenario.editorToken, editor),
      c = feed(scenario.lectorToken, viewer);
    await Promise.all([a.refresh(), b.refresh(), c.refresh()]);
    const data = { clientRequestId: randomUUID() };
    const accepted = await post(scenario.editorToken, data);
    expect(accepted.status).toBe(202);
    await until(() => [a, b, c].every((f) => f.snapshot().messages.length === 1));
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.snapshot()).toEqual(c.snapshot());
    expect((await post(scenario.editorToken, data)).body.id).toBe(accepted.body.id);
    c.setVisible(false);
    viewer.provider.destroy();
    await until(
      () => collab.server.hocuspocus.documents.get(scenario.room)?.getConnectionsCount() === 2,
    );
    expect(
      (await request('POST', `${messages()}/${accepted.body.id}/cancel`, scenario.editorToken))
        .status,
    ).toBe(200);
    const second = await post(scenario.duenaToken);
    expect(second.status).toBe(202);
    await until(
      () => a.snapshot().messages.length === 2 && b.snapshot().messages[0]?.status === 'CANCELLED',
    );
    expect(c.snapshot().messages[0]?.status).toBe('QUEUED');
    const reconnected = await connect(scenario.lectorToken);
    reconnected.provider.on('stateless', ({ payload }: { payload: string }) =>
      c.acceptEvent(payload),
    );
    c.setVisible(true);
    await c.refresh();
    expect(c.snapshot()).toEqual(a.snapshot());
    const reloaded = feed(scenario.lectorToken, reconnected);
    await reloaded.refresh();
    expect(reloaded.snapshot()).toEqual(a.snapshot());
    expect(new Set(c.snapshot().messages.map((m) => m.id)).size).toBe(2);
    expect((await request('GET', messages(), scenario.extranoToken)).status).toBe(404);
  });

  it.each(['membership', 'session', 'expiration'] as const)(
    'excluye receptor inactivo tras revocación %s antes de emitir',
    async (reason) => {
      const owner = await connect(scenario.duenaToken),
        editor = await connect(scenario.editorToken);
      if (reason === 'membership')
        await collab.prisma.projectMember.delete({
          where: { projectId_userId: { projectId: scenario.projectId, userId: scenario.editorId } },
        });
      if (reason === 'session')
        await collab.prisma.user.update({
          where: { id: scenario.editorId },
          data: { sessionVersion: { increment: 1 } },
        });
      if (reason === 'expiration') {
        const connection = collab.server.hocuspocus.documents
          .get(scenario.room)
          ?.getConnections()
          .find((c) => c.context.userId === scenario.editorId);
        expect(connection).toBeDefined();
        connection!.context = { ...connection!.context, expiresAt: Date.now() - 1 };
      }
      const event = { type: 'team.message', boardId: scenario.boardId, messageId: randomUUID() };
      expect((await publish(event)).status).toBe(202);
      await until(() => owner.events.length === 1);
      expect(editor.events).toEqual([]);
      editor.provider.destroy();
      expect((await request('GET', messages(), scenario.editorToken)).status).toBe(
        reason === 'membership' ? 404 : reason === 'session' ? 401 : 200,
      );
    },
  );

  it.each(['READY', 'PENDING_CONFIRMATION'] as const)(
    'paso 13: creación %s del worker llega por team.update y recupera la propuesta confirmada en BD',
    async (status) => {
      const owner = await connect(scenario.duenaToken);
      const observer = feed(scenario.duenaToken, owner);
      const publisher = createTeamEventPublisher(
        apiConfig({
          NODE_ENV: 'test',
          DATABASE_URL: database.url,
          JWT_SECRET: jwtSecret,
          COLLAB_INTERNAL_URL: url(),
          COLLAB_INTERNAL_SECRET: serviceSecret,
        }),
        api.log,
      );
      const process = createTeamProcessor(createAiPorts(loadAiConfig({ AI_LLM_PROVIDER: 'mock' })));
      const worker = createTeamWorker({
        prisma: api.prisma,
        publish: publisher.publish,
        process: async (job, signal) => {
          const result = await process(job, signal);
          expect(result.proposal).toBeDefined();
          return { ...result, proposal: { ...result.proposal!, status } };
        },
        timeoutMs: 5000,
        log: api.log,
      });
      try {
        await worker.start();
        const accepted = await post(scenario.editorToken, {
          mode: 'INSTRUCT',
          text: 'Crea la clase Persona',
        });
        expect(accepted.status).toBe(202);
        worker.notify(scenario.boardId);
        await until(() => observer.snapshot().proposals.length === 1);
        const proposal = observer.snapshot().proposals[0]!;
        await until(() => owner.events.some((event) => 'proposalId' in event));
        expect(owner.events.filter((event) => 'proposalId' in event)).toEqual([
          { type: 'team.update', boardId: scenario.boardId, proposalId: proposal.id, status },
        ]);
        expect(proposal).toMatchObject({
          status,
          requestMessageId: accepted.body.id,
          requesterId: scenario.editorId,
        });
        const persisted = await collab.prisma.aiProposal.findUniqueOrThrow({
          where: { id: proposal.id },
        });
        expect(persisted.status).toBe(status);
        expect(
          await collab.prisma.auditOperation.count({ where: { boardId: scenario.boardId } }),
        ).toBe(0);
      } finally {
        await worker.close();
        await publisher.close();
      }
    },
  );

  it('notifica decisiones, expiración, auditoría y configuración solo una vez tras commit', async () => {
    const owner = await connect(scenario.duenaToken);
    const observer = feed(scenario.duenaToken, owner);
    const accepted = await post();
    await until(() => owner.events.length === 1);
    expect(
      await collab.prisma.teamMessage.findUnique({ where: { id: accepted.body.id as string } }),
    ).not.toBeNull();
    const { proposal, batch } = await seedProposal(accepted.body.id as string);
    const confirm = () =>
      request(
        'POST',
        `/boards/${scenario.boardId}/team-ai/proposals/${proposal.id}/confirm`,
        scenario.editorToken,
      );
    expect((await confirm()).status).toBe(200);
    await until(() => owner.events.length === 2);
    expect((await confirm()).status).toBe(200);
    for (let i = 0; i < 2; i++)
      expect(
        (await request('POST', `/boards/${scenario.boardId}/audit`, scenario.editorToken, batch))
          .status,
      ).toBe(202);
    await until(() => owner.events.length === 3);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request('PUT', `/projects/${scenario.projectId}/ai-settings`, scenario.duenaToken, {
            ...DEFAULT_AI_SETTINGS,
            solutionMode: 'HINTS_ONLY',
          })
        ).status,
      ).toBe(200);
    await until(() => owner.events.length === 4);
    expect(owner.events.map((e) => e.type)).toEqual([
      'team.message',
      'team.update',
      'team.update',
      'ai.settings',
    ]);
    expect(owner.events[1]).toMatchObject({ proposalId: proposal.id, status: 'READY' });
    expect(owner.events[2]).toMatchObject({ proposalId: proposal.id, status: 'APPLIED' });
    await until(() => observer.snapshot().proposals[0]?.status === 'APPLIED');
    const expiredAt = new Date(Date.now() - 1000);
    await collab.prisma.aiProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'READY',
        createdAt: new Date(expiredAt.getTime() - AI_PROPOSAL_TTL_MS),
        expiresAt: expiredAt,
      },
    });
    expect((await confirm()).status).toBe(409);
    await until(() => owner.events.length === 5);
    expect(owner.events[4]).toMatchObject({ status: 'EXPIRED' });
    await until(() => observer.snapshot().proposals[0]?.status === 'EXPIRED');
  });

  it.each(['USER', 'STALE', 'APPLY_FAILED'] as const)(
    'difunde rechazo %s y recupera el estado persistido',
    async (reason) => {
      const owner = await connect(scenario.duenaToken);
      const observer = feed(scenario.duenaToken, owner);
      const accepted = await post();
      const { proposal } = await seedProposal(accepted.body.id as string);
      const path = `/boards/${scenario.boardId}/team-ai/proposals/${proposal.id}`;
      if (reason !== 'USER')
        expect((await request('POST', `${path}/confirm`, scenario.editorToken)).status).toBe(200);
      expect(
        (await request('POST', `${path}/reject`, scenario.editorToken, { reason })).status,
      ).toBe(200);
      const status = reason === 'STALE' ? 'STALE' : 'REJECTED';
      await until(() => observer.snapshot().proposals[0]?.status === status);
      expect(observer.snapshot().proposals[0]?.rejectReason).toBe(reason);
      expect(owner.events).toContainEqual({
        type: 'team.update',
        boardId: scenario.boardId,
        proposalId: proposal.id,
        status,
      });
    },
  );

  it('recupera por polling cuando el emisor no puede autenticarse en colaboración', async () => {
    const client = await connect(scenario.lectorToken);
    const observer = feed(scenario.lectorToken, client);
    await observer.refresh();
    const disconnectedApi = await buildApp(
      apiConfig({
        NODE_ENV: 'test',
        DATABASE_URL: database.url,
        JWT_SECRET: jwtSecret,
        COLLAB_INTERNAL_URL: url(),
        COLLAB_INTERNAL_SECRET: 'invalid-service-secret-with-more-than-32-characters',
      }),
    );
    try {
      const response = await disconnectedApi.inject({
        method: 'POST',
        url: messages(),
        headers: { authorization: `Bearer ${scenario.editorToken}` },
        payload: {
          clientRequestId: randomUUID(),
          mode: 'ASK',
          inputMode: 'TEXT',
          text: 'Sin aviso',
          model,
        },
      });
      expect(response.statusCode).toBe(202);
      await until(() => observer.snapshot().messages.length === 1);
      expect(observer.snapshot().messages[0]?.text).toBe('Sin aviso');
      expect(client.events).toEqual([]);
    } finally {
      await disconnectedApi.close();
    }
  });

  it('un rollback no publica los avisos recolectados', async () => {
    const emitted: TeamAiEvent[] = [];
    await expect(
      withTeamBoard(
        collab.prisma,
        scenario.boardId,
        scenario.editorId,
        async (_tx, { emit }) => {
          emit({ type: 'team.message', boardId: scenario.boardId, messageId: randomUUID() });
          throw new Error('rollback');
        },
        (event) => emitted.push(event),
      ),
    ).rejects.toThrow('rollback');
    expect(emitted).toEqual([]);
  });
});
