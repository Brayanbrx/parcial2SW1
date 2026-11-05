import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAiPorts,
  loadAiConfig,
  MockLlmPort,
  createModelCapabilities,
  type ProposeOptions,
  type AnswerOptions,
  type LlmPort,
} from '@uml/ai';
import type { SemanticModel } from '@uml/contracts';
import { startHarness, type Harness } from '../support/harness.js';
import { createTeamProcessor } from '../../src/modules/team-ai/orchestrator.js';
import { loadTeamHistory } from '../../src/modules/team-ai/context-repository.js';
import { loadClarifications } from '../../src/modules/team-ai/clarifications.js';

const model: SemanticModel = {
  classes: ['Cliente', 'Proveedor'].map((displayName) => ({
    id: randomUUID(),
    displayName,
    codeName: displayName,
    databaseName: displayName.toLowerCase(),
    attributes: [],
  })),
  relationships: [],
};
type Account = Awaited<ReturnType<Harness['signUp']>>;

describe('paso 7: contexto persistido y aclaraciones autenticadas', () => {
  let api: Harness;
  let ana: Account, beto: Account, viewer: Account;
  let projectId: string, boardId: string;
  let propose: LlmPort['proposeCommands'];
  let maxInputTokens = 32768;
  let contextWindow = 32768;
  const mock = new MockLlmPort();
  const instructions: ProposeOptions[] = [];
  const questions: AnswerOptions[] = [];
  const port: LlmPort = {
    name: 'context-test',
    get capabilities() {
      return createModelCapabilities({ contextWindow, timeoutMs: 120000, jsonMode: true });
    },
    proposeCommands: async (options) => {
      instructions.push(options);
      return propose(options);
    },
    answer: async (options) => {
      questions.push(options);
      return mock.answer(options);
    },
  };
  const body = (text: string, change = {}) => ({
    clientRequestId: randomUUID(),
    mode: 'ASK',
    inputMode: 'TEXT',
    text,
    model,
    ...change,
  });
  const send = (text: string, actor: Account = beto, change = {}) =>
    api.request('POST', `/boards/${boardId}/team-ai/messages`, {
      token: actor.token,
      body: body(text, change),
    });
  async function done(id: string) {
    await vi.waitFor(
      async () =>
        expect((await api.app.prisma.teamMessage.findUniqueOrThrow({ where: { id } })).status).toBe(
          'DONE',
        ),
      { timeout: 5000 },
    );
    return api.app.prisma.teamMessage.findFirstOrThrow({
      where: { replyToId: id, authorKind: 'AI' },
    });
  }
  async function ask(text: string, actor = beto, change = {}) {
    const response = await send(text, actor, change);
    expect(response.status).toBe(202);
    return done(response.body.id as string);
  }
  beforeAll(async () => {
    api = await startHarness({
      teamAi: {
        process: (job, signal) =>
          createTeamProcessor(
            {
              ...createAiPorts(loadAiConfig({})),
              llm: port,
            },
            { prisma: api.app.prisma, limits: { groupLimit: 4, personalLimit: 4 }, maxInputTokens },
          )(job, signal),
      },
    });
    ana = await api.signUp('ana-context@test.invalid');
    beto = await api.signUp('beto-context@test.invalid');
    viewer = await api.signUp('viewer-context@test.invalid');
    await api.app.prisma.user.update({ where: { id: ana.userId }, data: { displayName: 'Ana' } });
    await api.app.prisma.user.update({ where: { id: beto.userId }, data: { displayName: 'Beto' } });
    projectId = (
      await api.request('POST', '/projects', {
        token: ana.token,
        body: { displayName: 'Contexto' },
      })
    ).body.id as string;
    await api.app.prisma.projectMember.createMany({
      data: [
        { projectId, userId: beto.userId, role: 'EDITOR' },
        { projectId, userId: viewer.userId, role: 'VIEWER' },
      ],
    });
  });
  afterAll(async () => {
    await api?.stop();
  });
  beforeEach(async () => {
    await api.app.prisma.projectAiSettings.deleteMany({ where: { projectId } });
    instructions.length = 0;
    questions.length = 0;
    maxInputTokens = 32768;
    contextWindow = 32768;
    propose = (options) => mock.proposeCommands(options);
    boardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Contexto' } }))
      .id;
  });

  const configure = (change = {}, actor = ana) =>
    api.request('PUT', `/projects/${projectId}/ai-settings`, {
      token: actor.token,
      body: {
        enabled: true,
        solutionMode: 'ON_REQUEST',
        executionMode: 'PROPOSE_ONLY',
        reviewMode: 'ON_DEMAND',
        ...change,
      },
    });

  it('OWNER alterna pistas y solución explícita; VIEWER consulta sin propuestas ni cambios', async () => {
    expect((await configure({ solutionMode: 'HINTS_ONLY' }, beto)).status).toBe(403);
    expect((await configure({ solutionMode: 'HINTS_ONLY' })).status).toBe(200);
    const hint = await ask('Dame un ejemplo resuelto de atributo derivado', viewer);
    expect(hint.text).toContain('Solo pistas');
    expect(hint.text).not.toContain('total =');
    expect(questions.at(-1)!.teaching).toEqual({ task: 'ASK', solutionMode: 'HINTS_ONLY' });
    expect((await configure()).status).toBe(200);
    const explanation = await ask('Explica un atributo derivado', viewer);
    expect(explanation.text).not.toContain('total =');
    const solved = await ask('Dame un ejemplo resuelto de atributo derivado', viewer);
    expect(solved.text).toContain('total = cantidad × precio');
    expect(solved.text).toContain('Cliente');
    const negative = await ask('Explica atributo derivado, no me des la solución', viewer);
    expect(negative.text).not.toContain('total =');
    expect(await api.app.prisma.aiProposal.count({ where: { boardId } })).toBe(0);
    expect(instructions).toHaveLength(0);
  });

  it('REVIEW señala elementos, severidad y orientación; solución solo cuando se pide', async () => {
    const invalid: SemanticModel = {
      ...model,
      relationships: [
        {
          id: randomUUID(),
          sourceClassId: model.classes[0]!.id,
          targetClassId: model.classes[1]!.id,
          sourceMultiplicity: '0..*',
          targetMultiplicity: '0..*',
          kind: 'ASSOCIATION',
        },
      ],
    };
    const review = await ask('Revisa el diagrama', viewer, { mode: 'REVIEW', model: invalid });
    expect(review.kind).toBe('REVIEW');
    expect(review.text).toContain('[ERROR] MANY_TO_MANY_RELATIONSHIP');
    expect(review.text).toContain('Cliente — Proveedor');
    expect(review.text).toContain('Pista:');
    expect(review.text).not.toContain('Solución sugerida:');
    const solution = await ask('Dame una solución para la relación', viewer, {
      mode: 'REVIEW',
      model: invalid,
    });
    expect(solution.text).toContain('Solución sugerida:');
    expect(solution.text).toContain('intermedia');
    await configure({ solutionMode: 'HINTS_ONLY' });
    const hints = await ask('Dame una solución', viewer, { mode: 'REVIEW', model: invalid });
    expect(hints.text).not.toContain('Solución sugerida:');
    expect(questions.at(-1)!.issues!.every((issue) => issue.suggestion === undefined)).toBe(true);
    expect(questions.at(-1)!.issues!.some((issue) => issue.elementIds?.length)).toBe(true);
    expect(await api.app.prisma.aiProposal.count({ where: { boardId } })).toBe(0);
  });

  it('OFF bloquea REVIEW pero permite ASK e INSTRUCT; ON_ISSUES permite revisión solicitada', async () => {
    await configure({ solutionMode: 'HINTS_ONLY', reviewMode: 'OFF' });
    const rejected = await send('Revisa', viewer, { mode: 'REVIEW' });
    expect(rejected.status).toBe(409);
    expect(questions).toHaveLength(0);
    await ask('Explica herencia', viewer);
    const proposal = await ask('Crea la clase Factura', beto, { mode: 'INSTRUCT' });
    expect(proposal.kind).toBe('PROPOSAL');
    expect(instructions).toHaveLength(1);
    await configure({ reviewMode: 'ON_ISSUES' });
    expect((await ask('Revisa', viewer, { mode: 'REVIEW' })).kind).toBe('REVIEW');
  });

  it('revisión de pizarra vacía no afirma completitud', async () => {
    const result = await ask('Revisa', viewer, {
      mode: 'REVIEW',
      model: { classes: [], relationships: [] },
    });
    expect(result.text).toContain('pizarra está vacía');
    expect(result.text).toContain('no acredita completitud');
  });

  it.each(['TEXT', 'DICTATION', 'VOICE_COMMAND'])(
    'paso 10: lote seguro %s conserva expected y atribución de origen',
    async (inputMode) => {
      await ask('Crea la clase Factura', beto, { mode: 'INSTRUCT', inputMode });
      const proposal = await api.app.prisma.aiProposal.findFirstOrThrow({ where: { boardId } });
      expect(proposal.status).toBe('READY');
      expect(proposal.expectedSemantic).toEqual(model);
      expect(proposal.batch).toMatchObject({
        actorId: beto.userId,
        origin: inputMode === 'VOICE_COMMAND' ? 'AI_VOICE' : 'AI_TEXT',
      });
      expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(0);
    },
  );

  it('paso 10: un único DELETE por voz y un lote mixto exigen confirmación explícita', async () => {
    const attributeId = randomUUID();
    const withAttribute: SemanticModel = {
      ...model,
      classes: model.classes.map((c, i) =>
        i
          ? c
          : {
              ...c,
              attributes: [
                {
                  id: attributeId,
                  displayName: 'correo',
                  codeName: 'correo',
                  databaseName: 'correo',
                  type: 'String',
                  nullable: true,
                  primaryKey: false,
                  unique: false,
                },
              ],
            },
      ),
    };
    propose = async () => ({
      proposal: {
        operations: [{ op: 'DELETE_ATTRIBUTE', className: 'Cliente', attributeName: 'correo' }],
      },
    });
    await ask('Borra correo de Cliente', beto, {
      mode: 'INSTRUCT',
      inputMode: 'VOICE_COMMAND',
      model: withAttribute,
    });
    const proposal = await api.app.prisma.aiProposal.findFirstOrThrow({ where: { boardId } });
    expect(proposal.status).toBe('PENDING_CONFIRMATION');
    expect(proposal.batch).toMatchObject({
      origin: 'AI_VOICE',
      commands: [{ type: 'DELETE_ATTRIBUTE' }],
    });
    const url = `/boards/${boardId}/team-ai/proposals/${proposal.id}/confirm`;
    expect((await api.request('POST', url, { token: ana.token })).status).toBe(403);
    const confirmed = await api.request('POST', url, { token: beto.token });
    expect(confirmed.body.status).toBe('READY');
    expect(confirmed.body.decidedById).toBe(beto.userId);
    expect(await api.app.prisma.auditOperation.count({ where: { boardId } })).toBe(0);
    propose = async () => ({
      proposal: {
        operations: [
          { op: 'CREATE_CLASS', className: 'Factura' },
          { op: 'DELETE_ATTRIBUTE', className: 'Cliente', attributeName: 'correo' },
        ],
      },
    });
    const mixed = await ask('Crea Factura y borra correo', beto, {
      mode: 'INSTRUCT',
      inputMode: 'VOICE_COMMAND',
      model: withAttribute,
    });
    expect(
      (
        await api.app.prisma.aiProposal.findUniqueOrThrow({
          where: { requestMessageId: mixed.replyToId! },
        })
      ).status,
    ).toBe('PENDING_CONFIRMATION');
  });

  it('paso 10: N:M nueva requiere confirmar, warnings y errores anteriores no bloquean creaciones seguras', async () => {
    propose = async () => ({
      proposal: {
        operations: [
          {
            op: 'CREATE_RELATIONSHIP',
            fromClass: 'Cliente',
            toClass: 'Proveedor',
            fromMultiplicity: '0..*',
            toMultiplicity: '0..*',
          },
        ],
      },
    });
    const response = await ask('Relaciona muchos a muchos', beto, {
      mode: 'INSTRUCT',
      inputMode: 'VOICE_COMMAND',
    });
    const proposal = await api.app.prisma.aiProposal.findUniqueOrThrow({
      where: { requestMessageId: response.replyToId! },
    });
    expect(proposal.status).toBe('PENDING_CONFIRMATION');
    expect(response.text).toContain('Error nuevo:');
    const invalid: SemanticModel = {
      ...model,
      relationships: [
        {
          id: randomUUID(),
          sourceClassId: model.classes[0]!.id,
          targetClassId: model.classes[1]!.id,
          sourceMultiplicity: '0..*',
          targetMultiplicity: '0..*',
        },
      ],
    };
    propose = async () => ({
      proposal: { operations: [{ op: 'CREATE_CLASS', className: 'Factura' }] },
    });
    const safe = await ask('Crea Factura', beto, {
      mode: 'INSTRUCT',
      inputMode: 'VOICE_COMMAND',
      model: invalid,
    });
    expect(
      (
        await api.app.prisma.aiProposal.findUniqueOrThrow({
          where: { requestMessageId: safe.replyToId! },
        })
      ).status,
    ).toBe('READY');
    expect(safe.text).toContain('Aviso:');
    expect(safe.text).not.toContain('Error nuevo:');
  });

  it('Beto/Ana/Beto mantiene tema personal aunque el grupo cambie de tema', async () => {
    const first = await ask('¿Qué es un atributo derivado?');
    expect(first.text).toContain('Beto, sobre tu consulta');
    const second = await ask('¿Eso aplica a Venta?', ana);
    expect(second.text).toContain('Ana, sobre la consulta de Beto');
    expect(second.text).toContain('atributo derivado');
    await ask('Explica herencia', ana);
    const last = await ask('Dame otro ejemplo');
    expect(last.text).toContain('Beto, sobre tu consulta');
    expect(last.text).toContain('atributo derivado');
    expect(last.text).not.toContain('La herencia');
    const team = questions.at(-1)!.team!;
    expect(team.requesterId).toBe(beto.userId);
    expect(
      team.personalTurns.every(
        (t) => t.authorId === beto.userId || t.addressedToId === beto.userId,
      ),
    ).toBe(true);
    const ids = [...team.personalTurns, ...team.groupTurns].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('ASK referencia mensaje ajeno con identidad propia y REVIEW recibe el mismo contexto', async () => {
    const reference = await ask('Explica herencia', ana);
    const response = await ask('Dame otro ejemplo', viewer, { replyToId: reference.id });
    expect(response.addressedToId).toBe(viewer.userId);
    expect(response.text).toContain('consulta de Ana');
    const review = await ask('Revisa', viewer, { mode: 'REVIEW' });
    expect(review.kind).toBe('REVIEW');
    expect(questions.at(-1)!.team?.requesterId).toBe(viewer.userId);
  });
  it('dos ventanas N/M excluyen otras pizarras, solicitudes activas/fallidas y modelo privado', async () => {
    await ask('Tema de Beto');
    for (let i = 0; i < 4; i++) await ask(`Tema Ana ${i}`, ana);
    const otherBoard = (
      await api.app.prisma.board.create({ data: { projectId, displayName: 'Privada' } })
    ).id;
    await api.app.prisma.teamMessage.create({
      data: {
        boardId: otherBoard,
        authorKind: 'SYSTEM',
        kind: 'SYSTEM',
        text: 'SECRETO_OTRA_PIZARRA',
      },
    });
    await api.app.prisma.teamMessage.create({
      data: {
        boardId,
        authorKind: 'USER',
        kind: 'QUESTION',
        authorId: beto.userId,
        clientRequestId: randomUUID(),
        mode: 'ASK',
        inputMode: 'TEXT',
        status: 'FAILED',
        text: 'FALLIDA',
        requestModel: model,
      },
    });
    const request = await send('Nuevo');
    await done(request.body.id as string);
    const history = questions.at(-1)!.team!;
    expect(history.personalTurns.some((t) => t.text === 'Tema de Beto')).toBe(true);
    expect(history.personalTurns.length).toBeLessThanOrEqual(4);
    expect(history.groupTurns.length).toBeLessThanOrEqual(4);
    expect(JSON.stringify(history)).not.toContain('SECRETO_OTRA_PIZARRA');
    expect(JSON.stringify(history)).not.toContain('FALLIDA');
    expect(JSON.stringify(history)).not.toContain('requestModel');
    expect(
      [...history.groupTurns, ...history.personalTurns].some((t) => t.id === request.body.id),
    ).toBe(false);
  });
  it('reconstruye aclaraciones multivuelta y conserva opciones numeradas, actor y snapshot actual', async () => {
    const first = await ask('agrega correo tipo String a Fantasma', beto, { mode: 'INSTRUCT' });
    expect(first.kind).toBe('CLARIFICATION');
    expect(first.text).toContain('1. "Cliente"');
    expect(first.text).toContain('2. "Proveedor"');
    propose = async () => ({
      proposal: { operations: [], needsClarification: '¿El tipo debe ser String?' },
    });
    const second = await ask('la segunda', beto, { mode: 'INSTRUCT', replyToId: first.id });
    expect(instructions[1]!.context).toEqual([
      { role: 'user', text: 'agrega correo tipo String a Fantasma' },
      { role: 'assistant', text: first.text },
    ]);
    propose = async () => ({
      proposal: {
        operations: [
          { op: 'ADD_ATTRIBUTE', className: 'Proveedor', attributeName: 'correo', type: 'String' },
        ],
      },
    });
    const final = await ask('sí, conserva las clases', beto, {
      mode: 'INSTRUCT',
      replyToId: second.id,
    });
    expect(instructions[2]!.context).toEqual([
      ...instructions[1]!.context!,
      { role: 'user', text: 'la segunda' },
      { role: 'assistant', text: second.text },
    ]);
    const proposal = await api.app.prisma.aiProposal.findUniqueOrThrow({
      where: { requestMessageId: final.replyToId! },
    });
    expect(proposal.requesterId).toBe(beto.userId);
    expect(proposal.expectedSemantic).toEqual(model);
    expect(instructions[2]!.team?.replyToId).toBe(second.id);
  });
  it('solo dueño responde aclaración con INSTRUCT; otros pueden consultarla con ASK', async () => {
    const clarification = await ask('agrega correo tipo String', beto, { mode: 'INSTRUCT' });
    expect(
      (await send('Cliente', ana, { mode: 'INSTRUCT', replyToId: clarification.id })).status,
    ).toBe(403);
    expect(
      (await send('Cliente', viewer, { mode: 'INSTRUCT', replyToId: clarification.id })).status,
    ).toBe(403);
    expect(
      (await ask('¿Qué significa esa pregunta?', ana, { replyToId: clarification.id }))
        .addressedToId,
    ).toBe(ana.userId);
    const result = await ask('Cliente', beto, { mode: 'INSTRUCT', replyToId: clarification.id });
    expect(result.kind).toBe('PROPOSAL');
  });
  it('Empezar de nuevo no reutiliza acciones pendientes del historial', async () => {
    await ask('agrega correo tipo String', beto, { mode: 'INSTRUCT' });
    const response = await ask('Crea Factura', beto, { mode: 'INSTRUCT', replyToId: null });
    expect(instructions.at(-1)!.context).toEqual([]);
    expect(instructions.at(-1)!.team!.personalTurns.length).toBeGreaterThan(0);
    const proposal = await api.app.prisma.aiProposal.findUniqueOrThrow({
      where: { requestMessageId: response.replyToId! },
    });
    expect(JSON.stringify(proposal.batch)).toContain('Factura');
    expect(JSON.stringify(proposal.batch)).not.toContain('correo');
  });
  it('admite exactamente diez turnos y rechaza doce sin llamar al proveedor ni truncar', async () => {
    propose = async () => ({ proposal: { operations: [], needsClarification: '¿Más detalles?' } });
    let replyToId: string | null = null;
    for (let i = 0; i < 6; i++) {
      const response = await ask(`Dato ${i}`, beto, { mode: 'INSTRUCT', replyToId });
      replyToId = response.id;
    }
    expect(instructions.at(-1)!.context).toHaveLength(10);
    const rejected = await send('Siguiente', beto, { mode: 'INSTRUCT', replyToId });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('team_ai_context_limit');
    expect(instructions).toHaveLength(6);
    await ask('Crea Nuevo', beto, { mode: 'INSTRUCT', replyToId: null });
    expect(instructions.at(-1)!.context).toEqual([]);
  });
  it('rechaza cadena injertada de otro autor y ciclos en toda la cadena, no solo en el último enlace', async () => {
    const betoAnswer = await ask('agrega correo tipo String', beto, { mode: 'INSTRUCT' });
    const anaAnswer = await ask('agrega telefono tipo String', ana, { mode: 'INSTRUCT' });
    await api.app.prisma.teamMessage.update({
      where: { id: betoAnswer.replyToId! },
      data: { replyToId: anaAnswer.id },
    });
    const cross = await send('Cliente', beto, { mode: 'INSTRUCT', replyToId: betoAnswer.id });
    expect(cross.status).toBe(400);
    expect(cross.body.error.code).toBe('invalid_clarification');
    await api.app.prisma.teamMessage.update({
      where: { id: betoAnswer.replyToId! },
      data: { replyToId: betoAnswer.id },
    });
    await expect(
      loadClarifications(api.app.prisma, boardId, beto.userId, betoAnswer.id),
    ).rejects.toMatchObject({ code: 'invalid_clarification' });
    expect(instructions).toHaveLength(2);
  });
  it('rechaza vínculo a solicitud terminal sin aclaración y a pizarra distinta', async () => {
    const response = await ask('Explica UML');
    expect((await send('Cliente', beto, { mode: 'INSTRUCT', replyToId: response.id })).status).toBe(
      403,
    );
    const oldBoard = boardId;
    boardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Otra' } })).id;
    expect((await send('Tema', beto, { replyToId: response.id })).status).toBe(400);
    await expect(
      loadClarifications(api.app.prisma, boardId, beto.userId, response.id),
    ).rejects.toMatchObject({ code: 'invalid_clarification' });
    boardId = oldBoard;
  });
  it('un prompt base excesivo falla sin gastar proveedor y conserva el modelo íntegro', async () => {
    maxInputTokens = 4096;
    const response = await send('Crea Venta', beto, { mode: 'INSTRUCT' });
    expect(response.status).toBe(202);
    await vi.waitFor(async () =>
      expect(
        (
          await api.app.prisma.teamMessage.findUniqueOrThrow({
            where: { id: response.body.id as string },
          })
        ).status,
      ).toBe('FAILED'),
    );
    const request = await api.app.prisma.teamMessage.findUniqueOrThrow({
      where: { id: response.body.id as string },
    });
    expect(request.errorCode).toBe('team_ai_input_budget');
    expect(request.requestModel).toEqual(model);
    expect(instructions).toHaveLength(0);
  });
  it.each(['ASK', 'INSTRUCT', 'REVIEW'])(
    'respeta una ventana menor del puerto en %s antes de invocarlo',
    async (mode) => {
      contextWindow = 100;
      const response = await send('Explica UML', beto, { mode });
      expect(response.status).toBe(202);
      await vi.waitFor(async () =>
        expect(
          await api.app.prisma.teamMessage.findUniqueOrThrow({
            where: { id: response.body.id as string },
          }),
        ).toMatchObject({
          status: 'FAILED',
          errorCode: 'team_ai_input_budget',
          requestModel: model,
        }),
      );
      expect(questions).toHaveLength(0);
      expect(instructions).toHaveLength(0);
      expect(await api.app.prisma.aiProposal.count({ where: { boardId } })).toBe(0);
    },
  );
  it('la referencia explícita se carga aunque salga de las ventanas y no consulta historial de otra pizarra', async () => {
    const reference = await ask('Explica herencia', ana);
    for (let i = 0; i < 4; i++) await ask(`Otro asunto ${i}`, ana);
    const response = await ask('Dame un ejemplo de eso', beto, { replyToId: reference.id });
    expect(response.text).toContain('herencia');
    const saved = await api.app.prisma.teamMessage.findUniqueOrThrow({
      where: { id: response.replyToId! },
    });
    const loaded = await loadTeamHistory(api.app.prisma, saved, {
      groupLimit: 1,
      personalLimit: 1,
    });
    expect(loaded.history.referencedTurn?.id).toBe(reference.id);
    expect(loaded.history.referencedTurn?.boardId).toBe(boardId);
  });
});
