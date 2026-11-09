import { describe, expect, it, vi } from 'vitest';
import {
  createRecorderRecognition,
  createServerVoiceEngine,
  type RecorderDependencies,
  type RecorderLike,
} from '../src/features/assistant/recorder-recognition.js';
import { createSpeechSession } from '../src/features/assistant/speech-session.js';
import { createVoiceCommandSession } from '../src/features/assistant/voice-command-session.js';
import { encodeWav } from '../src/features/assistant/wav.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it('allows the full configured speech chain deadline plus conversion and transport', () => {
  const transcribe = async () => '';
  const toWav = async () => new Uint8Array();
  expect(createServerVoiceEngine(transcribe, toWav).stopTimeoutMs).toBe(150_000);
  expect(createServerVoiceEngine(transcribe, toWav, 180_000).stopTimeoutMs).toBe(210_000);
});

function fakes(transcribe: RecorderDependencies['transcribe'] = async () => 'Crea la clase Venta') {
  const track = { stop: vi.fn() };
  const recorders: RecorderLike[] = [];
  const deps: RecorderDependencies = {
    getMicrophone: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
    createRecorder: vi.fn(() => {
      const recorder: RecorderLike & { state: string } = {
        state: 'inactive',
        ondataavailable: null,
        onerror: null,
        onstop: null,
        start() {
          recorder.state = 'recording';
        },
        stop() {
          recorder.state = 'inactive';
          recorder.ondataavailable?.({ data: new Blob(['audio']) });
          recorder.onstop?.();
        },
      };
      recorders.push(recorder);
      return recorder;
    }),
    toWav: vi.fn(async () => new Uint8Array([1, 2, 3])),
    transcribe: vi.fn(transcribe),
  };
  return { deps, track, recorders };
}
function listen(engine: ReturnType<typeof createRecorderRecognition>) {
  const events: string[] = [];
  engine.onresult = ({ results }) =>
    events.push(`result:${results[0]![0]!.transcript}:${String(results[0]!.isFinal)}`);
  engine.onerror = ({ error }) => events.push(`error:${error}`);
  engine.onend = () => events.push('end');
  return events;
}

describe('WAV para Whisper', () => {
  it('escribe una cabecera PCM mono de 16 bits y recorta las muestras', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(wav.buffer);
    const ascii = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([2, 3, 4, 5].map((i) => view.getInt16(44 + (i - 2) * 2, true))).toEqual([
      0, 32767, -32768, 32767,
    ]);
  });
});

describe('reconocimiento grabando y transcribiendo en el servidor', () => {
  it('al parar entrega un único resultado final, cierra y libera el micrófono', async () => {
    const { deps, track } = fakes();
    const engine = createRecorderRecognition(deps);
    const events = listen(engine);
    engine.start();
    await flush();
    engine.stop();
    await flush();
    expect(events).toEqual(['result:Crea la clase Venta:true', 'end']);
    expect(deps.transcribe).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      expect.any(AbortSignal),
    );
    expect(track.stop).toHaveBeenCalled();
  });

  it('un audio sin palabras termina sin resultado; otros fallos se informan', async () => {
    const silencio = fakes(async () =>
      Promise.reject(Object.assign(new Error(), { code: 'no_speech' })),
    );
    const quiet = createRecorderRecognition(silencio.deps);
    const quietEvents = listen(quiet);
    quiet.start();
    await flush();
    quiet.stop();
    await flush();
    expect(quietEvents).toEqual(['end']);

    const caido = fakes(async () => Promise.reject(new Error('503')));
    const down = createRecorderRecognition(caido.deps);
    const downEvents = listen(down);
    down.start();
    await flush();
    down.stop();
    await flush();
    expect(downEvents).toEqual(['error:servidor de voz']);
  });

  it('sin permiso de micrófono informa not-allowed', async () => {
    const { deps } = fakes();
    deps.getMicrophone = async () =>
      Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }));
    const engine = createRecorderRecognition(deps);
    const events = listen(engine);
    engine.start();
    await flush();
    expect(events).toEqual(['error:not-allowed']);
  });

  it('descarta el audio si falla la grabación antes de terminar', async () => {
    const { deps, track, recorders } = fakes();
    const engine = createRecorderRecognition(deps);
    const events = listen(engine);
    engine.start();
    await flush();

    recorders[0]!.onerror?.();
    engine.stop();
    await flush();

    expect(events).toEqual(['error:audio-capture']);
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('abortar mientras convierte el audio impide enviarlo a transcribir', async () => {
    const { deps } = fakes();
    let finishConversion!: (wav: Uint8Array) => void;
    deps.toWav = () => new Promise((resolve) => (finishConversion = resolve));
    const engine = createRecorderRecognition(deps);
    const events = listen(engine);
    engine.start();
    await flush();
    engine.stop();

    engine.abort();
    finishConversion(new Uint8Array([1, 2, 3]));
    await flush();

    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('abortar durante la transcripción la cancela y no emite nada', async () => {
    let signal: AbortSignal | undefined;
    const { deps } = fakes(
      (_wav, received) =>
        new Promise((_resolve, reject) => {
          signal = received;
          received.addEventListener('abort', () => reject(new Error('abortado')));
        }),
    );
    const engine = createRecorderRecognition(deps);
    const events = listen(engine);
    engine.start();
    await flush();
    engine.stop();
    await flush();
    engine.abort();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(events).toEqual([]);
  });

  it('soltar antes de que el micrófono esté listo para la grabación al empezar', async () => {
    const { deps, recorders } = fakes();
    const engine = createRecorderRecognition(deps);
    const events = listen(engine);
    engine.start();
    engine.stop();
    await flush();
    await flush();
    expect(recorders[0]!.state).toBe('inactive');
    expect(events).toEqual(['result:Crea la clase Venta:true', 'end']);
  });
});

describe('con las sesiones de Dictar y Comando de voz', () => {
  const callbacks = () => ({ phase: vi.fn(), text: vi.fn(), error: vi.fn(), complete: vi.fn() });

  it('Comando de voz envía la transcripción de Whisper al soltar', async () => {
    const { deps } = fakes();
    const cb = callbacks();
    const session = createVoiceCommandSession(() => createRecorderRecognition(deps), cb, {
      stopTimeoutMs: 60_000,
    });
    session.start();
    await flush();
    session.stop();
    await flush();
    expect(cb.complete).toHaveBeenCalledWith('Crea la clase Venta');
    expect(cb.error).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('Dictar deja el texto para revisar y un silencio no envía nada', async () => {
    const dictado = fakes();
    const cb = callbacks();
    const session = createSpeechSession(() => createRecorderRecognition(dictado.deps), cb, {
      stopTimeoutMs: 60_000,
    });
    session.start();
    await flush();
    session.stop();
    await flush();
    expect(cb.complete).toHaveBeenCalledWith('Crea la clase Venta');

    const silencio = fakes(async () =>
      Promise.reject(Object.assign(new Error(), { code: 'no_speech' })),
    );
    const command = callbacks();
    const voice = createVoiceCommandSession(
      () => createRecorderRecognition(silencio.deps),
      command,
      {
        stopTimeoutMs: 60_000,
      },
    );
    voice.start();
    await flush();
    voice.stop();
    await flush();
    expect(command.complete).not.toHaveBeenCalled();
    expect(command.error).toHaveBeenLastCalledWith(
      expect.stringContaining('No se envió el comando'),
    );
  });
});
