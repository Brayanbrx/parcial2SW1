import { pedirJson } from '../http.js';
import { ProviderContractError, type PortUsage, type SpeechPort } from '../ports.js';
import { comprobarAudio } from '../prompt.js';

/**
 * Transcripcion con Whisper en Workers AI de Cloudflare.
 *
 * Es el respaldo del puerto de voz: otro proveedor, otra red y otra cuenta que
 * el primario, que es lo unico que hace util a un respaldo.
 *
 * Necesita **dos** valores, no uno: el identificador de la cuenta va en la ruta
 * y el testigo en la cabecera. Faltando cualquiera de los dos el registro falla
 * al arrancar y dice cual falta.
 */

const PROVIDER = 'cloudflare';
const BASE = 'https://api.cloudflare.com/client/v4';
const MODELO_POR_DEFECTO = '@cf/openai/whisper-large-v3-turbo';

export interface CloudflareSpeechOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly language?: string;
  readonly baseUrl?: string;
}

interface RespuestaCloudflare {
  readonly success?: boolean;
  readonly result?: { readonly text?: string };
  readonly errors?: readonly { readonly message?: string }[];
}

export class CloudflareSpeechPort implements SpeechPort {
  public readonly name = PROVIDER;

  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly language: string;
  private readonly baseUrl: string;

  public constructor(options: CloudflareSpeechOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.model = options.model ?? MODELO_POR_DEFECTO;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.language = options.language ?? 'es';
    this.baseUrl = options.baseUrl ?? BASE;
  }

  public async transcribe(options: {
    readonly audio: Uint8Array;
    readonly mediaType: string;
    readonly signal?: AbortSignal;
  }): Promise<{ text: string; usage?: PortUsage }> {
    comprobarAudio(PROVIDER, options.mediaType);

    const inicio = Date.now();

    const respuesta = await pedirJson<RespuestaCloudflare>({
      provider: PROVIDER,
      url: `${this.baseUrl}/accounts/${encodeURIComponent(this.accountId)}/ai/run/${this.model}`,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          audio: Buffer.from(options.audio).toString('base64'),
          task: 'transcribe',
          language: this.language,
        }),
      },
    });

    // Cloudflare responde 200 con `success: false` cuando el modelo falla. Sin
    // mirar la bandera, el fallo se leeria como una transcripcion vacia.
    if (respuesta.success === false) {
      throw new ProviderContractError(
        PROVIDER,
        `El proveedor rechazo el audio: ${respuesta.errors?.[0]?.message ?? 'sin detalle'}.`,
        respuesta.errors,
      );
    }

    const texto = (respuesta.result?.text ?? '').trim();
    if (texto.length === 0) {
      throw new ProviderContractError(PROVIDER, 'No se reconocio ninguna palabra en el audio.');
    }

    return {
      text: texto,
      usage: { provider: PROVIDER, model: this.model, latencyMs: Date.now() - inicio },
    };
  }
}
