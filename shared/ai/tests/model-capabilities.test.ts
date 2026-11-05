import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAiPorts,
  createModelCapabilities,
  createTaskRouter,
  loadAiConfig,
  type ModelCapabilities,
} from '@uml/ai';

afterEach(() => vi.unstubAllGlobals());
const defaults = { contextWindow: 32768, timeoutMs: 120000, jsonMode: true };

describe('capacidades operativas del puerto', () => {
  it('expone solo límites, copia y congela sin compartir configuración mutable', () => {
    const source = { ...defaults, apiKey: 'no debe salir' };
    const capabilities = createModelCapabilities(source);
    source.contextWindow = 1;
    expect(capabilities).toEqual(defaults);
    expect(Object.isFrozen(capabilities)).toBe(true);
  });

  it.each([
    { contextWindow: 0 },
    { contextWindow: -1 },
    { contextWindow: 1.5 },
    { contextWindow: Infinity },
    { contextWindow: NaN },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
    { timeoutMs: 2147483648 },
    { timeoutMs: NaN },
    { jsonMode: 'true' },
  ])('rechaza capacidades inválidas: %j', (change) => {
    expect(() =>
      createModelCapabilities({ ...defaults, ...change } as ModelCapabilities),
    ).toThrow();
  });

  it('mock y las cuatro tareas exponen la misma configuración efectiva', () => {
    const limits = { contextWindow: 65536 };
    const ports = createAiPorts(loadAiConfig({ AI_CHAIN_TIMEOUT_MS: '180000' }), limits);
    limits.contextWindow = 1;
    for (const task of ['mentor', 'instruct', 'review', 'summary'] as const) {
      const port = createTaskRouter(ports).portFor(task);
      expect(port).toBe(ports.llm);
      expect(port.capabilities).toEqual({
        contextWindow: 65536,
        timeoutMs: 180000,
        jsonMode: true,
      });
    }
    expect(createAiPorts(loadAiConfig({})).llm.capabilities).toEqual(defaults);
  });

  it.each([true, false])(
    'el respaldo NVIDIA solo afecta jsonMode cuando está activo: %s',
    (enabled) => {
      const ports = createAiPorts(
        loadAiConfig({
          AI_LLM_PROVIDER: 'mock',
          AI_LLM_FALLBACKS: JSON.stringify([{ provider: 'nvidia', model: 'test', enabled }]),
          NVIDIA_API_KEY: 'test-key',
        }),
      );
      expect(ports.llm.capabilities?.jsonMode).toBe(!enabled);
    },
  );

  it('incluye el respaldo legado y no confunde la cadena de visión con texto', () => {
    expect(
      createAiPorts(
        loadAiConfig({
          AI_LLM_FALLBACK_PROVIDER: 'nvidia',
          AI_LLM_FALLBACK_MODEL: 'test',
          NVIDIA_API_KEY: 'test',
        }),
      ).llm.capabilities?.jsonMode,
    ).toBe(false);
    expect(
      createAiPorts(
        loadAiConfig({
          AI_VISION_PROVIDER: 'nvidia',
          AI_VISION_MODEL: 'test',
          NVIDIA_API_KEY: 'test',
        }),
      ).llm.capabilities?.jsonMode,
    ).toBe(true);
  });

  it.each(['openrouter', 'nvidia'] as const)(
    '%s declara el modo JSON que efectivamente envía y valida su salida',
    async (provider) => {
      const fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"operations":[]}' }, finish_reason: 'stop' }],
            }),
          ),
      );
      vi.stubGlobal('fetch', fetch);
      const port = createAiPorts(
        loadAiConfig({
          AI_LLM_PROVIDER: provider,
          AI_LLM_MODEL: 'test',
          OPENROUTER_API_KEY: 'test',
          NVIDIA_API_KEY: 'test',
          AI_MAX_RETRIES: '0',
        }),
      ).llm;
      await port.proposeCommands({
        instruction: 'Crea Cliente',
        snapshot: { classes: [], relationships: [] },
      });
      const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(!!JSON.parse(String(init.body)).response_format).toBe(port.capabilities?.jsonMode);
      fetch.mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: { content: '{"operations":[{"op":"INVENTADO"}]}' },
                  finish_reason: 'stop',
                },
              ],
            }),
          ),
      );
      await expect(
        port.proposeCommands({
          instruction: 'Crea Cliente',
          snapshot: { classes: [], relationships: [] },
        }),
      ).rejects.toThrow();
    },
  );

  it('no añade proveedores locales ni habilita HTTP privado', () => {
    expect(() => loadAiConfig({ AI_LLM_PROVIDER: 'ollama' })).toThrow();
    expect(() => loadAiConfig({ NVIDIA_BASE_URL: 'http://127.0.0.1:11434' })).toThrow();
  });
});
