import type { CommandBatch } from '@uml/contracts';
import { applyBatchToDocument, readBoardState } from '@uml/yjs-adapter';
import * as Y from 'yjs';

/** A separate slot per mounted editor avoids overwriting another tab's offline work. */
export class BoardDrafts {
  private readonly prefix: string;
  private readonly key: string;
  private readonly snapshotKey: string;

  constructor(
    private readonly storage: Storage,
    userId: string,
    room: string,
  ) {
    this.prefix = `uml_board_draft_v1:${encodeURIComponent(userId)}:${encodeURIComponent(room)}:`;
    this.key = this.prefix + crypto.randomUUID();
    this.snapshotKey = `uml_board_snapshot_v1:${encodeURIComponent(userId)}:${encodeURIComponent(room)}`;
  }

  /**
   * Last authorized server state, also saved for readers and untouched boards.
   *
   * Throws when storage rejects the write: the caller shows the board as
   * available offline and must not claim that before the copy exists.
   */
  snapshot(doc: Y.Doc): void {
    this.storage.setItem(this.snapshotKey, encode(Y.encodeStateAsUpdate(doc)));
  }

  /** Offline replicas never go directly into a provider; reconnect starts clean. */
  openOffline(doc: Y.Doc, includeDrafts: boolean): boolean {
    const value = this.storage.getItem(this.snapshotKey);
    if (value === null) return false;
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, decode(value));
      const drafts = includeDrafts ? this.entries() : [];
      for (const [, draft] of drafts) Y.applyUpdate(candidate, decode(draft));
      readBoardState(candidate);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(candidate));
      // Abrir solo lee, incluso con borradores de varias pestañas. `restore`
      // unifica las ranuras al reconectar; hacerlo aquí duplicaría la instantánea
      // completa y consumiría cuota sin que el usuario haya editado nada.
      return true;
    } finally {
      candidate.destroy();
    }
  }

  /** Call after write authorization and acknowledgement of the replica's updates. */
  restore(doc: Y.Doc): boolean {
    const entries = this.entries();
    if (entries.length === 0) return false;
    const candidate = new Y.Doc();
    try {
      const confirmed = Y.encodeStateAsUpdate(doc);
      Y.applyUpdate(candidate, confirmed);
      for (const [, value] of entries) {
        Y.applyUpdate(candidate, decode(value));
      }
      readBoardState(candidate);
      const merged = Y.encodeStateAsUpdate(candidate);
      // Compare the whole update: state vectors alone cannot detect deletions.
      if (confirmed.length === merged.length && confirmed.every((byte, i) => byte === merged[i])) {
        this.removeUnchanged(entries);
        return false;
      }
      // Persist the merged copy before deleting old slots or modifying the editor.
      this.storage.setItem(this.key, encode(merged));
      this.removeUnchanged(entries.filter(([key]) => key !== this.key));
      Y.applyUpdate(doc, merged);
      return true;
    } finally {
      candidate.destroy();
    }
  }

  /** Commit to local storage before publishing: quota/privacy failures cannot lose a change. */
  apply(doc: Y.Doc, batch: CommandBatch): ReturnType<typeof applyBatchToDocument> {
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
      const result = applyBatchToDocument(candidate, batch);
      if (!result.applied) return result;
      const update = Y.encodeStateAsUpdate(candidate);
      this.storage.setItem(this.key, encode(update));
      Y.applyUpdate(doc, update);
      return result;
    } finally {
      candidate.destroy();
    }
  }

  private entries(): [string, string][] {
    const entries: [string, string][] = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (key?.startsWith(this.prefix)) {
        const value = this.storage.getItem(key);
        if (value !== null) entries.push([key, value]);
      }
    }
    return entries;
  }

  private removeUnchanged(previous: [string, string][]): void {
    for (const [key, value] of previous) {
      // Another tab may have updated its slot since we read it.
      if (this.storage.getItem(key) === value) this.storage.removeItem(key);
    }
  }
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
