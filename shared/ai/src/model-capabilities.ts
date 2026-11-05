/** Límites operativos del puerto, no un catálogo de ventanas comerciales.
 * contextWindow limita la entrada completa (sistema, modelo, solicitud e historial).
 * No incluye ni sustituye el límite de salida que configura cada adaptador.
 */
export interface ModelCapabilities {
  readonly contextWindow: number;
  /** Plazo total de la cadena por invocación; no cuenta el tiempo en cola. */
  readonly timeoutMs: number;
  /** Todos los eslabones activos solicitan JSON estructurado o devuelven objetos mock.
   * false permite JSON por prompt; nunca exime de validar la respuesta.
   */
  readonly jsonMode: boolean;
}

export const DEFAULT_MODEL_CONTEXT_WINDOW = 32768;

/** Copia validada e inmutable: no expone credenciales ni opciones del proveedor. */
export function createModelCapabilities(value: ModelCapabilities): ModelCapabilities {
  if (!Number.isSafeInteger(value.contextWindow) || value.contextWindow <= 0)
    throw new Error('contextWindow debe ser un entero positivo seguro');
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs <= 0 || value.timeoutMs > 2_147_483_647)
    throw new Error('timeoutMs debe ser un entero positivo compatible con temporizadores');
  if (typeof value.jsonMode !== 'boolean') throw new Error('jsonMode debe ser booleano');
  return Object.freeze({
    contextWindow: value.contextWindow,
    timeoutMs: value.timeoutMs,
    jsonMode: value.jsonMode,
  });
}
