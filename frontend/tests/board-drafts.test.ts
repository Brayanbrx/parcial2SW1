import { describe, expect, it } from 'vitest';
import type { CommandBatch } from '@uml/contracts';
import { readBoardState } from '@uml/yjs-adapter';
import * as Y from 'yjs';
import { BoardDrafts } from '../src/features/editor/board-drafts.js';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function createClass(name: string): CommandBatch {
  const meta = {
    actorId: crypto.randomUUID(),
    origin: 'GUI' as const,
    issuedAt: new Date().toISOString(),
  };
  return {
    ...meta,
    batchId: crypto.randomUUID(),
    commands: [
      {
        ...meta,
        commandId: crypto.randomUUID(),
        type: 'CREATE_CLASS',
        payload: { classId: crypto.randomUUID(), displayName: name },
      },
    ],
  };
}

describe('copia local del editor', () => {
  it('abre varios borradores sin reescribirlos aunque no quede cuota', () => {
    const storage = new MemoryStorage();
    const snapshot = new Y.Doc();
    const first = new Y.Doc();
    const second = new Y.Doc();
    const reopened = new Y.Doc();
    const drafts = new BoardDrafts(storage, 'ana', 'ventas');
    drafts.snapshot(snapshot);
    new BoardDrafts(storage, 'ana', 'ventas').apply(first, createClass('Primera'));
    new BoardDrafts(storage, 'ana', 'ventas').apply(second, createClass('Segunda'));
    const before = Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index)!;
      return [key, storage.getItem(key)] as const;
    });
    let writes = 0;
    storage.setItem = () => {
      writes++;
      throw new Error('QuotaExceededError');
    };
    try {
      expect(drafts.openOffline(reopened, true)).toBe(true);
      expect(
        readBoardState(reopened)
          .semantic.classes.map((item) => item.displayName)
          .sort(),
      ).toEqual(['Primera', 'Segunda']);
      expect(writes).toBe(0);
      expect(storage.length).toBe(before.length);
      for (const [key, value] of before) expect(storage.getItem(key)).toBe(value);
    } finally {
      snapshot.destroy();
      first.destroy();
      second.destroy();
      reopened.destroy();
    }
  });

  it('abre una pizarra visitada sin ediciones y conserva actualizaciones remotas', () => {
    const storage = new MemoryStorage();
    const doc = new Y.Doc();
    const drafts = new BoardDrafts(storage, 'ana', 'ventas');
    drafts.snapshot(doc);
    const empty = new Y.Doc();
    expect(drafts.openOffline(empty, false)).toBe(true);
    new BoardDrafts(new MemoryStorage(), 'beto', 'ventas').apply(doc, createClass('Remota'));
    drafts.snapshot(doc);
    const reopened = new Y.Doc();
    expect(drafts.openOffline(reopened, false)).toBe(true);
    expect(readBoardState(reopened).semantic.classes[0]?.displayName).toBe('Remota');
    expect(new BoardDrafts(storage, 'otro', 'ventas').openOffline(new Y.Doc(), true)).toBe(false);
    doc.destroy();
    empty.destroy();
    reopened.destroy();
  });

  it('un lector abre el estado autorizado sin mezclar antiguos borradores de edición', () => {
    const storage = new MemoryStorage();
    const drafts = new BoardDrafts(storage, 'ana', 'ventas');
    const local = new Y.Doc();
    drafts.apply(local, createClass('Pendiente'));
    const authorized = new Y.Doc();
    drafts.snapshot(authorized);
    const reader = new Y.Doc();
    drafts.openOffline(reader, false);
    expect(readBoardState(reader).semantic.classes).toEqual([]);
    const editor = new Y.Doc();
    drafts.openOffline(editor, true);
    expect(readBoardState(editor).semantic.classes[0]?.displayName).toBe('Pendiente');
    local.destroy();
    authorized.destroy();
    reader.destroy();
    editor.destroy();
  });

  it('no abre una instantánea corrupta como si fuera una pizarra vacía editable', () => {
    const storage = new MemoryStorage();
    storage.setItem('uml_board_snapshot_v1:ana:ventas', 'not-base64!');
    const doc = new Y.Doc();
    expect(() => new BoardDrafts(storage, 'ana', 'ventas').openOffline(doc, true)).toThrow();
    expect(readBoardState(doc).semantic.classes).toEqual([]);
    doc.destroy();
  });

  it('una copia antigua no resucita una clase eliminada por otro participante', () => {
    const storage = new MemoryStorage();
    const doc = new Y.Doc();
    new BoardDrafts(storage, 'ana', 'ventas').apply(doc, createClass('Eliminada'));
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const id = readBoardState(remote).semantic.classes[0]!.id;
    remote.getMap('classes').delete(id);
    new BoardDrafts(storage, 'ana', 'ventas').restore(remote);
    expect(readBoardState(remote).semantic.classes).toHaveLength(0);
    doc.destroy();
    remote.destroy();
  });

  it('recupera cambios al cerrar antes de sincronizar y fusiona los del servidor', () => {
    const storage = new MemoryStorage();
    const doc = new Y.Doc();
    const drafts = new BoardDrafts(storage, 'ana', 'ventas');
    drafts.apply(doc, createClass('Local'));
    doc.destroy();
    const reopened = new Y.Doc();
    new BoardDrafts(new MemoryStorage(), 'beto', 'ventas').apply(reopened, createClass('Remota'));
    expect(new BoardDrafts(storage, 'ana', 'ventas').restore(reopened)).toBe(true);
    expect(
      readBoardState(reopened)
        .semantic.classes.map((c) => c.displayName)
        .sort(),
    ).toEqual(['Local', 'Remota']);
    const duplicate = new Y.Doc();
    new BoardDrafts(storage, 'ana', 'ventas').restore(duplicate);
    expect(readBoardState(duplicate)).toEqual(readBoardState(reopened));
    reopened.destroy();
    duplicate.destroy();
  });

  it('conserva las ediciones de dos pestañas sin mezclarlas con otra cuenta o pizarra', () => {
    const storage = new MemoryStorage();
    const first = new Y.Doc();
    const second = new Y.Doc();
    const restored = new Y.Doc();
    new BoardDrafts(storage, 'ana', 'ventas').apply(first, createClass('Primera'));
    new BoardDrafts(storage, 'ana', 'ventas').apply(second, createClass('Segunda'));
    expect(new BoardDrafts(storage, 'beto', 'ventas').restore(restored)).toBe(false);
    expect(new BoardDrafts(storage, 'ana', 'otra').restore(restored)).toBe(false);
    new BoardDrafts(storage, 'ana', 'ventas').restore(restored);
    expect(readBoardState(restored).semantic.classes).toHaveLength(2);
    first.destroy();
    second.destroy();
    restored.destroy();
  });

  it('rechaza la edición antes de modificar el documento si el disco está lleno', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const doc = new Y.Doc();
    expect(() =>
      new BoardDrafts(storage, 'ana', 'ventas').apply(doc, createClass('Perdida')),
    ).toThrow();
    expect(readBoardState(doc).semantic.classes).toEqual([]);
    doc.destroy();
  });
});
