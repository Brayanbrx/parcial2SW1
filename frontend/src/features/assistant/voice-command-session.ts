import type { SpeechPhase, SpeechRecognitionLike } from './speech-session.js';

/** Comando explícito: solo finaliza tras soltar y recibir end con resultados finales.
 * Nunca recupera parciales como instrucciones ni completa desde un timeout/error.
 */
export function createVoiceCommandSession(
  create: () => SpeechRecognitionLike,
  callbacks: {
    phase(value: SpeechPhase): void;
    text(value: string): void;
    error(value: string | null): void;
    complete(value: string): void;
  },
  /** Espera tras soltar; la transcripción en el servidor necesita más que el navegador. */
  options: { stopTimeoutMs?: number } = {},
) {
  let current: SpeechRecognitionLike | null = null;
  let phase: SpeechPhase = 'idle';
  let prefix = '';
  let segment = '';
  let hasInterim = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const setPhase = (value: SpeechPhase) => {
    phase = value;
    callbacks.phase(value);
  };
  const detach = () => {
    const engine = current;
    current = null;
    if (engine) engine.onresult = engine.onerror = engine.onend = null;
    return engine;
  };
  const reset = () => {
    clearTimeout(timer);
    const engine = detach();
    try {
      engine?.abort();
    } catch {
      /* El servicio ya puede estar cerrado. */
    }
    setPhase('idle');
  };
  const fail = (message: string) => {
    reset();
    callbacks.error(message);
  };
  const finish = () => {
    const text = [prefix, segment].filter(Boolean).join(' ').trim();
    if (hasInterim || !text) {
      fail(
        'No se recibió una transcripción final completa. No se envió el comando. Inténtalo de nuevo.',
      );
      return;
    }
    if (text.length > 2000) {
      fail(
        'El comando supera 2000 caracteres. No se envió; acorta la instrucción e inténtalo de nuevo.',
      );
      return;
    }
    reset();
    callbacks.complete(text);
  };
  const begin = () => {
    if (phase !== 'listening') return;
    try {
      const engine = create();
      current = engine;
      segment = '';
      hasInterim = false;
      engine.lang = 'es-ES';
      engine.continuous = true;
      engine.interimResults = true;
      engine.onresult = ({ results }) => {
        if (current !== engine) return;
        const entries = Array.from(results);
        hasInterim = entries.some((entry) => entry.isFinal !== true);
        segment = entries
          .map((entry) => entry[0]?.transcript ?? '')
          .join(' ')
          .trim();
        callbacks.text([prefix, segment].filter(Boolean).join(' '));
      };
      engine.onerror = ({ error }) => {
        if (current !== engine) return;
        fail(
          error === 'not-allowed' || error === 'service-not-allowed'
            ? 'No se pudo acceder al micrófono. Revisa el permiso del navegador. No se envió el comando.'
            : `El reconocimiento se interrumpió (${error}). No se envió el comando.`,
        );
      };
      engine.onend = () => {
        if (current !== engine) return;
        detach();
        if (phase === 'stopping') {
          finish();
        } else if (hasInterim) {
          // No ejecutar una frase truncada que podría perder, por ejemplo, una negación.
          fail('La transcripción quedó incompleta. No se envió el comando. Inténtalo de nuevo.');
        } else {
          prefix = [prefix, segment].filter(Boolean).join(' ');
          segment = '';
          timer = setTimeout(begin, 250);
        }
      };
      engine.start();
    } catch {
      fail('No se pudo iniciar el reconocimiento. Puedes escribir la instrucción.');
    }
  };
  return {
    start() {
      if (phase !== 'idle') return;
      prefix = segment = '';
      hasInterim = false;
      callbacks.text('');
      callbacks.error(null);
      setPhase('listening');
      begin();
    },
    stop() {
      if (phase !== 'listening') return;
      clearTimeout(timer);
      setPhase('stopping');
      if (!current) {
        finish();
        return;
      }
      timer = setTimeout(
        () => fail('No llegó el cierre de la transcripción. No se envió el comando.'),
        options.stopTimeoutMs ?? 5000,
      );
      try {
        current.stop();
      } catch {
        fail('No se pudo finalizar el reconocimiento. No se envió el comando.');
      }
    },
    cancel() {
      if (phase === 'idle') return;
      reset();
      callbacks.text('');
      callbacks.error('Comando de voz cancelado. No se envió ninguna instrucción.');
    },
  };
}
