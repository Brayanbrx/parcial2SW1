import { anthropicFailure } from './anthropic-errors.js';
import { requireCompleteResponse } from '../completion.js';
import Anthropic from '@anthropic-ai/sdk';
import { PROPOSAL_JSON_SCHEMA } from '../proposal.js';
import {
  type AnswerOptions,
  type AnswerResult,
  type LlmPort,
  type ProposeOptions,
  type ProposeResult,
} from '../ports.js';
import {
  SISTEMA_ASISTENTE,
  SISTEMA_CONSULTA,
  interpretarPropuesta,
  mensajeDeConsulta,
  mensajeDePropuesta,
} from '../prompt.js';

/**
 * Adaptador de Claude.
 *
 * La clave nunca sale del servidor (RNF-08). Este modulo solo se importa desde
 * el proceso HTTP; el navegador habla con nuestra API, no con el proveedor.
 *
 * La propuesta se pide con **salida estructurada** contra el esquema derivado de
 * los contratos, no parseando texto libre (6.5). Aun asi se vuelve a validar con
 * Zod al recibirla: el esquema restringe la forma, no garantiza que el contenido
 * cumpla nuestras reglas.
 */

const PROVIDER = 'anthropic';

export interface AnthropicAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export class AnthropicLlmPort implements LlmPort {
  public readonly name = PROVIDER;

  private readonly client: Anthropic;
  private readonly model: string;

  public constructor(options: AnthropicAdapterOptions) {
    this.model = options.model ?? 'claude-opus-5';
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // Un proveedor lento no puede colgar la interfaz (6.5). Los reintentos del
      // SDK ya usan espera creciente.
      timeout: options.timeoutMs ?? 30_000,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  public async proposeCommands(options: ProposeOptions): Promise<ProposeResult> {
    const inicio = Date.now();

    const response = await this.enviar(
      [
        {
          role: 'user',
          content: mensajeDePropuesta(options.instruction, options.snapshot, options.context),
        },
      ],
      {
        system: SISTEMA_ASISTENTE,
        outputConfig: {
          format: { type: 'json_schema', schema: PROPOSAL_JSON_SCHEMA, name: 'propuesta' },
        },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );

    return {
      proposal: interpretarPropuesta(PROVIDER, textoDe(response)),
      usage: {
        provider: PROVIDER,
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - inicio,
      },
    };
  }

  public async answer(options: AnswerOptions): Promise<AnswerResult> {
    const inicio = Date.now();

    const response = await this.enviar(
      [
        {
          role: 'user',
          content: mensajeDeConsulta(options.question, options.snapshot, options.issues ?? []),
        },
      ],
      {
        system: SISTEMA_CONSULTA,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );

    return {
      text: textoDe(response),
      usage: {
        provider: PROVIDER,
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - inicio,
      },
    };
  }

  private async enviar(
    messages: Anthropic.MessageParam[],
    extra: {
      system: string;
      outputConfig?: Record<string, unknown>;
      signal?: AbortSignal;
    },
  ): Promise<Anthropic.Message> {
    try {
      return await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 4096,
          system: extra.system,
          messages,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low', ...(extra.outputConfig ?? {}) },
        } as Anthropic.MessageCreateParamsNonStreaming,
        extra.signal === undefined ? undefined : { signal: extra.signal },
      );
    } catch (error) {
      throw anthropicFailure(error);
    }
  }
}

function textoDe(response: Anthropic.Message): string {
  requireCompleteResponse(PROVIDER, response.stop_reason, 'end_turn');
  return response.content
    .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('\n')
    .trim();
}
