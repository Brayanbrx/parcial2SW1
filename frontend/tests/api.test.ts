import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  apiRequest,
  currentAccessToken,
  setAccessToken,
  NetworkError,
  login,
  logout,
  refreshSession,
  flushAuditQueue,
  pendingAuditCount,
  subscribeAuditQueue,
  sessionRefreshUnavailable,
  downloadGeneration,
  downloadXmi,
} from '../src/lib/api.js';
import type { CommandBatch } from '@uml/contracts';

describe('cliente HTTP', () => {
  it.each([null, {}, { batchId: 'otro-lote' }])(
    'conserva la auditoría si la confirmación no corresponde al lote: %j',
    async (ack) => {
      const userId = crypto.randomUUID();
      const batch = auditBatch(userId);
      const storage = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) =>
          jsonResponse(200, input.endsWith('/login') ? session(userId) : ack),
        ),
      );
      await login('ana@example.com', 'password');
      await expect(api.recordBatch('pizarra', batch)).rejects.toMatchObject({
        code: 'invalid_response',
      });
      expect(pendingAuditCount()).toBe(1);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(202, { batchId: batch.batchId })),
      );
      await flushAuditQueue();
      expect(pendingAuditCount()).toBe(0);
    },
  );

  it('valida también la confirmación de auditoría sin almacenamiento local', async () => {
    const userId = crypto.randomUUID();
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        jsonResponse(200, input.endsWith('/login') ? session(userId) : {}),
      ),
    );
    await login('ana@example.com', 'password');
    await expect(api.recordBatch('pizarra', auditBatch(userId))).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('cancela sin esperar la renovación compartida ni interrumpir otras peticiones', async () => {
    setAccessToken('expirado');
    let finishRefresh!: (response: Response) => void;
    let refreshed = false;
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/refresh'))
        return new Promise<Response>((resolve) => {
          finishRefresh = (response) => {
            refreshed = true;
            resolve(response);
          };
        });
      return Promise.resolve(
        jsonResponse(refreshed ? 200 : 401, refreshed ? [] : { error: { code: 'unauthorized' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const cancelled = apiRequest('/cancelada', { signal: controller.signal });
    const other = apiRequest('/projects');
    let failure: unknown;
    const observed = cancelled.catch((error: unknown) => {
      failure = error;
    });
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'));
    controller.abort();
    try {
      await vi.waitFor(() => expect(failure).toBe(controller.signal.reason), { timeout: 200 });
      expect(refreshed).toBe(false);
    } finally {
      finishRefresh(jsonResponse(200, session('ana')));
      await observed;
      await expect(other).resolves.toEqual([]);
    }
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/refresh'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/cancelada'))).toHaveLength(1);
  });

  it('conserva la auditoría pendiente cuando el servidor devuelve JSON truncado', async () => {
    const userId = crypto.randomUUID();
    const batch = auditBatch(userId);
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/login')
          ? jsonResponse(200, session(userId))
          : new Response('{"batchId":', { status: 202 }),
      ),
    );
    await login('ana@example.com', 'password');
    await expect(api.recordBatch('pizarra', batch)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(pendingAuditCount()).toBe(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(202, { batchId: batch.batchId })),
    );
    await flushAuditQueue();
    expect(pendingAuditCount()).toBe(0);
  });

  it.each(['JSON', 'ZIP'] as const)(
    'clasifica como caída de red el corte del cuerpo %s después de las cabeceras',
    async (type) => {
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'));
          },
        }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      );
      const request =
        type === 'JSON' ? apiRequest('/projects') : downloadGeneration('generation', 'spring');
      await expect(request).rejects.toBeInstanceOf(NetworkError);
    },
  );

  it('una renovación truncada permite recuperar la copia offline en lugar de cerrar sesión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"accessToken":', { status: 200 })),
    );
    await expect(refreshSession()).resolves.toBe(false);
    expect(sessionRefreshUnavailable()).toBe(true);
  });

  it('conserva un aborto mientras se lee el JSON y el estado HTTP de errores sin JSON', async () => {
    const error = new DOMException('Cancelado', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(error);
              },
            }),
          ),
      ),
    );
    await expect(apiRequest('/projects')).rejects.toBe(error);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Error</html>', { status: 503 })),
    );
    await expect(apiRequest('/projects')).rejects.toMatchObject({ status: 503 });
  });

  it.each(['red', 'servidor', 'plazo'] as const)(
    'conserva el fallo de %s al renovar una petición con acceso vencido',
    async (failure) => {
      setAccessToken('acceso-expirado');
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
          if (!input.endsWith('/refresh'))
            return jsonResponse(401, { error: { code: 'unauthorized' } });
          if (failure === 'red') throw new TypeError('Failed to fetch');
          if (failure === 'plazo') throw new DOMException('Tiempo agotado', 'TimeoutError');
          return jsonResponse(503, {
            error: { code: 'unavailable', message: 'Servicio temporalmente no disponible' },
          });
        }),
      );

      const request = api.getBoard('pizarra');
      if (failure === 'red') await expect(request).rejects.toBeInstanceOf(NetworkError);
      else
        await expect(request).rejects.toMatchObject(
          failure === 'plazo' ? { name: 'TimeoutError' } : { status: 503, code: 'unavailable' },
        );
    },
  );

  it('espera un logout pendiente antes de iniciar otra cuenta', async () => {
    let finishLogout!: (response: Response) => void;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        calls.push(input);
        if (input.endsWith('/logout'))
          return new Promise<Response>((resolve) => {
            finishLogout = resolve;
          });
        return Promise.resolve(
          jsonResponse(200, {
            accessToken: 'nuevo-token',
            user: { id: 'nueva', email: 'nueva@example.com', displayName: 'Nueva' },
          }),
        );
      }),
    );
    const leaving = logout();
    await vi.waitFor(() => expect(calls).toEqual(['/api/auth/logout']));
    const entering = login('nueva@example.com', 'password');
    expect(calls).toEqual(['/api/auth/logout']);
    finishLogout(new Response(null, { status: 204 }));
    await leaving;
    await entering;
    expect(calls).toEqual(['/api/auth/logout', '/api/auth/login']);
    expect(currentAccessToken()).toBe('nuevo-token');
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('comparte una sola renovacion entre peticiones que reciben 401 a la vez', async () => {
    setAccessToken('acceso-expirado');

    let refreshCalls = 0;
    let finishRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);

        if (path === '/api/auth/refresh') {
          refreshCalls += 1;
          await refreshGate;
          return jsonResponse(200, {
            accessToken: 'acceso-renovado',
            user: { id: 'usuario-1', email: 'ana@example.com', displayName: 'Ana' },
          });
        }

        const authorization = new Headers(init?.headers).get('authorization');
        if (authorization === 'Bearer acceso-expirado') {
          return jsonResponse(401, {
            error: { code: 'unauthorized', message: 'El token expiro.' },
          });
        }

        return jsonResponse(200, { path });
      }),
    );

    const requests = Promise.all([
      apiRequest<{ path: string }>('/recurso-a'),
      apiRequest<{ path: string }>('/recurso-b'),
    ]);

    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    finishRefresh?.();

    await expect(requests).resolves.toEqual([
      { path: '/api/recurso-a' },
      { path: '/api/recurso-b' },
    ]);
    expect(refreshCalls).toBe(1);
    expect(currentAccessToken()).toBe('acceso-renovado');
  });

  it('una renovacion tardia no restaura la sesion despues de salir', async () => {
    let finishRefresh!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        input.endsWith('/refresh')
          ? new Promise<Response>((resolve) => {
              finishRefresh = resolve;
            })
          : Promise.resolve(new Response(null, { status: 204 })),
      ),
    );
    const refresh = refreshSession();
    const exiting = logout();
    finishRefresh(jsonResponse(200, session('ana')));
    await exiting;
    await expect(refresh).resolves.toBe(false);
    expect(currentAccessToken()).toBeNull();
  });

  it('mantiene la sesion y envia la auditoria si acceder a localStorage lanza SecurityError', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const userId = crypto.randomUUID();
    const batch = auditBatch(userId);
    const fetchMock = vi.fn(async (input: string) =>
      jsonResponse(200, input.endsWith('/refresh') ? session(userId) : { batchId: batch.batchId }),
    );
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Almacenamiento bloqueado', 'SecurityError');
      },
    });
    try {
      expect(pendingAuditCount()).toBe(0);
      await expect(refreshSession()).resolves.toBe(true);
      expect(currentAccessToken()).toBe(`token-${userId}`);
      await expect(api.recordBatch('pizarra', batch)).resolves.toEqual({ batchId: batch.batchId });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/boards/pizarra/audit',
        expect.objectContaining({ method: 'POST', body: JSON.stringify(batch) }),
      );
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('no reintenta una escritura con otra cuenta al cambiar la cookie en otra pestana', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/login')) return jsonResponse(200, session('ana'));
      if (input.endsWith('/refresh')) return jsonResponse(200, session('beto'));
      return jsonResponse(401, { error: { code: 'unauthorized' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await login('ana@example.com', 'password');
    await expect(
      apiRequest('/projects', { method: 'POST', body: { displayName: 'Privado' } }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/projects')).toHaveLength(1);
    expect(currentAccessToken()).toBeNull();
  });

  it.each(['escritura', 'ZIP', 'XMI'] as const)(
    'no reenvia una peticion %s anterior tras iniciar otra cuenta',
    async (tipo) => {
      let responder!: (response: Response) => void;
      let cuenta = 'ana';
      let solicitudes = 0;
      const fetchMock = vi.fn((input: string) => {
        if (input.endsWith('/login') || input.endsWith('/refresh')) {
          return Promise.resolve(jsonResponse(200, session(cuenta)));
        }
        solicitudes += 1;
        if (solicitudes > 1) return Promise.resolve(jsonResponse(200, {}));
        return new Promise<Response>((resolve) => {
          responder = resolve;
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      await login('ana@example.com', 'password');
      const pendiente =
        tipo === 'ZIP'
          ? downloadGeneration('generacion', 'spring')
          : tipo === 'XMI'
            ? downloadXmi('pizarra', {})
            : apiRequest('/projects', { method: 'POST', body: { displayName: 'De Ana' } });
      const resultado = expect(pendiente).rejects.toMatchObject({ code: 'session_changed' });
      cuenta = 'beto';
      await login('beto@example.com', 'password');
      responder(jsonResponse(401, { error: { code: 'unauthorized' } }));
      await resultado;
      expect(fetchMock.mock.calls).toHaveLength(3);
      expect(currentAccessToken()).toBe('token-beto');
    },
  );

  it('descarta una respuesta exitosa de una cuenta anterior', async () => {
    let responder!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            responder = resolve;
          }),
      ),
    );
    setAccessToken('token-ana');
    const pendiente = apiRequest('/projects');
    const resultado = expect(pendiente).rejects.toMatchObject({ code: 'session_changed' });
    setAccessToken('token-beto');
    responder(jsonResponse(200, [{ displayName: 'Proyecto de Ana' }]));
    await resultado;
  });

  it('envia solo los lotes de la cuenta activa y conserva los de la anterior', async () => {
    const ana = crypto.randomUUID();
    const beto = crypto.randomUUID();
    const pending = [
      { boardId: crypto.randomUUID(), batch: auditBatch(ana) },
      { boardId: crypto.randomUUID(), batch: auditBatch(beto) },
    ];
    const storage = new Map([['uml_audit_queue_v1', JSON.stringify(pending)]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const fetchMock = vi.fn(async (input: string) =>
      jsonResponse(
        200,
        input.endsWith('/login') ? session(beto) : { batchId: pending[1]!.batch.batchId },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    // Offline reload has no API token, but the remembered account still needs
    // to see its pending count without exposing the other account's queue.
    expect(pendingAuditCount()).toBe(0);
    expect(pendingAuditCount(ana)).toBe(1);
    expect(pendingAuditCount(beto)).toBe(1);
    await login('beto@example.com', 'password');
    expect(pendingAuditCount()).toBe(1);
    await flushAuditQueue();
    expect(
      fetchMock.mock.calls.map(([path]) => path).filter((path) => path.endsWith('/audit')),
    ).toEqual([`/api/boards/${pending[1]!.boardId}/audit`]);
    expect(JSON.parse(storage.get('uml_audit_queue_v1')!)).toEqual([pending[0]]);
    expect(pendingAuditCount()).toBe(0);
  });

  it('envía la cola de la nueva cuenta aunque todavía haya un envío de la anterior', async () => {
    const ana = { boardId: crypto.randomUUID(), batch: auditBatch(crypto.randomUUID()) };
    const beto = { boardId: crypto.randomUUID(), batch: auditBatch(crypto.randomUUID()) };
    const storage = storePendingAudits([ana, beto]);
    let account = ana.batch.actorId;
    let confirmAna!: (response: Response) => void;
    let confirmBeto!: (response: Response) => void;
    const betoResponse = new Promise<Response>((resolve) => {
      confirmBeto = resolve;
    });
    const fetchMock = vi.fn(async (input: string, options?: RequestInit) => {
      if (input.endsWith('/login')) return jsonResponse(200, session(account));
      if (input.includes(ana.boardId)) {
        return new Promise<Response>((resolve) => {
          confirmAna = resolve;
        });
      }
      expect(options?.headers).toMatchObject({ authorization: `Bearer token-${account}` });
      return betoResponse;
    });
    vi.stubGlobal('fetch', fetchMock);

    await login('ana@example.com', 'password');
    const oldFlush = expect(flushAuditQueue()).rejects.toMatchObject({ code: 'session_changed' });
    account = beto.batch.actorId;
    await login('beto@example.com', 'password');
    const newFlush = flushAuditQueue();
    const checkedFlush = expect(newFlush).resolves.toBeUndefined();

    confirmAna(jsonResponse(202, { batchId: ana.batch.batchId }));
    await oldFlush;
    const repeatedFlush = flushAuditQueue();
    confirmBeto(jsonResponse(202, { batchId: beto.batch.batchId }));
    await checkedFlush;
    expect(repeatedFlush).toBe(newFlush);
    expect(JSON.parse(storage.get('uml_audit_queue_v1')!)).toEqual([ana]);
  });

  it('actualiza el contador cuando otra pestaña sincroniza la auditoría', async () => {
    const userId = crypto.randomUUID();
    const pending = { boardId: crypto.randomUUID(), batch: auditBatch(userId) };
    const storage = storePendingAudits([pending]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, session(userId))),
    );
    await login('ana@example.com', 'password');
    const browser = new EventTarget();
    vi.stubGlobal('window', browser);
    const onCount = vi.fn();
    const unsubscribe = subscribeAuditQueue(onCount);
    const event = Object.assign(new Event('storage'), { key: 'uml_audit_queue_v1' });

    expect(pendingAuditCount()).toBe(1);
    storage.set('uml_audit_queue_v1', '[]');
    browser.dispatchEvent(event);
    unsubscribe();
    browser.dispatchEvent(event);

    expect(onCount.mock.calls).toEqual([[0]]);
  });

  it('deja reintentar la cola si el envío de un lote no responde', async () => {
    const userId = crypto.randomUUID();
    const pending = { boardId: crypto.randomUUID(), batch: auditBatch(userId) };
    storePendingAudits([pending]);
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetchMock = vi.fn(async (input: string, options?: RequestInit) => {
      if (input.endsWith('/login')) return jsonResponse(200, session(userId));
      expect(options?.signal).toBe(deadline.signal);
      return new Promise<Response>((_resolve, reject) => {
        deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await login('ana@example.com', 'password');
      const failed = expect(flushAuditQueue()).rejects.toMatchObject({ name: 'TimeoutError' });
      deadline.abort(new DOMException('Se agotó el tiempo', 'TimeoutError'));
      await failed;
      expect(pendingAuditCount()).toBe(1);
    } finally {
      timeout.mockRestore();
    }

    fetchMock.mockResolvedValueOnce(jsonResponse(202, { batchId: pending.batch.batchId }));
    await flushAuditQueue();
    expect(pendingAuditCount()).toBe(0);
  });

  it('un lote de una pizarra eliminada no bloquea los de las otras pizarras', async () => {
    const userId = crypto.randomUUID();
    const pending = [
      { boardId: crypto.randomUUID(), batch: auditBatch(userId) },
      { boardId: crypto.randomUUID(), batch: auditBatch(userId) },
    ];
    const storage = new Map([['uml_audit_queue_v1', JSON.stringify(pending)]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/login')) return jsonResponse(200, session(userId));
        if (input.includes(pending[0]!.boardId))
          return jsonResponse(404, { error: { code: 'not_found' } });
        return jsonResponse(202, { batchId: pending[1]!.batch.batchId });
      }),
    );
    await login('ana@example.com', 'password');
    await flushAuditQueue();
    expect(JSON.parse(storage.get('uml_audit_queue_v1')!)).toEqual([pending[0]]);
  });
});

function storePendingAudits(pending: readonly { boardId: string; batch: CommandBatch }[]) {
  const storage = new Map([['uml_audit_queue_v1', JSON.stringify(pending)]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return storage;
}

function session(id: string) {
  return { accessToken: `token-${id}`, user: { id, email: `${id}@example.com`, displayName: id } };
}

function auditBatch(actorId: string): CommandBatch {
  const issuedAt = new Date().toISOString();
  return {
    batchId: crypto.randomUUID(),
    actorId,
    origin: 'GUI',
    issuedAt,
    commands: [
      {
        commandId: crypto.randomUUID(),
        actorId,
        origin: 'GUI',
        issuedAt,
        type: 'CREATE_CLASS',
        payload: { classId: crypto.randomUUID(), displayName: 'Cliente' },
      },
    ],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
