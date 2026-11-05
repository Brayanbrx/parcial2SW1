import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeechRecognitionLike } from '../src/features/assistant/speech-session.js';
import { createVoiceCommandSession } from '../src/features/assistant/voice-command-session.js';

function harness() {
  vi.useFakeTimers();
  const engines: SpeechRecognitionLike[] = [];
  const callbacks = { phase: vi.fn(), text: vi.fn(), error: vi.fn(), complete: vi.fn() };
  const session = createVoiceCommandSession(() => {
    const engine: SpeechRecognitionLike = {
      lang: '',
      continuous: false,
      interimResults: false,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      onresult: null,
      onerror: null,
      onend: null,
    };
    engines.push(engine);
    return engine;
  }, callbacks);
  const result = (text: string, isFinal = true, engine = engines.at(-1)!) => {
    engine.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] });
  };
  return { engines, callbacks, session, result };
}
afterEach(() => vi.useRealTimers());

describe('comando de voz aislado', () => {
  it('espera soltar, resultado final y end; deduplica inicio, parada y cierre', () => {
    const h = harness();
    h.session.start();
    h.session.start();
    h.result('Crea Clien', false);
    h.session.stop();
    h.session.stop();
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    h.result('Crea Cliente');
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    const end = h.engines[0]!.onend!;
    end();
    end();
    vi.runAllTimers();
    expect(h.engines).toHaveLength(1);
    expect(h.engines[0]!.stop).toHaveBeenCalledTimes(1);
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('Crea Cliente');
  });
  it('una pausa acumula finales sin enviar ni duplicar revisiones', () => {
    const h = harness();
    h.session.start();
    h.result('Crea');
    h.result('Crea Cliente');
    h.engines[0]!.onend!();
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    h.result('con correo');
    h.session.stop();
    h.engines[1]!.onend!();
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('Crea Cliente con correo');
  });
  it('soltar durante la pausa usa los finales sin reiniciar el micrófono', () => {
    const h = harness();
    h.session.start();
    h.result('Crea Cliente');
    h.engines[0]!.onend!();
    h.session.stop();
    vi.runAllTimers();
    expect(h.engines).toHaveLength(1);
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('Crea Cliente');
  });
  it.each(['', 'Crea Cliente'])('no envía vacíos ni parciales al terminar: %s', (text) => {
    const h = harness();
    h.session.start();
    h.result(text, false);
    h.session.stop();
    h.engines[0]!.onend!();
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(h.callbacks.error).toHaveBeenLastCalledWith(expect.stringContaining('No se envió'));
  });
  it('no trunca un comando con negación pendiente', () => {
    const h = harness();
    h.session.start();
    h.engines[0]!.onresult!({
      results: [
        Object.assign([{ transcript: 'Crea Cliente' }], { isFinal: true }),
        Object.assign([{ transcript: 'pero no' }], { isFinal: false }),
      ],
    });
    h.engines[0]!.onend!();
    h.session.stop();
    vi.runAllTimers();
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(h.engines).toHaveLength(1);
  });
  it('descarta provisional retirado del listado final', () => {
    const h = harness();
    h.session.start();
    h.result('Crea Cliente y borra Venta', false);
    h.session.stop();
    h.result('Crea Cliente');
    h.engines[0]!.onend!();
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('Crea Cliente');
  });
  it.each([
    'not-allowed',
    'service-not-allowed',
    'network',
    'no-speech',
    'aborted',
    'audio-capture',
  ])('un error %s descarta incluso resultados finales', (error) => {
    const h = harness();
    h.session.start();
    h.result('Crea Cliente');
    h.session.stop();
    h.engines[0]!.onerror!({ error });
    vi.runAllTimers();
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(h.engines[0]!.abort).toHaveBeenCalledTimes(1);
  });
  it('un timeout nunca convierte el último parcial/final en una solicitud', () => {
    const h = harness();
    h.session.start();
    h.result('Crea Cliente');
    h.session.stop();
    vi.advanceTimersByTime(5000);
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(h.callbacks.error).toHaveBeenLastCalledWith(expect.stringContaining('cierre'));
  });
  it.each(['listening', 'stopping'])(
    'cancelar en %s invalida callbacks tardíos y permite otra sesión',
    (phase) => {
      const h = harness();
      h.session.start();
      h.result('Borra Venta');
      if (phase === 'stopping') h.session.stop();
      const old = {
        result: h.engines[0]!.onresult!,
        end: h.engines[0]!.onend!,
        error: h.engines[0]!.onerror!,
      };
      h.session.cancel();
      h.session.start();
      old.result({ results: [Object.assign([{ transcript: 'Borra Venta' }], { isFinal: true })] });
      old.end();
      old.error({ error: 'network' });
      h.result('Crea Cliente');
      h.session.stop();
      h.engines[1]!.onend!();
      expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('Crea Cliente');
    },
  );
  it('rechaza más de 2000 caracteres sin truncar', () => {
    const h = harness();
    h.session.start();
    h.result('a'.repeat(2001));
    h.session.stop();
    h.engines[0]!.onend!();
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(h.callbacks.text).toHaveBeenLastCalledWith('a'.repeat(2001));
    expect(h.callbacks.error).toHaveBeenLastCalledWith(expect.stringContaining('2000'));
  });
  it.each(['start', 'stop'] as const)('una excepción de %s no envía', (method) => {
    const h = harness();
    if (method === 'start') {
      const session = createVoiceCommandSession(() => {
        throw new Error('fallo');
      }, h.callbacks);
      session.start();
    } else {
      h.session.start();
      h.result('Crea Cliente');
      h.engines[0]!.stop = () => {
        throw new Error('fallo');
      };
      h.session.stop();
    }
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(h.callbacks.phase).toHaveBeenLastCalledWith('idle');
  });
});
