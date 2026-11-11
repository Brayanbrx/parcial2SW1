import type { SemanticModel, TeamMode } from '@uml/contracts';
import type { AnswerIssue, ConversationTurn, TeachingPolicy } from './ports.js';
import {
  INSTRUCCION_ESQUEMA,
  SISTEMA_ASISTENTE,
  sistemaDeConsulta,
  mensajeDeConsulta,
  mensajeDePropuesta,
} from './prompt.js';

export interface TeamTurn {
  readonly id: string;
  readonly boardId: string;
  readonly authorKind: 'USER' | 'AI' | 'SYSTEM';
  readonly authorId: string | null;
  readonly authorName: string;
  readonly addressedToId: string | null;
  readonly replyToId: string | null;
  /** kind CHAT: conversación entre personas, nunca una solicitud a la IA. */
  readonly kind: string;
  readonly text: string;
  readonly createdAt: string;
  /** Personas a las que se dirigió el mensaje con @ (por ID, con su nombre actual). */
  readonly mentions?: readonly { readonly id: string; readonly name: string }[];
  readonly truncated?: boolean;
}

export interface TeamContext {
  readonly boardId: string;
  readonly requesterId: string;
  readonly requesterName: string;
  /** Los dos conjuntos son disjuntos; unidos forman el historial disponible. */
  readonly groupTurns: readonly TeamTurn[];
  readonly personalTurns: readonly TeamTurn[];
  readonly replyToId?: string;
}

export interface TeamContextInput {
  readonly boardId: string;
  readonly requesterId: string;
  readonly requesterName: string;
  readonly groupTurns: readonly TeamTurn[];
  readonly personalTurns: readonly TeamTurn[];
  readonly replyToId?: string;
  readonly referencedTurn?: TeamTurn;
  readonly referenceTurns?: readonly TeamTurn[];
  readonly groupLimit?: number;
  readonly personalLimit?: number;
  readonly request: {
    readonly mode: TeamMode;
    readonly text: string;
    readonly snapshot: SemanticModel;
    readonly context?: readonly ConversationTurn[];
    readonly issues?: readonly AnswerIssue[];
    readonly teaching?: TeachingPolicy;
  };
}

export class TeamContextError extends Error {
  constructor(public readonly code: 'team_ai_input_budget' | 'team_ai_invalid_context') {
    super(code);
  }
}

const compare = (a: TeamTurn, b: TeamTurn) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const personal = (turn: TeamTurn, userId: string) =>
  turn.authorId === userId ||
  turn.addressedToId === userId ||
  (turn.mentions ?? []).some((mention) => mention.id === userId);

/** Cota deliberadamente conservadora: un token por byte UTF-8 más envoltorio.
 * Incluye sistema, esquema de salida, modelo, petición, aclaraciones e historial.
 * No es una medición del tokenizer de un proveedor ni su ventana declarada. */
export function estimateTeamInputTokens(
  input: TeamContextInput['request'],
  team: TeamContext,
): number {
  const instruct = input.mode === 'INSTRUCT';
  const system = instruct
    ? `${SISTEMA_ASISTENTE}\n\n${INSTRUCCION_ESQUEMA}`
    : sistemaDeConsulta(input.teaching);
  const user = instruct
    ? mensajeDePropuesta(input.text, input.snapshot, input.context, team)
    : mensajeDeConsulta(input.text, input.snapshot, input.issues, team);
  return new TextEncoder().encode(system + '\n' + user).byteLength + 512;
}

/** Función pura: recibe historial ya autorizado. No consulta ni persiste memoria. */
export function buildTeamContext(
  input: TeamContextInput,
  budget: { maxInputTokens: number },
): TeamContext {
  const groupLimit = input.groupLimit ?? 20;
  const personalLimit = input.personalLimit ?? 10;
  if (
    ![groupLimit, personalLimit].every((n) => Number.isInteger(n) && n >= 0 && n <= 100) ||
    !Number.isInteger(budget.maxInputTokens) ||
    budget.maxInputTokens <= 0
  )
    throw new TeamContextError('team_ai_input_budget');
  const normalize = (turn: TeamTurn): TeamTurn => ({
    id: turn.id,
    boardId: turn.boardId,
    authorKind: turn.authorKind,
    authorId: turn.authorId,
    authorName: turn.authorName.slice(0, 120),
    addressedToId: turn.addressedToId,
    replyToId: turn.replyToId,
    kind: turn.kind,
    createdAt: turn.createdAt,
    text: turn.text.slice(0, 2000),
    ...(turn.mentions?.length
      ? {
          mentions: turn.mentions
            .slice(0, 10)
            .map((mention) => ({ id: mention.id, name: mention.name.slice(0, 120) })),
        }
      : {}),
    ...(turn.text.length > 2000 || turn.truncated ? { truncated: true } : {}),
  });
  const unique = (turns: readonly TeamTurn[]) =>
    [
      ...new Map(
        turns.filter((t) => t.boardId === input.boardId).map((t) => [t.id, normalize(t)]),
      ).values(),
    ].sort(compare);
  const latest = (turns: TeamTurn[], limit: number) => (limit === 0 ? [] : turns.slice(-limit));
  const own = latest(
    unique(input.personalTurns).filter((t) => personal(t, input.requesterId)),
    personalLimit,
  );
  const group = latest(unique(input.groupTurns), groupLimit);
  const selected = new Map<string, TeamTurn>();
  const ownIds = new Set(own.map((t) => t.id));
  const make = (): TeamContext => {
    const turns = [...selected.values()].sort(compare);
    return {
      boardId: input.boardId,
      requesterId: input.requesterId,
      requesterName: input.requesterName.slice(0, 120),
      groupTurns: turns.filter((t) => !ownIds.has(t.id)),
      personalTurns: turns.filter((t) => ownIds.has(t.id)),
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    };
  };
  if (input.replyToId) {
    const reference =
      input.referencedTurn ?? [...own, ...group].find((t) => t.id === input.replyToId);
    if (!reference || reference.boardId !== input.boardId || reference.id !== input.replyToId)
      throw new TeamContextError('team_ai_invalid_context');
    selected.set(reference.id, normalize(reference));
    if (personal(reference, input.requesterId)) ownIds.add(reference.id);
    // El hilo explícito puede estar fuera de N/M: preservar sus antecedentes
    // cargados por la API, siempre de esta pizarra y con recorrido acotado.
    for (const ancestor of (input.referenceTurns ?? []).slice(0, 10)) {
      if (ancestor.boardId !== input.boardId) throw new TeamContextError('team_ai_invalid_context');
      selected.set(ancestor.id, normalize(ancestor));
      if (personal(ancestor, input.requesterId)) ownIds.add(ancestor.id);
    }
  }
  if (estimateTeamInputTokens(input.request, make()) > budget.maxInputTokens)
    throw new TeamContextError('team_ai_input_budget');
  // Retener primero hilo explícito y memoria personal reciente. Nunca recortar
  // modelo/instrucción/aclaraciones para hacer entrar historial opcional.
  for (const turn of [...own].reverse().concat([...group].reverse())) {
    if (selected.has(turn.id)) continue;
    selected.set(turn.id, turn);
    if (estimateTeamInputTokens(input.request, make()) > budget.maxInputTokens)
      selected.delete(turn.id);
  }
  return make();
}
