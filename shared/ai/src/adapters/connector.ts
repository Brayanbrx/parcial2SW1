import type { LlmPort } from '../ports.js';
import { createModelCapabilities } from '../model-capabilities.js';
import {
  SISTEMA_ASISTENTE,
  INSTRUCCION_ESQUEMA,
  mensajeDePropuesta,
  mensajeDeConsulta,
  sistemaDeConsulta,
  interpretarPropuesta,
} from '../prompt.js';

/** El conector recibe solo texto y devuelve texto; los contratos se validan aquí. */
export function createConnectorLlmPort(options: {
  name: string;
  contextWindow: number;
  timeoutMs: number;
  complete(input: {
    system: string;
    prompt: string;
    json: boolean;
    signal?: AbortSignal;
  }): Promise<string>;
}): LlmPort {
  return {
    name: options.name,
    capabilities: createModelCapabilities({
      contextWindow: options.contextWindow - Math.min(4096, Math.floor(options.contextWindow / 4)),
      timeoutMs: options.timeoutMs,
      jsonMode: true,
    }),
    async proposeCommands(input) {
      const text = await options.complete({
        system: `${SISTEMA_ASISTENTE}\n\n${INSTRUCCION_ESQUEMA}`,
        prompt: mensajeDePropuesta(input.instruction, input.snapshot, input.context, input.team),
        json: true,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return { proposal: interpretarPropuesta(options.name, text) };
    },
    async answer(input) {
      const text = await options.complete({
        system: sistemaDeConsulta(input.teaching),
        prompt: mensajeDeConsulta(input.question, input.snapshot, input.issues ?? [], input.team),
        json: false,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return { text };
    },
  };
}
