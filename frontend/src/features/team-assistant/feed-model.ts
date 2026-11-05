import type {
  AiProposal,
  Command,
  PendingTurn,
  TeamMessage,
  TeamMode,
  TeamRequestStatus,
} from '@uml/contracts';

export const modeLabel: Record<TeamMode, string> = {
  ASK: 'Pregunta',
  INSTRUCT: 'Instrucción',
  REVIEW: 'Revisión',
};
export const requestLabel: Record<TeamRequestStatus, string> = {
  QUEUED: 'En cola',
  PROCESSING: 'Procesando',
  DONE: 'Completada',
  FAILED: 'Falló',
  CANCELLED: 'Solicitud cancelada',
  INTERRUPTED: 'Interrumpida',
};
export const proposalLabel: Record<AiProposal['status'], string> = {
  READY: 'Lista para aplicar',
  PENDING_CONFIRMATION: 'Pendiente de confirmación',
  APPLIED: 'Aplicado.',
  STALE: 'Propuesta desactualizada.',
  REJECTED: 'Propuesta rechazada.',
  EXPIRED: 'Propuesta vencida.',
};

/** Reconstruye solo el hilo de aclaración de esta persona y pizarra, sin reanudarlo. */
export function clarificationTurns(
  messages: readonly TeamMessage[],
  replyToId: string | null,
  userId: string,
): PendingTurn[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const turns: PendingTurn[] = [];
  const seen = new Set<string>();
  let next = replyToId;
  let boardId: string | undefined;
  while (next) {
    if (seen.has(next)) return [];
    seen.add(next);
    const answer = byId.get(next);
    if (
      answer?.authorKind !== 'AI' ||
      answer.kind !== 'CLARIFICATION' ||
      answer.addressedToId !== userId
    )
      return [];
    boardId ??= answer.boardId;
    const request = answer.replyToId ? byId.get(answer.replyToId) : undefined;
    if (
      answer.boardId !== boardId ||
      request?.boardId !== boardId ||
      request.authorKind !== 'USER' ||
      request.authorId !== userId ||
      request.mode !== 'INSTRUCT'
    )
      return [];
    turns.unshift({ role: 'user', text: request.text }, { role: 'assistant', text: answer.text });
    next = request.replyToId;
  }
  return turns;
}

export function summarizeCommand(command: Command, proposal: AiProposal): string {
  const payload = command.payload;
  const className =
    'classId' in payload
      ? (proposal.expectedSemantic.classes.find((c) => c.id === payload.classId)?.displayName ??
        'clase nueva')
      : '';
  switch (command.type) {
    case 'CREATE_CLASS':
      return `Crear clase ${command.payload.displayName}`;
    case 'RENAME_CLASS':
      return `Renombrar ${className} a ${command.payload.displayName}`;
    case 'DELETE_CLASS':
      return `Eliminar clase ${className}`;
    case 'MOVE_CLASS':
      return `Mover clase ${className}`;
    case 'ADD_ATTRIBUTE':
      return `Añadir ${command.payload.displayName}: ${command.payload.type} a ${className}`;
    case 'UPDATE_ATTRIBUTE':
      return `Actualizar atributo ${command.payload.displayName ?? ''} de ${className}`;
    case 'DELETE_ATTRIBUTE':
      return `Eliminar atributo de ${className}`;
    case 'CREATE_RELATIONSHIP':
      return 'Crear relación entre clases';
    case 'UPDATE_RELATIONSHIP':
      return 'Actualizar relación';
    case 'DELETE_RELATIONSHIP':
      return 'Eliminar relación';
    case 'CHANGE_MULTIPLICITY':
      return 'Cambiar multiplicidad';
  }
}
