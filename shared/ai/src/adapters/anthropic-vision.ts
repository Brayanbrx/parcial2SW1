import { anthropicFailure } from './anthropic-errors.js';
import { requireCompleteResponse } from '../completion.js';
import Anthropic from '@anthropic-ai/sdk';
import { PROPOSAL_JSON_SCHEMA } from '../proposal.js';
import { type PortUsage, type VisionPort } from '../ports.js';
import type { BatchProposal } from '../proposal.js';
import { SISTEMA_VISION, comprobarImagen, interpretarPropuesta } from '../prompt.js';

/**
 * Extraccion de un modelo desde una fotografia
 *
 * El reconocimiento de un pizarron **se va a equivocar en algo**. Por eso lo que
 * produce es un candidato editable y nunca se aplica solo (CA-042.1): un
 * candidato que no se puede corregir no sirve.
 *
 * Se le pide la misma estructura de propuesta que al asistente por texto, y por
 * la misma razon: la importacion recorre despues el mismo camino —vista previa,
 * correccion, resolucion, validacion, lote— en lugar de tener una via propia con
 * sus propias reglas (RA-01).
 */

const PROVIDER = 'anthropic';

export interface AnthropicVisionOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export class AnthropicVisionPort implements VisionPort {
  public readonly name = PROVIDER;

  private readonly client: Anthropic;
  private readonly model: string;

  public constructor(options: AnthropicVisionOptions) {
    this.model = options.model ?? 'claude-opus-5';
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  public async extractModel(options: {
    readonly image: Uint8Array;
    readonly mediaType: string;
    readonly signal?: AbortSignal;
  }): Promise<{ proposal: BatchProposal; usage?: PortUsage }> {
    comprobarImagen(PROVIDER, options.mediaType);

    const inicio = Date.now();
    let response: Anthropic.Message;

    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 8192,
          system: SISTEMA_VISION,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: options.mediaType as 'image/jpeg',
                    data: Buffer.from(options.image).toString('base64'),
                  },
                },
                {
                  type: 'text',
                  text: 'Transcribe este diagrama de clases a operaciones.',
                },
              ],
            },
          ],
          thinking: { type: 'adaptive' },
          output_config: {
            // Leer un pizarron torcido y a mano cuesta mas que interpretar una
            // frase escrita: aqui el esfuerzo alto se paga.
            effort: 'high',
            format: { type: 'json_schema', schema: PROPOSAL_JSON_SCHEMA, name: 'candidato' },
          },
        } as Anthropic.MessageCreateParamsNonStreaming,
        options.signal === undefined ? undefined : { signal: options.signal },
      );
    } catch (error) {
      throw anthropicFailure(error);
    }

    requireCompleteResponse(PROVIDER, response.stop_reason, 'end_turn');
    const bruto = response.content
      .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === 'text')
      .map((bloque) => bloque.text)
      .join('\n')
      .trim();

    return {
      // Tolerante: importar produce un candidato editable, asi que una
      // operacion mal formada se descarta con aviso en vez de costar la
      // lectura entera del diagrama.
      proposal: interpretarPropuesta(PROVIDER, bruto, { tolerante: true }),
      usage: {
        provider: PROVIDER,
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - inicio,
      },
    };
  }
}
