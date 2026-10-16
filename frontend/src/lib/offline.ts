import type { BoardSummary, ProjectRole, SessionUser } from './api.js';

// No credentials: this profile only identifies whose local copies may be opened.
export const OFFLINE_USER_KEY = 'uml_offline_user_v1';
const LOGOUT_KEY = 'uml_offline_logout_v1';
const BOARD_PREFIX = 'uml_offline_board_v1:';
export type OfflineBoard = BoardSummary & { role: ProjectRole };

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function offlineUser(): SessionUser | null {
  if (logoutPending()) return null;
  const value = read(OFFLINE_USER_KEY);
  return record(value) &&
    typeof value['id'] === 'string' &&
    typeof value['email'] === 'string' &&
    typeof value['displayName'] === 'string'
    ? { id: value['id'], email: value['email'], displayName: value['displayName'] }
    : null;
}

export function rememberUser(user: SessionUser): void {
  try {
    const { id, email, displayName } = user;
    localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify({ id, email, displayName }));
  } catch {
    /* Online use remains possible when storage is disabled. */
  }
}

export function forgetUser(): void {
  try {
    localStorage.removeItem(OFFLINE_USER_KEY);
  } catch {
    /* Unavailable storage. */
  }
}

export function logoutPending(): boolean {
  return read(LOGOUT_KEY) === true;
}

export function markLogout(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(LOGOUT_KEY, 'true');
    else localStorage.removeItem(LOGOUT_KEY);
  } catch {
    /* Unavailable storage. */
  }
}

function boardKey(userId: string, boardId: string): string {
  return `${BOARD_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(boardId)}`;
}

export function cachedBoard(userId: string, boardId: string): OfflineBoard | null {
  const value = read(boardKey(userId, boardId));
  if (
    !record(value) ||
    value['id'] !== boardId ||
    typeof value['projectId'] !== 'string' ||
    typeof value['displayName'] !== 'string' ||
    typeof value['room'] !== 'string' ||
    !['OWNER', 'EDITOR', 'VIEWER'].includes(String(value['role']))
  )
    return null;
  return value as unknown as OfflineBoard;
}

/**
 * Call only after saving a server-synchronized document and verifying its scope.
 *
 * Unlike the profile helpers this one lets a storage failure through on purpose:
 * the caller advertises the board as available offline, and it may only do so
 * once the entry is really on disk.
 */
export function rememberBoard(userId: string, board: OfflineBoard): void {
  localStorage.setItem(boardKey(userId, board.id), JSON.stringify(board));
}

/**
 * Keeps an authorized copy openable, without its former write permission.
 *
 * Losing write access does not invalidate the local document — it is still the
 * server's — so the entry survives as read-only instead of being removed. Only a
 * revoked board justifies `forgetBoard`.
 */
export function downgradeBoard(userId: string, boardId: string): void {
  const board = cachedBoard(userId, boardId);
  if (board === null || board.role === 'VIEWER') return;
  try {
    localStorage.setItem(boardKey(userId, boardId), JSON.stringify({ ...board, role: 'VIEWER' }));
  } catch {
    // Sin espacio para reescribirla, la entrada anterior no puede quedarse: su
    // rol permitiria editar una copia que ya no se puede publicar.
    forgetBoard(userId, boardId);
  }
}

export function forgetBoard(userId: string, boardId: string): void {
  try {
    localStorage.removeItem(boardKey(userId, boardId));
  } catch {
    /* Keep drafts. */
  }
}

export function cachedBoards(userId: string): OfflineBoard[] {
  const result: OfflineBoard[] = [];
  try {
    const prefix = `${BOARD_PREFIX}${encodeURIComponent(userId)}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const board = cachedBoard(userId, decodeURIComponent(key.slice(prefix.length)));
      if (board !== null) result.push(board);
    }
  } catch {
    /* Return only readable entries. */
  }
  return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
