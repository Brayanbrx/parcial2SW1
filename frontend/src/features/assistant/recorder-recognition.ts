import type { SpeechRecognitionLike } from './speech-session.js';

/** Lo mínimo de MediaRecorder que se usa; permite probar sin navegador. */
export interface RecorderLike {
  readonly state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: (() => void) | null;
  onstop: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface RecorderDependencies {
  getMicrophone(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): RecorderLike;
  toWav(recording: Blob): Promise<Uint8Array>;
  /** Devuelve el texto; un error con code 'no_speech' significa audio sin palabras. */
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string>;
  /** Corte de cada tramo; el dictado sigue en otro tramo, como con el navegador. */
  readonly maxSegmentMs?: number;
}

/** ~2,5 min de WAV de 16 kHz caben con holgura en el límite de subida de la API. */
const MAX_SEGMENT_MS = 150_000;

/**
 * Reconocimiento con el mismo contrato que SpeechRecognition, pero grabando el
 * micrófono y transcribiendo en el servidor (Whisper local con «Modelo local»).
 * No hay resultados parciales: al parar llega un único resultado final y `end`.
 */
export function createRecorderRecognition(deps: RecorderDependencies): SpeechRecognitionLike {
  let stream: MediaStream | null = null;
  let recorder: RecorderLike | null = null;
  let chunks: Blob[] = [];
  let aborted = false;
  let stopRequested = false;
  let segmentTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  const release = () => {
    clearTimeout(segmentTimer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };
  const fail = (error: string) => {
    if (aborted) return;
    engine.abort();
    engine.onerror?.({ error });
  };
  const finish = async () => {
    release();
    if (aborted) return;
    const recording = new Blob(chunks);
    chunks = [];
    let text = '';
    try {
      if (recording.size > 0) {
        const wav = await deps.toWav(recording);
        if (aborted) return;
        text = (await deps.transcribe(wav, controller.signal)).trim();
      }
    } catch (error) {
      if (aborted) return;
      if ((error as { code?: string }).code !== 'no_speech') {
        engine.onerror?.({ error: 'servidor de voz' });
        return;
      }
    }
    if (aborted) return;
    if (text) {
      const result = Object.assign([{ transcript: text }], { isFinal: true });
      engine.onresult?.({ results: [result] });
    }
    engine.onend?.();
  };

  const engine: SpeechRecognitionLike = {
    lang: 'es-ES',
    continuous: true,
    interimResults: true,
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      void deps.getMicrophone().then(
        (microphone) => {
          stream = microphone;
          if (aborted) {
            release();
            return;
          }
          try {
            recorder = deps.createRecorder(microphone);
            recorder.ondataavailable = ({ data }) => {
              if (!aborted && data.size > 0) chunks.push(data);
            };
            recorder.onerror = () => fail('audio-capture');
            recorder.onstop = () => void finish();
            recorder.start();
            segmentTimer = setTimeout(() => engine.stop(), deps.maxSegmentMs ?? MAX_SEGMENT_MS);
            if (stopRequested) engine.stop();
          } catch {
            fail('audio-capture');
          }
        },
        (error: { name?: string }) =>
          fail(
            error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
              ? 'not-allowed'
              : 'audio-capture',
          ),
      );
    },
    stop() {
      stopRequested = true;
      clearTimeout(segmentTimer);
      if (recorder?.state === 'recording') recorder.stop();
    },
    abort() {
      aborted = true;
      controller.abort();
      chunks = [];
      try {
        if (recorder?.state === 'recording') recorder.stop();
      } finally {
        release();
      }
    },
  };
  return engine;
}

/** Motor de voz del panel cuando la transcripción la hace el servidor. */
export interface VoiceEngine {
  create(): SpeechRecognitionLike;
  /** Espera tras soltar o parar: incluye grabación, conversión y transcripción. */
  readonly stopTimeoutMs: number;
}

/** Con el navegador real: micrófono, MediaRecorder y conversión a WAV. */
export function createServerVoiceEngine(
  transcribe: RecorderDependencies['transcribe'],
  toWav: RecorderDependencies['toWav'],
  speechTimeoutMs = 120_000,
): VoiceEngine {
  return {
    // La API puede agotar la cadena completa; reservamos margen para WAV y transporte.
    stopTimeoutMs: speechTimeoutMs + 30_000,
    create: () =>
      createRecorderRecognition({
        getMicrophone: () =>
          navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          }),
        createRecorder: (stream) => {
          const recorder = new MediaRecorder(stream);
          const like: RecorderLike = {
            get state() {
              return recorder.state;
            },
            ondataavailable: null,
            onerror: null,
            onstop: null,
            start: () => recorder.start(),
            stop: () => recorder.stop(),
          };
          recorder.ondataavailable = (event) => like.ondataavailable?.({ data: event.data });
          recorder.onerror = () => like.onerror?.();
          recorder.onstop = () => like.onstop?.();
          return like;
        },
        toWav,
        transcribe,
      }),
  };
}

/** Grabar exige micrófono y MediaRecorder; ambos solo existen en contexto seguro. */
export function canRecordVoice(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}
