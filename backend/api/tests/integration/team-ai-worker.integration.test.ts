import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiPorts, loadAiConfig, ProviderUnavailableError } from '@uml/ai';
import {
  AI_PROPOSAL_TTL_MS,
  teamMessageSchema,
  aiProposalSchema,
  type TeamAiEvent,
} from '@uml/contracts';
import type { TeamMessage } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { createTeamWorker } from '../../src/modules/team-ai/worker.js';
import {
  createTeamProcessor,
  type TeamWorkResult,
} from '../../src/modules/team-ai/orchestrator.js';
import { startHarness, type Harness } from '../support/harness.js';

const model = { classes: [], relationships: [] };
const answer: TeamWorkResult = { kind: 'ANSWER', text: 'Respuesta compartida' };
type Call = {
  job: TeamMessage;
  signal: AbortSignal;
  resolve(value: TeamWorkResult): void;
  reject(error: unknown): void;
};

describe('paso 6: worker real, API y PostgreSQL', () => {
  let api: Harness;
  let owner: Awaited<ReturnType<Harness['signUp']>>;
  let editor: Awaited<ReturnType<Harness['signUp']>>;
  let projectId: string, boardId: string;
  const calls: Call[] = [];
  const post = (change = {}, token = owner.token) =>
    api.request('POST', `/boards/${boardId}/team-ai/messages`, {
      token,
      body: {
        clientRequestId: randomUUID(),
        mode: 'ASK',
        inputMode: 'TEXT',
        text: 'Explica UML',
        model,
        ...change,
      },
    });
  const state = (id: string) => api.app.prisma.teamMessage.findUniqueOrThrow({ where: { id } });
  const waitState = async (id: string, status: string) => {
    await vi.waitFor(async () => expect((await state(id)).status).toBe(status), { timeout: 8000 });
  };
  const waitCalls = async (count: number) => {
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(count), { timeout: 8000 });
  };

  beforeAll(async () => {
    api = await startHarness({
      teamAi: {
        process: (job, signal) =>
          new Promise((resolve, reject) => calls.push({ job, signal, resolve, reject })),
      },
      env: {
        AI_CHAIN_TIMEOUT_MS: '1500',
        TEAM_AI_TIMEOUT_MS: '1500',
        TEAM_AI_BOARD_CONCURRENCY: '2',
        TEAM_AI_MAX_CONCURRENCY: '4',
      },
    });
    owner = await api.signUp('worker@test.invalid');
    const project = await api.request('POST', '/projects', {
      token: owner.token,
      body: { displayName: 'Worker' },
    });
    projectId = project.body.id as string;
    editor = await api.signUp('parallel-editor@test.invalid');
    await api.app.prisma.projectMember.create({
      data: { projectId, userId: editor.userId, role: 'EDITOR' },
    });
  });
  afterAll(async () => {
    await api?.stop();
  });
  beforeEach(async () => {
    calls.length = 0;
    await api.app.prisma.projectAiSettings.deleteMany({ where: { projectId } });
    boardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Cola' } })).id;
  });

  it('atiende a dos desarrolladores a la vez en la misma pizarra y conserva cada destinatario al terminar en otro orden', async () => {
    const firstBoard = boardId;
    const responses = await Promise.all([
      post({ text: 'Primera' }),
      post({ text: 'Segunda' }, editor.token),
    ]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    await waitCalls(2);
    const ordered = await api.app.prisma.teamMessage.findMany({
      where: { boardId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(calls.map((c) => c.job.id)).toEqual(ordered.map((m) => m.id));
    expect(ordered.map((m) => m.status)).toEqual(['PROCESSING', 'PROCESSING']);
    boardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Paralela' } }))
      .id;
    const parallel = await post();
    await waitCalls(3);
    calls[2]!.resolve(answer);
    await waitState(parallel.body.id as string, 'DONE');
    calls[1]!.resolve(answer);
    await waitState(ordered[1]!.id, 'DONE');
    expect((await state(ordered[0]!.id)).status).toBe('PROCESSING');
    calls[0]!.resolve(answer);
    await waitState(ordered[0]!.id, 'DONE');
    const history = await api.request('GET', `/boards/${firstBoard}/team-ai/messages`, {
      token: owner.token,
    });
    const ai = history.body.messages.filter((m: { authorKind: string }) => m.authorKind === 'AI');
    expect(ai).toHaveLength(2);
    for (const message of ai) {
      expect(teamMessageSchema.safeParse(message).success).toBe(true);
      expect(message.addressedToId).toBe(ordered.find((m) => m.id === message.replyToId)!.authorId);
      expect(ordered.map((m) => m.id)).toContain(message.replyToId);
    }
  });

  it('idempotencia activa no llama dos veces al proveedor', async () => {
    const clientRequestId = randomUUID();
    const [a, b] = await Promise.all([post({ clientRequestId }), post({ clientRequestId })]);
    expect(a.body.id).toBe(b.body.id);
    await waitCalls(1);
    calls[0]!.resolve(answer);
    await waitState(a.body.id as string, 'DONE');
    expect((await post({ clientRequestId })).body.status).toBe('DONE');
    expect(calls).toHaveLength(1);
    expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
      1,
    );
  });

  it('cambio de solutionMode en vuelo descarta la respuesta generada con la política anterior', async () => {
    const response = await post();
    await waitCalls(1);
    const changed = await api.request('PUT', `/projects/${projectId}/ai-settings`, {
      token: owner.token,
      body: {
        enabled: true,
        solutionMode: 'HINTS_ONLY',
        executionMode: 'PROPOSE_ONLY',
        reviewMode: 'ON_DEMAND',
        aiSource: 'PROVIDERS',
      },
    });
    expect(changed.status).toBe(200);
    calls[0]!.resolve({ ...answer, solutionMode: 'ON_REQUEST' });
    await waitState(response.body.id as string, 'FAILED');
    expect((await state(response.body.id as string)).errorCode).toBe('team_ai_settings_changed');
    expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
      0,
    );
  });

  it('OFF bloquea revisión en vuelo y en cola sin afectar el historial', async () => {
    const first = await post({ mode: 'REVIEW' });
    const second = await post({ mode: 'REVIEW' });
    await waitCalls(2);
    const queued = await post({ mode: 'REVIEW' });
    await api.request('PUT', `/projects/${projectId}/ai-settings`, {
      token: owner.token,
      body: {
        enabled: true,
        solutionMode: 'ON_REQUEST',
        executionMode: 'PROPOSE_ONLY',
        reviewMode: 'OFF',
        aiSource: 'PROVIDERS',
      },
    });
    calls[0]!.resolve({ kind: 'REVIEW', text: 'Respuesta tardía', solutionMode: 'ON_REQUEST' });
    calls[1]!.resolve({ kind: 'REVIEW', text: 'Respuesta tardía', solutionMode: 'ON_REQUEST' });
    for (const response of [first, second, queued]) {
      await waitState(response.body.id as string, 'FAILED');
      expect((await state(response.body.id as string)).errorCode).toBe('team_ai_review_disabled');
    }
    expect(calls).toHaveLength(2);
    expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
      0,
    );
  });

  it('no publica un tipo de respuesta de edición para ASK aunque el procesador lo devuelva', async () => {
    const response = await post();
    await waitCalls(1);
    calls[0]!.resolve({ kind: 'PROPOSAL', text: 'Cambio indebido' });
    await waitState(response.body.id as string, 'FAILED');
    expect((await state(response.body.id as string)).errorCode).toBe('team_ai_invalid_response');
    expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
      0,
    );
  });

  it('cancelar PROCESSING aborta y no publica respuesta ni propuesta tardía; cancelar QUEUED no llama al proveedor', async () => {
    const first = await post({ mode: 'INSTRUCT', text: 'Crea la clase Persona' });
    await waitCalls(1);
    const lateProposal = await createTeamProcessor(
      createAiPorts(loadAiConfig({ AI_LLM_PROVIDER: 'mock' })),
    )(calls[0]!.job, calls[0]!.signal);
    expect(lateProposal.proposal).toBeDefined();
    const second = await post();
    await waitCalls(2);
    const queued = await post();
    const cancel = (id: string) =>
      api.request('POST', `/boards/${boardId}/team-ai/messages/${id}/cancel`, {
        token: owner.token,
      });
    expect((await cancel(queued.body.id as string)).body.status).toBe('CANCELLED');
    expect((await cancel(first.body.id as string)).body.status).toBe('CANCELLED');
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    calls[0]!.resolve(lateProposal);
    calls[1]!.resolve(answer);
    const third = await post();
    await waitCalls(3);
    calls[2]!.resolve(answer);
    await waitState(second.body.id as string, 'DONE');
    await waitState(third.body.id as string, 'DONE');
    expect((await state(queued.body.id as string)).status).toBe('CANCELLED');
    expect((await state(first.body.id as string)).status).toBe('CANCELLED');
    expect(
      await api.app.prisma.teamMessage.count({ where: { replyToId: first.body.id as string } }),
    ).toBe(0);
    expect(
      await api.app.prisma.aiProposal.count({
        where: { requestMessageId: first.body.id as string },
      }),
    ).toBe(0);
  });

  it('timeout persiste FAILED, descarta salida tardía y permite seguir editando/consultando', async () => {
    const request = await post();
    await waitCalls(1);
    await waitState(request.body.id as string, 'FAILED');
    expect((await state(request.body.id as string)).errorCode).toBe('team_ai_timeout');
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.resolve(answer);
    const next = await post();
    await waitCalls(2);
    calls[1]!.resolve(answer);
    await waitState(next.body.id as string, 'DONE');
    expect(
      await api.app.prisma.teamMessage.count({ where: { replyToId: request.body.id as string } }),
    ).toBe(0);
    expect((await api.request('GET', `/boards/${boardId}`, { token: owner.token })).status).toBe(
      200,
    );
  });

  it('tres trabajos no gastan su presupuesto esperando en cola', async () => {
    const requests = await Promise.all([post(), post(), post()]);
    for (let i = 0; i < 3; i++) {
      await waitCalls(i + 1);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(calls[i]!.signal.aborted).toBe(false);
      calls[i]!.resolve(answer);
    }
    for (const response of requests) await waitState(response.body.id as string, 'DONE');
  });

  it('fallo de proveedor no filtra secretos y no detiene la siguiente solicitud', async () => {
    const first = await post();
    const second = await post();
    await waitCalls(1);
    calls[0]!.reject(new ProviderUnavailableError('test', 'secret-provider-payload'));
    await waitCalls(2);
    calls[1]!.resolve(answer);
    await waitState(first.body.id as string, 'FAILED');
    await waitState(second.body.id as string, 'DONE');
    expect((await state(first.body.id as string)).errorCode).toBe('ai_provider_unavailable');
    const response = await api.request('GET', `/boards/${boardId}/team-ai/messages`, {
      token: owner.token,
    });
    expect(JSON.stringify(response.body)).not.toContain('secret-provider-payload');
  });

  it('revalida enabled antes de publicar y antes de consumir el siguiente', async () => {
    const first = await post();
    const second = await post();
    await waitCalls(2);
    const queued = await post();
    await api.app.prisma.projectAiSettings.create({ data: { projectId, enabled: false } });
    calls[0]!.resolve(answer);
    calls[1]!.resolve(answer);
    await waitState(first.body.id as string, 'FAILED');
    await waitState(second.body.id as string, 'FAILED');
    await waitState(queued.body.id as string, 'FAILED');
    expect((await state(first.body.id as string)).errorCode).toBe('ai_disabled');
    expect(calls).toHaveLength(2);
    expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
      0,
    );
  });

  it('revocar membresía durante el proveedor impide publicar y vacía la cola de ese usuario', async () => {
    const member = await api.signUp('worker-editor@test.invalid');
    await api.app.prisma.projectMember.create({
      data: { projectId, userId: member.userId, role: 'EDITOR' },
    });
    const response = await api.request('POST', `/boards/${boardId}/team-ai/messages`, {
      token: member.token,
      body: {
        clientRequestId: randomUUID(),
        mode: 'ASK',
        inputMode: 'TEXT',
        text: 'Pregunta',
        model,
      },
    });
    await waitCalls(1);
    await api.app.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: member.userId } },
    });
    calls[0]!.resolve(answer);
    await waitState(response.body.id as string, 'FAILED');
    expect((await state(response.body.id as string)).errorCode).toBe('team_ai_access_revoked');
    expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
      0,
    );
  });

  it('puente mock produce propuesta con expiración, identidad y precondición sin modificar UML', async () => {
    const request = await post({ mode: 'INSTRUCT', text: 'Crea la clase Persona' });
    await waitCalls(1);
    const processor = createTeamProcessor(createAiPorts(loadAiConfig({ AI_LLM_PROVIDER: 'mock' })));
    const result = await processor(calls[0]!.job, calls[0]!.signal);
    calls[0]!.resolve(result);
    await waitState(request.body.id as string, 'DONE');
    const response = await api.request(
      'GET',
      `/boards/${boardId}/team-ai/messages/${request.body.id}`,
      { token: owner.token },
    );
    expect(aiProposalSchema.safeParse(response.body.proposal).success).toBe(true);
    const proposal = response.body.proposal;
    expect(proposal.requesterId).toBe(owner.userId);
    expect(proposal.batch.actorId).toBe(owner.userId);
    expect(proposal.expectedSemantic).toEqual(model);
    expect(Date.parse(proposal.expiresAt) - Date.parse(proposal.createdAt)).toBe(
      AI_PROPOSAL_TTL_MS,
    );
    expect(proposal.status).toBe('READY');
    expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(0);
    expect(await api.app.prisma.boardDocument.findUnique({ where: { boardId } })).toBeNull();
  });

  it('dos instrucciones en vuelo conservan autor, lote y snapshot propios sin modificar el diagrama', async () => {
    const snapshot = {
      classes: [
        {
          id: randomUUID(),
          displayName: 'Cliente',
          codeName: 'Cliente',
          databaseName: 'cliente',
          attributes: [],
        },
      ],
      relationships: [],
    };
    const first = await post({ mode: 'INSTRUCT', text: 'Crea la clase Persona' });
    const second = await post(
      { mode: 'INSTRUCT', text: 'Crea la clase Producto', model: snapshot },
      editor.token,
    );
    await waitCalls(2);
    const processor = createTeamProcessor(createAiPorts(loadAiConfig({ AI_LLM_PROVIDER: 'mock' })));
    const results = await Promise.all(calls.map((call) => processor(call.job, call.signal)));
    calls[1]!.resolve(results[1]!);
    await waitState(second.body.id as string, 'DONE');
    expect((await state(first.body.id as string)).status).toBe('PROCESSING');
    calls[0]!.resolve(results[0]!);
    await waitState(first.body.id as string, 'DONE');
    const proposals = await api.app.prisma.aiProposal.findMany({ where: { boardId } });
    expect(proposals).toHaveLength(2);
    expect(new Set(proposals.map((p) => p.batchId)).size).toBe(2);
    for (const [response, actorId, expected] of [
      [first, owner.userId, model],
      [second, editor.userId, snapshot],
    ] as const) {
      const detail = await api.request(
        'GET',
        `/boards/${boardId}/team-ai/messages/${response.body.id}`,
        { token: owner.token },
      );
      expect(detail.status).toBe(200);
      const proposal = aiProposalSchema.parse(detail.body.proposal);
      expect(proposal.requesterId).toBe(actorId);
      expect(proposal.batch.actorId).toBe(actorId);
      expect(proposal.expectedSemantic).toEqual(expected);
    }
    expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(0);
    expect(await api.app.prisma.boardDocument.findUnique({ where: { boardId } })).toBeNull();
  });

  it('recupera PROCESSING huérfano sin interrumpir otra inferencia activa en esa pizarra', async () => {
    const first = await post();
    await waitCalls(1);
    const orphan = await api.app.prisma.teamMessage.create({
      data: {
        boardId,
        authorKind: 'USER',
        authorId: owner.userId,
        clientRequestId: randomUUID(),
        mode: 'ASK',
        inputMode: 'TEXT',
        kind: 'QUESTION',
        text: 'Escritura final interrumpida',
        requestModel: model,
        status: 'PROCESSING',
      },
    });
    const second = await post();
    await waitCalls(2);
    expect((await state(orphan.id)).status).toBe('INTERRUPTED');
    expect((await state(first.body.id as string)).status).toBe('PROCESSING');
    expect(calls[0]!.signal.aborted).toBe(false);
    calls[0]!.resolve(answer);
    calls[1]!.resolve(answer);
    await waitState(first.body.id as string, 'DONE');
    await waitState(second.body.id as string, 'DONE');
  });

  // Se ejecuta al final: cierra el consumidor real y reinicia sobre la misma BD.
  it('cierre aborta activos; arranque recupera QUEUED/PROCESSING a INTERRUPTED y conserva terminales', async () => {
    const first = await post();
    await waitCalls(1);
    const second = await post();
    await waitCalls(2);
    await api.app.close();
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(true);
    // El cliente Prisma del harness puede reconectar tras close para comprobar persistencia.
    await waitState(first.body.id as string, 'INTERRUPTED');
    await waitState(second.body.id as string, 'INTERRUPTED');
    const seed = async (status: 'QUEUED' | 'PROCESSING' | 'CANCELLED') =>
      api.app.prisma.teamMessage.create({
        data: {
          boardId,
          authorKind: 'USER',
          authorId: owner.userId,
          clientRequestId: randomUUID(),
          mode: 'ASK',
          inputMode: 'TEXT',
          kind: 'QUESTION',
          text: 'Reinicio',
          requestModel: model,
          status,
        },
      });
    const queued = await seed('QUEUED'),
      processing = await seed('PROCESSING'),
      cancelled = await seed('CANCELLED');
    const events: TeamAiEvent[] = [];
    const process = vi.fn(async () => answer);
    const worker = createTeamWorker({
      prisma: api.app.prisma,
      publish: (e) => events.push(e),
      process,
      timeoutMs: 1500,
      log: { warn: vi.fn() },
    });
    try {
      await worker.start();
      await waitState(queued.id, 'INTERRUPTED');
      await waitState(processing.id, 'INTERRUPTED');
      expect((await state(cancelled.id)).status).toBe('CANCELLED');
      expect(process).not.toHaveBeenCalled();
      expect(events).toEqual(
        expect.arrayContaining([
          { type: 'team.update', boardId, messageId: queued.id, status: 'INTERRUPTED' },
          { type: 'team.update', boardId, messageId: processing.id, status: 'INTERRUPTED' },
        ]),
      );
      calls[0]!.resolve(answer);
      expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
        0,
      );
      await worker.close();
      const crash = await seed('QUEUED');
      const restarted = await buildApp(api.config, { teamAi: { process } });
      try {
        await restarted.ready();
        await waitState(crash.id, 'INTERRUPTED');
        const retry = await restarted.inject({
          method: 'POST',
          url: `/boards/${boardId}/team-ai/messages`,
          headers: { authorization: `Bearer ${owner.token}` },
          payload: {
            clientRequestId: randomUUID(),
            mode: 'ASK',
            inputMode: 'TEXT',
            text: 'Nuevo intento',
            model,
          },
        });
        expect(retry.statusCode).toBe(202);
        await waitState(retry.json<{ id: string }>().id, 'DONE');
        expect(process).toHaveBeenCalledTimes(1);
      } finally {
        await restarted.close();
      }
    } finally {
      await worker.close();
      await api.app.prisma.$disconnect();
    }
  });
});
