import { afterEach, describe, expect, it, vi } from 'vitest';
import { pedirJson } from '../src/http.js';
import { ProviderContractError, ProviderUnavailableError } from '../src/ports.js';

afterEach(() => vi.unstubAllGlobals());

const options = {
  provider: 'prueba',
  url: 'https://example.invalid',
  init: {},
  timeoutMs: 100,
  maxRetries: 1,
  esperar: async () => undefined,
};

function truncatedResponse(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('La conexion se corto al leer el cuerpo'));
      },
    }),
  );
}

describe('transporte de IA', () => {
  it('reintenta si la conexion se corta despues de recibir las cabeceras', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pedirJson(options)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clasifica un cuerpo interrumpido como indisponibilidad para activar el respaldo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => truncatedResponse()),
    );
    await expect(pedirJson(options)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('aborta el intento al agotar el plazo aunque el proveedor nunca conteste', async () => {
    // Un fetch que solo termina cuando lo abortan: es lo que hace un proveedor
    // saturado. El plazo tiene que dispararse solo, sin ayuda del llamante.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    await expect(pedirJson({ ...options, maxRetries: 0 })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it('la cancelacion del llamante corta el intento y no se reintenta', async () => {
    const controlador = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pendiente = pedirJson({ ...options, signal: controlador.signal });
    controlador.abort(new Error('cancelado por la persona'));
    await expect(pendiente).rejects.toThrow('cancelado por la persona');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un cuerpo completo que no cumple JSON es un error de contrato sin reintento', async () => {
    const fetchMock = vi.fn(async () => new Response('no es JSON'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pedirJson(options)).rejects.toBeInstanceOf(ProviderContractError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
