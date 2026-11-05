import type { SemanticModel } from '@uml/contracts';
import type { BatchProposal } from './proposal.js';
import type { TeamContext } from './team-context.js';
import type { ModelCapabilities } from './model-capabilities.js';

/** Un turno previo que completa una instruccion todavia no resuelta */
export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/**
 * Los tres puertos de la capa de IA
 * Ningun modulo del dominio conoce un proveedor concreto
 * Cada proveedor es un adaptador intercambiable por configuracion
 */

export interface ProposeOptions {
  /** Instruccion del usuario, como la escribio o la dicto. */
  readonly instruction: string;
  /** Estado actual de la pizarra. El modelo lo ve; nunca lo modifica. */
  readonly snapshot: SemanticModel;
  /**
   * se vacia cuando ya existe una propuesta o cuando la persona lo descarta
   */
  readonly context?: readonly ConversationTurn[];
  readonly team?: TeamContext;
  readonly signal?: AbortSignal;
}

export interface AnswerOptions {
  /** Política confiable del proyecto, separada del historial y del texto del usuario. */
  readonly teaching?: TeachingPolicy;
  readonly team?: TeamContext;
  readonly question: string;
  readonly snapshot: SemanticModel;
  /** Hallazgos del validador, para que pueda señalar problemas */
  readonly issues?: readonly AnswerIssue[];
  readonly signal?: AbortSignal;
}

export interface TeachingPolicy {
  readonly solutionMode: 'HINTS_ONLY' | 'ON_REQUEST';
  readonly task: 'ASK' | 'REVIEW';
}

export interface AnswerIssue {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly elementIds?: readonly string[];
  readonly suggestion?: string | undefined;
}

export interface AnswerResult {
  readonly text: string;
  readonly usage?: PortUsage;
}

export interface ProposeResult {
  readonly proposal: BatchProposal;
  readonly usage?: PortUsage;
}

/** Registro de uso, para diagnosticar */
export interface PortUsage {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs: number;
}

export interface LlmPort {
  readonly name: string;
  /** Opcional para conservar adaptadores existentes; la pasarela siempre lo declara. */
  readonly capabilities?: ModelCapabilities;
  /**
   * Traduce una instruccion a una propuesta de operaciones
   * Devuelve nombres, no identificadores. Un identificador inventado
   * por el modelo seria imposible de detectar como error
   * y produciria un comando que apunta a nada
   */
  proposeCommands(options: ProposeOptions): Promise<ProposeResult>;

  /** Responde una consulta sobre la pizarra sin modificarla */
  answer(options: AnswerOptions): Promise<AnswerResult>;
}

export interface VisionPort {
  readonly name: string;
  /** Extrae un modelo candidato de una fotografia de diagrama */
  extractModel(options: {
    readonly image: Uint8Array;
    readonly mediaType: string;
    readonly signal?: AbortSignal;
  }): Promise<{ proposal: BatchProposal; usage?: PortUsage }>;
}

export interface SpeechPort {
  readonly name: string;
  /**
   * Transcribe audio
   */
  transcribe(options: {
    readonly audio: Uint8Array;
    readonly mediaType: string;
    readonly signal?: AbortSignal;
  }): Promise<{ text: string; usage?: PortUsage }>;
}

/** El proveedor no respondio a tiempo o fallo de forma recuperable */
export class ProviderUnavailableError extends Error {
  public constructor(
    public readonly provider: string,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number; quota?: boolean },
  ) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
    this.quota = options?.quota ?? false;
    this.retryAfterMs = options?.retryAfterMs;
  }
  public readonly quota: boolean;
  public readonly retryAfterMs: number | undefined;
}

/** El proveedor respondio algo que no cumple el contrato */
export class ProviderContractError extends Error {
  public constructor(
    public readonly provider: string,
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'ProviderContractError';
  }
}
