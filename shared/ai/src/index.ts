/**
 * @uml/ai
 * Capa de IA desacoplada
 *
 * Ningun modulo del dominio conoce un proveedor concreto. Se consume a traves de tres puertos
 * y cada proveedor es un adaptador intercambiable por configuracion.
 */
export * from './ports.js';
export * from './proposal.js';
export * from './resolver.js';
export * from './registry.js';
export * from './team-context.js';
export * from './task-router.js';
export * from './model-capabilities.js';
export { createConnectorLlmPort } from './adapters/connector.js';
export {
  SUPPORTED_AUDIO_TYPES,
  SUPPORTED_IMAGE_TYPES,
  describir,
  inferirTipoAtributo,
  interpretarPropuesta,
} from './prompt.js';
export { MockLlmPort, MockSpeechPort, MockVisionPort, nombreDeClase } from './adapters/mock.js';
export { AnthropicLlmPort, type AnthropicAdapterOptions } from './adapters/anthropic.js';
export { AnthropicVisionPort, type AnthropicVisionOptions } from './adapters/anthropic-vision.js';
export { GeminiLlmPort, GeminiVisionPort, type GeminiAdapterOptions } from './adapters/gemini.js';
export {
  OpenRouterLlmPort,
  OpenRouterVisionPort,
  type OpenRouterAdapterOptions,
} from './adapters/openrouter.js';
export { GroqSpeechPort, contextoDeAudio, type GroqSpeechOptions } from './adapters/groq.js';
export { CloudflareSpeechPort, type CloudflareSpeechOptions } from './adapters/cloudflare.js';
