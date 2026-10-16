import {
  ProviderContractError,
  createAiPorts,
  describeAiChains,
  loadAiConfig,
  type AiConfig,
} from '@uml/ai';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Pasarela de IA: seleccion de proveedor, credenciales y cadena de respaldo
 * (6.3, 6.5, ADR-015 y ADR-019).
 *
 * Ninguna prueba llama a un proveedor real. Las que ejercen un adaptador HTTP
 * sustituyen `fetch` y comprueban **la peticion que se habria enviado**, que es
 * justo lo que no se puede verificar leyendo el codigo: si la clave va en la
 * cabecera correcta, si se pide JSON, si la imagen viaja como dato y no como
 * URL publica.
 */

const original = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

const PIZARRA_VACIA = { classes: [], relationships: [] };
const IMAGEN = new Uint8Array([137, 80, 78, 71]);
const AUDIO = new Uint8Array([1, 2, 3, 4]);

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

describe('seleccion de proveedor (6.3)', () => {
  it('por defecto usa el adaptador simulado en los tres puertos', () => {
    const puertos = createAiPorts(loadAiConfig({}));

    expect(puertos.llm.name).toBe('mock');
    expect(puertos.vision.name).toBe('mock');
    expect(puertos.speech.name).toBe('mock');
  });

  it('cada puerto se configura por separado', () => {
    const config = loadAiConfig({ AI_VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave' });

    expect(config.AI_LLM_PROVIDER).toBe('mock');
    expect(createAiPorts(config).vision.name).toBe('gemini');
  });

  it('rechaza un proveedor que no sabe atender ese puerto', () => {
    // Aceptar una combinacion imposible y caer al simulado en silencio haria
    // creer que se probo un proveedor que nunca fue llamado. La voz solo la
    // atienden groq, cloudflare y mistral.
    expect(() => loadAiConfig({ AI_SPEECH_PROVIDER: 'anthropic' })).toThrow(/AI_SPEECH_PROVIDER/);
    expect(() => loadAiConfig({ AI_SPEECH_PROVIDER: 'gemini' })).toThrow(/AI_SPEECH_PROVIDER/);
    expect(() => loadAiConfig({ AI_SPEECH_PROVIDER: 'nvidia' })).toThrow(/AI_SPEECH_PROVIDER/);
  });

  it('cloudflare tambien sirve texto e imagen, con las mismas dos credenciales', () => {
    // Workers AI por su capa compatible con OpenAI: la cuenta va en la ruta,
    // igual que en la voz, y como compatible exige modelo.
    const puertos = createAiPorts(
      loadAiConfig({
        AI_LLM_PROVIDER: 'cloudflare',
        AI_LLM_MODEL: '@cf/openai/gpt-oss-120b',
        AI_VISION_PROVIDER: 'cloudflare',
        AI_VISION_MODEL: '@cf/meta/llama-4-scout-17b-16e-instruct',
        CLOUDFLARE_ACCOUNT_ID: 'cuenta',
        CLOUDFLARE_API_TOKEN: 'testigo',
      }),
    );
    expect(puertos.llm.name).toBe('cloudflare');
    expect(puertos.vision.name).toBe('cloudflare');

    expect(() =>
      createAiPorts(
        loadAiConfig({
          AI_LLM_PROVIDER: 'cloudflare',
          AI_LLM_MODEL: '@cf/openai/gpt-oss-120b',
          CLOUDFLARE_API_TOKEN: 'testigo',
        }),
      ),
    ).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(() =>
      loadAiConfig({
        AI_LLM_PROVIDER: 'cloudflare',
        CLOUDFLARE_ACCOUNT_ID: 'cuenta',
        CLOUDFLARE_API_TOKEN: 'testigo',
      }),
    ).toThrow(/AI_LLM_MODEL/);
  });

  it('nvidia y cohere entran como compatibles con OpenAI y piden su clave', () => {
    expect(() =>
      createAiPorts(
        loadAiConfig({
          AI_LLM_PROVIDER: 'nvidia',
          AI_LLM_MODEL: 'meta/llama-4-scout-17b-16e-instruct',
        }),
      ),
    ).toThrow(/NVIDIA_API_KEY/);
    expect(() =>
      createAiPorts(
        loadAiConfig({ AI_VISION_PROVIDER: 'cohere', AI_VISION_MODEL: 'command-a-vision-07-2025' }),
      ),
    ).toThrow(/COHERE_API_KEY/);
    expect(
      createAiPorts(
        loadAiConfig({ AI_LLM_PROVIDER: 'nvidia', AI_LLM_MODEL: 'modelo', NVIDIA_API_KEY: 'k' }),
      ).llm.name,
    ).toBe('nvidia');
  });

  it('una clave por proveedor sirve a los dos puertos que lo usan', () => {
    // Antes habia una clave por puerto y la misma cadena se escribia dos veces.
    const puertos = createAiPorts(
      loadAiConfig({
        AI_LLM_PROVIDER: 'gemini',
        AI_VISION_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'una-sola-clave',
      }),
    );

    expect(puertos.llm.name).toBe('gemini');
    expect(puertos.vision.name).toBe('gemini');
  });

  it('falla al construir si falta la credencial, diciendo cual', () => {
    // Se descubre al arrancar y no en mitad de la demostracion.
    expect(() => createAiPorts(loadAiConfig({ AI_LLM_PROVIDER: 'gemini' }))).toThrow(
      /GEMINI_API_KEY/,
    );
    expect(() => createAiPorts(loadAiConfig({ AI_VISION_PROVIDER: 'anthropic' }))).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => createAiPorts(loadAiConfig({ AI_SPEECH_PROVIDER: 'groq' }))).toThrow(
      /GROQ_API_KEY/,
    );
  });

  it('cloudflare necesita las dos variables y lo dice por separado', () => {
    // El identificador de cuenta va en la ruta: sin el, el sintoma seria un 404.
    expect(() =>
      createAiPorts(
        loadAiConfig({ AI_SPEECH_PROVIDER: 'cloudflare', CLOUDFLARE_API_TOKEN: 'testigo' }),
      ),
    ).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it('openrouter exige modelo porque enruta a cientos', () => {
    expect(() =>
      loadAiConfig({ AI_LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'clave' }),
    ).toThrow(/AI_LLM_MODEL/);
  });

  it('rechaza un respaldo identico al primario', () => {
    // No es un respaldo: si el primario no responde, este tampoco.
    expect(() =>
      loadAiConfig({
        AI_LLM_PROVIDER: 'gemini',
        AI_LLM_FALLBACK_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'clave',
      }),
    ).toThrow(/AI_LLM_FALLBACK_PROVIDER/);
  });

  it('acepta el mismo proveedor con otro modelo como respaldo', () => {
    const config = loadAiConfig({
      AI_LLM_PROVIDER: 'gemini',
      AI_LLM_MODEL: 'gemini-2.5-flash',
      AI_LLM_FALLBACK_PROVIDER: 'gemini',
      AI_LLM_FALLBACK_MODEL: 'gemini-2.5-pro',
      GEMINI_API_KEY: 'clave',
    });

    expect(createAiPorts(config).llm.name).toBe('gemini→gemini');
  });

  it('describe la cadena activa sin filtrar secretos', () => {
    const config = loadAiConfig({
      AI_LLM_PROVIDER: 'gemini',
      AI_LLM_MODEL: 'gemini-2.5-flash',
      AI_LLM_FALLBACK_PROVIDER: 'openrouter',
      AI_LLM_FALLBACK_MODEL: 'anthropic/claude-sonnet-4.5',
      AI_SPEECH_PROVIDER: 'groq',
      GEMINI_API_KEY: 'clave-secreta',
      OPENROUTER_API_KEY: 'otra-secreta',
      GROQ_API_KEY: 'tercera-secreta',
    });

    const descripcion = describeAiChains(config);

    expect(descripcion).toContain('texto: gemini/gemini-2.5-flash → openrouter/anthropic');
    expect(descripcion).toContain('voz: groq');
    // Lo que se registra al arrancar no puede llevar ninguna clave.
    expect(descripcion).not.toContain('secreta');
  });
});

// ---------------------------------------------------------------------------
// Cadena de respaldo
// ---------------------------------------------------------------------------

describe('cadena de respaldo (6.5)', () => {
  const CON_RESPALDO = {
    AI_LLM_PROVIDER: 'gemini',
    AI_LLM_FALLBACK_PROVIDER: 'openrouter',
    AI_LLM_FALLBACK_MODEL: 'anthropic/claude-sonnet-4.5',
    GEMINI_API_KEY: 'clave-gemini',
    OPENROUTER_API_KEY: 'clave-openrouter',
    AI_MAX_RETRIES: '0',
  };

  it('cae al respaldo cuando el primario no responde', async () => {
    const llamadas = interceptar([
      { estado: 503, cuerpo: { error: 'no disponible' } },
      {
        estado: 200,
        cuerpo: respuestaOpenRouter('{"operations":[{"op":"CREATE_CLASS","className":"Cliente"}]}'),
      },
    ]);

    const puertos = createAiPorts(loadAiConfig(CON_RESPALDO));
    const resultado = await puertos.llm.proposeCommands({
      instruction: 'crea Cliente',
      snapshot: PIZARRA_VACIA,
    });

    expect(resultado.proposal.operations).toHaveLength(1);
    expect(llamadas()).toHaveLength(2);
    expect(llamadas()[0]?.url).toContain('generativelanguage.googleapis.com');
    expect(llamadas()[1]?.url).toContain('openrouter.ai');
    // El registro anota de donde salio la respuesta: es lo que permite decir en
    // la defensa que el primario fallo y el sistema siguio.
    expect(puertos.usageLog.at(-1)?.provider).toBe('openrouter');
  });

  it('no cae al respaldo si el primario rechazo la credencial', async () => {
    // Es configuracion, no una caida. Disimularla cambiando de proveedor
    // significa no enterarse nunca de que la clave esta mal.
    const llamadas = interceptar([{ estado: 401, cuerpo: { error: 'clave invalida' } }]);

    const puertos = createAiPorts(loadAiConfig(CON_RESPALDO));

    await expect(
      puertos.llm.proposeCommands({ instruction: 'crea Cliente', snapshot: PIZARRA_VACIA }),
    ).rejects.toBeInstanceOf(ProviderContractError);
    expect(llamadas()).toHaveLength(1);
  });

  it('sin respaldo configurado, el fallo del primario se propaga', async () => {
    interceptar([{ estado: 503, cuerpo: {} }]);

    const puertos = createAiPorts(
      loadAiConfig({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave', AI_MAX_RETRIES: '0' }),
    );

    await expect(
      puertos.llm.proposeCommands({ instruction: 'crea Cliente', snapshot: PIZARRA_VACIA }),
    ).rejects.toThrow(/gemini/);
  });

  it('reintenta el mismo proveedor antes de cambiar', async () => {
    const llamadas = interceptar([
      { estado: 500, cuerpo: {} },
      { estado: 200, cuerpo: respuestaGemini('{"operations":[]}') },
    ]);

    const puertos = createAiPorts(loadAiConfig({ ...CON_RESPALDO, AI_MAX_RETRIES: '1' }));
    await puertos.llm.proposeCommands({ instruction: 'hola', snapshot: PIZARRA_VACIA });

    // Las dos llamadas fueron a Gemini: el respaldo es lo ultimo, no lo primero.
    expect(llamadas()).toHaveLength(2);
    expect(llamadas()[1]?.url).toContain('generativelanguage.googleapis.com');
  });

  it('el registro de uso se puede apagar', async () => {
    interceptar([{ estado: 200, cuerpo: respuestaGemini('{"operations":[]}') }]);

    const puertos = createAiPorts(
      loadAiConfig({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave', AI_LOG_USAGE: 'false' }),
    );
    await puertos.llm.proposeCommands({ instruction: 'hola', snapshot: PIZARRA_VACIA });

    expect(puertos.usageLog).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lo que cada adaptador envia
// ---------------------------------------------------------------------------

describe('peticiones de los adaptadores', () => {
  it('gemini manda la clave en la cabecera y pide JSON', async () => {
    const llamadas = interceptar([{ estado: 200, cuerpo: respuestaGemini('{"operations":[]}') }]);

    const puertos = createAiPorts(
      loadAiConfig({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave-secreta' }),
    );
    await puertos.llm.proposeCommands({ instruction: 'hola', snapshot: PIZARRA_VACIA });

    const peticion = llamadas()[0];
    // En la URL acabaria en el registro del proxy y en cualquier traza pegada
    // en un chat.
    expect(peticion?.url).not.toContain('clave-secreta');
    expect(peticion?.headers['x-goog-api-key']).toBe('clave-secreta');
    expect(peticion?.body.generationConfig.responseMimeType).toBe('application/json');
    expect(peticion?.body.systemInstruction.parts[0].text).toContain('CREATE_CLASS');
  });

  it('manda las aclaraciones acumuladas junto con la ultima instruccion', async () => {
    const llamadas = interceptar([{ estado: 200, cuerpo: respuestaGemini('{"operations":[]}') }]);
    const puertos = createAiPorts(
      loadAiConfig({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave' }),
    );

    await puertos.llm.proposeCommands({
      instruction: 'id es int y descripcion es string',
      context: [
        {
          role: 'user',
          text: 'crea Cliente y Producto con id y descripcion',
        },
        {
          role: 'assistant',
          text: '¿Que tipos tienen id y descripcion?',
        },
      ],
      snapshot: PIZARRA_VACIA,
    });

    const mensaje = llamadas()[0]?.body.contents[0].parts[0].text as string;
    expect(mensaje).toContain(
      JSON.stringify({ role: 'user', text: 'crea Cliente y Producto con id y descripcion' }),
    );
    expect(mensaje).toContain(
      JSON.stringify({ role: 'assistant', text: '¿Que tipos tienen id y descripcion?' }),
    );
    expect(mensaje).toContain('id es int y descripcion es string');
    expect(mensaje).toContain('Combina el contexto y esta aclaracion');
  });

  it('la vision manda la imagen como dato, no como enlace', async () => {
    const llamadas = interceptar([
      { estado: 200, cuerpo: respuestaOpenRouter('{"operations":[]}') },
    ]);

    const puertos = createAiPorts(
      loadAiConfig({
        AI_VISION_PROVIDER: 'openrouter',
        AI_VISION_MODEL: 'google/gemini-2.5-flash',
        OPENROUTER_API_KEY: 'clave',
      }),
    );
    await puertos.vision.extractModel({ image: IMAGEN, mediaType: 'image/png' });

    const contenido = llamadas()[0]?.body.messages[1].content;
    // La fotografia del pizarron no esta publicada en ningun sitio y no debe
    // estarlo solo para poder analizarla.
    expect(contenido[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('rechaza un formato de imagen no soportado antes de gastar una llamada', async () => {
    const llamadas = interceptar([]);

    const puertos = createAiPorts(
      loadAiConfig({ AI_VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave' }),
    );

    await expect(
      puertos.vision.extractModel({ image: IMAGEN, mediaType: 'image/tiff' }),
    ).rejects.toThrow(/no soportado/);
    expect(llamadas()).toHaveLength(0);
  });

  it('groq manda el audio como formulario, con idioma declarado', async () => {
    const llamadas = interceptar([{ estado: 200, cuerpo: { text: 'crea la clase Cliente' } }]);

    const puertos = createAiPorts(
      loadAiConfig({ AI_SPEECH_PROVIDER: 'groq', GROQ_API_KEY: 'clave' }),
    );
    const resultado = await puertos.speech.transcribe({
      audio: AUDIO,
      mediaType: 'audio/webm',
    });

    expect(resultado.text).toBe('crea la clase Cliente');

    const formulario = llamadas()[0]?.form;
    expect(formulario?.get('model')).toContain('whisper');
    // Quien dicta «crea la clase Cliente» habla espanol: una deteccion
    // equivocada en dos segundos devuelve texto que el asistente no entiende.
    expect(formulario?.get('language')).toBe('es');
    expect((formulario?.get('file') as File).name).toBe('dictado.webm');
  });

  it('cloudflare pone la cuenta en la ruta y el audio en base64', async () => {
    const llamadas = interceptar([
      { estado: 200, cuerpo: { success: true, result: { text: 'hola' } } },
    ]);

    const puertos = createAiPorts(
      loadAiConfig({
        AI_SPEECH_PROVIDER: 'cloudflare',
        CLOUDFLARE_ACCOUNT_ID: 'cuenta-123',
        CLOUDFLARE_API_TOKEN: 'testigo',
      }),
    );
    await puertos.speech.transcribe({ audio: AUDIO, mediaType: 'audio/webm' });

    expect(llamadas()[0]?.url).toContain('/accounts/cuenta-123/ai/run/@cf/');
    expect(llamadas()[0]?.body.audio).toBe(Buffer.from(AUDIO).toString('base64'));
  });

  it('un audio sin voz se dice, no se devuelve vacio', async () => {
    interceptar([{ estado: 200, cuerpo: { success: true, result: { text: '   ' } } }]);

    const puertos = createAiPorts(
      loadAiConfig({
        AI_SPEECH_PROVIDER: 'cloudflare',
        CLOUDFLARE_ACCOUNT_ID: 'cuenta',
        CLOUDFLARE_API_TOKEN: 'testigo',
      }),
    );

    await expect(
      puertos.speech.transcribe({ audio: AUDIO, mediaType: 'audio/webm' }),
    ).rejects.toThrow(/ninguna palabra/);
  });

  it('una respuesta que no cumple el contrato no se aplica', async () => {
    // El proveedor respondio, y lo que devolvio no es del vocabulario cerrado.
    interceptar([{ estado: 200, cuerpo: respuestaGemini('{"operations":[{"op":"FORMATEAR"}]}') }]);

    const puertos = createAiPorts(
      loadAiConfig({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave' }),
    );

    await expect(
      puertos.llm.proposeCommands({ instruction: 'formatea', snapshot: PIZARRA_VACIA }),
    ).rejects.toBeInstanceOf(ProviderContractError);
  });

  it('absorbe el bloque de codigo que el modelo pone de mas', async () => {
    // Se le pide que no lo haga y a veces lo hace: es la desviacion mas comun.
    interceptar([
      {
        estado: 200,
        cuerpo: respuestaGemini(
          '```json\n{"operations":[{"op":"CREATE_CLASS","className":"Cliente"}]}\n```',
        ),
      },
    ]);

    const puertos = createAiPorts(
      loadAiConfig({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'clave' }),
    );
    const resultado = await puertos.llm.proposeCommands({
      instruction: 'crea Cliente',
      snapshot: PIZARRA_VACIA,
    });

    expect(resultado.proposal.operations[0]).toMatchObject({ className: 'Cliente' });
  });
});

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

interface LlamadaRegistrada {
  readonly url: string;
  readonly headers: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly body: any;
  readonly form?: FormData;
}

/**
 * Sustituye `fetch` por una cola de respuestas y devuelve lo que se envio.
 *
 * Devuelve una funcion y no el arreglo para que las aserciones lean el estado
 * del momento y no una copia tomada antes de la llamada.
 */
function interceptar(
  respuestas: readonly { estado: number; cuerpo: unknown }[],
): () => readonly LlamadaRegistrada[] {
  const llamadas: LlamadaRegistrada[] = [];
  let indice = 0;

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const cuerpo = init?.body;
    llamadas.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof cuerpo === 'string' ? JSON.parse(cuerpo) : undefined,
      ...(cuerpo instanceof FormData ? { form: cuerpo } : {}),
    });

    const respuesta = respuestas[indice];
    indice += 1;
    if (respuesta === undefined) {
      throw new Error(`Llamada ${indice} sin respuesta preparada: ${String(url)}`);
    }

    return new Response(JSON.stringify(respuesta.cuerpo), {
      status: respuesta.estado,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return () => llamadas;
}

function respuestaGemini(texto: string): unknown {
  return {
    candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
  };
}

function respuestaOpenRouter(texto: string): unknown {
  return {
    choices: [{ message: { content: texto } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

// Comprobacion de tipos: la configuracion que devuelve el cargador es la que
// espera el constructor de puertos.
const _tipo: (config: AiConfig) => unknown = createAiPorts;
void _tipo;

describe('variables vacias', () => {
  it('trata una variable vacia como no puesta', () => {
    // Compose entrega `VARIABLE=""` cuando la reenvia y el .env no la define, y
    // un .env real tiene media docena de lineas esperando a que las rellenen.
    const config = loadAiConfig({
      AI_LLM_PROVIDER: 'mock',
      AI_LLM_MODEL: '',
      AI_LLM_FALLBACK_PROVIDER: '',
      AI_VISION_TIMEOUT_MS: '',
      GEMINI_API_KEY: '   ',
    });

    expect(config.AI_LLM_FALLBACK_PROVIDER).toBeUndefined();
    expect(config.AI_VISION_TIMEOUT_MS).toBeUndefined();
    expect(createAiPorts(config).llm.name).toBe('mock');
  });

  it('una clave en blanco no cuenta como clave', () => {
    expect(() =>
      createAiPorts(loadAiConfig({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '  ' })),
    ).toThrow(/GEMINI_API_KEY/);
  });
});

describe('el instructivo y el codigo no divergen', () => {
  /**
   * `infra/.env.example` es lo unico que la mayoria de la gente va a leer. Si
   * documenta una variable que el codigo no lee, o un ejemplo que el codigo
   * rechaza, el fallo aparece en la maquina de otro y con prisa.
   */
  const ejemplo = readFileSync(new URL('../../../infra/.env.example', import.meta.url), 'utf8');

  it('los valores por defecto del ejemplo son configuracion valida', () => {
    const config = loadAiConfig(variables(ejemplo, { comentadas: false }));

    expect(config.AI_LLM_PROVIDER).toBe('mock');
    expect(() => createAiPorts(config)).not.toThrow();
  });

  it('la cadena que el ejemplo propone se acepta tal cual', () => {
    // El bloque comentado del final: groq→gemini, gemini→mistral y groq→cloudflare.
    const config = loadAiConfig({
      ...variables(ejemplo, { comentadas: true }),
      GEMINI_API_KEY: 'clave',
      OPENROUTER_API_KEY: 'clave',
      GROQ_API_KEY: 'clave',
      MISTRAL_API_KEY: 'clave',
      CLOUDFLARE_ACCOUNT_ID: 'cuenta',
      CLOUDFLARE_API_TOKEN: 'testigo',
    });

    expect(describeAiChains(config)).toBe(
      'texto: groq/openai/gpt-oss-120b → gemini/gemini-3.5-flash-lite | ' +
        'imagen: gemini/gemini-3.5-flash → mistral/ministral-14b-latest | ' +
        'voz: groq/whisper-large-v3-turbo → cloudflare',
    );
    expect(() => createAiPorts(config)).not.toThrow();
  });
});

/** Lee las asignaciones del archivo; `comentadas` toma las del bloque de ejemplo. */
function variables(texto: string, opciones: { comentadas: boolean }): NodeJS.ProcessEnv {
  const entradas: NodeJS.ProcessEnv = {};

  for (const linea of texto.split(/\r?\n/)) {
    const limpia = opciones.comentadas ? linea.replace(/^#\s?/, '') : linea;
    if (opciones.comentadas ? !linea.startsWith('#') : linea.trimStart().startsWith('#')) continue;

    const corte = limpia.indexOf('=');
    if (corte <= 0) continue;

    const nombre = limpia.slice(0, corte).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(nombre)) continue;
    entradas[nombre] = limpia.slice(corte + 1).trim();
  }

  return entradas;
}
