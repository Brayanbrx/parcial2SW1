import { requireCompleteResponse } from '../completion.js';
import { pedirJson } from '../http.js';
import {
  ProviderContractError,
  type AnswerOptions,
  type AnswerResult,
  type LlmPort,
  type PortUsage,
  type ProposeOptions,
  type ProposeResult,
  type VisionPort,
} from '../ports.js';
import type { BatchProposal } from '../proposal.js';
import {
  INSTRUCCION_ESQUEMA,
  SISTEMA_ASISTENTE,
  SISTEMA_CONSULTA,
  SISTEMA_VISION,
  comprobarImagen,
  interpretarPropuesta,
  mensajeDeConsulta,
  mensajeDePropuesta,
} from '../prompt.js';

/**
 * Adaptador de Gemini (Google AI Studio).
 *
 * Es el primario de los puertos de texto e imagen en la configuracion de
 * referencia. Se llama por HTTP y no con su SDK a proposito: el unico SDK que
 * este proyecto arrastra es el de Claude, y anadir uno por proveedor —cada uno
 * con su cadencia de versiones— cuesta mas que las cuarenta lineas de aqui.
 *
 * La clave viaja en la cabecera `x-goog-api-key` y no en la URL. Una clave en la
 * URL acaba en el registro del proxy, en el historial y en cualquier traza que
 * alguien pegue en un chat.
 */

const PROVIDER = 'gemini';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Modelo por defecto.
 *
 * Rapido y barato, que es lo que pide un asistente que responde mientras
 * alguien mira la pantalla. Se cambia con `AI_LLM_MODEL` sin tocar codigo.
 */
const MODELO_POR_DEFECTO = 'gemini-3.6-flash';

export interface GeminiAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Solo para las pruebas: apunta el adaptador a un servidor local. */
  readonly baseUrl?: string;
}

interface RespuestaGemini {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
    readonly finishReason?: string;
  }[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
}

type Parte = { text: string } | { inlineData: { mimeType: string; data: string } };

export class GeminiLlmPort implements LlmPort {
  public readonly name = PROVIDER;
  private readonly cliente: ClienteGemini;

  public constructor(options: GeminiAdapterOptions) {
    this.cliente = new ClienteGemini(options);
  }

  public async proposeCommands(options: ProposeOptions): Promise<ProposeResult> {
    const respuesta = await this.cliente.generar({
      sistema: `${SISTEMA_ASISTENTE}\n\n${INSTRUCCION_ESQUEMA}`,
      partes: [
        { text: mensajeDePropuesta(options.instruction, options.snapshot, options.context) },
      ],
      json: true,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    requireCompleteResponse(PROVIDER, respuesta.truncada ? 'MAX_TOKENS' : 'STOP', 'STOP');
    return {
      proposal: interpretarPropuesta(PROVIDER, respuesta.texto),
      usage: respuesta.usage,
    };
  }

  public async answer(options: AnswerOptions): Promise<AnswerResult> {
    const respuesta = await this.cliente.generar({
      sistema: SISTEMA_CONSULTA,
      partes: [
        { text: mensajeDeConsulta(options.question, options.snapshot, options.issues ?? []) },
      ],
      json: false,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    requireCompleteResponse(PROVIDER, respuesta.truncada ? 'MAX_TOKENS' : 'STOP', 'STOP');
    return { text: respuesta.texto, usage: respuesta.usage };
  }
}

export class GeminiVisionPort implements VisionPort {
  public readonly name = PROVIDER;
  private readonly cliente: ClienteGemini;

  public constructor(options: GeminiAdapterOptions) {
    this.cliente = new ClienteGemini(options);
  }

  public async extractModel(options: {
    readonly image: Uint8Array;
    readonly mediaType: string;
    readonly signal?: AbortSignal;
  }): Promise<{ proposal: BatchProposal; usage?: PortUsage }> {
    comprobarImagen(PROVIDER, options.mediaType);

    const respuesta = await this.cliente.generar({
      sistema: `${SISTEMA_VISION}\n\n${INSTRUCCION_ESQUEMA}`,
      partes: [
        {
          inlineData: {
            mimeType: options.mediaType,
            data: Buffer.from(options.image).toString('base64'),
          },
        },
        { text: 'Transcribe este diagrama de clases a operaciones.' },
      ],
      json: true,
      // Un diagrama entidad-relacion de ocho tablas son unas sesenta
      // operaciones; uno del tamano que promete RNF-03, ciento setenta.
      maxTokens: 32_768,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    // Tolerante: ver `OpcionesDeInterpretacion`. Vale para la fotografia,
    // no para el asistente.
    const proposal = interpretarPropuesta(PROVIDER, respuesta.texto, { tolerante: true });

    // Si el proveedor dice que corto por longitud, se anade a la explicacion
    // que la persona ya lee junto a la vista previa. Sin esto, una lectura
    // incompleta llega con el mismo aspecto que una completa.
    if (respuesta.truncada) {
      const aviso =
        'La lectura se corto por longitud: revisa si falta alguna clase o atributo, y si ' +
        'el diagrama es muy grande importalo por partes.';

      return {
        proposal: {
          ...proposal,
          // Recortado al maximo que acepta el contrato: el aviso no puede ser
          // lo que invalide la propuesta que esta describiendo.
          rationale: `${aviso} ${proposal.rationale ?? ''}`.trim().slice(0, 400),
        },
        usage: respuesta.usage,
      };
    }

    return { proposal, usage: respuesta.usage };
  }
}

/** Lo que comparten los dos puertos: una sola forma de hablar con la API. */
class ClienteGemini {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;

  public constructor(options: GeminiAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? MODELO_POR_DEFECTO;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.baseUrl = options.baseUrl ?? BASE;
  }

  public async generar(peticion: {
    readonly sistema: string;
    readonly partes: readonly Parte[];
    readonly json: boolean;
    /** Leer una fotografia produce mucho mas texto que responder una frase. */
    readonly maxTokens?: number;
    readonly signal?: AbortSignal;
  }): Promise<{ texto: string; usage: PortUsage; truncada: boolean }> {
    const inicio = Date.now();

    const respuesta = await pedirJson<RespuestaGemini>({
      provider: PROVIDER,
      url: `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      ...(peticion.signal === undefined ? {} : { signal: peticion.signal }),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: peticion.sistema }] },
          contents: [{ role: 'user', parts: peticion.partes }],
          generationConfig: {
            // Cero: la misma instruccion sobre la misma pizarra deberia dar la
            // misma propuesta. No lo garantiza, pero quita la variacion gratuita.
            temperature: 0,
            // Explicito, y no el valor por defecto del modelo. Leer la foto de
            // un diagrama de ocho tablas son unas sesenta operaciones, y con el
            // presupuesto por defecto la respuesta se cortaba a la mitad: el
            // modelo cerraba el JSON limpiamente, asi que ni fallaba ni avisaba
            // — simplemente faltaban clases.
            //
            // El razonamiento cuenta dentro de este presupuesto, y no es poco:
            // medido sobre un diagrama de once clases, Gemini gasto 4675 tokens
            // pensando y 3461 escribiendo. Con 8192 esa misma llamada se habria
            // quedado sin sitio a mitad de la respuesta.
            maxOutputTokens: peticion.maxTokens ?? 16_384,
            ...(peticion.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
    });

    if (respuesta.promptFeedback?.blockReason !== undefined) {
      // Es un rechazo del filtro, no una caida: reintentar en otro proveedor
      // daria el mismo resultado y esconderia el motivo.
      throw new ProviderContractError(
        PROVIDER,
        `El proveedor bloqueo la peticion (${respuesta.promptFeedback.blockReason}).`,
      );
    }

    const reason = respuesta.candidates?.[0]?.finishReason;
    if (reason !== 'MAX_TOKENS') requireCompleteResponse(PROVIDER, reason, 'STOP');
    const texto = (respuesta.candidates?.[0]?.content?.parts ?? [])
      .map((parte) => parte.text ?? '')
      .join('')
      .trim();

    if (texto.length === 0) {
      throw new ProviderContractError(PROVIDER, 'El proveedor devolvio una respuesta vacia.', {
        finishReason: respuesta.candidates?.[0]?.finishReason,
      });
    }

    return {
      texto,
      // Gemini lo dice en la respuesta. Es la unica forma de distinguir «el
      // diagrama tenia esto» de «no cupo mas».
      truncada: respuesta.candidates?.[0]?.finishReason === 'MAX_TOKENS',
      usage: {
        provider: PROVIDER,
        model: this.model,
        ...(respuesta.usageMetadata?.promptTokenCount === undefined
          ? {}
          : { inputTokens: respuesta.usageMetadata.promptTokenCount }),
        ...(respuesta.usageMetadata?.candidatesTokenCount === undefined
          ? {}
          : { outputTokens: respuesta.usageMetadata.candidatesTokenCount }),
        latencyMs: Date.now() - inicio,
      },
    };
  }
}
