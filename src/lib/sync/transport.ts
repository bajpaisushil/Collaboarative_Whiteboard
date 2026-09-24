/**
 * Transports: BroadcastChannel (real tabs / split panes) and an in-memory hub (tests).
 */
import type { SyncMessage, Transport } from "./protocol";

export class BroadcastTransport implements Transport {
  readonly kind = "broadcast" as const;
  private ch: BroadcastChannel | null;
  private handlers = new Set<(msg: SyncMessage) => void>();

  constructor(name: string) {
    this.ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(name) : null;
    this.ch?.addEventListener("message", this.onEvent);
  }

  private onEvent = (e: MessageEvent) => {
    const msg = e.data as SyncMessage;
    if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") return;
    for (const h of [...this.handlers]) h(msg);
  };

  send(msg: SyncMessage): void {
    try {
      this.ch?.postMessage(msg);
    } catch {
      // channel closed or message not cloneable — treat as a drop; anti-entropy repairs it
    }
  }

  onMessage(handler: (msg: SyncMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.ch?.removeEventListener("message", this.onEvent);
    this.ch?.close();
    this.ch = null;
    this.handlers.clear();
  }
}

/** In-process hub: every transport receives every other transport's messages (async, JSON-cloned). */
export class MemoryHub {
  private members = new Set<MemoryTransport>();

  connect(): MemoryTransport {
    const t = new MemoryTransport(this);
    this.members.add(t);
    return t;
  }

  /** @internal */
  leave(t: MemoryTransport): void {
    this.members.delete(t);
  }

  /** @internal */
  deliver(from: MemoryTransport, msg: SyncMessage): void {
    const json = JSON.stringify(msg);
    for (const m of this.members) {
      if (m === from) continue;
      queueMicrotask(() => m.dispatch(JSON.parse(json) as SyncMessage));
    }
  }
}

export class MemoryTransport implements Transport {
  readonly kind = "memory" as const;
  private handlers = new Set<(msg: SyncMessage) => void>();
  private closed = false;

  constructor(private hub: MemoryHub) {}

  send(msg: SyncMessage): void {
    if (!this.closed) this.hub.deliver(this, msg);
  }

  onMessage(handler: (msg: SyncMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** @internal */
  dispatch(msg: SyncMessage): void {
    if (this.closed) return;
    for (const h of [...this.handlers]) h(msg);
  }

  close(): void {
    this.closed = true;
    this.hub.leave(this);
    this.handlers.clear();
  }
}
