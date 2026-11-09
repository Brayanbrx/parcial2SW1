import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechPhase } from './speech-session.js';
import { recognitionConstructor } from './useSpeech.js';
import { createVoiceCommandSession } from './voice-command-session.js';
import { canRecordVoice, type VoiceEngine } from './recorder-recognition.js';

/** Con `engine` (voz local del proyecto) se graba y transcribe en el servidor:
 * no depende de la conexión a internet del navegador, solo de llegar a la API. */
export function useVoiceCommand(
  allowed: boolean,
  onComplete: (text: string) => void,
  engine?: VoiceEngine,
) {
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [finalText, setFinalText] = useState('');
  const latest = useRef({ allowed, onComplete, engine });
  latest.current = { allowed, onComplete, engine };
  const session = useRef<ReturnType<typeof createVoiceCommandSession> | null>(null);
  const connected = () => latest.current.engine !== undefined || navigator.onLine;
  const cancel = useCallback(() => session.current?.cancel(), []);
  const start = useCallback(() => {
    if (!latest.current.allowed || !connected()) return;
    const current = latest.current.engine;
    const Recognition = recognitionConstructor();
    const create = current
      ? canRecordVoice()
        ? () => current.create()
        : undefined
      : Recognition
        ? () => new Recognition()
        : undefined;
    if (!create) return;
    if (!session.current) {
      session.current = createVoiceCommandSession(
        create,
        {
          phase: setPhase,
          text: setTranscript,
          error: setError,
          complete: (text) => {
            if (!latest.current.allowed || !connected()) {
              setError('Las condiciones para enviar cambiaron. No se envió el comando.');
              return;
            }
            setFinalText(text);
            latest.current.onComplete(text);
          },
        },
        current ? { stopTimeoutMs: current.stopTimeoutMs } : {},
      );
    }
    setFinalText('');
    session.current.start();
  }, []);
  const stop = useCallback(() => session.current?.stop(), []);
  useEffect(() => {
    if (!allowed) cancel();
  }, [allowed, cancel]);
  // Cambiar de motor descarta la sesión: cada una conserva su plazo de parada.
  useEffect(
    () => () => {
      session.current?.cancel();
      session.current = null;
    },
    [engine],
  );
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    // Sin red el reconocimiento del navegador se corta; la voz local no.
    const offline = () => {
      if (!latest.current.engine) cancel();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      session.current?.cancel();
      session.current = null;
    };
  }, [cancel]);
  return {
    supported: engine ? canRecordVoice() : !!recognitionConstructor(),
    phase,
    transcript,
    finalText,
    error,
    start,
    stop,
    cancel,
  };
}
