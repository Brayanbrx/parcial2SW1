import { MAX_CONTEXT_TURNS, exceedsContext, type PendingTurn } from '@uml/contracts';
import type { Prisma } from '@prisma/client';
import { badRequest, conflict } from '../../lib/http-error.js';

/** Recorrido acotado de parejas USER → AI. No reconstruir por proximidad temporal. */
export async function loadClarifications(
  db: Pick<Prisma.TransactionClient, 'teamMessage'>,
  boardId: string,
  userId: string,
  replyToId: string | null,
): Promise<PendingTurn[]> {
  const turns: PendingTurn[] = [];
  const seen = new Set<string>();
  let next = replyToId;
  while (next) {
    if (seen.has(next))
      throw badRequest('invalid_clarification', 'El hilo de aclaración no es válido.');
    seen.add(next);
    const answer = await db.teamMessage.findFirst({
      where: { id: next, boardId },
      select: { authorKind: true, kind: true, addressedToId: true, replyToId: true, text: true },
    });
    if (
      answer?.authorKind !== 'AI' ||
      answer.kind !== 'CLARIFICATION' ||
      answer.addressedToId !== userId ||
      !answer.replyToId ||
      seen.has(answer.replyToId)
    )
      throw badRequest('invalid_clarification', 'El hilo de aclaración no es válido.');
    seen.add(answer.replyToId);
    const request = await db.teamMessage.findFirst({
      where: { id: answer.replyToId, boardId },
      select: {
        authorKind: true,
        authorId: true,
        mode: true,
        status: true,
        text: true,
        replyToId: true,
      },
    });
    if (
      request?.authorKind !== 'USER' ||
      request.authorId !== userId ||
      request.mode !== 'INSTRUCT' ||
      request.status !== 'DONE'
    )
      throw badRequest('invalid_clarification', 'El hilo de aclaración no es válido.');
    turns.unshift({ role: 'user', text: request.text }, { role: 'assistant', text: answer.text });
    if (turns.length > MAX_CONTEXT_TURNS || exceedsContext(turns))
      throw conflict(
        'team_ai_context_limit',
        'Revisa la solicitud completa o empieza de nuevo: el hilo supera diez turnos o su límite de texto.',
      );
    next = request.replyToId;
  }
  return turns;
}
