import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandSchema,
  emptyBoardState,
  type Command,
  type CommandBatch,
  type SemanticModel,
} from '@uml/contracts';
import { applyBatch, validateModel } from '@uml/domain-core';
import { startHarness, type Harness } from '../support/harness.js';
import { reviewIssueKey } from '../../src/modules/team-ai/review-evidence.js';
import { createTeamModerator } from '../../src/modules/team-ai/moderator.js';
import { recordAudit } from '../../src/modules/team-ai/audit-ack.js';

type Account = Awaited<ReturnType<Harness['signUp']>>;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe('paso 9: auditoría, prueba de contenido y moderador persistido', () => {
  let api: Harness, owner: Account, editor: Account;
  let projectId: string, boardId: string, a: string, b: string, rel: string;
  let model: SemanticModel;
  const timing = { idleMs: 40, retryMs: 25, timeoutMs: 800, cooldownMs: 180 };
  const cmd = (type: string, payload: unknown, actor = owner) =>
    commandSchema.parse({
      type,
      payload,
      commandId: randomUUID(),
      actorId: actor.userId,
      issuedAt: new Date().toISOString(),
      origin: 'GUI',
    });
  const batch = (commands: Command[], actor = owner): CommandBatch => ({
    batchId: randomUUID(),
    commands,
    actorId: actor.userId,
    issuedAt: new Date().toISOString(),
    origin: 'GUI',
  });
  function apply(value: CommandBatch) {
    const outcome = applyBatch({ ...emptyBoardState(), semantic: model }, value);
    if (!outcome.applied) throw new Error(JSON.stringify(outcome.issues));
    model = outcome.state.semantic;
  }
  const persist = () =>
    api.app.prisma.boardSnapshot.update({
      where: { boardId_version: { boardId, version: 1 } },
      data: { canonicalJson: model },
    });
  const post = (value: CommandBatch, actor = owner) =>
    api.request('POST', `/boards/${boardId}/audit`, { token: actor.token, body: value });
  const messages = () =>
    api.app.prisma.teamMessage.findMany({
      where: { boardId, authorKind: 'AI', kind: 'REVIEW' },
      orderBy: { createdAt: 'asc' },
    });
  const reviewed = async (value: CommandBatch) =>
    vi.waitFor(
      async () =>
        expect(
          (await api.app.prisma.aiReviewState.findUnique({ where: { boardId } }))
            ?.lastReviewedBatchId,
        ).toBe(value.batchId),
      { timeout: 3000 },
    );
  const change = (multiplicity = '0..*', actor = owner) =>
    batch(
      [
        cmd(
          'CHANGE_MULTIPLICITY',
          { relationshipId: rel, sourceMultiplicity: multiplicity },
          actor,
        ),
      ],
      actor,
    );
  const settings = (values = {}) =>
    api.request('PUT', `/projects/${projectId}/ai-settings`, {
      token: owner.token,
      body: {
        enabled: true,
        solutionMode: 'ON_REQUEST',
        reviewMode: 'ON_ISSUES',
        executionMode: 'PROPOSE_ONLY',
        aiSource: 'PROVIDERS',
        ...values,
      },
    });

  beforeAll(async () => {
    api = await startHarness({ teamAi: false, moderator: timing });
    owner = await api.signUp('moderator-owner@test.invalid');
    editor = await api.signUp('moderator-editor@test.invalid');
    projectId = (
      await api.request('POST', '/projects', {
        token: owner.token,
        body: { displayName: 'Moderador' },
      })
    ).body.id as string;
    await api.app.prisma.projectMember.create({
      data: { projectId, userId: editor.userId, role: 'EDITOR' },
    });
  });
  afterAll(async () => {
    await api?.stop();
  });
  beforeEach(async () => {
    await api.app.prisma.projectAiSettings.deleteMany({ where: { projectId } });
    boardId = (
      await api.request('POST', `/projects/${projectId}/boards`, {
        token: owner.token,
        body: { displayName: 'Revisión' },
      })
    ).body.id as string;
    a = randomUUID();
    b = randomUUID();
    rel = randomUUID();
    model = { classes: [], relationships: [] };
    apply(
      batch([
        cmd('CREATE_CLASS', { classId: a, displayName: 'Alumno' }),
        cmd('CREATE_CLASS', { classId: b, displayName: 'Materia' }),
        cmd('CREATE_RELATIONSHIP', {
          relationshipId: rel,
          sourceClassId: a,
          targetClassId: b,
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        }),
      ]),
    );
    await persist();
  });

  it('202 no espera Yjs; timestamp nuevo sin efecto no sirve; efecto correcto publica una vez al autor autenticado', async () => {
    const value = change('0..*', editor);
    const response = await post({ ...value, actorId: owner.userId }, editor);
    expect(response.status).toBe(202);
    expect(await messages()).toHaveLength(0);
    await persist(); // timestamp nuevo, contenido viejo
    await pause(130);
    expect(await messages()).toHaveLength(0);
    apply(value);
    await persist();
    await reviewed(value);
    const [message] = await messages();
    expect(message).toMatchObject({
      addressedToId: editor.userId,
      kind: 'REVIEW',
      authorKind: 'AI',
      replyToId: null,
    });
    expect(message!.text).toContain('muchos a muchos');
    expect(message!.text).toContain('intermedia');
    expect(await api.app.prisma.aiProposal.count({ where: { boardId } })).toBe(0);
    expect((await post({ ...value, actorId: owner.userId }, editor)).status).toBe(202);
    await pause(100);
    expect(await messages()).toHaveLength(1);
  });
  it('no anuncia WARNING ni MOVE ni errores ya registrados', async () => {
    const warning = batch([cmd('CREATE_CLASS', { classId: randomUUID(), displayName: 'Aislada' })]);
    apply(warning);
    await persist();
    await post(warning);
    await reviewed(warning);
    expect(await messages()).toHaveLength(0);
    const move = batch([cmd('MOVE_CLASS', { classId: a, position: { x: 50, y: 30 } })]);
    await post(move);
    await pause(100);
    expect(
      (await api.app.prisma.aiReviewState.findUniqueOrThrow({ where: { boardId } }))
        .lastReviewedBatchId,
    ).toBe(warning.batchId);
    const bad = change();
    apply(bad);
    await persist();
    await post(bad);
    await reviewed(bad);
    const rename = batch([cmd('RENAME_CLASS', { classId: a, displayName: 'Estudiante' })]);
    apply(rename);
    await persist();
    await post(rename);
    await reviewed(rename);
    expect(await messages()).toHaveLength(1);
  });
  it('baseline de instalación existente absorbe errores previos sin acusar al último usuario', async () => {
    apply(change());
    await persist();
    await api.app.prisma.aiReviewState.delete({ where: { boardId } });
    const rename = batch([cmd('RENAME_CLASS', { classId: b, displayName: 'Curso' })], editor);
    apply(rename);
    await persist();
    await post(rename, editor);
    await reviewed(rename);
    expect(await messages()).toHaveLength(0);
    expect(
      (await api.app.prisma.aiReviewState.findUniqueOrThrow({ where: { boardId } })).lastIssueKeys,
    ).toEqual(
      validateModel(model)
        .filter((i) => i.severity === 'ERROR')
        .map(reviewIssueKey),
    );
  });
  it('agrupa autores distintos; un lote posterior no relacionado no roba la atribución', async () => {
    const bad = change('0..*', editor);
    const other = batch([cmd('CREATE_CLASS', { classId: randomUUID(), displayName: 'SinError' })]);
    await post(bad, editor);
    await post(other);
    apply(bad);
    apply(other);
    await persist();
    await reviewed(other);
    expect(await messages()).toHaveLength(1);
    expect((await messages())[0]!.addressedToId).toBe(editor.userId);
  });
  it('si nuevos hallazgos afectan autores diferentes dirige el grupo a Equipo', async () => {
    const bad = change('0..*', editor);
    const duplicate = batch([
      cmd('CREATE_CLASS', { classId: randomUUID(), displayName: 'Alumno' }),
    ]);
    await post(bad, editor);
    await post(duplicate);
    apply(bad);
    apply(duplicate);
    await persist();
    await reviewed(duplicate);
    const [message] = await messages();
    expect(message!.addressedToId).toBeNull();
    expect(message!.text).toContain('MANY_TO_MANY_RELATIONSHIP');
    expect(message!.text).toContain('DUPLICATE_CLASS_NAME');
  });
  it.each([{ enabled: false }, { reviewMode: 'OFF' }, { reviewMode: 'ON_DEMAND' }])(
    'configuración %j impide intervención y absorbe baseline',
    async (values) => {
      await settings(values);
      const bad = change();
      apply(bad);
      await persist();
      await post(bad);
      await reviewed(bad);
      expect(await messages()).toHaveLength(0);
      await settings();
      const rename = batch([cmd('RENAME_CLASS', { classId: a, displayName: 'Estudiante' })]);
      apply(rename);
      await persist();
      await post(rename);
      await reviewed(rename);
      expect(await messages()).toHaveLength(0);
    },
  );
  it('cambio OWNER antes de publicación y Solo pistas se respetan', async () => {
    const bad = change();
    await post(bad);
    await settings({ solutionMode: 'HINTS_ONLY' });
    apply(bad);
    await persist();
    await reviewed(bad);
    expect((await messages())[0]!.text).toContain('Pista:');
    expect((await messages())[0]!.text).not.toContain('intermedia');
  });
  it('corregir elimina la clave y una reaparición posterior puede anunciarse con cooldown', async () => {
    const bad = change();
    apply(bad);
    await persist();
    await post(bad);
    await reviewed(bad);
    const fixed = change('1');
    apply(fixed);
    await persist();
    await post(fixed);
    await reviewed(fixed);
    expect(
      (await api.app.prisma.aiReviewState.findUniqueOrThrow({ where: { boardId } })).lastIssueKeys,
    ).toEqual([]);
    const again = change();
    apply(again);
    await persist();
    await post(again);
    await reviewed(again);
    const history = await messages();
    expect(history).toHaveLength(2);
    expect(
      history[1]!.createdAt.getTime() - history[0]!.createdAt.getTime(),
    ).toBeGreaterThanOrEqual(175);
  });
  it('evidencia nunca disponible expira sin mensaje y sin bloquear otras pizarras', async () => {
    const bad = change();
    await post(bad);
    await persist();
    const originalBoard = boardId;
    const originalModel = structuredClone(model);
    boardId = (
      await api.request('POST', `/projects/${projectId}/boards`, {
        token: owner.token,
        body: { displayName: 'Otra pizarra' },
      })
    ).body.id as string;
    const other = change();
    apply(other);
    await persist();
    await post(other);
    await reviewed(other);
    expect(await messages()).toHaveLength(1);
    boardId = originalBoard;
    model = originalModel;
    await pause(950);
    apply(bad);
    await persist();
    await pause(120);
    expect(await messages()).toHaveLength(0);
    expect(
      (await api.app.prisma.aiReviewState.findUniqueOrThrow({ where: { boardId } }))
        .lastReviewedBatchId,
    ).toBeNull();
  });
  it('estado durable y bloqueo serializan dos moderadores sin duplicar tras reinicio', async () => {
    const bad = change();
    apply(bad);
    await persist();
    await post(bad);
    await reviewed(bad);
    const publish = vi.fn();
    const one = createTeamModerator({
      prisma: api.app.prisma,
      publish,
      log: { warn: vi.fn() },
      timing,
    });
    const two = createTeamModerator({
      prisma: api.app.prisma,
      publish,
      log: { warn: vi.fn() },
      timing,
    });
    try {
      one.notify(boardId);
      two.notify(boardId);
      await pause(150);
      expect(await messages()).toHaveLength(1);
      expect(publish).not.toHaveBeenCalled();
      const duplicate = batch([
        cmd('CREATE_CLASS', { classId: randomUUID(), displayName: 'Alumno' }),
      ]);
      apply(duplicate);
      await persist();
      await recordAudit(api.app.prisma, boardId, owner.userId, duplicate, duplicate);
      one.notify(boardId);
      two.notify(boardId);
      await vi.waitFor(async () => expect(await messages()).toHaveLength(2), { timeout: 3000 });
      await pause(100);
      expect(await messages()).toHaveLength(2);
      expect(publish).toHaveBeenCalledTimes(1);
    } finally {
      await one.close();
      await two.close();
    }
  });
});
