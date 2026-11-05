import type { LlmPort } from './ports.js';

export type AiTask = 'mentor' | 'instruct' | 'review' | 'summary';
/** Punto de extensión: todas las tareas usan hoy la pasarela nube/mock existente. */
export function createTaskRouter(ports: { readonly llm: LlmPort }) {
  return {
    portFor(_task: AiTask): LlmPort {
      return ports.llm;
    },
  };
}
