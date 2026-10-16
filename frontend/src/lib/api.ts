import { commandBatchSchema, type CommandBatch } from '@uml/contracts';
import { forgetUser, markLogout } from './offline.js';

/**
 * Cliente HTTP de la plataforma.
 *
 * El token de acceso vive **en memoria**, no en `localStorage`: cualquier script
 * que se cuele en la pagina puede leer el almacenamiento local, y ahi el token
 * sobreviviria a la pestana. El de refresco viaja en cookie de solo HTTP, que el
 * JavaScript de la pagina no ve.
 *
 * El precio es que recargar pierde el token de acceso. Se recupera al arrancar
 * llamando a `/auth/refresh`, que es justamente para lo que existe.
 */

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * El servidor no llego a contestar.
 *
 * No es un `ApiError`: no hay respuesta ni codigo que interpretar, y quien
 * distingue «el servidor rechazo esto» de «no hubo servidor» necesita que los
 * dos casos no compartan tipo. `fetch` lo senala con un `TypeError`, el mismo
 * que produciria un error de programacion en esta capa, asi que se traduce en el
 * unico sitio que sabe que venia de la red.
 */
export class NetworkError extends Error {
  public constructor(cause: unknown) {
    super('No se pudo contactar al servidor.', { cause });
    this.name = 'NetworkError';
  }
}

let accessToken: string | null = null;
let sessionUserId: string | null = null;
let sessionRevision = 0;
let refreshInFlight: Promise<boolean> | null = null;
let signingOut = false;
let logoutInFlight: Promise<void> | null = null;
let refreshFailure: unknown = null;

/** A failed network/server request must not be mistaken for rejected credentials. */
export function sessionRefreshUnavailable(): boolean {
  return refreshFailure !== null;
}

export function isConnectionUnavailable(error: unknown): boolean {
  return (
    error instanceof NetworkError ||
    (error instanceof ApiError && error.status >= 500) ||
    (error instanceof Error && error.name === 'TimeoutError')
  );
}
const AUDIT_QUEUE_KEY = 'uml_audit_queue_v1';
let auditFlushInFlight: Promise<void> | null = null;

export function currentAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  sessionRevision += 1;
  if (token === null) sessionUserId = null;
}

interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Interno: evita reintentar en bucle si la propia renovacion devuelve 401. */
  readonly skipRefresh?: boolean;
  /** Evita reenviar un cambio pendiente con la cuenta de otra pestaña. */
  readonly expectedUserId?: string;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestWithSession(path, options, leer<T>);
}

async function requestWithSession<T>(
  path: string,
  options: RequestOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  // Una peticion pertenece a la sesion que la inicio. Un 401 tardio no puede
  // repetir una escritura con la cuenta que haya entrado mientras esperaba.
  const revision = sessionRevision;
  const comprobarSesion = (): void => {
    options.signal?.throwIfAborted();
    if (revision !== sessionRevision) {
      throw new ApiError(401, 'session_changed', 'La cuenta de la sesión cambió.');
    }
  };
  let respuesta = await enviar(path, options);
  comprobarSesion();

  // Una sola renovacion por peticion: si el token acaba de expirar se renueva y
  // se repite, y si eso tampoco vale, la sesion se acabo de verdad.
  if (respuesta.status === 401 && options.skipRefresh !== true) {
    const renovado = await refreshSession();
    comprobarSesion();
    if (renovado) {
      respuesta = await enviar(path, options);
      comprobarSesion();
    } else if (refreshFailure !== null) {
      // El 401 pertenecía al acceso vencido. La renovación no pudo comprobar
      // la sesión: conserva su causa para permitir la copia local y el reintento.
      throw refreshFailure;
    }
  }

  const result = await read(respuesta);
  // Tambien puede cambiar la cuenta mientras se descarga el cuerpo del ZIP/JSON.
  comprobarSesion();
  return result;
}

async function enviar(path: string, options: RequestOptions): Promise<Response> {
  options.signal?.throwIfAborted();
  if (options.expectedUserId !== undefined && options.expectedUserId !== sessionUserId) {
    throw new ApiError(401, 'session_changed', 'La cuenta de la sesión cambió.');
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (accessToken !== null) headers['authorization'] = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  // Fuera del `try`: serializar un cuerpo imposible tambien lanza `TypeError`, y
  // eso es un error de programacion, no una red caida.
  const peticion: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    // Sin esto la cookie de refresco no viaja y la sesion se pierde al recargar.
    credentials: 'include',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  };

  try {
    return await fetch(`/api${path}`, peticion);
  } catch (error) {
    // Un aborto o un plazo vencido son decisiones nuestras: los distingue su
    // propio nombre y suben tal cual.
    if (error instanceof TypeError) throw new NetworkError(error);
    throw error;
  }
}

async function leer<T>(respuesta: Response): Promise<T> {
  if (respuesta.status === 204) return undefined as T;

  const cuerpo: unknown = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    const error = (cuerpo as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      respuesta.status,
      error?.code ?? 'unknown',
      error?.message ?? `Error ${respuesta.status}`,
      error?.details,
    );
  }

  return cuerpo as T;
}

interface SessionResponse {
  readonly accessToken: string;
  readonly user: SessionUser;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  // Offline logout immediately shows login. Its delayed response must not clear
  // the token/cookie of a new login started from that screen.
  await logoutInFlight;
  // The promise above only coordinates this tab. The cookie is shared by every
  // tab, so login must use the same browser lock as logout and token refresh.
  return withSessionLock(async () => {
    const sesion = await apiRequest<SessionResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipRefresh: true,
    });
    setAccessToken(sesion.accessToken);
    sessionUserId = sesion.user.id;
    markLogout(false);
    return sesion.user;
  });
}

export interface RegistrationResponse {
  readonly verificationRequired: true;
  readonly emailSent: boolean;
}

export async function register(
  email: string,
  displayName: string,
  password: string,
): Promise<RegistrationResponse> {
  return apiRequest<RegistrationResponse>('/auth/register', {
    method: 'POST',
    body: { email, displayName, password },
    skipRefresh: true,
  });
}

export const verification = {
  resend: (email: string) =>
    apiRequest<{ sent: true }>('/auth/verification/resend', {
      method: 'POST',
      body: { email },
      skipRefresh: true,
    }),
  confirm: (token: string) =>
    apiRequest<{ verified: true }>('/auth/verification/confirm', {
      method: 'POST',
      body: { token },
      skipRefresh: true,
    }),
};

export function logout(): Promise<void> {
  logoutInFlight ??= performLogout().finally(() => {
    logoutInFlight = null;
  });
  return logoutInFlight;
}

async function performLogout(): Promise<void> {
  signingOut = true;
  markLogout(true);
  forgetUser();
  // Una renovacion que ya estaba en vuelo no debe resucitar esta sesion.
  setAccessToken(null);
  // Esperar tambien su Set-Cookie permite revocar la cookie rotada, incluso
  // cuando la respuesta de refresh llega despues de pulsar Salir.
  await refreshInFlight;
  await withSessionLock(() =>
    apiRequest<void>('/auth/logout', {
      method: 'POST',
      skipRefresh: true,
      signal: AbortSignal.timeout(8000),
    }),
  )
    .then(() => markLogout(false))
    .catch(() => undefined);
  setAccessToken(null);
  signingOut = false;
}

/** Devuelve `true` si habia una sesion viva que renovar. */
export function refreshSession(): Promise<boolean> {
  if (signingOut) return Promise.resolve(false);
  // Varias peticiones pueden descubrir a la vez que el token de acceso expiro.
  // El token de refresco es de un solo uso, asi que todas deben compartir una
  // unica rotacion en lugar de competir por consumirlo.
  refreshInFlight ??= withSessionLock(performRefresh).finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function performRefresh(): Promise<boolean> {
  if (signingOut) return false;
  refreshFailure = null;
  const revision = sessionRevision;
  const previousUserId = sessionUserId;
  try {
    const sesion = await apiRequest<SessionResponse>('/auth/refresh', {
      method: 'POST',
      skipRefresh: true,
      signal: AbortSignal.timeout(8000),
    });
    if (revision !== sessionRevision) return false;
    if (previousUserId !== null && previousUserId !== sesion.user.id) {
      setAccessToken(null);
      return false;
    }
    accessToken = sesion.accessToken;
    sessionUserId = sesion.user.id;
    void flushAuditQueue().catch(() => undefined);
    return true;
  } catch (error) {
    refreshFailure = isConnectionUnavailable(error) ? error : null;
    if (revision === sessionRevision) accessToken = null;
    return false;
  }
}

async function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || navigator.locks === undefined) return action();

  // `await` y no `return` a secas: la firma de `request` resuelve al valor que
  // devuelve la funcion, y como la nuestra devuelve una promesa el tipo saldria
  // como `Promise<Promise<T>>`. Esperarlo aqui lo aplana y evita el `as`.
  return await navigator.locks.request('uml-refresh-session', action);
}

export async function fetchMe(signal?: AbortSignal): Promise<SessionUser> {
  return apiRequest<SessionUser>('/auth/me', signal === undefined ? {} : { signal });
}

// ---------------------------------------------------------------------------
// Perfil y contrasena (RF-A10 y RF-A11)
// ---------------------------------------------------------------------------

/**
 * La foto se pide por su URL, no en el JSON del perfil.
 *
 * Asi el navegador la cachea como cualquier imagen y no viaja en base64 en cada
 * lectura del perfil. `v` cambia al subir una nueva para saltarse esa cache.
 */
export function avatarUrl(userId: string, version = 0): string {
  return `/api/auth/users/${userId}/avatar?v=${version}`;
}

export const perfil = {
  actualizar: (displayName: string) =>
    apiRequest<SessionUser>('/auth/me', { method: 'PATCH', body: { displayName } }),

  subirAvatar: (image: string, mediaType: string) =>
    apiRequest<{ hasAvatar: boolean; bytes: number }>('/auth/me/avatar', {
      method: 'PUT',
      body: { image, mediaType },
    }),

  quitarAvatar: () => apiRequest<void>('/auth/me/avatar', { method: 'DELETE' }),

  cambiarPassword: (currentPassword: string, newPassword: string) =>
    apiRequest<{ changed: boolean }>('/auth/me/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  /** Siempre responde igual, exista o no la cuenta: no revela quien esta registrado. */
  pedirRecuperacion: (email: string) =>
    apiRequest<{ sent: boolean }>('/auth/password/forgot', {
      method: 'POST',
      body: { email },
      skipRefresh: true,
    }),

  restablecer: (token: string, newPassword: string) =>
    apiRequest<{ reset: boolean }>('/auth/password/reset', {
      method: 'POST',
      body: { token, newPassword },
      skipRefresh: true,
    }),
};

// ---------------------------------------------------------------------------
// Proyectos y pizarras
// ---------------------------------------------------------------------------

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface ProjectSummary {
  readonly id: string;
  readonly displayName: string;
  readonly role: ProjectRole;
  readonly boardCount: number;
  readonly memberCount: number;
}

export interface BoardSummary {
  readonly id: string;
  readonly projectId: string;
  readonly displayName: string;
  readonly room: string;
}

export interface ProjectDetail {
  readonly id: string;
  readonly displayName: string;
  readonly role: ProjectRole;
  readonly boards: readonly { id: string; displayName: string }[];
}

/** Estado de la emision del artefacto (ADR-018). */
export type GenerationStatus = 'CREATING' | 'READY' | 'FAILED';

export interface GenerationSummary {
  readonly id: string;
  readonly snapshotVersion: number;
  readonly createdAt: string;
  readonly status: GenerationStatus;
  /** Nombre con el que se genero, no el actual de la pizarra. */
  readonly projectName: string;
  readonly basePackage: string;
  readonly templatesHash: string;
  readonly springSha256: string | null;
  readonly mobileSha256?: string | null;
  readonly error: string | null;
  readonly author: { id: string; displayName: string; email: string };
}

export interface GenerationResult {
  readonly id: string;
  readonly boardId: string;
  readonly snapshotVersion: number;
  readonly createdAt: string;
  readonly status: GenerationStatus;
  readonly artifactName: string;
  readonly basePackage: string;
  readonly entities: number;
  readonly sha256: { spring: string };
}

export interface ProjectMember {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: ProjectRole;
}

export interface ProjectInvite {
  readonly id: string;
  readonly code: string;
  readonly role: 'EDITOR' | 'VIEWER';
  readonly expiresAt: string;
}

export const api = {
  listProjects: () => apiRequest<ProjectSummary[]>('/projects'),

  createProject: (displayName: string) =>
    apiRequest<{ id: string }>('/projects', { method: 'POST', body: { displayName } }),

  getProject: (projectId: string) => apiRequest<ProjectDetail>(`/projects/${projectId}`),

  deleteProject: (projectId: string) =>
    apiRequest<void>(`/projects/${projectId}`, { method: 'DELETE' }),

  listMembers: (projectId: string) => apiRequest<ProjectMember[]>(`/projects/${projectId}/members`),
  changeMemberRole: (projectId: string, userId: string, role: 'EDITOR' | 'VIEWER') =>
    apiRequest(`/projects/${projectId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (projectId: string, userId: string) =>
    apiRequest<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
  listInvites: (projectId: string) => apiRequest<ProjectInvite[]>(`/projects/${projectId}/invites`),
  revokeInvite: (projectId: string, inviteId: string) =>
    apiRequest<void>(`/projects/${projectId}/invites/${inviteId}`, { method: 'DELETE' }),

  createInvite: (projectId: string, role: 'EDITOR' | 'VIEWER') =>
    apiRequest<{ code: string }>(`/projects/${projectId}/invites`, {
      method: 'POST',
      body: { role },
    }),

  acceptInvite: (code: string) =>
    apiRequest<{ projectId: string; role: ProjectRole }>(`/invites/${code}/accept`, {
      method: 'POST',
    }),

  listBoards: (projectId: string) => apiRequest<BoardSummary[]>(`/projects/${projectId}/boards`),

  createBoard: (projectId: string, displayName: string) =>
    apiRequest<BoardSummary>(`/projects/${projectId}/boards`, {
      method: 'POST',
      body: { displayName },
    }),

  getBoard: (boardId: string, signal?: AbortSignal) =>
    apiRequest<BoardSummary & { role: ProjectRole }>(
      `/boards/${boardId}`,
      signal === undefined ? {} : { signal },
    ),

  renameBoard: (boardId: string, displayName: string) =>
    apiRequest<BoardSummary>(`/boards/${boardId}`, { method: 'PATCH', body: { displayName } }),

  deleteBoard: (boardId: string) => apiRequest<void>(`/boards/${boardId}`, { method: 'DELETE' }),

  // -------------------------------------------------------------------------
  // Generacion (RF-060 a RF-072)
  // -------------------------------------------------------------------------

  generate: (boardId: string, basePackage?: string, includeMobile = false) =>
    apiRequest<GenerationResult>(`/boards/${boardId}/generations`, {
      method: 'POST',
      body: {
        includeMobile,
        ...(basePackage === undefined || basePackage.trim() === '' ? {} : { basePackage }),
      },
    }),

  listGenerations: (boardId: string) =>
    apiRequest<GenerationSummary[]>(`/boards/${boardId}/generations`),

  /**
   * Quita una generacion del historial y libera su version congelada en el
   * servidor. No hay ningun ZIP que borrar: se regenera al descargar.
   */
  deleteGeneration: (generationId: string) =>
    apiRequest<void>(`/generations/${generationId}`, { method: 'DELETE' }),

  /**
   * Registra el lote para auditoria (RF-A09).
   *
   * No se espera la respuesta en el camino de edicion: el lote ya se aplico en
   * el documento cuando esto se llama, y un fallo al registrar no puede deshacer
   * lo que el usuario ya ve en pantalla. Se avisa por consola y se sigue.
   */
  recordBatch: recordBatchReliable,
};

interface PendingAudit {
  readonly boardId: string;
  readonly batch: CommandBatch;
}

const auditQueueListeners = new Set<(count: number) => void>();

/**
 * Guarda el lote antes de enviarlo. Si la API o la red fallan, `online`, una
 * renovacion de sesion o el siguiente cambio vuelven a intentar la cola. El
 * servidor es idempotente por boardId+batchId, asi que repetir es seguro.
 */
async function recordBatchReliable(
  boardId: string,
  batch: CommandBatch,
): Promise<{ batchId: string }> {
  const cola = readAuditQueue();
  if (!cola.some((item) => item.boardId === boardId && item.batch.batchId === batch.batchId)) {
    writeAuditQueue([...cola, { boardId, batch }]);
  }

  // Navegacion privada o una politica corporativa pueden deshabilitar storage.
  // En ese caso no fingimos que se encolo: se conserva el envio inmediato.
  if (
    !readAuditQueue().some(
      (item) => item.boardId === boardId && item.batch.batchId === batch.batchId,
    )
  ) {
    return apiRequest<{ batchId: string }>(`/boards/${boardId}/audit`, {
      method: 'POST',
      body: batch,
      expectedUserId: batch.actorId,
    });
  }

  await flushAuditQueue();
  return { batchId: batch.batchId };
}

export function flushAuditQueue(): Promise<void> {
  auditFlushInFlight ??= performAuditFlush().finally(() => {
    auditFlushInFlight = null;
  });
  return auditFlushInFlight;
}

export function pendingAuditCount(userId: string | null = sessionUserId): number {
  return readAuditQueue().filter((item) => item.batch.actorId === userId).length;
}

export function subscribeAuditQueue(listener: (count: number) => void): () => void {
  auditQueueListeners.add(listener);
  return () => auditQueueListeners.delete(listener);
}

async function performAuditFlush(): Promise<void> {
  // Conservamos lotes rechazados para recuperarlos, pero no bloquean las otras
  // pizarras. Cada pasada intenta cada lote como maximo una vez.
  const attempted = new Set<string>();
  for (;;) {
    const item = readAuditQueue().find(
      (pending) =>
        pending.batch.actorId === sessionUserId &&
        !attempted.has(`${pending.boardId}:${pending.batch.batchId}`),
    );
    if (item === undefined) return;
    attempted.add(`${item.boardId}:${item.batch.batchId}`);
    try {
      await apiRequest<{ batchId: string }>(`/boards/${item.boardId}/audit`, {
        method: 'POST',
        body: item.batch,
        expectedUserId: item.batch.actorId,
      });
    } catch (error) {
      if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) continue;
      throw error;
    }
    writeAuditQueue(
      readAuditQueue().filter(
        (pending) =>
          pending.boardId !== item.boardId || pending.batch.batchId !== item.batch.batchId,
      ),
    );
  }
}

function readAuditQueue(): PendingAudit[] {
  try {
    // El propio getter puede lanzar SecurityError cuando el navegador bloquea storage.
    if (typeof localStorage === 'undefined') return [];
    const parsed: unknown = JSON.parse(localStorage.getItem(AUDIT_QUEUE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): PendingAudit[] => {
      if (typeof item !== 'object' || item === null || !('boardId' in item) || !('batch' in item)) {
        return [];
      }
      const boardId = item.boardId;
      const batch = commandBatchSchema.safeParse(item.batch);
      return typeof boardId === 'string' && batch.success ? [{ boardId, batch: batch.data }] : [];
    });
  } catch {
    return [];
  }
}

function writeAuditQueue(items: readonly PendingAudit[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUDIT_QUEUE_KEY, JSON.stringify(items));
    for (const listener of auditQueueListeners) listener(pendingAuditCount());
  } catch {
    // Si el almacenamiento esta deshabilitado, la peticion inmediata aun se
    // intenta; el error vuelve al llamante y se muestra en consola.
  }
}

/** Exporta XMI con la misma renovacion de sesion que el resto del cliente. */
export async function downloadXmi(
  boardId: string,
  model: unknown,
  layout?: unknown,
  format: 'EA_21' | 'UML_251' = 'EA_21',
): Promise<{ blob: Blob; fileName: string }> {
  return requestWithSession(
    `/boards/${boardId}/export/xmi`,
    { method: 'POST', body: { model, format, ...(layout === undefined ? {} : { layout }) } },
    (respuesta) => readDownload(respuesta, 'pizarra.xmi'),
  );
}

/**
 * Descarga un artefacto generado.
 *
 * No usa `apiRequest` porque la respuesta no es JSON: son los bytes de un ZIP.
 * El token va en la cabecera igual, y el nombre del archivo sale de
 * `content-disposition` para que el navegador guarde el nombre que decidio el
 * servidor y no uno inventado aqui.
 */
export async function downloadGeneration(
  generationId: string,
  target: 'spring' | 'mobile',
): Promise<{ blob: Blob; fileName: string }> {
  return requestWithSession(
    `/generations/${generationId}/download?target=${target}`,
    {},
    (respuesta) => readDownload(respuesta, `generacion-${target}.zip`),
  );
}

async function readDownload(
  respuesta: Response,
  fallback: string,
): Promise<{ blob: Blob; fileName: string }> {
  if (!respuesta.ok) await throwApiError(respuesta);
  return {
    blob: await respuesta.blob(),
    fileName: filenameFrom(respuesta, fallback),
  };
}

async function throwApiError(respuesta: Response): Promise<never> {
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  const error = (cuerpo as { error?: { code?: string; message?: string; details?: unknown } })
    ?.error;
  throw new ApiError(
    respuesta.status,
    error?.code ?? 'unknown',
    error?.message ?? `Error ${respuesta.status}`,
    error?.details,
  );
}

function filenameFrom(respuesta: Response, fallback: string): string {
  const disposicion = respuesta.headers.get('content-disposition') ?? '';
  return /filename="([^"]+)"/.exec(disposicion)?.[1] ?? fallback;
}
