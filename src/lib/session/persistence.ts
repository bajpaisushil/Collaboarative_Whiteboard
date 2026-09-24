/**
 * Per-tab persistence in sessionStorage (no database). Ops are stored append-only in arrival
 * order, chunked, so a local edit rewrites only the last chunk + meta — synchronously, before
 * the op is broadcast (write-ahead), so a reload can never re-author an op id with new content.
 */
import type { Op, PersistedReplica, UndoStacks } from "../crdt/types";
import type { StorageLike } from "./types";

const CHUNK = 200;

interface Meta {
  version: 2;
  replica: string;
  label: string;
  ancestors: string[];
  txnCounter: number;
  undo: UndoStacks;
  chunks: number;
  count: number;
}

export function storageKey(room: string, pane: string): string {
  return `weave:v2:${room}:${pane}`;
}

export function safeSessionStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const k = "__weave_probe__";
    window.sessionStorage.setItem(k, "1");
    window.sessionStorage.removeItem(k);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export class Persistence {
  private persistedCount = 0;
  private arrival: Op[] = [];
  bytes = 0;
  error: string | null = null;

  constructor(
    private storage: StorageLike | null,
    private key: string,
  ) {}

  load(): PersistedReplica | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(`${this.key}:meta`);
      if (!raw) return null;
      const meta = JSON.parse(raw) as Meta;
      if (meta.version !== 2) return null;
      const ops: Op[] = [];
      for (let i = 0; i < meta.chunks; i++) {
        const c = this.storage.getItem(`${this.key}:c${i}`);
        if (c) ops.push(...(JSON.parse(c) as Op[]));
      }
      this.arrival = ops;
      this.persistedCount = ops.length;
      return {
        version: 2,
        replica: meta.replica,
        label: meta.label,
        ancestors: meta.ancestors ?? [],
        ops,
        undo: meta.undo ?? { undo: [], redo: [] },
        txnCounter: meta.txnCounter ?? 0,
      };
    } catch {
      return null;
    }
  }

  /** Record newly integrated ops (arrival order). */
  append(ops: readonly Op[]): void {
    if (ops.length) this.arrival.push(...ops);
  }

  get dirty(): boolean {
    return this.persistedCount < this.arrival.length;
  }

  save(state: Omit<PersistedReplica, "ops" | "version">, force = false): void {
    if (!this.storage) return;
    try {
      const from = Math.floor(this.persistedCount / CHUNK);
      const chunks = Math.ceil(this.arrival.length / CHUNK);
      if (this.dirty || force) {
        for (let i = from; i < chunks; i++) {
          const json = JSON.stringify(this.arrival.slice(i * CHUNK, (i + 1) * CHUNK));
          this.storage.setItem(`${this.key}:c${i}`, json);
          if (i === chunks - 1) this.bytes = i * CHUNK * 300 + json.length;
        }
      }
      const meta: Meta = {
        version: 2,
        replica: state.replica,
        label: state.label,
        ancestors: state.ancestors,
        txnCounter: state.txnCounter,
        undo: state.undo,
        chunks,
        count: this.arrival.length,
      };
      this.storage.setItem(`${this.key}:meta`, JSON.stringify(meta));
      this.persistedCount = this.arrival.length;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  clear(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(`${this.key}:meta`);
      const chunks = raw ? ((JSON.parse(raw) as Meta).chunks ?? 0) : 0;
      for (let i = 0; i < chunks + 1; i++) this.storage.removeItem(`${this.key}:c${i}`);
      this.storage.removeItem(`${this.key}:meta`);
    } catch {
      // ignore
    }
    this.arrival = [];
    this.persistedCount = 0;
  }
}
