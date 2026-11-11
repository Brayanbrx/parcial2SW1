import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  contextoDeAudio,
  createAiPorts,
  createTaskRouter,
  describeAiChains,
  loadAiConfig,
} from '@uml/ai';

afterEach(() => vi.unstubAllGlobals());
const snapshot = { classes: [], relationships: [] };
const local = {
  AI_LLM_PROVIDER: 'mock',
  AI_LOCAL_BASE_URL: 'http://host.docker.internal:11434/v1',
  AI_LOCAL_MODEL: 'gemma4:e4b',
  AI_LOG_USAGE: 'false',
};
const respuesta = (content: string) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('configuración del modelo local', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://host.docker.internal:11434/v1',
    'http://192.168.1.20:11434/v1',
    'https://ia.ejemplo.com/v1',
  ])('acepta %s fijada por el operador', (url) => {
    expect(() => loadAiConfig({ ...local, AI_LOCAL_BASE_URL: url })).not.toThrow();
  });

  it.each([
    'http://ia.ejemplo.com/v1',
    'http://8.8.8.8:11434/v1',
    'http://usuario:clave@localhost:11434/v1',
    'http://localhost:11434/v1?x=1',
    'ftp://localhost/v1',
  ])('rechaza %s', (url) => {
    expect(() => loadAiConfig({ ...local, AI_LOCAL_BASE_URL: url })).toThrow(/AI_LOCAL_BASE_URL/);
  });

  it('exige URL y modelo juntos y conserva un plazo separado para los proveedores', () => {
    expect(() => loadAiConfig({ AI_LOCAL_MODEL: 'gemma4:e4b' })).toThrow(/juntos/);
    expect(() => loadAiConfig({ AI_LOCAL_BASE_URL: 'http://localhost:11434/v1' })).toThrow(
      /juntos/,
    );
    const config = loadAiConfig(local);
    const ports = createAiPorts(config);
    expect(config.AI_LOCAL_TIMEOUT_MS).toBe(300_000);
    expect(ports.local?.capabilities?.timeoutMs).toBe(420_000);
    expect(ports.llm.capabilities?.timeoutMs).toBe(120_000);
    expect(() =>
      loadAiConfig({
        ...local,
        AI_LOCAL_CONTEXT_WINDOW: '8192',
        AI_LOCAL_MAX_OUTPUT_TOKENS: '4096',
      }),
    ).toThrow(/AI_LOCAL_MAX_OUTPUT_TOKENS/);
  });

  it('sin configuración no hay modelo local y la cadena de nube no cambia', () => {
    const ports = createAiPorts(loadAiConfig({ AI_LLM_PROVIDER: 'mock' }));
    expect(ports.local).toBeUndefined();
    expect(ports.localModel).toBeNull();
    expect(describeAiChains(loadAiConfig({}))).not.toContain('local');
  });
});

describe('cadena del modelo local', () => {
  it('pide primero al servidor local con JSON y sin clave real', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      respuesta(JSON.stringify({ operations: [{ op: 'CREATE_CLASS', className: 'Producto' }] })),
    );
    vi.stubGlobal('fetch', fetch);
    const ports = createAiPorts(loadAiConfig({ ...local, AI_LOCAL_REASONING: 'none' }));
    expect(ports.localModel).toBe('gemma4:e4b');
    expect(ports.local?.name).toBe('local→mock');
    const { proposal } = await ports.local!.proposeCommands({
      instruction: 'Crea la clase Producto',
      snapshot,
    });
    expect(proposal.operations).toEqual([{ op: 'CREATE_CLASS', className: 'Producto' }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://host.docker.internal:11434/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gemma4:e4b',
      max_tokens: 4096,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
    });
  });

  it.each([
    ['apagado', async () => Promise.reject(new TypeError('fetch failed'))],
    ['JSON inválido', async () => respuesta('no es json')],
    ['error del modelo', async () => new Response('{"error":"model not found"}', { status: 404 })],
  ])('si el modelo local está %s, responde la cadena de proveedores', async (_caso, falla) => {
    const fetch = vi.fn(falla);
    vi.stubGlobal('fetch', fetch);
    const { proposal } = await createAiPorts(loadAiConfig(local)).local!.proposeCommands({
      instruction: 'Crea la clase Producto',
      snapshot,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(proposal.operations[0]).toMatchObject({ op: 'CREATE_CLASS' });
  });

  it('la cancelación del solicitante no cae a los proveedores', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('abortado')), {
              once: true,
            });
            controller.abort(new Error('cancelación del solicitante'));
          }),
      ),
    );
    await expect(
      createAiPorts(loadAiConfig(local)).local!.answer({
        question: 'Explica UML',
        snapshot,
        teaching: { solutionMode: 'ON_REQUEST', task: 'ASK' },
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelación del solicitante/);
  });

  it('recorta el contexto para que entrada y salida quepan en el modelo local', () => {
    const ports = createAiPorts(
      loadAiConfig({
        ...local,
        AI_LOCAL_CONTEXT_WINDOW: '16384',
        AI_LOCAL_MAX_OUTPUT_TOKENS: '4096',
      }),
      { contextWindow: 32768 },
    );
    expect(ports.local?.capabilities?.contextWindow).toBe(12288);
    expect(ports.llm.capabilities?.contextWindow).toBe(32768);
  });
});

describe('voz local (Whisper)', () => {
  const voz = {
    AI_SPEECH_PROVIDER: 'mock',
    AI_LOCAL_SPEECH_BASE_URL: 'http://host.docker.internal:8178/v1',
    AI_LOCAL_SPEECH_MODEL: 'whisper-large-v3-turbo',
    AI_LOG_USAGE: 'false',
  };
  const audio = { audio: new Uint8Array([82, 73, 70, 70]), mediaType: 'audio/wav' };
  const whisper = (text: string) =>
    new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('valida la URL, exige URL y modelo juntos y deja tiempo para caer a los proveedores', () => {
    expect(() => loadAiConfig(voz)).not.toThrow();
    expect(() =>
      loadAiConfig({ ...voz, AI_LOCAL_SPEECH_BASE_URL: 'http://8.8.8.8:8178/v1' }),
    ).toThrow(/AI_LOCAL_SPEECH_BASE_URL/);
    expect(() => loadAiConfig({ AI_LOCAL_SPEECH_MODEL: 'whisper-small' })).toThrow(/juntos/);
    expect(() =>
      loadAiConfig({
        ...voz,
        AI_LOCAL_SPEECH_TIMEOUT_MS: '120000',
        AI_SPEECH_CHAIN_TIMEOUT_MS: '120000',
      }),
    ).toThrow(/AI_LOCAL_SPEECH_TIMEOUT_MS/);
  });

  it('sin configuración no hay voz local', () => {
    const ports = createAiPorts(loadAiConfig({}));
    expect(ports.localSpeech).toBeUndefined();
    expect(ports.localSpeechModel).toBeNull();
    expect(describeAiChains(loadAiConfig({}))).not.toContain('voz local');
  });

  it('envía el audio a whisper.cpp en español y quita las marcas de silencio', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      whisper(' [BLANK_AUDIO] Crea la clase Producto con atributo precio decimal.'),
    );
    vi.stubGlobal('fetch', fetch);
    const config = loadAiConfig(voz);
    const ports = createAiPorts(config);
    expect(ports.localSpeechModel).toBe('whisper-large-v3-turbo');
    expect(ports.localSpeech?.name).toBe('local→mock');
    expect(describeAiChains(config)).toContain(
      'voz local: local/whisper-large-v3-turbo → proveedores de voz',
    );
    const { text } = await ports.localSpeech!.transcribe(audio);
    expect(text).toBe('Crea la clase Producto con atributo precio decimal.');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://host.docker.internal:8178/v1/audio/transcriptions');
    const form = init.body as FormData;
    expect(form.get('language')).toBe('es');
    expect(form.get('response_format')).toBe('json');
    expect((form.get('file') as File).name).toBe('dictado.wav');
  });

  it('si Whisper local está apagado, transcriben los proveedores de voz', async () => {
    const fetch = vi.fn(async () => Promise.reject(new TypeError('fetch failed')));
    vi.stubGlobal('fetch', fetch);
    const { text } = await createAiPorts(loadAiConfig(voz)).localSpeech!.transcribe(audio);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).toBe('agrega telefono tipo String a Cliente');
  });

  it('limita la ventana de Whisper a la duración del WAV', async () => {
    const wav = (segundos: number) => {
      const datos = Math.round(segundos * 32000);
      const view = new DataView(new ArrayBuffer(44 + datos));
      const ascii = (at: number, s: string) =>
        [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
      ascii(0, 'RIFF');
      view.setUint32(4, 36 + datos, true);
      ascii(8, 'WAVE');
      ascii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint32(28, 32000, true); // bytes por segundo: 16 kHz, 16 bits, mono
      ascii(36, 'data');
      view.setUint32(40, datos, true);
      return new Uint8Array(view.buffer);
    };
    expect(contextoDeAudio(wav(3.7), 'audio/wav')).toBe(249);
    expect(contextoDeAudio(wav(0.5), 'audio/wav')).toBe(128);
    expect(contextoDeAudio(wav(35), 'audio/wav')).toBeUndefined();
    expect(contextoDeAudio(wav(3.7), 'audio/webm')).toBeUndefined();
    expect(contextoDeAudio(new Uint8Array(10), 'audio/wav')).toBeUndefined();

    const fetch = vi.fn(async (_url: string, _init: RequestInit) => whisper('Crea Venta'));
    vi.stubGlobal('fetch', fetch);
    await createAiPorts(loadAiConfig(voz)).localSpeech!.transcribe({
      audio: wav(3.7),
      mediaType: 'audio/wav',
    });
    expect((fetch.mock.calls[0]![1].body as FormData).get('audio_ctx')).toBe('249');
  });

  it('un audio sin palabras no se reenvía a la nube', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => whisper('[BLANK_AUDIO]')),
    );
    await expect(
      createAiPorts(loadAiConfig(voz)).localSpeech!.transcribe(audio),
    ).rejects.toMatchObject({ name: 'NoSpeechError' });
  });
});

describe('selección por proyecto', () => {
  const llm = { name: 'nube', answer: vi.fn(), proposeCommands: vi.fn() };
  const localPort = { name: 'local', answer: vi.fn(), proposeCommands: vi.fn() };
  it('PROVIDERS es el valor por defecto y LOCAL usa el modelo local', () => {
    expect(createTaskRouter({ llm, local: localPort }).portFor('mentor')).toBe(llm);
    expect(createTaskRouter({ llm, local: localPort }, 'PROVIDERS').portFor('instruct')).toBe(llm);
    expect(createTaskRouter({ llm, local: localPort }, 'LOCAL').portFor('review')).toBe(localPort);
  });
  it('LOCAL sin modelo configurado sigue con los proveedores', () => {
    expect(createTaskRouter({ llm }, 'LOCAL').portFor('instruct')).toBe(llm);
  });
});
