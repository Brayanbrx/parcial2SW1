import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSpeechSession,
  type SpeechPhase,
  type SpeechRecognitionLike,
} from './speech-session.js';
import { canRecordVoice, type VoiceEngine } from './recorder-recognition.js';

type Constructor = new () => SpeechRecognitionLike;
export function recognitionConstructor(): Constructor | undefined {
  const browser = window as unknown as {
    SpeechRecognition?: Constructor;
    webkitSpeechRecognition?: Constructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

/** Dictado del navegador: no sube audio al backend ni utiliza sus cuotas de IA.
 * El servicio del navegador puede depender de conexión y permisos.
 * Con `engine` (voz local del proyecto) se graba y transcribe en el servidor.
 */
export function useSpeech(
  onComplete: (text: string) => void,
  engine?: VoiceEngine,
  allowed = true,
) {
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const session = useRef<ReturnType<typeof createSpeechSession> | null>(null);
  // Cambiar de motor descarta la sesión: cada una conserva su plazo de parada.
  useEffect(
    () => () => {
      session.current?.cancel();
      session.current = null;
    },
    [engine],
  );
  useEffect(() => {
    const interruptWhenHidden = () => {
      if (!allowed || document.hidden) session.current?.interrupt();
    };
    interruptWhenHidden();
    document.addEventListener('visibilitychange', interruptWhenHidden);
    return () => document.removeEventListener('visibilitychange', interruptWhenHidden);
  }, [allowed]);
  const start = useCallback(() => {
    if (!allowed || document.hidden) return;
    if (session.current === null) {
      const Recognition = recognitionConstructor();
      const create = engine
        ? () => engine.create()
        : Recognition
          ? () => new Recognition()
          : undefined;
      if (!create || (engine && !canRecordVoice())) {
        setError('Este navegador no admite dictado. Puedes escribir tu solicitud.');
        return;
      }
      session.current = createSpeechSession(
        create,
        {
          phase: setPhase,
          text: setTranscript,
          error: setError,
          complete: (text) => callback.current(text),
        },
        engine ? { stopTimeoutMs: engine.stopTimeoutMs } : {},
      );
    }
    session.current.start();
  }, [engine, allowed]);
  const stop = useCallback(() => session.current?.stop(), []);
  const cancel = useCallback(() => session.current?.cancel(), []);
  return {
    supported: engine ? canRecordVoice() : recognitionConstructor() !== undefined,
    listening: phase === 'listening',
    stopping: phase === 'stopping',
    transcript,
    error,
    start,
    stop,
    cancel,
  };
}
