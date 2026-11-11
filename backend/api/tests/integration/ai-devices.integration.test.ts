import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectorTaskSchema,
  DEFAULT_AI_SETTINGS,
  personalAiStateSchema,
  type ConnectorTask,
} from '@uml/contracts';
import { startHarness, type Harness } from '../support/harness.js';

type Account = Awaited<ReturnType<Harness['signUp']>>;
type Client = { socket: WebSocket; tasks: ConnectorTask[]; cancelled: string[] };
describe('IA personal y de VM con API, WebSocket y PostgreSQL reales', () => {
  let api: Harness,
    origin: string,
    owner: Account,
    editor: Account,
    projectId: string,
    boardId: string;
  const vmSecret = 'vm-test-'.padEnd(64, 'x');
  const clients: Client[] = [];
  const model = { classes: [], relationships: [] };
  const models = [{ name: 'modelo-prueba', contextWindow: 32768 }];
  const state = (actor = owner) => api.request('GET', '/ai-devices', { token: actor.token });
  const waitStatus = (id: string, status: string) =>
    vi.waitFor(
      async () =>
        expect((await api.app.prisma.teamMessage.findUniqueOrThrow({ where: { id } })).status).toBe(
          status,
        ),
      { timeout: 8000 },
    );
  const post = (actor = owner, change = {}, targetBoardId = boardId) =>
    api.request('POST', `/boards/${targetBoardId}/team-ai/messages`, {
      token: actor.token,
      body: {
        clientRequestId: randomUUID(),
        mode: 'ASK',
        inputMode: 'TEXT',
        text: 'Explica Persona',
        model,
        ...change,
      },
    });
  const choose = (
    actor: Account,
    source: string,
    deviceId: string | null = null,
    chosenModel: string | null = 'modelo-prueba',
  ) =>
    api.request('PUT', '/ai-devices/preference', {
      token: actor.token,
      body: { source, deviceId, model: chosenModel },
    });
  async function pair(actor = owner) {
    const pairing = await api.request('POST', '/ai-devices/pairing', { token: actor.token });
    expect(pairing.status).toBe(200);
    const response = await api.request('POST', '/ai-devices/pair', {
      body: { code: pairing.body.code, name: 'Laptop de prueba' },
    });
    expect(response.status).toBe(201);
    return {
      id: response.body.id as string,
      token: response.body.token as string,
      code: pairing.body.code as string,
    };
  }
  async function connect(
    token: string,
    kind = 'DEVICE',
    availableModels = models,
    concurrency = 1,
  ) {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ai-devices/connect');
    const client: Client = { socket, tasks: [], cancelled: [] };
    clients.push(client);
    await new Promise<void>((yes, no) => {
      socket.addEventListener('open', () =>
        socket.send(
          JSON.stringify({
            type: 'hello',
            version: 1,
            kind,
            token,
            models: availableModels,
            maxConcurrency: concurrency,
          }),
        ),
      );
      socket.addEventListener('error', () => no(new Error('ws error')), { once: true });
      socket.addEventListener('close', () => no(new Error('ws closed')), { once: true });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'ready') yes();
        else if (message.type === 'task') client.tasks.push(connectorTaskSchema.parse(message));
        else if (message.type === 'cancel') client.cancelled.push(message.id as string);
      });
    });
    return client;
  }
  const result = (client: Client, task: ConnectorTask, text: string) =>
    client.socket.send(JSON.stringify({ type: 'result', id: task.id, text }));
  const waitTasks = (client: Client, count: number) =>
    vi.waitFor(() => expect(client.tasks).toHaveLength(count), { timeout: 8000 });
  beforeAll(async () => {
    api = await startHarness({
      env: {
        AI_VM_CONNECTOR_TOKEN: vmSecret,
        AI_VM_ALLOWED_EMAILS: 'personal-ai@test.invalid,personal-ai-editor@test.invalid',
      },
    });
    owner = await api.signUp('personal-ai@test.invalid');
    editor = await api.signUp('personal-ai-editor@test.invalid');
    projectId = (
      await api.request('POST', '/projects', {
        token: owner.token,
        body: { displayName: 'Motores personales' },
      })
    ).body.id as string;
    await api.app.prisma.projectMember.create({
      data: { projectId, userId: editor.userId, role: 'EDITOR' },
    });
    origin = await api.app.listen({ host: '127.0.0.1', port: 0 });
  });
  beforeEach(async () => {
    await api.app.prisma.userAiPreference.deleteMany();
    await api.app.prisma.aiDevice.deleteMany();
    await api.app.prisma.aiDevicePairing.deleteMany();
    await api.app.prisma.projectAiSettings.deleteMany({ where: { projectId } });
    boardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Personal' } }))
      .id;
  });
  afterEach(async () => {
    await Promise.all(
      clients.splice(0).map(
        ({ socket }) =>
          new Promise<void>((done) => {
            if (socket.readyState === 3) {
              done();
              return;
            }
            socket.addEventListener('close', () => done(), { once: true });
            socket.close();
          }),
      ),
    );
  });
  afterAll(async () => {
    await api?.stop();
  });

  it('vincula una sola vez, guarda solo hashes y aísla dispositivos entre cuentas', async () => {
    const device = await pair();
    const saved = await api.app.prisma.aiDevice.findUniqueOrThrow({ where: { id: device.id } });
    expect(saved.tokenHash).not.toBe(device.token);
    expect(saved.tokenHash).toHaveLength(64);
    expect(
      (
        await api.request('POST', '/ai-devices/pair', {
          body: { code: device.code, name: 'Repetida' },
        })
      ).status,
    ).toBe(401);
    const own = await state();
    expect(personalAiStateSchema.safeParse(own.body).success).toBe(true);
    expect(own.body.devices).toHaveLength(1);
    expect(JSON.stringify(own.body)).not.toContain(device.token);
    expect((await state(editor)).body.devices).toHaveLength(0);
    expect((await choose(editor, 'DEVICE', device.id)).status).toBe(400);
    expect(
      (await api.request('DELETE', `/ai-devices/${device.id}`, { token: editor.token })).status,
    ).toBe(404);
  });
  it('un código vencido o generado antes de revocar la sesión no vincula', async () => {
    const pairing = await api.request('POST', '/ai-devices/pairing', { token: owner.token });
    await api.app.prisma.aiDevicePairing.updateMany({ data: { expiresAt: new Date(0) } });
    expect(
      (
        await api.request('POST', '/ai-devices/pair', {
          body: { code: pairing.body.code, name: 'Tarde' },
        })
      ).status,
    ).toBe(401);
    const next = await api.request('POST', '/ai-devices/pairing', { token: owner.token });
    await api.app.prisma.aiDevicePairing.updateMany({ data: { sessionVersion: 999 } });
    expect(
      (
        await api.request('POST', '/ai-devices/pair', {
          body: { code: next.body.code, name: 'Revocada' },
        })
      ).status,
    ).toBe(401);
  });
  it('dos consumos simultáneos del mismo código crean un solo dispositivo', async () => {
    const pairing = await api.request('POST', '/ai-devices/pairing', { token: owner.token });
    const responses = await Promise.all(
      [1, 2].map(() =>
        api.request('POST', '/ai-devices/pair', {
          body: { code: pairing.body.code, name: 'Laptop' },
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 401]);
    expect(await api.app.prisma.aiDevice.count({ where: { userId: owner.userId } })).toBe(1);
  });
  it('IA de VM necesita el secreto del servidor; una credencial personal no puede anunciarse como VM', async () => {
    await expect(connect('incorrecta'.padEnd(64, 'x'), 'VM')).rejects.toThrow();
    const device = await pair();
    await expect(connect(device.token, 'VM')).rejects.toThrow();
    expect((await choose(owner, 'VM')).status).toBe(409);
    await connect(vmSecret, 'VM');
    const outsider = await api.signUp('vm-outsider@test.invalid');
    expect((await state(outsider)).body.vm).toEqual({
      allowed: false,
      connected: false,
      models: [],
      active: 0,
    });
    expect((await choose(outsider, 'VM')).status).toBe(403);
    expect((await choose(owner, 'VM')).status).toBe(200);
    expect((await state()).body.vm.connected).toBe(true);
  });
  it('permite guardar IA de VM como motor del proyecto sin conceder acceso a la VM', async () => {
    const update = (actor: Account) =>
      api.request('PUT', `/projects/${projectId}/ai-settings`, {
        token: actor.token,
        body: { ...DEFAULT_AI_SETTINGS, aiSource: 'VM' },
      });
    expect((await update(owner)).status).toBe(409);
    const vm = await connect(vmSecret, 'VM');
    expect((await update(editor)).status).toBe(403);
    const saved = await update(owner);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ aiSource: 'VM', vmAllowed: true, vmModel: models[0]!.name });

    const outsider = await api.signUp('vm-project-viewer@test.invalid');
    await api.app.prisma.projectMember.create({
      data: { projectId, userId: outsider.userId, role: 'VIEWER' },
    });
    expect((await post(outsider)).status).toBe(403);
    expect(vm.tasks).toHaveLength(0);

    const accepted = await post(editor);
    expect(accepted.status).toBe(202);
    await waitTasks(vm, 1);
    result(vm, vm.tasks[0]!, 'Una clase describe responsabilidades.');
    await waitStatus(accepted.body.id as string, 'DONE');
    expect((await choose(outsider, 'PROVIDERS', null, null)).status).toBe(200);
    expect((await post(outsider)).status).toBe(202);
  });
  it('atiende a dos personas en sus laptops simultáneamente sin cruzar tareas ni resultados', async () => {
    const a = await pair(owner),
      b = await pair(editor);
    const laptopA = await connect(a.token),
      laptopB = await connect(b.token);
    expect((await choose(owner, 'DEVICE', a.id)).status).toBe(200);
    expect((await choose(editor, 'DEVICE', b.id)).status).toBe(200);
    const [first, second] = await Promise.all([
      post(owner, { text: 'Pregunta de Ana' }),
      post(editor, { text: 'Pregunta de Beto' }),
    ]);
    expect([first.status, second.status]).toEqual([202, 202]);
    await Promise.all([waitTasks(laptopA, 1), waitTasks(laptopB, 1)]);
    expect(laptopA.tasks[0]!.prompt).toContain('Pregunta de Ana');
    expect(laptopB.tasks[0]!.prompt).toContain('Pregunta de Beto');
    result(laptopB, laptopA.tasks[0]!, 'Respuesta falsificada');
    result(laptopB, laptopB.tasks[0]!, 'Respuesta para Beto');
    await waitStatus(second.body.id as string, 'DONE');
    expect(
      (
        await api.app.prisma.teamMessage.findUniqueOrThrow({
          where: { id: first.body.id as string },
        })
      ).status,
    ).toBe('PROCESSING');
    result(laptopA, laptopA.tasks[0]!, 'Respuesta para Ana');
    await waitStatus(first.body.id as string, 'DONE');
    const history = await api.request('GET', `/boards/${boardId}/team-ai/messages`, {
      token: owner.token,
    });
    const responses = history.body.messages.filter(
      (m: { authorKind: string }) => m.authorKind === 'AI',
    );
    expect(responses).toHaveLength(2);
    expect(responses.map((m: { text: string }) => m.text)).not.toContain('Respuesta falsificada');
    expect(
      responses.find((m: { addressedToId: string }) => m.addressedToId === owner.userId).text,
    ).toBe('Respuesta para Ana');
    expect(
      responses.every((m: { engineLabel: string }) => m.engineLabel === 'Mi computadora'),
    ).toBe(true);
    expect(JSON.stringify(history.body)).not.toContain('executionTarget');
    expect(JSON.stringify(history.body)).not.toContain(a.id);
  });
  it('IA de VM genera propuestas con autor y snapshot propios y su nombre público', async () => {
    const vm = await connect(vmSecret, 'VM');
    await choose(owner, 'VM');
    const accepted = await post(owner, { mode: 'INSTRUCT', text: 'Crea Persona' });
    await waitTasks(vm, 1);
    expect(vm.tasks[0]!.json).toBe(true);
    result(
      vm,
      vm.tasks[0]!,
      JSON.stringify({ operations: [{ op: 'CREATE_CLASS', className: 'Persona' }] }),
    );
    await waitStatus(accepted.body.id as string, 'DONE');
    const detail = await api.request(
      'GET',
      `/boards/${boardId}/team-ai/messages/${accepted.body.id}`,
      { token: owner.token },
    );
    expect(detail.body.message.engineLabel).toBe('IA de VM');
    expect(detail.body.proposal.batch.actorId).toBe(owner.userId);
    expect(detail.body.proposal.expectedSemantic).toEqual(model);
    expect(await api.app.prisma.boardDocument.findUnique({ where: { boardId } })).toBeNull();
  });
  it('una laptop saturada en dos pizarras no ocupa los puestos de otra laptop', async () => {
    const a = await pair(owner);
    const b = await pair(editor);
    const [laptopA, laptopB] = await Promise.all([connect(a.token), connect(b.token)]);
    await choose(owner, 'DEVICE', a.id);
    await choose(editor, 'DEVICE', b.id);
    const secondBoard = await api.app.prisma.board.create({
      data: { projectId, displayName: 'Segunda pizarra' },
    });
    const waiting: { board: string; id: string }[] = [];
    for (const board of [boardId, secondBoard.id]) {
      for (let index = 0; index < 3; index++) {
        const response = await post(owner, { text: `Solicitud ${index}` }, board);
        expect(response.status).toBe(202);
        waiting.push({ board, id: response.body.id as string });
      }
    }
    await waitTasks(laptopA, 1);
    const independent = await post(editor, { text: 'Otra laptop' });
    expect(independent.status).toBe(202);
    await waitTasks(laptopB, 1);
    await waitStatus(waiting[0]!.id, 'PROCESSING');
    for (const entry of waiting.slice(1)) await waitStatus(entry.id, 'QUEUED');
    result(laptopB, laptopB.tasks[0]!, 'Respuesta independiente');
    await waitStatus(independent.body.id as string, 'DONE');
    for (const entry of [...waiting].reverse())
      expect(
        (
          await api.request('POST', `/boards/${entry.board}/team-ai/messages/${entry.id}/cancel`, {
            token: owner.token,
          })
        ).status,
      ).toBe(200);
  });
  it('congela el motor por solicitud y respeta la capacidad de una laptop', async () => {
    const device = await pair();
    const laptop = await connect(device.token);
    await choose(owner, 'DEVICE', device.id);
    const first = await post();
    const second = await post();
    await waitTasks(laptop, 1);
    expect(laptop.tasks[0]?.timeoutMs).toBe(300_000);
    await choose(owner, 'PROVIDERS', null, null);
    result(laptop, laptop.tasks[0]!, 'Primera');
    await waitTasks(laptop, 2);
    result(laptop, laptop.tasks[1]!, 'Segunda');
    await waitStatus(first.body.id as string, 'DONE');
    await waitStatus(second.body.id as string, 'DONE');
    const saved = await api.app.prisma.teamMessage.findUniqueOrThrow({
      where: { id: second.body.id as string },
    });
    expect(saved.executionTarget).toMatchObject({ source: 'DEVICE', deviceId: device.id });
  });
  it.each(['VM', 'DEVICE'])(
    'cancelar propaga al conector %s y descarta la respuesta tardía',
    async (kind) => {
      const device = kind === 'DEVICE' ? await pair() : null;
      const client = await connect(device?.token ?? vmSecret, kind);
      expect((await choose(owner, kind, device?.id)).status).toBe(200);
      const accepted = await post();
      await waitTasks(client, 1);
      const cancelled = await api.request(
        'POST',
        `/boards/${boardId}/team-ai/messages/${accepted.body.id}/cancel`,
        { token: owner.token },
      );
      expect(cancelled.status).toBe(200);
      await vi.waitFor(() => expect(client.cancelled).toContain(client.tasks[0]!.id));
      result(client, client.tasks[0]!, 'Tardía');
      await waitStatus(accepted.body.id as string, 'CANCELLED');
      expect(
        await api.app.prisma.teamMessage.count({
          where: { replyToId: accepted.body.id as string },
        }),
      ).toBe(0);
    },
  );
  it('desvincular cancela inferencias activas y restablece la preferencia sin recurrir a la nube', async () => {
    const device = await pair();
    const laptop = await connect(device.token);
    await choose(owner, 'DEVICE', device.id);
    const accepted = await post();
    await waitTasks(laptop, 1);
    expect(
      (await api.request('DELETE', `/ai-devices/${device.id}`, { token: owner.token })).status,
    ).toBe(204);
    await waitStatus(accepted.body.id as string, 'FAILED');
    expect((await state()).body.choice.source).toBe('PROJECT');
    expect(
      await api.app.prisma.teamMessage.count({ where: { replyToId: accepted.body.id as string } }),
    ).toBe(0);
    await expect(connect(device.token)).rejects.toThrow();
  });
  it('una desconexión y una salida inválida fallan sin respuesta de otro proveedor', async () => {
    const vm = await connect(vmSecret, 'VM');
    await choose(owner, 'VM');
    const invalid = await post(owner, { mode: 'INSTRUCT', text: 'Crea Persona' });
    await waitTasks(vm, 1);
    result(vm, vm.tasks[0]!, 'JSON inválido');
    await waitStatus(invalid.body.id as string, 'FAILED');
    const interrupted = await post();
    await waitTasks(vm, 2);
    vm.socket.close();
    await waitStatus(interrupted.body.id as string, 'FAILED');
    expect(await api.app.prisma.teamMessage.count({ where: { boardId, authorKind: 'AI' } })).toBe(
      0,
    );
    expect((await post()).status).toBe(409);
  });
  it('las políticas del proyecto se conservan al elegir un motor propio', async () => {
    const vm = await connect(vmSecret, 'VM');
    await choose(editor, 'VM');
    await api.app.prisma.projectAiSettings.create({ data: { projectId, enabled: false } });
    expect((await post(editor)).status).toBe(409);
    expect(vm.tasks).toHaveLength(0);
    await api.app.prisma.projectAiSettings.update({
      where: { projectId },
      data: { enabled: true, solutionMode: 'HINTS_ONLY' },
    });
    const accepted = await post(editor);
    await waitTasks(vm, 1);
    expect(vm.tasks[0]!.system).toContain('HINTS_ONLY');
    result(vm, vm.tasks[0]!, 'Piensa en la responsabilidad de la clase.');
    await waitStatus(accepted.body.id as string, 'DONE');
  });
  it('sirve el conector autónomo y una petición HTTP normal no abre una conexión', async () => {
    const download = await api.app.inject({ method: 'GET', url: '/ai-devices/connector.mjs' });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('ai-connector.mjs');
    expect(download.body).toContain('export async function inferVm');
    expect((await api.app.inject({ method: 'GET', url: '/ai-devices/connect' })).statusCode).toBe(
      426,
    );
  });
});
