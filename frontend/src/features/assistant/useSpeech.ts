import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSpeechSession,
  type SpeechPhase,
  type SpeechRecognitionLike,
} from './speech-session.js';

type Constructor = new () => SpeechRecognitionLike;
function recognitionConstructor(): Constructor | undefined {
  const browser = window as unknown as {
    SpeechRecognition?: Constructor;
    webkitSpeechRecognition?: Constructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

/** Dictado del navegador: no sube audio al backend ni utiliza sus cuotas de IA.
 * El servicio del navegador puede depender de conexión y permisos.
 */
export function useSpeech(onComplete: (text: string) => void) {
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const session = useRef<ReturnType<typeof createSpeechSession> | null>(null);
  const start = useCallback(() => {
    if (session.current === null) {
      const Recognition = recognitionConstructor();
      if (!Recognition) {
        setError('Este navegador no admite dictado. Puedes escribir tu solicitud.');
        return;
      }
      session.current = createSpeechSession(() => new Recognition(), {
        phase: setPhase,
        text: setTranscript,
        error: setError,
        complete: (text) => callback.current(text),
      });
    }
    session.current.start();
  }, []);
  const stop = useCallback(() => session.current?.stop(), []);
  const cancel = useCallback(() => session.current?.cancel(), []);
  useEffect(
    () => () => {
      session.current?.cancel();
      session.current = null;
    },
    [],
  );
  return {
    supported: recognitionConstructor() !== undefined,
    listening: phase === 'listening',
    stopping: phase === 'stopping',
    transcript,
    error,
    start,
    stop,
    cancel,
  };
}
