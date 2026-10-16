export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export type SpeechPhase = 'idle' | 'listening' | 'stopping';

/** Una sesión del usuario puede abarcar varias sesiones del servicio del navegador.
 * Ningún resultado parcial dispara una petición a la IA.
 */
export function createSpeechSession(
  create: () => SpeechRecognitionLike,
  callbacks: {
    phase(value: SpeechPhase): void;
    text(value: string): void;
    error(value: string | null): void;
    complete(value: string): void;
  },
) {
  let current: SpeechRecognitionLike | null = null;
  let active = false;
  let phase: SpeechPhase = 'idle';
  let prefix = '';
  let text = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const setPhase = (value: SpeechPhase) => {
    phase = value;
    callbacks.phase(value);
  };
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const detach = () => {
    const previous = current;
    current = null;
    if (previous) previous.onresult = previous.onerror = previous.onend = null;
    return previous;
  };
  const finish = () => {
    if (phase === 'idle') return;
    active = false;
    clear();
    const previous = detach();
    try {
      previous?.abort();
    } catch {
      /* Ya puede estar desconectado. */
    }
    setPhase('idle');
    callbacks.complete(text);
  };
  const begin = () => {
    if (!active) return;
    try {
      const engine = create();
      current = engine;
      engine.lang = 'es-ES';
      engine.continuous = true;
      engine.interimResults = true;
      engine.onresult = (event) => {
        if (current !== engine) return;
        // results contiene toda esta sesión, incluidos resultados revisados.
        // Reemplazar esa parte evita duplicarla al llegar el siguiente evento.
        const segment = Array.from(event.results)
          .map((r) => r[0]?.transcript ?? '')
          .join(' ');
        text = [prefix, segment.trim()].filter(Boolean).join(' ');
        callbacks.text(text);
      };
      engine.onerror = ({ error }) => {
        if (current !== engine || error === 'no-speech') return;
        callbacks.error(
          error === 'not-allowed' || error === 'service-not-allowed'
            ? 'No se pudo acceder al micrófono. Revisa el permiso del navegador.'
            : `El dictado se interrumpió (${error}). Conservamos el texto para que puedas revisarlo.`,
        );
        finish();
      };
      engine.onend = () => {
        if (current !== engine) return;
        detach();
        if (!active) {
          finish();
          return;
        }
        prefix = text;
        // Las pausas/límites del servicio no terminan el dictado del usuario.
        timer = setTimeout(begin, 250);
      };
      engine.start();
    } catch {
      callbacks.error('No se pudo iniciar el dictado. El texto capturado se conserva.');
      finish();
    }
  };
  return {
    start() {
      if (phase !== 'idle') return;
      prefix = text = '';
      callbacks.error(null);
      callbacks.text('');
      active = true;
      setPhase('listening');
      begin();
    },
    stop() {
      if (phase !== 'listening') return;
      active = false;
      clear();
      setPhase('stopping');
      if (!current) {
        finish();
        return;
      }
      // Plazo solo después de una parada explícita, nunca límite del dictado.
      timer = setTimeout(finish, 3000);
      try {
        current.stop();
      } catch {
        finish();
      }
    },
    cancel() {
      active = false;
      clear();
      const previous = detach();
      try {
        previous?.abort();
      } catch {
        /* Sin resultado al cancelar. */
      }
      prefix = text = '';
      callbacks.text('');
      callbacks.error(null);
      setPhase('idle');
    },
  };
}
