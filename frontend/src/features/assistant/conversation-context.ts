export interface PendingTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}
export const MAX_CONTEXT_TURNS = 10;

/** La numeración visible debe ser idéntica a la enviada: «la segunda» necesita su referente. */
export function clarificationText(question: string, options: readonly string[] = []): string {
  return [
    question,
    ...options.map((option, index) => `${index + 1}. ${JSON.stringify(option)}`),
  ].join('\n');
}

export function exceedsContext(context: readonly PendingTurn[]): boolean {
  return context.length > MAX_CONTEXT_TURNS || context.some((turn) => turn.text.length > 2000);
}

export function appendClarification(
  context: readonly PendingTurn[],
  instruction: string,
  question: string,
  options: readonly string[] = [],
): readonly PendingTurn[] {
  return [
    ...context,
    { role: 'user', text: instruction },
    { role: 'assistant', text: clarificationText(question, options) },
  ];
}

/** Conserva también las preguntas: «sí» no se entiende sin su antecedente. */
export function contextToDraft(context: readonly PendingTurn[], draft: string): string {
  return [
    ...context.map((turn) => `${turn.role === 'user' ? 'Solicitud' : 'Pregunta'}: ${turn.text}`),
    draft,
  ]
    .filter(Boolean)
    .join('\n');
}
