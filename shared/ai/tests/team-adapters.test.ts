import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnthropicLlmPort,
  GeminiLlmPort,
  OpenRouterLlmPort,
  buildTeamContext,
  type LlmPort,
} from '@uml/ai';

afterEach(() => vi.unstubAllGlobals());
const snapshot = { classes: [], relationships: [] };
const team = buildTeamContext(
  {
    boardId: 'board-verified',
    requesterId: 'beto-id',
    requesterName: 'Beto',
    groupTurns: [],
    personalTurns: [],
    request: { mode: 'ASK', text: 'Hola', snapshot },
  },
  { maxInputTokens: 32768 },
);

describe('ningún adaptador ignora team', () => {
  it.each(['anthropic', 'gemini', 'compatible'] as const)(
    '%s serializa identidad y contexto tanto en ASK como INSTRUCT',
    async (provider) => {
      const captured: unknown[] = [];
      let instruct = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const text = init?.body
            ? String(init.body)
            : input instanceof Request
              ? await input.text()
              : '';
          captured.push(JSON.parse(text));
          const output = instruct
            ? '{"operations":[],"needsClarification":"¿Cuál?"}'
            : 'Beto, respuesta';
          const body =
            provider === 'anthropic'
              ? {
                  id: 'msg_test',
                  type: 'message',
                  role: 'assistant',
                  model: 'test',
                  stop_reason: 'end_turn',
                  stop_sequence: null,
                  content: [{ type: 'text', text: output }],
                  usage: { input_tokens: 10, output_tokens: 5 },
                }
              : provider === 'gemini'
                ? {
                    candidates: [{ content: { parts: [{ text: output }] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
                  }
                : {
                    choices: [{ message: { content: output }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 10, completion_tokens: 5 },
                  };
          return new Response(JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
          });
        }),
      );
      const port: LlmPort =
        provider === 'anthropic'
          ? new AnthropicLlmPort({ apiKey: 'test', maxRetries: 0 })
          : provider === 'gemini'
            ? new GeminiLlmPort({ apiKey: 'test', maxRetries: 0 })
            : new OpenRouterLlmPort({ apiKey: 'test', model: 'test', maxRetries: 0 });
      await port.answer({
        question: 'Hola',
        snapshot,
        team,
        teaching: { solutionMode: 'HINTS_ONLY', task: 'REVIEW' },
      });
      instruct = true;
      await port.proposeCommands({
        instruction: 'la segunda',
        snapshot,
        team,
        context: [
          { role: 'user', text: 'Conserva Persona' },
          { role: 'assistant', text: '¿Cuál?\n1. "Ana"\n2. "Beto"' },
        ],
      });
      expect(captured).toHaveLength(2);
      for (const body of captured) {
        const payload = JSON.stringify(body);
        expect(payload).toContain('board-verified');
        expect(payload).toContain('beto-id');
        expect(payload).toContain('requesterName');
        expect(payload).toContain('Contexto del equipo');
      }
      expect(JSON.stringify(captured[1])).toContain('Conserva Persona');
      expect(JSON.stringify(captured[1])).toContain('la segunda');
      expect(JSON.stringify(captured[0])).toContain('Política OWNER: HINTS_ONLY');
      expect(JSON.stringify(captured[0])).toContain('Revisión solicitada');
      expect(JSON.stringify(captured[1])).not.toContain('Política OWNER');
    },
  );
});
