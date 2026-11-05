import { describe, expect, it } from 'vitest';
import {
  teamMessageSchema,
  exceedsContext,
  contextToDraft,
  type TeamMessage,
} from '@uml/contracts';
import { clarificationTurns } from '../src/features/team-assistant/feed-model.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userId = id(1),
  boardId = id(2),
  now = new Date(0).toISOString();
function request(n: number, replyToId: string | null = null): TeamMessage {
  return teamMessageSchema.parse({
    id: id(n),
    boardId,
    authorKind: 'USER',
    authorId: userId,
    addressedToId: null,
    clientRequestId: id(n),
    mode: 'INSTRUCT',
    inputMode: 'TEXT',
    kind: 'INSTRUCTION',
    text: `Pedido ${n}: no borres Persona`,
    status: 'DONE',
    errorCode: null,
    replyToId,
    createdAt: now,
    updatedAt: now,
  });
}
function answer(n: number, replyToId: string): TeamMessage {
  return teamMessageSchema.parse({
    id: id(n),
    boardId,
    authorKind: 'AI',
    authorId: null,
    addressedToId: userId,
    clientRequestId: null,
    mode: null,
    inputMode: null,
    kind: 'CLARIFICATION',
    text: '¿Cuál clase?\n1. "Cliente"\n2. "Venta"',
    status: null,
    errorCode: null,
    replyToId,
    createdAt: now,
    updatedAt: now,
  });
}
describe('hilos del panel colectivo', () => {
  it('reconstruye en orden solo la cadena seleccionada y conserva las opciones', () => {
    const messages = [
      request(3),
      answer(4, id(3)),
      request(5, id(4)),
      answer(6, id(5)),
      request(7),
    ];
    const turns = clarificationTurns(messages, id(6), userId);
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(turns[0]?.text).toContain('Pedido 3');
    expect(turns[1]?.text).toBe('¿Cuál clase?\n1. "Cliente"\n2. "Venta"');
    expect(turns.some((turn) => turn.text.includes('Pedido 7'))).toBe(false);
  });
  it('recargar sin selección no reanuda una aclaración', () => {
    expect(clarificationTurns([request(3), answer(4, id(3))], null, userId)).toEqual([]);
  });
  it.each(['author', 'recipient', 'board', 'missing', 'cycle'])(
    'descarta un hilo inválido: %s',
    (failure) => {
      let req = request(3),
        response = answer(4, id(3));
      if (failure === 'author') req = teamMessageSchema.parse({ ...req, authorId: id(8) });
      if (failure === 'recipient')
        response = teamMessageSchema.parse({ ...response, addressedToId: id(8) });
      if (failure === 'board') req = { ...req, boardId: id(8) };
      if (failure === 'cycle') req = { ...req, replyToId: response.id };
      expect(
        clarificationTurns(
          failure === 'missing' ? [response] : [req, response],
          response.id,
          userId,
        ),
      ).toEqual([]);
    },
  );
  it('seis aclaraciones obligan a revisar sin perder instrucciones o borrador', () => {
    const messages: TeamMessage[] = [];
    let parent: string | null = null;
    for (let n = 10; n < 22; n += 2) {
      messages.push(request(n, parent), answer(n + 1, id(n)));
      parent = id(n + 1);
    }
    const turns = clarificationTurns(messages, parent, userId);
    expect(turns).toHaveLength(12);
    expect(exceedsContext(turns)).toBe(true);
    expect(contextToDraft(turns, 'Conserva Estudiante')).toContain('Pedido 10: no borres Persona');
    expect(contextToDraft(turns, 'Conserva Estudiante')).toContain('Pedido 20: no borres Persona');
    expect(contextToDraft(turns, 'Conserva Estudiante')).toContain('Conserva Estudiante');
  });
});
