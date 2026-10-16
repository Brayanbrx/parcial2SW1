import { ProviderContractError, ProviderUnavailableError } from './ports.js';

/**
 * Transporte HTTP comun a los adaptadores
 */

export interface PeticionJsonOptions {
  /** Nombre del proveedor, para que el error diga quien fallo. */
  readonly provider: string;
  readonly url: string;
  readonly init: RequestInit;
  readonly timeoutMs: number;
  /** Reintentos adicionales al primer intento. 0 significa un solo intento. */
  readonly maxRetries: number;
  /** Cancelacion del llamante. Abortar aqui no reintenta: lo pidio el usuario. */
  readonly signal?: AbortSignal;
  /** Inyectable para que las pruebas no esperen de verdad. */
  readonly esperar?: (ms: number) => Promise<void>;
}

/** Codigos que merecen otro intento: el proveedor esta vivo pero no ahora. */
const REINTENTABLES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const ESPERA_BASE_MS = 250;
const ESPERA_MAXIMA_MS = 4_000;

export async function pedirJson<T>(options: PeticionJsonOptions): Promise<T> {
  const esperar = options.esperar ?? ((ms) => new Promise((listo) => setTimeout(listo, ms)));
  let ultimo: unknown;

  for (let intento = 0; intento <= options.maxRetries; intento += 1) {
    if (intento > 0) {
      // Espera creciente y acotada. Sin tope, el tercer reintento tarda mas que
      // la paciencia de quien esta mirando la pantalla.
      await esperar(Math.min(ESPERA_BASE_MS * 2 ** (intento - 1), ESPERA_MAXIMA_MS));
    }

    let respuesta: Response;
    let cuerpo: string;
    const plazo = senal(options.timeoutMs, options.signal);
    try {
      respuesta = await fetch(options.url, { ...options.init, signal: plazo.signal });
      // fetch resuelve al recibir las cabeceras. El cuerpo aun puede cortarse
      // o agotar el plazo: tambien debe activar el reintento y el respaldo.
      cuerpo = await respuesta.text();
    } catch (error) {
      // Si aborto el llamante, no es un fallo del proveedor y no se reintenta.
      if (options.signal?.aborted === true) throw error;
      ultimo = error;
      continue;
    } finally {
      plazo.liberar();
    }

    if (respuesta.ok) {
      try {
        return JSON.parse(cuerpo) as T;
      } catch (error) {
        throw new ProviderContractError(
          options.provider,
          'La respuesta del proveedor no era JSON.',
          { raw: recortar(cuerpo), cause: error },
        );
      }
    }

    const detalle = recortar(cuerpo);

    // Repetir una cuota agotada solo consume latencia y solicitudes.
    if (respuesta.status === 402 || respuesta.status === 429) {
      const header = respuesta.headers.get('retry-after');
      const seconds = header === null ? NaN : Number(header);
      const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : header === null
          ? NaN
          : Date.parse(header) - Date.now();
      throw new ProviderUnavailableError(
        options.provider,
        `${options.provider}: cuota o saldo no disponible (HTTP ${respuesta.status}).`,
        {
          quota: true,
          ...(Number.isFinite(delay) ? { retryAfterMs: Math.max(0, delay) } : {}),
        },
      );
    }

    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new ProviderContractError(
        options.provider,
        `El proveedor ${options.provider} rechazo la credencial (HTTP ${respuesta.status}). ` +
          'Revisa la clave en infra/.env.',
        { raw: detalle },
      );
    }

    if (!REINTENTABLES.has(respuesta.status)) {
      throw new ProviderContractError(
        options.provider,
        `El proveedor ${options.provider} rechazo la peticion (HTTP ${respuesta.status}).`,
        { raw: detalle },
      );
    }

    ultimo = new Error(`HTTP ${respuesta.status}: ${detalle}`);
  }

  throw new ProviderUnavailableError(
    options.provider,
    `${options.provider} no respondio tras ${options.maxRetries + 1} intento(s).`,
    { cause: ultimo },
  );
}

/**
 * Aborta por tiempo limite y por cancelacion del llamante.
 */
function senal(
  timeoutMs: number,
  delLlamante?: AbortSignal,
): { readonly signal: AbortSignal; readonly liberar: () => void } {
  const controlador = new AbortController();
  const temporizador = setTimeout(
    () =>
      controlador.abort(
        new DOMException(`El proveedor no respondio en ${String(timeoutMs)} ms.`, 'TimeoutError'),
      ),
    timeoutMs,
  );
  const propagar = (): void => controlador.abort(delLlamante?.reason);
  if (delLlamante?.aborted === true) propagar();
  else delLlamante?.addEventListener('abort', propagar, { once: true });

  return {
    signal: controlador.signal,
    liberar: (): void => {
      clearTimeout(temporizador);
      delLlamante?.removeEventListener('abort', propagar);
    },
  };
}

/**
 * El cuerpo del error se recorta antes de guardarlo
 */
function recortar(texto: string): string {
  return texto.length > 500 ? `${texto.slice(0, 500)}…` : texto;
}
