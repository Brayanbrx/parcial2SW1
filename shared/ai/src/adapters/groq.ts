import { pedirJson } from '../http.js';
import { ProviderContractError, type PortUsage, type SpeechPort } from '../ports.js';
import { comprobarAudio, extensionDeAudio } from '../prompt.js';

/**
 * Transcripcion con Whisper en Groq.
 *
 * El reconocimiento normal lo hace el **navegador** (puede usar su nube) y
 * responde al instante. Este puerto existe para cuando no lo hay —Firefox no
 * trae `SpeechRecognition`— y para cuando el del navegador reconoce mal.
 *
 * Que exista cambia una cosa importante respecto de la fase 7: hasta ahora
 * `SpeechPort` solo tenia adaptador simulado, asi que en un navegador sin
 * reconocimiento el dictado sencillamente no estaba. Ahora hay a donde caer.
 */

const PROVIDER = 'groq';
const BASE = 'https://api.groq.com/openai/v1';

/** Rapido y suficiente para dictar una instruccion corta. */
const MODELO_POR_DEFECTO = 'whisper-large-v3-turbo';

export interface GroqSpeechOptions {
  readonly provider?: 'groq' | 'mistral';
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /**
   * Idioma esperado.
   *
   * Se declara en lugar de dejar que lo detecte: quien dicta «crea la clase
   * Cliente» esta hablando espanol, y una deteccion equivocada en una frase de
   * dos segundos devuelve texto en otro idioma que el asistente no entiende.
   */
  readonly language?: string;
  readonly baseUrl?: string;
}

interface RespuestaGroq {
  readonly text?: string;
}

export class GroqSpeechPort implements SpeechPort {
  public readonly name: string;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly language: string;
  private readonly baseUrl: string;

  public constructor(options: GroqSpeechOptions) {
    this.name = options.provider ?? PROVIDER;
    this.apiKey = options.apiKey;
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
    comprobarAudio(this.name, options.mediaType);

    const inicio = Date.now();
    const formulario = new FormData();

    // El nombre del archivo lleva extension porque el servicio decide el
    // contenedor por ella antes que por el tipo declarado.
    formulario.append(
      'file',
      new Blob([new Uint8Array(options.audio)], { type: options.mediaType }),
      `dictado.${extensionDeAudio(options.mediaType)}`,
    );
    formulario.append('model', this.model);
    formulario.append('language', this.language);
    formulario.append('response_format', 'json');
    if (this.name === 'groq') formulario.append('temperature', '0');

    const respuesta = await pedirJson<RespuestaGroq>({
      provider: this.name,
      url: `${this.baseUrl}/audio/transcriptions`,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      init: {
        method: 'POST',
        // Sin `content-type` a mano: lo pone `fetch` con la frontera del
        // formulario, y escribirlo rompe la peticion en silencio.
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: formulario,
      },
    });

    const texto = (respuesta.text ?? '').trim();
    if (texto.length === 0) {
      // Un audio sin voz devuelve cadena vacia. Es un resultado legitimo del
      // servicio y un fallo para quien dicto: se dice, no se devuelve vacio.
      throw new ProviderContractError(this.name, 'No se reconocio ninguna palabra en el audio.');
    }

    return {
      text: texto,
      usage: { provider: this.name, model: this.model, latencyMs: Date.now() - inicio },
    };
  }
}
