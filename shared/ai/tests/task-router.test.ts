import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTaskRouter,
  createAiPorts,
  loadAiConfig,
  buildTeamContext,
  type LlmPort,
} from '@uml/ai';

afterEach(() => vi.unstubAllGlobals());
const snapshot = { classes: [], relationships: [] };
const tasks = ['mentor', 'instruct', 'review', 'summary'] as const;
const team = buildTeamContext(
  {
    boardId: 'board',
    requesterId: 'beto',
    requesterName: 'Beto',
    groupTurns: [],
    personalTurns: [],
    request: { mode: 'ASK', text: 'Explica UML', snapshot },
  },
  { maxInputTokens: 32768 },
);

describe('frontera por tarea', () => {
  it('un adaptador existente sin capabilities ni team sigue siendo compatible', async () => {
    const answer = vi.fn(async () => ({ text: 'respuesta' }));
    const proposeCommands = vi.fn(async () => ({ proposal: { operations: [] } }));
    const llm: LlmPort = { name: 'legacy', answer, proposeCommands };
    const router = createTaskRouter({ llm });
    await router.portFor('mentor').answer({ question: 'Explica UML', snapshot });
    await router.portFor('instruct').proposeCommands({ instruction: 'Crea Cliente', snapshot });
    expect(answer).toHaveBeenCalledExactlyOnceWith({ question: 'Explica UML', snapshot });
    expect(proposeCommands).toHaveBeenCalledExactlyOnceWith({
      instruction: 'Crea Cliente',
      snapshot,
    });
  });

  it.each(tasks)('%s conserva team, contexto y AbortSignal al cruzar la frontera', async (task) => {
    const answer = vi.fn<LlmPort['answer']>(async () => ({ text: 'respuesta' }));
    const proposeCommands = vi.fn<LlmPort['proposeCommands']>(async () => ({
      proposal: { operations: [] },
    }));
    const port = createTaskRouter({ llm: { name: 'test', answer, proposeCommands } }).portFor(task);
    const signal = new AbortController().signal;
    if (task === 'instruct') {
      const options = {
        instruction: 'la segunda',
        snapshot,
        team,
        signal,
        context: [{ role: 'user' as const, text: 'Conserva Cliente' }],
      };
      await port.proposeCommands(options);
      expect(proposeCommands.mock.calls[0]?.[0]).toBe(options);
      expect(answer).not.toHaveBeenCalled();
    } else {
      const options = { question: 'Explica UML', snapshot, team, signal };
      await port.answer(options);
      expect(answer.mock.calls[0]?.[0]).toBe(options);
      expect(proposeCommands).not.toHaveBeenCalled();
    }
  });

  it.each(['cancel', 'deadline'] as const)(
    'el puerto enrutado propaga %s y no ejecuta respaldo ni salida tardía',
    async (mode) => {
      const controller = new AbortController();
      let received: AbortSignal | null | undefined;
      const fetch = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            received = init.signal;
            received?.addEventListener('abort', () => reject(new Error('abortado')), {
              once: true,
            });
            if (mode === 'cancel') controller.abort(new Error('cancelación del solicitante'));
          }),
      );
      vi.stubGlobal('fetch', fetch);
      const ports = createAiPorts(
        loadAiConfig({
          AI_LLM_PROVIDER: 'openrouter',
          AI_LLM_MODEL: 'primary',
          OPENROUTER_API_KEY: 'test',
          AI_LLM_FALLBACK_PROVIDER: 'mock',
          AI_CHAIN_TIMEOUT_MS: '50',
          AI_MAX_RETRIES: '0',
        }),
      );
      const port = createTaskRouter(ports).portFor('instruct');
      expect(port.capabilities?.timeoutMs).toBe(50);
      await expect(
        port.proposeCommands({
          instruction: 'Crea Cliente',
          snapshot,
          team,
          signal: controller.signal,
        }),
      ).rejects.toThrow(mode === 'cancel' ? /cancelación del solicitante/ : /plazo total/);
      expect(received?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('el enrutamiento preserva el respaldo actual y contexto de equipo con mock', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const port = createTaskRouter(
      createAiPorts(
        loadAiConfig({
          AI_LLM_PROVIDER: 'openrouter',
          AI_LLM_MODEL: 'primary',
          OPENROUTER_API_KEY: 'test',
          AI_LLM_FALLBACK_PROVIDER: 'mock',
          AI_MAX_RETRIES: '0',
          AI_LOG_USAGE: 'false',
        }),
      ),
    ).portFor('mentor');
    const response = await port.answer({
      question: 'Explica un atributo derivado',
      snapshot,
      team,
    });
    expect(response.text).toContain('Beto');
    expect(response.text).toContain('derivado');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
