import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSpeechSession,
  type SpeechRecognitionLike,
} from '../src/features/assistant/speech-session.js';
import { prepareDictation } from '../src/features/assistant/prepare-dictation.js';

function harness() {
  vi.useFakeTimers();
  const engines: SpeechRecognitionLike[] = [];
  const callbacks = { phase: vi.fn(), text: vi.fn(), error: vi.fn(), complete: vi.fn() };
  const session = createSpeechSession(() => {
    const engine: SpeechRecognitionLike = {
      lang: '',
      continuous: false,
      interimResults: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    };
    engines.push(engine);
    return engine;
  }, callbacks);
  const result = (engine: SpeechRecognitionLike, ...parts: string[]) =>
    engine.onresult?.({ results: parts.map((transcript) => [{ transcript }]) });
  return { engines, callbacks, session, result };
}
afterEach(() => vi.useRealTimers());

describe('dictado hasta parar explícitamente', () => {
  it('acumula resultados sin duplicar revisiones y no finaliza por tiempo', () => {
    const h = harness();
    h.session.start();
    const engine = h.engines[0]!;
    expect(engine.continuous).toBe(true);
    expect(engine.interimResults).toBe(true);
    h.result(engine, 'crea Cliente');
    h.result(engine, 'crea Cliente', 'con nombre');
    h.result(engine, 'crea Cliente', 'con nombre String');
    vi.advanceTimersByTime(600_000);
    expect(h.callbacks.text).toHaveBeenLastCalledWith('crea Cliente con nombre String');
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(engine.stop).not.toHaveBeenCalled();
    h.session.stop();
    h.result(engine, 'crea Cliente', 'con nombre String obligatorio');
    engine.onend?.();
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith(
      'crea Cliente con nombre String obligatorio',
    );
    vi.runAllTimers();
    expect(h.engines).toHaveLength(1);
  });
  it('reanuda tras fin automático o silencio y conserva el dictado anterior', () => {
    const h = harness();
    h.session.start();
    h.result(h.engines[0]!, 'crea Cliente');
    h.engines[0]!.onend?.();
    vi.advanceTimersByTime(250);
    h.engines[1]!.onerror?.({ error: 'no-speech' });
    h.engines[1]!.onend?.();
    vi.advanceTimersByTime(250);
    h.result(h.engines[2]!, 'no elimines Venta');
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    h.session.stop();
    h.engines[2]!.onend?.();
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('crea Cliente no elimines Venta');
  });
  it('parar durante la reconexión cancela el reinicio', () => {
    const h = harness();
    h.session.start();
    h.result(h.engines[0]!, 'Cliente');
    h.engines[0]!.onend?.();
    h.session.stop();
    vi.runAllTimers();
    expect(h.engines).toHaveLength(1);
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('Cliente');
  });
  it('cancelar/desmontar ignora resultados tardíos y no devuelve un borrador', () => {
    const h = harness();
    h.session.start();
    const engine = h.engines[0]!;
    const late = engine.onresult;
    h.session.cancel();
    late?.({ results: [[{ transcript: 'borra Cliente' }]] });
    vi.runAllTimers();
    expect(h.callbacks.complete).not.toHaveBeenCalled();
    expect(engine.abort).toHaveBeenCalledOnce();
  });
  it('un fallo de permisos no provoca un bucle de reinicios', () => {
    const h = harness();
    h.session.start();
    h.engines[0]!.onerror?.({ error: 'not-allowed' });
    vi.runAllTimers();
    expect(h.engines).toHaveLength(1);
    expect(h.callbacks.error).toHaveBeenLastCalledWith(expect.stringContaining('permiso'));
  });
  it('evita dos inicios y dos finalizaciones; recupera texto si stop no emite end', () => {
    const h = harness();
    h.session.start();
    h.session.start();
    h.result(h.engines[0]!, 'crea Cliente');
    h.session.stop();
    h.session.stop();
    vi.advanceTimersByTime(3000);
    expect(h.engines).toHaveLength(1);
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('crea Cliente');
  });
  it('un fallo de red conserva el borrador y no hace reintentos infinitos', () => {
    const h = harness();
    h.session.start();
    h.result(h.engines[0]!, 'crea Cliente y no borres Venta');
    h.engines[0]!.onerror?.({ error: 'network' });
    vi.runAllTimers();
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('crea Cliente y no borres Venta');
    expect(h.engines).toHaveLength(1);
    h.session.cancel();
    expect(h.callbacks.error).toHaveBeenLastCalledWith(null);
  });
  it('descarta resultados provisionales retirados por el reconocedor', () => {
    const h = harness();
    h.session.start();
    h.result(h.engines[0]!, 'crea Cliente', 'borra Venta');
    h.result(h.engines[0]!, 'crea Cliente');
    h.session.stop();
    h.engines[0]!.onend?.();
    expect(h.callbacks.complete).toHaveBeenCalledExactlyOnceWith('crea Cliente');
  });
});

describe('preparación local del dictado', () => {
  it('quita preámbulos y espacios sin una segunda llamada a IA', () => {
    expect(
      prepareDictation('  eh, hola, por favor quiero que agregues  correo tipo String a Cliente  '),
    ).toBe('agregues correo tipo String a Cliente');
  });
  it.each([
    'no borres Cliente; cambia edad de Integer a Long, mejor a Decimal',
    'crea el atributo «eh» y la clase "Hola"',
    'renombra "mi  atributo" a "nombre nuevo"',
    'relaciona Cliente 0..1 con Venta 1..*; no cambies el resto',
    'el atributo se llama entonces y es obligatorio, no único',
  ])('conserva la intención y los detalles: %s', (text) =>
    expect(prepareDictation(text)).toBe(text),
  );
  it('no recorta dictados largos ni su última instrucción', () => {
    const text = 'agrega nombre String. '.repeat(300) + 'No borres Persona.';
    expect(prepareDictation(text)).toBe(text);
  });
  it.each([
    ['Bueno, lo que quiero es que no borres Cliente', 'no borres Cliente'],
    ['Hola, me puedes agregar email tipo String a Cliente', 'agregar email tipo String a Cliente'],
    [
      'Por favor podrías relacionar Cliente 1 con Venta 0..*',
      'relacionar Cliente 1 con Venta 0..*',
    ],
    ['crea la clase Bueno y el atributo hola', 'crea la clase Bueno y el atributo hola'],
  ])('reduce solo el preámbulo: %s', (raw, prepared) => {
    expect(prepareDictation(raw)).toBe(prepared);
  });
});
