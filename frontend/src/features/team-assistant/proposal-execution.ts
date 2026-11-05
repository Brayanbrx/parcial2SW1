import type { AiProposal, AiSettingsValues, TeamInputMode, TeamMessage } from '@uml/contracts';
import { evaluateAiProposal, inputAllowsAutoApply } from '@uml/domain-core';

/** Instancia por panel: nunca se serializa ni se comparte entre pestañas. */
export class ProposalExecution {
  private origins = new Map<string, TeamInputMode>();
  private consumed = new Set<string>();
  private applied = new Set<string>();
  register(clientRequestId: string, input: TeamInputMode) {
    this.origins.set(clientRequestId, input);
  }
  cancel(clientRequestId: string) {
    this.origins.delete(clientRequestId);
  }
  wasApplied(batchId: string) {
    return this.applied.has(batchId);
  }
  markApplied(batchId: string) {
    this.applied.add(batchId);
  }
  takeAuto(proposal: AiProposal, request: TeamMessage, settings: AiSettingsValues): boolean {
    if (
      request.authorKind !== 'USER' ||
      !this.origins.has(request.clientRequestId) ||
      this.consumed.has(request.clientRequestId)
    )
      return false;
    // Mensajes y propuestas tienen cursores independientes: una página puede
    // traer la propuesta antes del DONE. Esa copia parcial no es una decisión.
    if (request.status === 'QUEUED' || request.status === 'PROCESSING') return false;
    this.consumed.add(request.clientRequestId);
    const input = this.origins.get(request.clientRequestId);
    this.origins.delete(request.clientRequestId);
    return (
      !this.wasApplied(proposal.batchId) &&
      proposal.requestMessageId === request.id &&
      proposal.requesterId === request.authorId &&
      request.mode === 'INSTRUCT' &&
      request.status === 'DONE' &&
      input === request.inputMode &&
      proposal.status === 'READY' &&
      proposal.decidedAt === null &&
      settings.enabled &&
      inputAllowsAutoApply(input, settings.executionMode) &&
      evaluateAiProposal(proposal.expectedSemantic, proposal.batch).safe
    );
  }
}
