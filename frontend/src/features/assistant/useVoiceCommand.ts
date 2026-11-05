import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechPhase } from './speech-session.js';
import { recognitionConstructor } from './useSpeech.js';
import { createVoiceCommandSession } from './voice-command-session.js';

export function useVoiceCommand(allowed: boolean, onComplete: (text: string) => void) {
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [finalText, setFinalText] = useState('');
  const latest = useRef({ allowed, onComplete });
  latest.current = { allowed, onComplete };
  const session = useRef<ReturnType<typeof createVoiceCommandSession> | null>(null);
  const cancel = useCallback(() => session.current?.cancel(), []);
  const start = useCallback(() => {
    if (!latest.current.allowed || !navigator.onLine) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    if (!session.current) {
      session.current = createVoiceCommandSession(() => new Recognition(), {
        phase: setPhase,
        text: setTranscript,
        error: setError,
        complete: (text) => {
          if (!latest.current.allowed || !navigator.onLine) {
            setError('Las condiciones para enviar cambiaron. No se envió el comando.');
            return;
          }
          setFinalText(text);
          latest.current.onComplete(text);
        },
      });
    }
    setFinalText('');
    session.current.start();
  }, []);
  const stop = useCallback(() => session.current?.stop(), []);
  useEffect(() => {
    if (!allowed) cancel();
  }, [allowed, cancel]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('offline', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('offline', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      session.current?.cancel();
      session.current = null;
    };
  }, [cancel]);
  return {
    supported: !!recognitionConstructor(),
    phase,
    transcript,
    finalText,
    error,
    start,
    stop,
    cancel,
  };
}
