import type { LlmPort } from './ports.js';

export type AiTask = 'mentor' | 'instruct' | 'review' | 'summary';
export type AiSource = 'PROVIDERS' | 'LOCAL';

/**
 * Punto de extensión: PROVIDERS usa la pasarela nube/mock. LOCAL usa el modelo
 * local con los proveedores como respaldo, si el servidor lo configuró; si no,
 * sigue con los proveedores para que el proyecto nunca quede sin IA.
 */
export function createTaskRouter(
  ports: { readonly llm: LlmPort; readonly local?: LlmPort | undefined },
  source: AiSource = 'PROVIDERS',
) {
  return {
    portFor(_task: AiTask): LlmPort {
      return source === 'LOCAL' && ports.local ? ports.local : ports.llm;
    },
  };
}
