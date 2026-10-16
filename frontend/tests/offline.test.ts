import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cachedBoard,
  cachedBoards,
  downgradeBoard,
  forgetBoard,
  forgetUser,
  markLogout,
  offlineUser,
  rememberBoard,
  rememberUser,
} from '../src/lib/offline.js';

function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    key: (i) => [...data.keys()][i] ?? null,
    clear: () => {
      data.clear();
    },
  };
}

describe('identidad y catálogo offline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('separa pizarras por usuario y conserva borradores al revocar el catálogo', () => {
    vi.stubGlobal('localStorage', storage());
    const board = {
      id: 'board',
      projectId: 'project',
      displayName: 'Ventas',
      room: 'room',
      role: 'EDITOR' as const,
    };
    rememberBoard('ana', board);
    expect(cachedBoard('beto', board.id)).toBeNull();
    expect(cachedBoards('beto')).toEqual([]);
    expect(cachedBoards('ana')).toEqual([board]);
    localStorage.setItem('uml_board_draft_v1:ana:room:tab', 'pending');
    forgetBoard('ana', board.id);
    expect(cachedBoards('ana')).toEqual([]);
    expect(localStorage.getItem('uml_board_draft_v1:ana:room:tab')).toBe('pending');
  });

  it('degrada la entrada a lectura al perder la edición, sin retirarla', () => {
    vi.stubGlobal('localStorage', storage());
    const board = {
      id: 'board',
      projectId: 'project',
      displayName: 'Ventas',
      room: 'room',
      role: 'OWNER' as const,
    };
    rememberBoard('ana', board);
    downgradeBoard('ana', board.id);
    // La copia sigue siendo la del servidor: se puede abrir, pero no editar.
    expect(cachedBoard('ana', board.id)?.role).toBe('VIEWER');
    downgradeBoard('ana', board.id);
    expect(cachedBoard('ana', board.id)?.role).toBe('VIEWER');
    expect(() => downgradeBoard('ana', 'inexistente')).not.toThrow();
    expect(cachedBoard('ana', 'inexistente')).toBeNull();
  });

  it('sin espacio para degradarla, retira la entrada en lugar de dejar el rol anterior', () => {
    const almacen = storage();
    vi.stubGlobal('localStorage', almacen);
    const board = {
      id: 'board',
      projectId: 'project',
      displayName: 'Ventas',
      room: 'room',
      role: 'EDITOR' as const,
    };
    rememberBoard('ana', board);
    almacen.setItem = () => {
      throw new DOMException('Cuota agotada', 'QuotaExceededError');
    };
    downgradeBoard('ana', board.id);
    expect(cachedBoard('ana', board.id)).toBeNull();
  });

  it('guarda solo el perfil y bloquea restaurarlo cuando queda un logout pendiente', () => {
    vi.stubGlobal('localStorage', storage());
    const user = { id: 'ana', email: 'ana@example.com', displayName: 'Ana', accessToken: 'secret' };
    rememberUser(user);
    expect(offlineUser()).toEqual({ id: 'ana', email: 'ana@example.com', displayName: 'Ana' });
    expect(localStorage.getItem('uml_offline_user_v1')).not.toContain('secret');
    markLogout(true);
    expect(offlineUser()).toBeNull();
    forgetUser();
    markLogout(false);
    expect(offlineUser()).toBeNull();
  });

  it('ignora datos corruptos y el bloqueo de almacenamiento no rompe el arranque', () => {
    vi.stubGlobal('localStorage', storage());
    localStorage.setItem('uml_offline_user_v1', '{invalid');
    localStorage.setItem(
      'uml_offline_board_v1:ana:board',
      JSON.stringify({ id: 'board', role: 'ADMIN' }),
    );
    expect(offlineUser()).toBeNull();
    expect(cachedBoard('ana', 'board')).toBeNull();
    vi.stubGlobal('localStorage', undefined);
    expect(offlineUser()).toBeNull();
    expect(cachedBoards('ana')).toEqual([]);
    expect(() => rememberUser({ id: 'ana', email: '', displayName: '' })).not.toThrow();
  });
});
