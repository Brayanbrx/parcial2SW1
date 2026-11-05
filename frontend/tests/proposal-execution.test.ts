import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_SETTINGS,
  type AiProposal,
  type TeamInputMode,
  type TeamMessage,
} from '@uml/contracts';
import { ProposalExecution } from '../src/features/team-assistant/proposal-execution.js';

function fixture(inputMode: TeamInputMode = 'VOICE_COMMAND') {
  const authorId = randomUUID(),
    id = randomUUID(),
    batchId = randomUUID(),
    boardId = randomUUID(),
    now = new Date().toISOString();
  const request: TeamMessage = {
    id,
    boardId,
    authorKind: 'USER',
    authorId,
    addressedToId: null,
    replyToId: null,
    clientRequestId: randomUUID(),
    mode: 'INSTRUCT',
    inputMode,
    kind: 'INSTRUCTION',
    text: 'Crea Factura',
    status: 'DONE',
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
  const proposal: AiProposal = {
    id: randomUUID(),
    boardId,
    requestMessageId: id,
    requesterId: authorId,
    batchId,
    batch: {
      batchId,
      actorId: authorId,
      origin: 'AI_VOICE',
      issuedAt: now,
      commands: [
        {
          type: 'CREATE_CLASS',
          payload: { classId: randomUUID(), displayName: 'Factura' },
          commandId: randomUUID(),
          actorId: authorId,
          origin: 'AI_VOICE',
          issuedAt: now,
        },
      ],
    },
    expectedSemantic: { classes: [], relationships: [] },
    status: 'READY',
    rejectReason: null,
    decidedAt: null,
    decidedById: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  return { request, proposal };
}
describe('propiedad local de autoaplicación', () => {
  it.each(['QUEUED', 'PROCESSING'] as const)(
    'espera DONE sin consumir el permiso si la propuesta llega antes que la actualización %s',
    (status) => {
      const { request, proposal } = fixture();
      const origin = new ProposalExecution();
      origin.register(request.clientRequestId!, 'VOICE_COMMAND');

      expect(origin.takeAuto(proposal, { ...request, status }, DEFAULT_AI_SETTINGS)).toBe(false);
      expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(true);
      expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(false);
    },
  );
  it('solo instancia originadora, una vez; pestaña hermana y recarga nunca ejecutan historial', () => {
    const { request, proposal } = fixture();
    const origin = new ProposalExecution();
    origin.register(request.clientRequestId!, 'VOICE_COMMAND');
    expect(new ProposalExecution().takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(false);
    expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(true);
    expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(false);
    origin.register(request.clientRequestId!, 'VOICE_COMMAND'); // reintento de HTTP mismo ID
    expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(false);
  });
  it('confirmación desde otra pestaña nunca dispara autoaplicación', () => {
    const { request, proposal } = fixture();
    const origin = new ProposalExecution();
    origin.register(request.clientRequestId!, 'VOICE_COMMAND');
    expect(
      origin.takeAuto(
        { ...proposal, decidedAt: new Date().toISOString() },
        request,
        DEFAULT_AI_SETTINGS,
      ),
    ).toBe(false);
  });
  it('cancelación elimina permiso local; éxito registrado evita remontajes y cambios de filtro', () => {
    const { request, proposal } = fixture();
    const origin = new ProposalExecution();
    origin.register(request.clientRequestId!, 'VOICE_COMMAND');
    origin.cancel(request.clientRequestId!);
    expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(false);
    origin.register(request.clientRequestId!, 'VOICE_COMMAND');
    origin.markApplied(proposal.batchId);
    expect(origin.wasApplied(proposal.batchId)).toBe(true);
    expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(false);
  });
  it('texto por defecto y dictado opt-in siguen manuales; un cambio posterior de configuración no ejecuta una respuesta vieja', () => {
    for (const input of ['TEXT', 'DICTATION'] as const) {
      const { request, proposal } = fixture(input);
      const origin = new ProposalExecution();
      origin.register(request.clientRequestId!, input);
      const settings = {
        ...DEFAULT_AI_SETTINGS,
        executionMode:
          input === 'DICTATION' ? ('AUTO_SAFE_ALL' as const) : ('AUTO_SAFE_VOICE' as const),
      };
      expect(origin.takeAuto(proposal, request, settings)).toBe(false);
      expect(
        origin.takeAuto(proposal, request, { ...settings, executionMode: 'AUTO_SAFE_ALL' }),
      ).toBe(false);
    }
  });
  it('propuesta sensible y ERROR nuevo nunca se ejecutan aunque lleguen como READY', () => {
    const { request, proposal } = fixture();
    const origin = new ProposalExecution();
    origin.register(request.clientRequestId!, 'VOICE_COMMAND');
    const command = proposal.batch.commands[0]!;
    proposal.batch.commands = [
      { ...command, type: 'DELETE_CLASS', payload: { classId: randomUUID() } },
    ];
    expect(origin.takeAuto(proposal, request, DEFAULT_AI_SETTINGS)).toBe(false);
  });
});
