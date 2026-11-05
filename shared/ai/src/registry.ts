import { answerFromModel } from './local-answer.js';
import { z } from 'zod';
import { AnthropicLlmPort } from './adapters/anthropic.js';
import { AnthropicVisionPort } from './adapters/anthropic-vision.js';
import { CloudflareSpeechPort } from './adapters/cloudflare.js';
import { GeminiLlmPort, GeminiVisionPort } from './adapters/gemini.js';
import { GroqSpeechPort } from './adapters/groq.js';
import { MockLlmPort, MockSpeechPort, MockVisionPort } from './adapters/mock.js';
import { OpenRouterLlmPort, OpenRouterVisionPort } from './adapters/openrouter.js';
import { type LlmPort, type PortUsage, type SpeechPort, type VisionPort } from './ports.js';
import { FallbackChain, type ChainEntry } from './fallback-chain.js';
import { createModelCapabilities, DEFAULT_MODEL_CONTEXT_WINDOW } from './model-capabilities.js';
/** Configuracion independiente por capacidad, con principal y hasta siete respaldos. */
export const PROVIDERS = [
  'mock',
  'anthropic',
  'gemini',
  'openrouter',
  'groq',
  'cloudflare',
  'mistral',
  'zai',
  'moonshot',
  'sambanova',
  'nvidia',
  'cohere',
] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/**
 * Que proveedor sabe atender cada puerto
 * Cloudflare sirve las tres cosas: Whisper para la voz y, por su capa
 * compatible con OpenAI, modelos de texto e imagen como gpt-oss-120b
 * y Llama 4 Scout, con las mismas dos credenciales que ya tenia la voz
 */
export const LLM_PROVIDERS = [
  'mock',
  'anthropic',
  'gemini',
  'openrouter',
  'groq',
  'cloudflare',
  'mistral',
  'zai',
  'moonshot',
  'sambanova',
  'nvidia',
  'cohere',
] as const;
export const VISION_PROVIDERS = [
  'mock',
  'anthropic',
  'gemini',
  'openrouter',
  'groq',
  'cloudflare',
  'mistral',
  'zai',
  'moonshot',
  'sambanova',
  'nvidia',
  'cohere',
] as const;
export const SPEECH_PROVIDERS = ['mock', 'groq', 'cloudflare', 'mistral'] as const;

/** Los tres puertos, para recorrerlos sin repetir el mismo bloque tres veces. */
const PUERTOS = [
  {
    nombre: 'texto',
    provider: 'AI_LLM_PROVIDER',
    model: 'AI_LLM_MODEL',
    fallbackProvider: 'AI_LLM_FALLBACK_PROVIDER',
    fallbackModel: 'AI_LLM_FALLBACK_MODEL',
    fallbacks: 'AI_LLM_FALLBACKS',
    supported: LLM_PROVIDERS,
  },
  {
    nombre: 'imagen',
    provider: 'AI_VISION_PROVIDER',
    model: 'AI_VISION_MODEL',
    fallbackProvider: 'AI_VISION_FALLBACK_PROVIDER',
    fallbackModel: 'AI_VISION_FALLBACK_MODEL',
    fallbacks: 'AI_VISION_FALLBACKS',
    supported: VISION_PROVIDERS,
  },
  {
    nombre: 'voz',
    provider: 'AI_SPEECH_PROVIDER',
    model: 'AI_SPEECH_MODEL',
    fallbackProvider: 'AI_SPEECH_FALLBACK_PROVIDER',
    fallbackModel: 'AI_SPEECH_FALLBACK_MODEL',
    fallbacks: 'AI_SPEECH_FALLBACKS',
    supported: SPEECH_PROVIDERS,
  },
] as const;

const fallbackEntry = z
  .object({
    provider: z.enum(PROVIDERS),
    model: z.string().trim().min(1).optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
const fallbacks = z
  .string()
  .optional()
  .transform((value, ctx): unknown => {
    if (value === undefined) return [];
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Usa un array JSON valido de respaldos.',
      });
      return z.NEVER;
    }
  })
  .pipe(z.array(fallbackEntry).max(7));
const endpoint = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }, 'La URL debe ser HTTPS sin credenciales, query ni fragmento.')
  .optional();
const COMPATIBLE = [
  'openrouter',
  'groq',
  'cloudflare',
  'mistral',
  'zai',
  'moonshot',
  'sambanova',
  'nvidia',
  'cohere',
];

const schema = z
  .object({
    // --- Texto: interpreta instrucciones y responde consultas ---------------
    AI_LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('mock'),
    AI_LLM_MODEL: z.string().trim().optional(),
    AI_LLM_FALLBACK_PROVIDER: z.enum(LLM_PROVIDERS).optional(),
    AI_LLM_FALLBACK_MODEL: z.string().trim().optional(),

    // --- Imagen: lee la fotografia del pizarron -----------------------------
    AI_VISION_PROVIDER: z.enum(VISION_PROVIDERS).default('mock'),
    AI_VISION_MODEL: z.string().trim().optional(),
    AI_VISION_FALLBACK_PROVIDER: z.enum(VISION_PROVIDERS).optional(),
    AI_VISION_FALLBACK_MODEL: z.string().trim().optional(),

    // --- Voz: respaldo del reconocimiento del navegador ---------------------
    AI_SPEECH_PROVIDER: z.enum(SPEECH_PROVIDERS).default('mock'),
    AI_SPEECH_MODEL: z.string().trim().optional(),
    AI_SPEECH_FALLBACK_PROVIDER: z.enum(SPEECH_PROVIDERS).optional(),
    AI_SPEECH_FALLBACK_MODEL: z.string().trim().optional(),

    AI_LLM_FALLBACKS: fallbacks,
    AI_VISION_FALLBACKS: fallbacks,
    AI_SPEECH_FALLBACKS: fallbacks,
    AI_CHAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
    AI_VISION_CHAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
    AI_SPEECH_CHAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
    AI_QUOTA_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(60000),
    AI_COMPATIBLE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(32768).default(16384),
    MISTRAL_API_KEY: z.string().trim().optional(),
    ZAI_API_KEY: z.string().trim().optional(),
    MOONSHOT_API_KEY: z.string().trim().optional(),
    SAMBANOVA_API_KEY: z.string().trim().optional(),
    NVIDIA_API_KEY: z.string().trim().optional(),
    COHERE_API_KEY: z.string().trim().optional(),
    MISTRAL_BASE_URL: endpoint,
    ZAI_BASE_URL: endpoint,
    MOONSHOT_BASE_URL: endpoint,
    SAMBANOVA_BASE_URL: endpoint,
    GROQ_BASE_URL: endpoint,
    NVIDIA_BASE_URL: endpoint,
    COHERE_BASE_URL: endpoint,

    // --- Credenciales, una por proveedor ------------------------------------
    ANTHROPIC_API_KEY: z.string().trim().optional(),
    GEMINI_API_KEY: z.string().trim().optional(),
    OPENROUTER_API_KEY: z.string().trim().optional(),
    GROQ_API_KEY: z.string().trim().optional(),
    CLOUDFLARE_ACCOUNT_ID: z.string().trim().optional(),
    CLOUDFLARE_API_TOKEN: z.string().trim().optional(),

    // --- Politica comun ------------------------------------------------------
    /**
     * Tiempo maximo por intento
     * Corto a proposito. Lo que salva una llamada durante la defensa es cambiar
     * de proveedor pronto, no esperar mas al que no contesta
     */
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    /**
     * Leer un pizarron cuesta mas que interpretar una frase, asi que la vision
     * tiene su propio limite. Sin el, bajar `AI_TIMEOUT_MS` para que el
     * asistente reaccione rapido rompia la importacion por fotografia
     */
    AI_VISION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    AI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(1),
    /**
     * Registro de uso por llamada: proveedor, modelo, tokens y latencia.
     * Nunca incluye la clave ni el contenido de la pizarra.
     */
    AI_LOG_USAGE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((valor) => valor === 'true'),
  })
  .superRefine((config, ctx) => {
    for (const puerto of PUERTOS) {
      const primario = config[puerto.provider];
      const respaldo = config[puerto.fallbackProvider];
      if (respaldo === undefined) continue;

      // Un respaldo identico al primario no es un respaldo: si el primario no
      // responde, este tampoco. Se rechaza en lugar de ignorarlo porque el
      // sintoma de ignorarlo es creer que hay red de seguridad y no tenerla
      if (respaldo === primario && config[puerto.fallbackModel] === config[puerto.model]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [puerto.fallbackProvider],
          message:
            `${puerto.fallbackProvider} es identico al primario (${primario}). ` +
            'Un respaldo tiene que ser otro proveedor, u otro modelo del mismo.',
        });
      }
    }

    for (const port of PUERTOS) {
      const entries = [
        { provider: config[port.provider], model: config[port.model] },
        ...(config[port.fallbackProvider]
          ? [{ provider: config[port.fallbackProvider]!, model: config[port.fallbackModel] }]
          : []),
        ...config[port.fallbacks].filter((entry) => entry.enabled),
      ];
      const issue = (message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [port.fallbacks], message });
      if (config[port.fallbacks].length + (config[port.fallbackProvider] ? 1 : 0) > 7)
        issue('Maximo siete respaldos, incluyendo FALLBACK_PROVIDER.');
      const seen = new Set<string>();
      for (const entry of entries) {
        if (!(port.supported as readonly string[]).includes(entry.provider))
          issue(`${entry.provider} no admite ${port.nombre}.`);
        const key = `${entry.provider}/${entry.model ?? ''}`;
        if (seen.has(key)) issue(`Respaldo duplicado: ${key}.`);
        seen.add(key);
        // Los adaptadores de voz ya saben a que modelo de Whisper o Voxtral
        // llamar. En texto e imagen cada proveedor sirve muchos y hay que
        // nombrarlo: ninguno es el evidente
        const necesitaModelo = COMPATIBLE.includes(entry.provider) && port.nombre !== 'voz';
        if (necesitaModelo && !entry.model)
          issue(
            `${entry.provider} necesita AI_${port.nombre === 'texto' ? 'LLM' : port.nombre === 'imagen' ? 'VISION' : 'SPEECH'}_MODEL o model en el respaldo.`,
          );
        if (
          port.nombre === 'imagen' &&
          entry.provider === 'zai' &&
          entry.model &&
          !/^glm-(?:4\.[56]v|5v|ocr)/i.test(entry.model)
        )
          issue('Z.AI vision requiere un modelo visual: glm-4.6v-flash, no glm-4.7-flash.');
        if (
          port.nombre === 'voz' &&
          entry.provider === 'mistral' &&
          entry.model &&
          !/^voxtral-mini-(?:latest|transcribe)/.test(entry.model)
        )
          issue('Mistral voz requiere un modelo de transcripcion Voxtral Mini.');
      }
    }

    // OpenRouter enruta a cientos de modelos y ninguno es el evidente: sin
    // modelo declarado no se puede elegir por el
    for (const [variable, proveedor, modelo] of [
      ['AI_LLM_MODEL', config.AI_LLM_PROVIDER, config.AI_LLM_MODEL],
      ['AI_LLM_FALLBACK_MODEL', config.AI_LLM_FALLBACK_PROVIDER, config.AI_LLM_FALLBACK_MODEL],
      ['AI_VISION_MODEL', config.AI_VISION_PROVIDER, config.AI_VISION_MODEL],
      [
        'AI_VISION_FALLBACK_MODEL',
        config.AI_VISION_FALLBACK_PROVIDER,
        config.AI_VISION_FALLBACK_MODEL,
      ],
    ] as const) {
      if (proveedor === 'openrouter' && (modelo === undefined || modelo.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [variable],
          message: `openrouter necesita ${variable}: por ejemplo anthropic/claude-sonnet-4.5.`,
        });
      }
    }
  });

export type AiConfig = z.infer<typeof schema>;

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const parsed = schema.safeParse(sinVacios(env));
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida de la capa de IA:\n${detalle}`);
  }
  return parsed.data;
}

/**
 * Una variable vacia es una variable sin poner
 * No es cosmetico: Docker Compose entrega `AI_LLM_FALLBACK_PROVIDER=` cuando
 * la plantilla la reenvia y el `.env` no la define, y un `.env` real tiene media
 * docena de lineas `VARIABLE=` esperando a que alguien las rellene. Sin esto,
 * la cadena vacia no es ninguno de los proveedores validos y el proceso no
 * arranca  por una variable que nadie llego a configurar
 */
function sinVacios(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([, valor]) => valor !== undefined && valor.trim().length > 0),
  );
}

export interface AiPorts {
  readonly llm: LlmPort;
  readonly vision: VisionPort;
  readonly speech: SpeechPort;
  /** Lo que se ha gastado, para diagnosticar */
  readonly usageLog: readonly PortUsage[];
}

/**
 * Plazo minimo para leer una fotografia cuando no se fija uno explicito
 * Medido, no elegido: transcribir un diagrama de catorce clases tarda minutos en
 * el modelo gratuito de respaldo y bastante mas de un minuto en el primario. Con
 * el triple de `AI_TIMEOUT_MS` cuarenta y cinco segundos la lectura se abortaba
 * a mitad de camino, y el respaldo no llegaba a contestar nunca: existia en la
 * configuracion y no servia para nada.
 */
const PISO_VISION = 120_000;

function definitions(config: AiConfig, port: (typeof PUERTOS)[number]) {
  return [
    { provider: config[port.provider], model: config[port.model] },
    ...(config[port.fallbackProvider]
      ? [{ provider: config[port.fallbackProvider]!, model: config[port.fallbackModel] }]
      : []),
    ...config[port.fallbacks].filter((entry) => entry.enabled),
  ];
}

export function createAiPorts(
  config: AiConfig = loadAiConfig(),
  limits: { readonly contextWindow: number } = { contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW },
): AiPorts {
  const usageLog: PortUsage[] = [];
  const chain = new FallbackChain(usageLog, config.AI_LOG_USAGE, config.AI_QUOTA_COOLDOWN_MS);
  const visionTimeout =
    config.AI_VISION_TIMEOUT_MS ?? Math.max(config.AI_TIMEOUT_MS * 3, PISO_VISION);
  const llmDefinitions = definitions(config, PUERTOS[0]);
  const capabilities = createModelCapabilities({
    contextWindow: limits.contextWindow,
    timeoutMs: config.AI_CHAIN_TIMEOUT_MS,
    jsonMode: llmDefinitions.every((entry) => usesJsonMode(entry.provider)),
  });
  const llm: ChainEntry<LlmPort>[] = llmDefinitions.map((e) => ({
    key: etiqueta(e.provider, e.model),
    port: construirLlm(config, e.provider as AiConfig['AI_LLM_PROVIDER'], e.model),
  }));
  const vision: ChainEntry<VisionPort>[] = definitions(config, PUERTOS[1]).map((e) => ({
    key: etiqueta(e.provider, e.model),
    port: construirVision(
      config,
      e.provider as AiConfig['AI_VISION_PROVIDER'],
      e.model,
      visionTimeout,
    ),
  }));
  const speech: ChainEntry<SpeechPort>[] = definitions(config, PUERTOS[2]).map((e) => ({
    key: etiqueta(e.provider, e.model),
    port: construirSpeech(config, e.provider as AiConfig['AI_SPEECH_PROVIDER'], e.model),
  }));
  return {
    llm: {
      name: llm.map((e) => e.port.name).join('→'),
      capabilities,
      proposeCommands: (options) =>
        chain.run(
          llm,
          (port, signal) => port.proposeCommands({ ...options, signal }),
          capabilities.timeoutMs,
          options.signal,
        ),
      answer: (options) => {
        options.signal?.throwIfAborted();
        // Las reglas locales no conocen autores/hilos: no deben consumir una consulta colectiva.
        const local =
          options.team || options.teaching
            ? undefined
            : answerFromModel(options.question, options.snapshot);
        if (local !== undefined) return Promise.resolve({ text: local });
        return chain.run(
          llm,
          (port, signal) => port.answer({ ...options, signal }),
          capabilities.timeoutMs,
          options.signal,
        );
      },
    },
    vision: {
      name: vision.map((e) => e.port.name).join('→'),
      extractModel: (options) =>
        chain.run(
          vision,
          (port, signal) => port.extractModel({ ...options, signal }),
          config.AI_VISION_CHAIN_TIMEOUT_MS,
          options.signal,
        ),
    },
    speech: {
      name: speech.map((e) => e.port.name).join('→'),
      transcribe: (options) =>
        chain.run(
          speech,
          (port, signal) => port.transcribe({ ...options, signal }),
          config.AI_SPEECH_CHAIN_TIMEOUT_MS,
          options.signal,
        ),
    },
    usageLog,
  };
}

/** Solo nombres y modelos: nunca claves ni contenido del usuario. */
export function describeAiChains(config: AiConfig): string {
  return PUERTOS.map(
    (port) =>
      `${port.nombre}: ${definitions(config, port)
        .map((e) => etiqueta(e.provider, e.model))
        .join(' → ')}`,
  ).join(' | ');
}

function etiqueta(provider: ProviderName, model?: string): string {
  return model === undefined || model.length === 0 ? provider : `${provider}/${model}`;
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/**
 * Devuelve la credencial del proveedor o falla diciendo que variable falta
 * Se comprueba al construir los puertos, no en la primera peticion
 */
function credencial(config: AiConfig, provider: ProviderName, variable: string): string {
  const claves: Partial<Record<ProviderName, string | undefined>> = {
    mistral: config.MISTRAL_API_KEY,
    zai: config.ZAI_API_KEY,
    moonshot: config.MOONSHOT_API_KEY,
    sambanova: config.SAMBANOVA_API_KEY,
    nvidia: config.NVIDIA_API_KEY,
    cohere: config.COHERE_API_KEY,
    anthropic: config.ANTHROPIC_API_KEY,
    gemini: config.GEMINI_API_KEY,
    openrouter: config.OPENROUTER_API_KEY,
    groq: config.GROQ_API_KEY,
    cloudflare: config.CLOUDFLARE_API_TOKEN,
  };

  const nombreVariable =
    provider === 'cloudflare' ? 'CLOUDFLARE_API_TOKEN' : `${provider.toUpperCase()}_API_KEY`;
  const valor = claves[provider];

  if (valor === undefined || valor.length === 0) {
    throw new Error(
      `El proveedor ${provider} necesita ${nombreVariable}. ` +
        `Deja ${variable}=mock si todavia no tienes clave.`,
    );
  }
  return valor;
}

// ---------------------------------------------------------------------------
// Construccion de cada puerto
// ---------------------------------------------------------------------------

function construirLlm(
  config: AiConfig,
  provider: (typeof LLM_PROVIDERS)[number],
  model: string | undefined,
): LlmPort {
  const comun = {
    ...(model === undefined || model.length === 0 ? {} : { model }),
    timeoutMs: config.AI_TIMEOUT_MS,
    maxRetries: config.AI_MAX_RETRIES,
  };

  switch (provider) {
    case 'mock':
      return new MockLlmPort();
    case 'anthropic':
      return new AnthropicLlmPort({
        apiKey: credencial(config, 'anthropic', 'AI_LLM_PROVIDER'),
        ...comun,
      });
    case 'gemini':
      return new GeminiLlmPort({
        apiKey: credencial(config, 'gemini', 'AI_LLM_PROVIDER'),
        ...comun,
      });
    case 'groq':
    case 'cloudflare':
    case 'mistral':
    case 'zai':
    case 'moonshot':
    case 'sambanova':
    case 'nvidia':
    case 'cohere':
      return new OpenRouterLlmPort(
        compatibleOptions(config, provider, model as string, config.AI_TIMEOUT_MS),
      );
    case 'openrouter':
      return new OpenRouterLlmPort({
        apiKey: credencial(config, 'openrouter', 'AI_LLM_PROVIDER'),
        maxOutputTokens: config.AI_COMPATIBLE_MAX_OUTPUT_TOKENS,
        // El esquema ya garantiza que hay modelo cuando el proveedor es este.
        model: model as string,
        timeoutMs: config.AI_TIMEOUT_MS,
        maxRetries: config.AI_MAX_RETRIES,
      });
  }
}

function construirVision(
  config: AiConfig,
  provider: (typeof VISION_PROVIDERS)[number],
  model: string | undefined,
  timeoutMs: number,
): VisionPort {
  const comun = {
    ...(model === undefined || model.length === 0 ? {} : { model }),
    timeoutMs,
    maxRetries: config.AI_MAX_RETRIES,
  };

  switch (provider) {
    case 'mock':
      return new MockVisionPort();
    case 'anthropic':
      return new AnthropicVisionPort({
        apiKey: credencial(config, 'anthropic', 'AI_VISION_PROVIDER'),
        ...comun,
      });
    case 'gemini':
      return new GeminiVisionPort({
        apiKey: credencial(config, 'gemini', 'AI_VISION_PROVIDER'),
        ...comun,
      });
    case 'groq':
    case 'cloudflare':
    case 'mistral':
    case 'zai':
    case 'moonshot':
    case 'sambanova':
    case 'nvidia':
    case 'cohere':
      return new OpenRouterVisionPort(
        compatibleOptions(config, provider, model as string, timeoutMs),
      );
    case 'openrouter':
      return new OpenRouterVisionPort({
        apiKey: credencial(config, 'openrouter', 'AI_VISION_PROVIDER'),
        maxOutputTokens: config.AI_COMPATIBLE_MAX_OUTPUT_TOKENS,
        model: model as string,
        timeoutMs,
        maxRetries: config.AI_MAX_RETRIES,
      });
  }
}

function construirSpeech(
  config: AiConfig,
  provider: (typeof SPEECH_PROVIDERS)[number],
  model: string | undefined,
): SpeechPort {
  const comun = {
    ...(model === undefined || model.length === 0 ? {} : { model }),
    timeoutMs: config.AI_TIMEOUT_MS,
    maxRetries: config.AI_MAX_RETRIES,
  };

  switch (provider) {
    case 'mock':
      return new MockSpeechPort();
    case 'mistral':
      return new GroqSpeechPort({
        ...comun,
        provider: 'mistral',
        model: model ?? 'voxtral-mini-latest',
        apiKey: credencial(config, 'mistral', 'AI_SPEECH_PROVIDER'),
        baseUrl: config.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1',
      });
    case 'groq':
      return new GroqSpeechPort({
        apiKey: credencial(config, 'groq', 'AI_SPEECH_PROVIDER'),
        ...comun,
      });
    case 'cloudflare': {
      const accountId = config.CLOUDFLARE_ACCOUNT_ID;
      if (accountId === undefined || accountId.length === 0) {
        // Cloudflare necesita dos valores y falta el que va en la ruta
        throw new Error(
          'El proveedor cloudflare necesita CLOUDFLARE_ACCOUNT_ID ademas de ' +
            'CLOUDFLARE_API_TOKEN. Deja AI_SPEECH_PROVIDER=mock si todavia no lo tienes.',
        );
      }
      return new CloudflareSpeechPort({
        accountId,
        apiToken: credencial(config, 'cloudflare', 'AI_SPEECH_PROVIDER'),
        ...comun,
      });
    }
  }
}

/** Endpoints de API general: no endpoints de planes exclusivos de coding. */
function compatibleOptions(
  config: AiConfig,
  provider:
    'groq' | 'cloudflare' | 'mistral' | 'zai' | 'moonshot' | 'sambanova' | 'nvidia' | 'cohere',
  model: string,
  timeoutMs: number,
) {
  if (
    provider === 'cloudflare' &&
    (config.CLOUDFLARE_ACCOUNT_ID === undefined || config.CLOUDFLARE_ACCOUNT_ID.length === 0)
  ) {
    // Igual que en la voz: la cuenta va en la ruta y sin ella el sintoma
    // seria un 404 del proveedor.
    throw new Error(
      'El proveedor cloudflare necesita CLOUDFLARE_ACCOUNT_ID ademas de ' +
        'CLOUDFLARE_API_TOKEN. Deja AI_*_PROVIDER=mock si todavia no lo tienes.',
    );
  }
  const urls = {
    mistral: config.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1',
    zai: config.ZAI_BASE_URL ?? 'https://api.z.ai/api/paas/v4',
    moonshot: config.MOONSHOT_BASE_URL ?? 'https://api.moonshot.ai/v1',
    sambanova: config.SAMBANOVA_BASE_URL ?? 'https://api.sambanova.ai/v1',
    // Groq sirve texto y vision por su capa compatible con OpenAI; la voz va
    // por su propio adaptador, que no pasa por aqui.
    groq: config.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    // Workers AI por su capa compatible con OpenAI. Cuota gratuita diaria.
    cloudflare:
      'https://api.cloudflare.com/client/v4/accounts/' +
      encodeURIComponent(config.CLOUDFLARE_ACCOUNT_ID ?? '') +
      '/ai/v1',
    nvidia: config.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    cohere: config.COHERE_BASE_URL ?? 'https://api.cohere.ai/compatibility/v1',
  };
  return {
    provider,
    model,
    timeoutMs,
    maxRetries: config.AI_MAX_RETRIES,
    // Command A and Command A Vision reject requests above 8192 even when
    // the actual answer would be short. Keep the global budget for other models.
    maxOutputTokens:
      provider === 'cohere' && ['command-a-03-2025', 'command-a-vision-07-2025'].includes(model)
        ? Math.min(config.AI_COMPATIBLE_MAX_OUTPUT_TOKENS, 8192)
        : provider === 'nvidia' && model === 'google/gemma-4-31b-it'
          ? Math.min(config.AI_COMPATIBLE_MAX_OUTPUT_TOKENS, 4096)
          : config.AI_COMPATIBLE_MAX_OUTPUT_TOKENS,
    apiKey: credencial(config, provider, 'AI_*_PROVIDER'),
    baseUrl: urls[provider].replace(/\/$/, ''),
    // El prompt sigue exigiendo JSON y el resultado siempre se valida. NVIDIA
    // no garantiza `response_format` en todos sus modelos: alli se confia en
    // el esquema del prompt y en la validacion de la respuesta.
    jsonMode: usesJsonMode(provider),
    // El razonamiento extendido de Gemma supera el plazo del respaldo interactivo.
    ...(provider === 'nvidia' && model === 'google/gemma-4-31b-it'
      ? { chatTemplateThinking: false }
      : {}),
    ...(provider === 'moonshot' && model.startsWith('kimi-k3')
      ? { reasoningEffort: 'low' as const }
      : provider === 'zai' || provider === 'moonshot'
        ? { thinking: false }
        : {}),
  };
}

/** Política de los adaptadores actuales; también alimenta el descriptor de la cadena. */
function usesJsonMode(provider: ProviderName): boolean {
  return provider !== 'nvidia';
}
