import { requireCompleteResponse } from '../completion.js';
import { pedirJson } from '../http.js';
import {
  ProviderContractError,
  ProviderUnavailableError,
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

/** Chat Completions compatible; las particularidades se fijan por proveedor. */
const PROVIDER = 'openrouter';
const BASE = 'https://openrouter.ai/api/v1';

export interface CompatibleAdapterOptions {
  readonly apiKey: string;
  readonly provider?: string;
  readonly jsonMode?: boolean;
  readonly thinking?: boolean;
  readonly chatTemplateThinking?: boolean;
  readonly reasoningEffort?: 'low' | 'high' | 'max';
  readonly maxOutputTokens?: number;
  /** Obligatorio: OpenRouter sirve cientos de modelos y ninguno es el obvio. */
  readonly model: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly baseUrl?: string;
}

interface RespuestaOpenAi {
  readonly choices?: readonly {
    readonly finish_reason?: string;
    readonly message?: { readonly content?: string };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly error?: { readonly message?: string; readonly code?: number | string };
}

type Contenido = string | readonly ContenidoParte[];
type ContenidoParte =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export class CompatibleLlmPort implements LlmPort {
  public readonly name: string;
  private readonly cliente: ClienteCompatible;

  public constructor(options: CompatibleAdapterOptions) {
    this.name = options.provider ?? PROVIDER;
    this.cliente = new ClienteCompatible(options);
  }

  public async proposeCommands(options: ProposeOptions): Promise<ProposeResult> {
    const respuesta = await this.cliente.completar({
      sistema: `${SISTEMA_ASISTENTE}\n\n${INSTRUCCION_ESQUEMA}`,
      usuario: mensajeDePropuesta(options.instruction, options.snapshot, options.context),
      json: true,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    return { proposal: interpretarPropuesta(this.name, respuesta.texto), usage: respuesta.usage };
  }

  public async answer(options: AnswerOptions): Promise<AnswerResult> {
    const respuesta = await this.cliente.completar({
      sistema: SISTEMA_CONSULTA,
      usuario: mensajeDeConsulta(options.question, options.snapshot, options.issues ?? []),
      json: false,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    return { text: respuesta.texto, usage: respuesta.usage };
  }
}

export class CompatibleVisionPort implements VisionPort {
  public readonly name: string;
  private readonly cliente: ClienteCompatible;

  public constructor(options: CompatibleAdapterOptions) {
    this.name = options.provider ?? PROVIDER;
    this.cliente = new ClienteCompatible(options);
  }

  public async extractModel(options: {
    readonly image: Uint8Array;
    readonly mediaType: string;
    readonly signal?: AbortSignal;
  }): Promise<{ proposal: BatchProposal; usage?: PortUsage }> {
    comprobarImagen(this.name, options.mediaType);

    const respuesta = await this.cliente.completar({
      sistema: `${SISTEMA_VISION}\n\n${INSTRUCCION_ESQUEMA}`,
      usuario: [
        { type: 'text', text: 'Transcribe este diagrama de clases a operaciones.' },
        {
          type: 'image_url',
          image_url: {
            // El protocolo acepta una URL o el propio dato. Se manda el dato: la
            // fotografia no esta publicada en ningun sitio y no queremos que lo
            // este solo para poder analizarla.
            url: `data:${options.mediaType};base64,${Buffer.from(options.image).toString('base64')}`,
          },
        },
      ],
      json: true,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    // Tolerante: ver `OpcionesDeInterpretacion`. Vale para la fotografia,
    // no para el asistente.
    return {
      proposal: interpretarPropuesta(this.name, respuesta.texto, { tolerante: true }),
      usage: respuesta.usage,
    };
  }
}

class ClienteCompatible {
  private readonly provider: string;
  private readonly options: CompatibleAdapterOptions;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;

  public constructor(options: CompatibleAdapterOptions) {
    this.options = options;
    this.provider = options.provider ?? PROVIDER;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.baseUrl = options.baseUrl ?? BASE;
  }

  public async completar(peticion: {
    readonly sistema: string;
    readonly usuario: Contenido;
    readonly json: boolean;
    readonly signal?: AbortSignal;
  }): Promise<{ texto: string; usage: PortUsage }> {
    const inicio = Date.now();

    const respuesta = await pedirJson<RespuestaOpenAi>({
      provider: this.provider,
      url: `${this.baseUrl}/chat/completions`,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      ...(peticion.signal === undefined ? {} : { signal: peticion.signal }),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          // OpenRouter las usa para atribuir el consumo. Sin ellas funciona; con
          // ellas se sabe que gasto vino de aqui.
          ...(this.provider === 'openrouter'
            ? {
                'HTTP-Referer': 'https://github.com/plataforma-uml',
                'X-Title': 'Plataforma UML',
              }
            : {}),
        },
        body: JSON.stringify({
          model: this.model,
          ...(this.provider === 'moonshot' ? {} : { temperature: 0 }),
          max_tokens: this.options.maxOutputTokens ?? 16384,
          ...(this.options.reasoningEffort
            ? { reasoning_effort: this.options.reasoningEffort }
            : {}),
          ...(this.options.thinking === undefined
            ? {}
            : { thinking: { type: this.options.thinking ? 'enabled' : 'disabled' } }),
          ...(this.options.chatTemplateThinking === undefined
            ? {}
            : { chat_template_kwargs: { enable_thinking: this.options.chatTemplateThinking } }),
          messages: [
            { role: 'system', content: peticion.sistema },
            { role: 'user', content: peticion.usuario },
          ],
          ...(peticion.json && this.options.jsonMode !== false
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
      },
    });

    // OpenRouter puede devolver 200 con un error dentro: el enrutador respondio,
    // el modelo de destino no. Sin esto se leeria como respuesta vacia.
    if (respuesta.error !== undefined) {
      const code = Number(respuesta.error.code);
      if ([402, 408, 429, 500, 502, 503, 504].includes(code)) {
        throw new ProviderUnavailableError(this.provider, `${this.provider}: error ${code}.`, {
          quota: code === 402 || code === 429,
        });
      }
      throw new ProviderContractError(
        this.provider,
        `El proveedor devolvio un error: ${respuesta.error.message ?? 'sin detalle'}.`,
        respuesta.error,
      );
    }

    if (respuesta.choices?.[0]?.finish_reason === 'length') {
      throw new ProviderContractError(
        this.provider,
        'La respuesta alcanzo el limite de salida. Reduce la solicitud o aumenta AI_COMPATIBLE_MAX_OUTPUT_TOKENS.',
      );
    }
    requireCompleteResponse(this.provider, respuesta.choices?.[0]?.finish_reason, 'stop');
    const texto = (respuesta.choices?.[0]?.message?.content ?? '').trim();
    if (texto.length === 0) {
      throw new ProviderContractError(this.provider, 'El proveedor devolvio una respuesta vacia.');
    }

    return {
      texto,
      usage: {
        provider: this.provider,
        model: this.model,
        ...(respuesta.usage?.prompt_tokens === undefined
          ? {}
          : { inputTokens: respuesta.usage.prompt_tokens }),
        ...(respuesta.usage?.completion_tokens === undefined
          ? {}
          : { outputTokens: respuesta.usage.completion_tokens }),
        latencyMs: Date.now() - inicio,
      },
    };
  }
}
