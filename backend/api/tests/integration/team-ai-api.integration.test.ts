import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_SETTINGS,
  AI_PROPOSAL_TTL_MS,
  teamMessageSchema,
  type CommandBatch,
  type SemanticModel,
} from '@uml/contracts';
import type { AiProposalStatus, Prisma } from '@prisma/client';
import { startHarness, type Harness } from '../support/harness.js';
import { nextTeamTimestamp, withTeamBoard } from '../../src/modules/team-ai/persistence.js';

const model: SemanticModel = { classes: [], relationships: [] };
const body = (change = {}) => ({
  clientRequestId: randomUUID(),
  mode: 'INSTRUCT',
  inputMode: 'TEXT',
  text: 'Crea Persona',
  model,
  ...change,
});
type Account = Awaited<ReturnType<Harness['signUp']>>;

describe('paso 3: API colectiva autenticada', () => {
  let api: Harness;
  let owner: Account, editor: Account, viewer: Account, outsider: Account;
  let projectId: string, boardId: string, otherBoardId: string;
  const messages = () => `/boards/${boardId}/team-ai/messages`;
  const settings = () => `/projects/${projectId}/ai-settings`;
  const post = (data = body(), token = owner.token) =>
    api.request('POST', messages(), { token, body: data });
  const cancel = (id: string, token = owner.token) =>
    api.request('POST', `${messages()}/${id}/cancel`, { token });

  beforeAll(async () => {
    // Esta suite aísla el contrato HTTP y siembra propuestas/estados manualmente.
    api = await startHarness({ teamAi: false });
    owner = await api.signUp('team-owner@test.invalid');
    editor = await api.signUp('team-editor@test.invalid');
    viewer = await api.signUp('team-viewer@test.invalid');
    outsider = await api.signUp('team-outsider@test.invalid');
    const project = await api.request('POST', '/projects', {
      token: owner.token,
      body: { displayName: 'Equipo' },
    });
    projectId = project.body.id as string;
    await api.app.prisma.projectMember.createMany({
      data: [
        { projectId, userId: editor.userId, role: 'EDITOR' },
        { projectId, userId: viewer.userId, role: 'VIEWER' },
      ],
    });
  });
  afterAll(async () => {
    await api?.stop();
  });
  beforeEach(async () => {
    await api.app.prisma.projectAiSettings.deleteMany({ where: { projectId } });
    boardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Equipo' } }))
      .id;
    otherBoardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Otra' } }))
      .id;
  });

  async function seedProposal(
    status: AiProposalStatus = 'READY',
    options: { expired?: boolean; position?: boolean; actor?: Account } = {},
  ) {
    const actor = options.actor ?? owner;
    const accepted = await post(body(), actor.token);
    expect(accepted.status).toBe(202);
    const now = new Date(Date.now() - (options.expired ? AI_PROPOSAL_TTL_MS + 1000 : 0));
    const batchId = randomUUID();
    const batch: CommandBatch = {
      batchId,
      actorId: actor.userId,
      origin: 'AI_TEXT',
      issuedAt: now.toISOString(),
      commands: [
        {
          commandId: randomUUID(),
          actorId: actor.userId,
          origin: 'AI_TEXT',
          issuedAt: now.toISOString(),
          type: 'CREATE_CLASS',
          payload: {
            classId: randomUUID(),
            displayName: 'Persona',
            ...(options.position ? { position: { x: 5, y: 10 } } : {}),
          },
        },
      ],
    };
    await api.app.prisma.teamMessage.update({
      where: { id: accepted.body.id as string },
      data: { status: 'DONE' },
    });
    const proposal = await api.app.prisma.aiProposal.create({
      data: {
        boardId,
        requestMessageId: accepted.body.id as string,
        requesterId: actor.userId,
        batchId,
        batch,
        expectedSemantic: model,
        status,
        createdAt: now,
        expiresAt: new Date(now.getTime() + AI_PROPOSAL_TTL_MS),
      },
    });
    const url = `/boards/${boardId}/team-ai/proposals/${proposal.id}`;
    return { proposal, batch, url };
  }
  const audit = (batch: unknown, token = owner.token) =>
    api.request('POST', `/boards/${boardId}/audit`, { token, body: batch });

  it('exige sesión y oculta recursos a no miembros', async () => {
    expect((await api.request('GET', messages())).status).toBe(401);
    expect((await api.request('GET', messages(), { token: outsider.token })).status).toBe(404);
    expect((await post(body(), outsider.token)).status).toBe(404);
    expect((await api.request('GET', settings(), { token: outsider.token })).status).toBe(404);
  });
  it('permite ASK y REVIEW al VIEWER, pero reserva INSTRUCT a escritores', async () => {
    expect((await post(body({ mode: 'ASK' }), viewer.token)).status).toBe(202);
    expect((await post(body({ mode: 'REVIEW' }), viewer.token)).status).toBe(202);
    expect((await post(body(), viewer.token)).status).toBe(403);
    expect((await post(body(), editor.token)).status).toBe(202);
    expect(
      (await api.request('GET', messages(), { token: viewer.token })).body.messages,
    ).toHaveLength(3);
  });
  it('deriva identidad, conserva entrada privada y devuelve el contrato público', async () => {
    const data = body();
    const accepted = await post(data);
    expect(accepted.status).toBe(202);
    expect(teamMessageSchema.safeParse(accepted.body).success).toBe(true);
    expect(accepted.body).toMatchObject({ authorId: owner.userId, boardId, status: 'QUEUED' });
    expect(accepted.body).not.toHaveProperty('requestModel');
    const saved = await api.app.prisma.teamMessage.findUniqueOrThrow({
      where: { clientRequestId: data.clientRequestId },
    });
    expect(saved.requestModel).toEqual(model);
    expect(
      (await api.request('GET', `${messages()}/${saved.id}`, { token: editor.token })).body.message,
    ).not.toHaveProperty('requestModel');
  });
  it.each([
    { authorId: randomUUID() },
    { status: 'DONE' },
    { mode: 'SUMMARY' },
    { text: ' ' },
    { text: 'x'.repeat(2001) },
    { model: null },
  ])('rechaza entrada inválida %j', async (change) => {
    expect((await post(body(change))).status).toBe(400);
    expect(await api.app.prisma.teamMessage.count({ where: { boardId } })).toBe(0);
  });
  it('deduplica solicitudes simultáneas y conserva el estado al reintentar', async () => {
    const data = body();
    const results = await Promise.all(Array.from({ length: 5 }, () => post(data)));
    expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await api.app.prisma.teamMessage.count({ where: { boardId } })).toBe(1);
    await cancel(results[0]!.body.id as string);
    expect((await post(data)).body.status).toBe('CANCELLED');
  });
  it('responde 409 genérico por otra identidad, pizarra o contenido, incluido el modelo', async () => {
    const data = body();
    await post(data);
    const results = [
      await post(data, editor.token),
      await post({ ...data, text: 'Otro' }),
      await post({
        ...data,
        model: {
          classes: [
            {
              id: randomUUID(),
              displayName: 'Otro',
              codeName: 'Otro',
              databaseName: 'otro',
              attributes: [],
            },
          ],
          relationships: [],
        },
      }),
      await api.request('POST', `/boards/${otherBoardId}/team-ai/messages`, {
        token: owner.token,
        body: data,
      }),
    ];
    for (const result of results) {
      expect(result.status).toBe(409);
      expect(result.body.error).toEqual(results[0]!.body.error);
      expect(result.body).not.toHaveProperty('id');
    }
  });
  it('resuelve una carrera de clave global entre dos pizarras', async () => {
    const data = body();
    const results = await Promise.all([
      post(data),
      api.request('POST', `/boards/${otherBoardId}/team-ai/messages`, {
        token: owner.token,
        body: data,
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
  });
  it('configuración solo OWNER, PUT completo, defaults y lectura con IA deshabilitada', async () => {
    expect((await api.request('GET', settings(), { token: viewer.token })).body).toMatchObject({
      ...DEFAULT_AI_SETTINGS,
      localModel: null,
    });
    expect(
      (await api.request('PUT', settings(), { token: editor.token, body: DEFAULT_AI_SETTINGS }))
        .status,
    ).toBe(403);
    const sinLocal = await api.request('PUT', settings(), {
      token: owner.token,
      body: { ...DEFAULT_AI_SETTINGS, aiSource: 'LOCAL' },
    });
    expect([sinLocal.status, sinLocal.body.error.code]).toEqual([400, 'local_ai_unavailable']);
    expect(
      (await api.request('PUT', settings(), { token: owner.token, body: { enabled: false } }))
        .status,
    ).toBe(400);
    const data = body();
    await post(data);
    expect(
      (
        await api.request('PUT', settings(), {
          token: owner.token,
          body: { ...DEFAULT_AI_SETTINGS, enabled: false },
        })
      ).status,
    ).toBe(200);
    expect((await post(body())).body.error.code).toBe('ai_disabled');
    expect((await post(data)).status).toBe(202);
    expect(
      (await api.request('GET', messages(), { token: viewer.token })).body.messages,
    ).toHaveLength(1);
  });
  it('limita pendientes por usuario de forma atómica y libera cupo al cancelar', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post()));
    expect(results.filter((r) => r.status === 202)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(2);
    await cancel(results.find((r) => r.status === 202)!.body.id as string);
    expect((await post()).status).toBe(202);
    expect((await post(body(), editor.token)).status).toBe(202);
  });
  it('aplica el límite de pizarra independientemente del usuario', async () => {
    await api.app.prisma.teamMessage.createMany({
      data: Array.from({ length: 20 }, (): Prisma.TeamMessageCreateManyInput => ({
        boardId,
        authorId: randomUUID(),
        authorKind: 'USER',
        clientRequestId: randomUUID(),
        mode: 'ASK',
        inputMode: 'TEXT',
        kind: 'QUESTION',
        text: 'Pregunta',
        status: 'QUEUED',
      })),
    });
    expect((await post()).body.error.code).toBe('team_queue_full');
  });
  it('valida pizarra y destinatario del hilo de aclaración', async () => {
    const parent = await post();
    await api.app.prisma.teamMessage.update({
      where: { id: parent.body.id as string },
      data: { status: 'DONE' },
    });
    const clarification = await api.app.prisma.teamMessage.create({
      data: {
        boardId,
        authorKind: 'AI',
        kind: 'CLARIFICATION',
        text: '¿Qué atributos?',
        replyToId: parent.body.id as string,
        addressedToId: owner.userId,
      },
    });
    expect((await post(body({ replyToId: clarification.id }), editor.token)).status).toBe(403);
    expect((await post(body({ replyToId: clarification.id }))).status).toBe(202);
    expect(
      (await post(body({ mode: 'ASK', replyToId: clarification.id }), viewer.token)).status,
    ).toBe(202);
    expect(
      (
        await api.request('POST', `/boards/${otherBoardId}/team-ai/messages`, {
          token: owner.token,
          body: body({ replyToId: clarification.id }),
        })
      ).status,
    ).toBe(400);
  });
  it('cancela solo el solicitante y conserva estados terminales', async () => {
    const accepted = await post();
    const id = accepted.body.id as string;
    expect((await cancel(id, editor.token)).status).toBe(403);
    const results = await Promise.all([cancel(id), cancel(id)]);
    expect(results.map((r) => r.body.status)).toEqual(['CANCELLED', 'CANCELLED']);
    await api.app.prisma.teamMessage.update({ where: { id }, data: { status: 'DONE' } });
    expect((await cancel(id)).status).toBe(409);
  });
  it('pagina historial empatado y rechaza cursores inválidos o de otra pizarra', async () => {
    const date = new Date();
    await api.app.prisma.teamMessage.createMany({
      data: Array.from({ length: 4 }, () => ({
        boardId,
        authorKind: 'SYSTEM' as const,
        kind: 'SYSTEM' as const,
        text: 'Evento',
        createdAt: date,
        updatedAt: date,
      })),
    });
    const first = await api.request('GET', `${messages()}?limit=2`, { token: viewer.token });
    const second = await api.request(
      'GET',
      `${messages()}?limit=2&cursor=${first.body.nextCursor}`,
      { token: viewer.token },
    );
    expect(first.body.hasMore).toBe(true);
    expect(second.body.hasMore).toBe(false);
    expect(
      new Set([...first.body.messages, ...second.body.messages].map((m: { id: string }) => m.id))
        .size,
    ).toBe(4);
    expect(
      (await api.request('GET', `${messages()}?cursor=invalid`, { token: owner.token })).status,
    ).toBe(400);
    expect(
      (
        await api.request(
          'GET',
          `/boards/${otherBoardId}/team-ai/messages?cursor=${first.body.nextCursor}`,
          { token: owner.token },
        )
      ).status,
    ).toBe(400);
  });
  it('recupera cambios de mensajes y propuestas con cursores independientes', async () => {
    const { proposal, url } = await seedProposal('PENDING_CONFIRMATION');
    const first = await api.request('GET', `${messages()}?changedSince=start&limit=1`, {
      token: viewer.token,
    });
    expect(first.body.messages).toHaveLength(1);
    expect(first.body.proposals).toHaveLength(1);
    await api.request('POST', `${url}/confirm`, { token: owner.token });
    const changes = await api.request(
      'GET',
      `${messages()}?changedSince=${first.body.nextCursor}`,
      { token: viewer.token },
    );
    expect(changes.body.messages).toHaveLength(0);
    expect(changes.body.proposals).toMatchObject([{ id: proposal.id, status: 'READY' }]);
    const empty = await api.request(
      'GET',
      `${messages()}?changedSince=${changes.body.nextCursor}`,
      { token: owner.token },
    );
    expect(empty.body.messages).toEqual([]);
    expect(empty.body.proposals).toEqual([]);
  });
  it('el cursor no adelanta una escritura todavía sin commit', async () => {
    const first = await post();
    let signal!: () => void, release!: () => void;
    const locked = new Promise<void>((r) => {
      signal = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const write = withTeamBoard(api.app.prisma, boardId, owner.userId, async (tx) => {
      await tx.teamMessage.update({
        where: { id: first.body.id as string },
        data: { status: 'PROCESSING', updatedAt: await nextTeamTimestamp(tx, boardId) },
      });
      signal();
      await gate;
    });
    await locked;
    const read = api.request('GET', `${messages()}?changedSince=start`, { token: owner.token });
    release();
    await write;
    expect((await read).body.messages[0].status).toBe('PROCESSING');
  });
  it('confirmar exige solicitante escritor y no reabre terminales', async () => {
    const { url, proposal } = await seedProposal('PENDING_CONFIRMATION');
    expect((await api.request('POST', `${url}/confirm`, { token: editor.token })).status).toBe(403);
    const results = await Promise.all([
      api.request('POST', `${url}/confirm`, { token: owner.token }),
      api.request('POST', `${url}/confirm`, { token: owner.token }),
    ]);
    expect(results.map((r) => r.body.status)).toEqual(['READY', 'READY']);
    await api.request('POST', `${url}/reject`, { token: owner.token, body: { reason: 'USER' } });
    expect((await api.request('POST', `${url}/confirm`, { token: owner.token })).status).toBe(409);
    expect(
      (await api.app.prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
    ).toBe('REJECTED');
  });
  it.each(['USER', 'STALE', 'APPLY_FAILED'])(
    'persiste rechazo %s y lo publica en lectura compartida',
    async (reason) => {
      const { url, proposal } = await seedProposal();
      expect(
        (await api.request('POST', `${url}/reject`, { token: editor.token, body: { reason } }))
          .status,
      ).toBe(403);
      const response = await api.request('POST', `${url}/reject`, {
        token: owner.token,
        body: { reason },
      });
      expect(response.body).toMatchObject({
        rejectReason: reason,
        status: reason === 'STALE' ? 'STALE' : 'REJECTED',
      });
      const read = await api.request('GET', `${messages()}/${proposal.requestMessageId}`, {
        token: viewer.token,
      });
      expect(read.body.proposal.status).toBe(response.body.status);
    },
  );
  it('persiste expiración aunque confirmar devuelva 409 y no crea auditoría', async () => {
    const { url, proposal, batch } = await seedProposal('PENDING_CONFIRMATION', { expired: true });
    expect((await api.request('POST', `${url}/confirm`, { token: owner.token })).status).toBe(409);
    expect((await audit(batch)).status).toBe(409);
    expect(
      (await api.app.prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
    ).toBe('EXPIRED');
    expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(0);
  });
  it('reconoce ACK y reintento exacto con posición añadida por dispatch', async () => {
    const { batch, proposal } = await seedProposal();
    const applied = {
      ...batch,
      commands: batch.commands.map((c) => ({
        ...c,
        payload: { ...c.payload, position: { x: 10, y: 20 } },
      })),
    };
    const results = await Promise.all([audit(applied), audit(applied)]);
    expect(results.map((r) => r.status)).toEqual([202, 202]);
    expect(results[0]!.body).toMatchObject({ proposalId: proposal.id, status: 'APPLIED' });
    expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(1);
    expect(
      (await api.app.prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
    ).toBe('APPLIED');
  });
  it.each(['payload', 'extra', 'actor', 'origin', 'commandId', 'missing'])(
    'rechaza auditoría discordante: %s',
    async (change) => {
      const { batch, proposal } = await seedProposal();
      const command = batch.commands[0]!;
      const modified = { ...batch, commands: [{ ...command, payload: { ...command.payload } }] };
      if (change === 'payload')
        Object.assign(modified.commands[0]!.payload, { displayName: 'Otra' });
      if (change === 'extra') Object.assign(modified.commands[0]!.payload, { arbitrary: true });
      if (change === 'actor') modified.actorId = editor.userId;
      if (change === 'origin') modified.origin = 'AI_VOICE';
      if (change === 'commandId') modified.commands[0]!.commandId = randomUUID();
      if (change === 'missing') modified.commands = [];
      expect([400, 409]).toContain((await audit(modified)).status);
      expect(
        (await api.app.prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
      ).toBe('READY');
      expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(0);
    },
  );
  it('respeta posición explícita y propietario de la propuesta', async () => {
    const { batch } = await seedProposal('READY', { position: true });
    expect((await audit(batch, editor.token)).status).toBe(403);
    const changed = {
      ...batch,
      commands: batch.commands.map((c) => ({
        ...c,
        payload: { ...c.payload, position: { x: 999, y: 0 } },
      })),
    };
    expect((await audit(changed)).status).toBe(409);
    expect((await audit(batch)).status).toBe(202);
  });
  it('un registro previo discordante nunca valida una propuesta', async () => {
    const { batch, proposal } = await seedProposal();
    await api.app.prisma.auditOperation.create({
      data: {
        boardId,
        batchId: batch.batchId,
        actorId: owner.userId,
        origin: batch.origin,
        payload: { commands: [], issuedAt: batch.issuedAt },
      },
    });
    expect((await audit(batch)).status).toBe(409);
    expect(
      (await api.app.prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
    ).toBe('READY');
  });
  it('auditar y rechazar concurrentemente produce una sola decisión terminal', async () => {
    const { batch, proposal, url } = await seedProposal();
    const results = await Promise.all([
      audit(batch),
      api.request('POST', `${url}/reject`, { token: owner.token, body: { reason: 'USER' } }),
    ]);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const saved = await api.app.prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(['APPLIED', 'REJECTED']).toContain(saved.status);
    expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(
      saved.status === 'APPLIED' ? 1 : 0,
    );
  });
  it('comprueba permisos vigentes tras degradar al solicitante', async () => {
    const { url, batch } = await seedProposal('PENDING_CONFIRMATION', { actor: editor });
    await api.app.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: editor.userId } },
      data: { role: 'VIEWER' },
    });
    try {
      expect((await api.request('POST', `${url}/confirm`, { token: editor.token })).status).toBe(
        403,
      );
      expect((await audit(batch, editor.token)).status).toBe(403);
      expect((await post(body(), editor.token)).status).toBe(403);
    } finally {
      await api.app.prisma.projectMember.update({
        where: { projectId_userId: { projectId, userId: editor.userId } },
        data: { role: 'EDITOR' },
      });
    }
  });

  it('retirar la membresía bloquea historial, estado, configuración y acciones', async () => {
    const { proposal, url } = await seedProposal('PENDING_CONFIRMATION', { actor: editor });
    await api.app.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: editor.userId } },
    });
    try {
      for (const route of [messages(), `${messages()}/${proposal.requestMessageId}`, settings()])
        expect((await api.request('GET', route, { token: editor.token })).status).toBe(404);
      expect((await api.request('POST', `${url}/confirm`, { token: editor.token })).status).toBe(
        404,
      );
      expect((await post(body(), editor.token)).status).toBe(404);
    } finally {
      await api.app.prisma.projectMember.create({
        data: { projectId, userId: editor.userId, role: 'EDITOR' },
      });
    }
  });

  it('los cambios avanzan incluso cuando el reloj queda detrás del último cursor', async () => {
    const accepted = await post();
    const future = new Date(Date.now() + 10_000);
    await api.app.prisma.teamMessage.update({
      where: { id: accepted.body.id as string },
      data: { updatedAt: future },
    });
    const page = await api.request('GET', `${messages()}?changedSince=start`, {
      token: owner.token,
    });
    await cancel(accepted.body.id as string);
    const changes = await api.request('GET', `${messages()}?changedSince=${page.body.nextCursor}`, {
      token: owner.token,
    });
    expect(changes.body.messages).toHaveLength(1);
    expect(changes.body.messages[0].status).toBe('CANCELLED');
    expect(Date.parse(changes.body.messages[0].updatedAt as string)).toBeGreaterThan(
      future.getTime(),
    );
  });

  it('una propuesta pendiente no admite ACK ni rechazos de aplicación', async () => {
    const { url, batch, proposal } = await seedProposal('PENDING_CONFIRMATION');
    expect((await audit(batch)).status).toBe(409);
    for (const reason of ['STALE', 'APPLY_FAILED'])
      expect(
        (await api.request('POST', `${url}/reject`, { token: owner.token, body: { reason } }))
          .status,
      ).toBe(409);
    expect(
      (await api.app.prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
    ).toBe('PENDING_CONFIRMATION');
  });

  it('la auditoría compara conjuntos de comandos sin admitir commandId duplicados', async () => {
    const seeded = await seedProposal();
    const batch = {
      ...seeded.batch,
      commands: [
        ...seeded.batch.commands,
        {
          ...seeded.batch.commands[0]!,
          commandId: randomUUID(),
          type: 'CREATE_CLASS' as const,
          payload: { classId: randomUUID(), displayName: 'Otra' },
        },
      ],
    };
    await api.app.prisma.aiProposal.update({
      where: { id: seeded.proposal.id },
      data: {
        batch: { ...batch, commands: [batch.commands[0]!, batch.commands[0]!] },
      },
    });
    expect((await audit(batch)).status).toBe(409);
    await api.app.prisma.aiProposal.update({ where: { id: seeded.proposal.id }, data: { batch } });
    expect(
      (await audit({ ...batch, commands: [batch.commands[0], batch.commands[0]] })).status,
    ).toBe(409);
    expect((await audit({ ...batch, commands: [...batch.commands].reverse() })).status).toBe(202);
  });
});
