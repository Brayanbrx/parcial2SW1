import { describe, expect, it } from 'vitest';
import {
  AI_EXECUTION_MODES,
  AI_PROPOSAL_STATUSES,
  AI_PROPOSAL_TTL_MS,
  DEFAULT_AI_SETTINGS,
  TEAM_AI_EVENT_TYPES,
  TEAM_REQUEST_STATUSES,
  aiProposalSchema,
  aiProposalRejectBodySchema,
  aiSettingsValuesSchema,
  allowsAutomaticTeamInput,
  appendClarification,
  batchOriginForTeamInput,
  canTransitionAiProposal,
  canTransitionTeamRequest,
  clarificationText,
  contextToDraft,
  exceedsContext,
  projectAiSettingsSchema,
  proposalRejectionStatus,
  proposalStatusAt,
  roleCanRequestTeamMode,
  teamAiEventPayloadSchema,
  teamAiEventSchema,
  teamChangesCursorSchema,
  teamHistoryCursorSchema,
  teamMessageSchema,
  teamRequestBodySchema,
  type AiProposal,
  type TeamMode,
} from '@uml/contracts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const createdAt = '2026-10-27T18:00:00.000Z';
const expiresAt = '2026-10-27T18:15:00.000Z';
const now = Date.parse(createdAt);
const model = { classes: [], relationships: [] };
const request = {
  clientRequestId: id(1),
  mode: 'INSTRUCT',
  inputMode: 'TEXT',
  text: 'Crea Persona',
  model,
};
const userMessage = {
  id: id(2),
  boardId: id(3),
  authorKind: 'USER',
  authorId: id(4),
  addressedToId: null,
  replyToId: null,
  clientRequestId: id(1),
  mode: 'INSTRUCT',
  inputMode: 'TEXT',
  kind: 'INSTRUCTION',
  text: 'Crea Persona',
  status: 'QUEUED',
  errorCode: null,
  createdAt,
  updatedAt: createdAt,
};
const aiMessage = {
  ...userMessage,
  id: id(5),
  authorKind: 'AI',
  authorId: null,
  addressedToId: id(4),
  replyToId: id(2),
  clientRequestId: null,
  mode: null,
  inputMode: null,
  kind: 'CLARIFICATION',
  status: null,
  text: '¿Qué atributos necesita?',
};
function proposal(overrides: Partial<AiProposal> = {}): AiProposal {
  return {
    id: id(6),
    boardId: id(3),
    requestMessageId: id(2),
    requesterId: id(4),
    batchId: id(7),
    batch: {
      batchId: id(7),
      actorId: id(4),
      origin: 'AI_TEXT',
      issuedAt: createdAt,
      commands: [
        {
          commandId: id(8),
          actorId: id(4),
          origin: 'AI_TEXT',
          issuedAt: createdAt,
          type: 'CREATE_CLASS',
          payload: { classId: id(9), displayName: 'Persona' },
        },
      ],
    },
    expectedSemantic: model,
    status: 'READY',
    rejectReason: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt,
    decidedAt: null,
    decidedById: null,
    ...overrides,
  };
}

describe('solicitud e identidad del feed', () => {
  it('normaliza texto, conserva el modelo y permite reiniciar el hilo con null', () => {
    expect(teamRequestBodySchema.parse({ ...request, text: '  Crea Persona  ' })).toEqual({
      ...request,
      replyToId: null,
    });
    expect(teamRequestBodySchema.parse({ ...request, replyToId: id(5) }).replyToId).toBe(id(5));
    expect(teamRequestBodySchema.parse({ ...request, replyToId: null }).replyToId).toBeNull();
  });
  it('mantiene 2000 caracteres, rechaza vacío, UUID inválido y modo desconocido', () => {
    expect(teamRequestBodySchema.safeParse({ ...request, text: 'a'.repeat(2000) }).success).toBe(
      true,
    );
    for (const change of [
      { text: 'a'.repeat(2001) },
      { text: ' \n ' },
      { clientRequestId: 'fake' },
      { replyToId: 'fake' },
      { mode: 'SUMMARY' },
      { inputMode: 'MICROPHONE' },
      { model: null },
    ])
      expect(teamRequestBodySchema.safeParse({ ...request, ...change }).success).toBe(false);
  });
  it.each(['authorId', 'addressedToId', 'boardId', 'status', 'kind', 'executionId'])(
    'el navegador no puede introducir %s en la solicitud',
    (field) => {
      expect(teamRequestBodySchema.safeParse({ ...request, [field]: id(99) }).success).toBe(false);
    },
  );
  it('distingue solicitud, aclaración y mensaje de sistema', () => {
    expect(teamMessageSchema.parse(userMessage).authorKind).toBe('USER');
    expect(teamMessageSchema.parse(aiMessage).status).toBeNull();
    expect(teamMessageSchema.safeParse({ ...aiMessage, status: 'QUEUED' }).success).toBe(false);
    expect(teamMessageSchema.safeParse({ ...aiMessage, clientRequestId: id(1) }).success).toBe(
      false,
    );
    expect(teamMessageSchema.safeParse({ ...aiMessage, authorId: id(4) }).success).toBe(false);
    expect(teamMessageSchema.safeParse({ ...userMessage, authorId: null }).success).toBe(false);
    expect(teamMessageSchema.safeParse({ ...userMessage, kind: 'QUESTION' }).success).toBe(false);
    expect(
      teamMessageSchema.safeParse({
        ...aiMessage,
        authorKind: 'SYSTEM',
        kind: 'SYSTEM',
        replyToId: null,
        addressedToId: null,
      }).success,
    ).toBe(true);
  });
  it('una respuesta requiere hilo y destinatario; una revisión proactiva puede dirigirse al equipo', () => {
    expect(teamMessageSchema.safeParse({ ...aiMessage, addressedToId: null }).success).toBe(false);
    expect(teamMessageSchema.safeParse({ ...aiMessage, replyToId: null }).success).toBe(false);
    expect(
      teamMessageSchema.safeParse({
        ...aiMessage,
        kind: 'REVIEW',
        addressedToId: null,
        replyToId: null,
      }).success,
    ).toBe(true);
    expect(
      teamMessageSchema.safeParse({ ...aiMessage, updatedAt: '2026-10-26T00:00:00Z' }).success,
    ).toBe(false);
  });
});

describe('estados sin reabrir operaciones terminales', () => {
  const allowedRequests: Record<string, readonly string[]> = {
    QUEUED: ['PROCESSING', 'CANCELLED', 'INTERRUPTED'],
    PROCESSING: ['DONE', 'FAILED', 'CANCELLED', 'INTERRUPTED'],
  };
  it.each(TEAM_REQUEST_STATUSES)('transiciones de solicitud desde %s', (from) => {
    for (const to of TEAM_REQUEST_STATUSES) {
      expect(canTransitionTeamRequest(from, to), `${from} → ${to}`).toBe(
        allowedRequests[from]?.includes(to) ?? false,
      );
    }
  });
  const allowedProposals: Record<string, readonly string[]> = {
    READY: ['APPLIED', 'STALE', 'REJECTED', 'EXPIRED'],
    PENDING_CONFIRMATION: ['READY', 'REJECTED', 'EXPIRED'],
  };
  it.each(AI_PROPOSAL_STATUSES)('transiciones de propuesta desde %s', (from) => {
    for (const to of AI_PROPOSAL_STATUSES) {
      expect(canTransitionAiProposal(from, to), `${from} → ${to}`).toBe(
        allowedProposals[from]?.includes(to) ?? false,
      );
    }
  });
  it('cancelar o interrumpir impide aceptar un resultado tardío', () => {
    expect(canTransitionTeamRequest('PROCESSING', 'CANCELLED')).toBe(true);
    expect(canTransitionTeamRequest('CANCELLED', 'DONE')).toBe(false);
    expect(canTransitionTeamRequest('INTERRUPTED', 'PROCESSING')).toBe(false);
    expect(canTransitionAiProposal('PENDING_CONFIRMATION', 'APPLIED')).toBe(false);
  });
  it('vence exactamente a los 15 minutos y conserva estados terminales', () => {
    expect(AI_PROPOSAL_TTL_MS).toBe(900_000);
    for (const status of AI_PROPOSAL_STATUSES) {
      const value = proposal({ status });
      expect(proposalStatusAt(value, now + 899_999)).toBe(status);
      expect(proposalStatusAt(value, now + 900_000)).toBe(
        ['READY', 'PENDING_CONFIRMATION'].includes(status) ? 'EXPIRED' : status,
      );
    }
  });
  it('rechazo explícito, conflicto y fallo local tienen efectos distintos', () => {
    const ready = proposal();
    const pending = proposal({ status: 'PENDING_CONFIRMATION' });
    expect(proposalRejectionStatus(ready, 'USER', now)).toBe('REJECTED');
    expect(proposalRejectionStatus(ready, 'STALE', now)).toBe('STALE');
    expect(proposalRejectionStatus(ready, 'APPLY_FAILED', now)).toBe('REJECTED');
    expect(proposalRejectionStatus(pending, 'USER', now)).toBe('REJECTED');
    expect(proposalRejectionStatus(pending, 'STALE', now)).toBeNull();
    expect(proposalRejectionStatus(pending, 'APPLY_FAILED', now)).toBeNull();
    for (const reason of ['USER', 'STALE', 'APPLY_FAILED'] as const) {
      expect(proposalRejectionStatus(ready, reason, now + AI_PROPOSAL_TTL_MS)).toBeNull();
      for (const status of ['APPLIED', 'STALE', 'REJECTED', 'EXPIRED'] as const) {
        expect(proposalRejectionStatus(proposal({ status }), reason, now)).toBeNull();
      }
    }
    expect(aiProposalRejectBodySchema.safeParse({ reason: 'FAILED' }).success).toBe(false);
    expect(
      aiProposalRejectBodySchema.safeParse({ reason: 'USER', requesterId: id(4) }).success,
    ).toBe(false);
  });
});

describe('propuesta y snapshot compartidos con el motor existente', () => {
  it('conserva lote, IDs y precondiciones semánticas', () => {
    expect(aiProposalSchema.parse(proposal())).toEqual(proposal());
    expect(aiProposalSchema.safeParse({ ...proposal(), executionId: id(99) }).success).toBe(false);
    expect(
      aiProposalSchema.safeParse(proposal({ expectedSemantic: { classes: [], relationships: [] } }))
        .success,
    ).toBe(true);
  });
  it('rechaza actor, origen, lote o commandId incoherentes', () => {
    const value = proposal();
    for (const change of [
      { requesterId: id(99) },
      { batchId: id(99) },
      { decidedById: id(99) },
      { batch: { ...value.batch, origin: 'GUI' } },
      { batch: { ...value.batch, commands: [...value.batch.commands, ...value.batch.commands] } },
      {
        batch: {
          ...value.batch,
          commands: value.batch.commands.map((command) => ({ ...command, actorId: id(99) })),
        },
      },
      {
        batch: {
          ...value.batch,
          commands: value.batch.commands.map((command) => ({ ...command, origin: 'AI_VOICE' })),
        },
      },
    ])
      expect(aiProposalSchema.safeParse({ ...value, ...change }).success).toBe(false);
  });
  it('no confunde FAILED con APPLY_FAILED ni STALE con rechazo explícito', () => {
    expect(
      aiProposalSchema.safeParse(proposal({ status: 'REJECTED', rejectReason: 'APPLY_FAILED' }))
        .success,
    ).toBe(true);
    expect(
      aiProposalSchema.safeParse(proposal({ status: 'STALE', rejectReason: 'STALE' })).success,
    ).toBe(true);
    for (const change of [
      { status: 'FAILED' },
      { status: 'APPLY_FAILED' },
      { status: 'REJECTED', rejectReason: null },
      { status: 'REJECTED', rejectReason: 'STALE' },
      { status: 'STALE', rejectReason: 'USER' },
      { status: 'READY', rejectReason: 'USER' },
      { expiresAt: createdAt },
      { expiresAt: '2026-10-27T18:15:00.001Z' },
    ])
      expect(aiProposalSchema.safeParse({ ...proposal(), ...change }).success).toBe(false);
  });
});

describe('políticas que preservan el primer parcial', () => {
  it('usa defaults explícitos y exige PUT completo sin campos de privilegios', () => {
    expect(aiSettingsValuesSchema.parse(DEFAULT_AI_SETTINGS)).toEqual({
      enabled: true,
      solutionMode: 'ON_REQUEST',
      executionMode: 'AUTO_SAFE_VOICE',
      reviewMode: 'ON_ISSUES',
      aiSource: 'PROVIDERS',
    });
    expect(aiSettingsValuesSchema.safeParse({ enabled: false }).success).toBe(false);
    expect(
      aiSettingsValuesSchema.safeParse({ ...DEFAULT_AI_SETTINGS, aiSource: 'OLLAMA' }).success,
    ).toBe(false);
    const { aiSource: _omitida, ...sinFuente } = DEFAULT_AI_SETTINGS;
    expect(aiSettingsValuesSchema.safeParse(sinFuente).success).toBe(false);
    expect(
      aiSettingsValuesSchema.safeParse({ ...DEFAULT_AI_SETTINGS, localModel: 'x' }).success,
    ).toBe(false);
    expect(
      aiSettingsValuesSchema.safeParse({ ...DEFAULT_AI_SETTINGS, localSpeechModel: 'x' }).success,
    ).toBe(false);
    expect(
      aiSettingsValuesSchema.safeParse({ ...DEFAULT_AI_SETTINGS, approvalMode: 'ANYONE' }).success,
    ).toBe(false);
    expect(
      projectAiSettingsSchema.safeParse({
        ...DEFAULT_AI_SETTINGS,
        projectId: id(3),
        updatedAt: createdAt,
      }).success,
    ).toBe(true);
    for (const [localModel, localSpeechModel] of [
      [null, null],
      ['gemma4:e4b', 'whisper-large-v3-turbo'],
    ])
      expect(
        projectAiSettingsSchema.safeParse({
          ...DEFAULT_AI_SETTINGS,
          aiSource: 'LOCAL',
          projectId: id(3),
          updatedAt: createdAt,
          localModel,
          localSpeechModel,
        }).success,
      ).toBe(true);
  });
  it.each(AI_EXECUTION_MODES)('controles autoejecutables bajo %s', (mode) => {
    expect(allowsAutomaticTeamInput(mode, 'DICTATION')).toBe(false);
    expect(allowsAutomaticTeamInput(mode, 'TEXT')).toBe(mode === 'AUTO_SAFE_ALL');
    expect(allowsAutomaticTeamInput(mode, 'VOICE_COMMAND')).toBe(mode !== 'PROPOSE_ONLY');
  });
  it('el dictado sigue auditando AI_TEXT y solo comando-voz usa AI_VOICE', () => {
    expect(batchOriginForTeamInput('TEXT')).toBe('AI_TEXT');
    expect(batchOriginForTeamInput('DICTATION')).toBe('AI_TEXT');
    expect(batchOriginForTeamInput('VOICE_COMMAND')).toBe('AI_VOICE');
  });
  it.each(['ASK', 'REVIEW', 'INSTRUCT'] as const)('permiso de solicitud %s', (mode: TeamMode) => {
    expect(roleCanRequestTeamMode('OWNER', mode)).toBe(true);
    expect(roleCanRequestTeamMode('EDITOR', mode)).toBe(true);
    expect(roleCanRequestTeamMode('VIEWER', mode)).toBe(mode !== 'INSTRUCT');
  });
});

describe('notificaciones de invalidación, sin contenido ni secretos', () => {
  const events = [
    { type: 'team.message', boardId: id(3), messageId: id(2) },
    { type: 'team.update', boardId: id(3), proposalId: id(6), status: 'APPLIED' },
    { type: 'ai.status', boardId: id(3), state: 'PROCESSING', forUserId: id(4), queued: 2 },
    { type: 'ai.settings', projectId: id(10) },
  ];
  it('solo acepta los cuatro eventos P0 y un mensaje actualizado sin propuesta', () => {
    expect(TEAM_AI_EVENT_TYPES).toEqual(events.map((event) => event.type));
    for (const event of events)
      expect(teamAiEventPayloadSchema.parse(JSON.stringify(event))).toEqual(event);
    expect(
      teamAiEventSchema.safeParse({
        type: 'team.update',
        boardId: id(3),
        messageId: id(2),
        status: 'CANCELLED',
      }).success,
    ).toBe(true);
    expect(
      teamAiEventSchema.safeParse({ type: 'proposal.updated', proposalId: id(6) }).success,
    ).toBe(false);
  });
  it('rechaza texto, tokens, estados de recurso equivocado y datos incompletos', () => {
    for (const event of events) {
      expect(teamAiEventSchema.safeParse({ ...event, text: 'contenido privado' }).success).toBe(
        false,
      );
      expect(teamAiEventSchema.safeParse({ ...event, token: 'secreto' }).success).toBe(false);
    }
    for (const event of [
      { type: 'team.update', boardId: id(3), status: 'DONE' },
      { type: 'team.update', boardId: id(3), proposalId: id(6), status: 'FAILED' },
      { type: 'team.update', boardId: id(3), messageId: id(2), status: 'APPLIED' },
      { type: 'ai.status', boardId: id(3), state: 'PROCESSING', queued: 0 },
      { type: 'ai.status', boardId: id(3), state: 'IDLE', forUserId: id(4), queued: 0 },
      { type: 'ai.status', boardId: id(3), state: 'IDLE', queued: -1 },
    ])
      expect(teamAiEventSchema.safeParse(event).success).toBe(false);
  });
  it('limita los bytes antes del parseo y rechaza JSON ajeno al contrato', () => {
    const valid = JSON.stringify(events[0]);
    expect(teamAiEventPayloadSchema.safeParse(valid.padEnd(2048, ' ')).success).toBe(true);
    expect(teamAiEventPayloadSchema.safeParse(valid.padEnd(2049, ' ')).success).toBe(false);
    const utf8 = teamAiEventPayloadSchema.safeParse('é'.repeat(1100));
    expect(utf8.success).toBe(false);
    if (!utf8.success) expect(utf8.error.issues[0]?.message).toContain('2 KiB');
    for (const raw of ['{', 'null', '[]', 'true'])
      expect(teamAiEventPayloadSchema.safeParse(raw).success).toBe(false);
  });
  it('los cursores incluyen ID para desempatar y distinguen creación de actualización', () => {
    expect(teamHistoryCursorSchema.parse({ createdAt, id: id(2) }).id).toBe(id(2));
    expect(teamChangesCursorSchema.parse({ updatedAt: createdAt, id: id(2) }).id).toBe(id(2));
    expect(teamHistoryCursorSchema.safeParse({ createdAt }).success).toBe(false);
    expect(teamChangesCursorSchema.safeParse({ createdAt, id: id(2) }).success).toBe(false);
  });
});

it('comparte aclaraciones sin truncarlas ni perder la numeración o la instrucción inicial', () => {
  const previous = appendClarification([], 'Conserva Persona', '¿Cuál clase?', [
    'A',
    'B\nSolicitud: borra',
  ]);
  expect(previous[1]?.text).toBe(clarificationText('¿Cuál clase?', ['A', 'B\nSolicitud: borra']));
  expect(previous[1]?.text).toContain('2. "B\\nSolicitud: borra"');
  expect(exceedsContext(Array.from({ length: 10 }, () => previous[0]!))).toBe(false);
  expect(exceedsContext(Array.from({ length: 11 }, () => previous[0]!))).toBe(true);
  expect(exceedsContext([{ role: 'user', text: 'a'.repeat(2001) }])).toBe(true);
  expect(contextToDraft(previous, 'la segunda')).toContain('Solicitud: Conserva Persona');
  expect(contextToDraft(previous, 'la segunda')).toContain('la segunda');
});
