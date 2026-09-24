/**
 * Network simulator wrapped around a Transport: the Online/Offline "cable", plus chaos
 * (latency, jitter → reordering, drops, duplicates). Offline drops traffic both ways — it is
 * not queued: the op log *is* the queue, and anti-entropy catches up on reconnect.
 */
import type { LinkTransport, NetworkConditions, SyncMessage, Transport } from "./protocol";
import { DEFAULT_CONDITIONS } from "./protocol";

export interface SimTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface TrafficCounters {
  sent: number;
  received: number;
  dropped: number;
}

export class NetworkSim implements Transport {
  readonly kind: Transport["kind"];
  private conditions: NetworkConditions;
  private handlers = new Set<(msg: SyncMessage, via?: LinkTransport) => void>();
  private unsub: () => void;
  private timers: SimTimers;
  private random: () => number;
  private pendingTimers = new Set<unknown>();
  readonly traffic: TrafficCounters = { sent: 0, received: 0, dropped: 0 };

  constructor(
    private inner: Transport,
    opts: { conditions?: Partial<NetworkConditions>; timers?: SimTimers; random?: () => number } = {},
  ) {
    this.kind = inner.kind;
    this.conditions = { ...DEFAULT_CONDITIONS, ...opts.conditions };
    this.timers = opts.timers ?? { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
    this.random = opts.random ?? Math.random;
    this.unsub = inner.onMessage((m, via) => this.onIncoming(m, via));
  }

  getConditions(): NetworkConditions {
    return this.conditions;
  }

  setConditions(patch: Partial<NetworkConditions>): void {
    this.conditions = { ...this.conditions, ...patch };
    if (!this.conditions.online) {
      // Anything still "on the wire" is lost when the cable is pulled.
      for (const id of this.pendingTimers) this.timers.clearTimeout(id);
      this.pendingTimers.clear();
    }
  }

  get online(): boolean {
    return this.conditions.online;
  }

  private onIncoming(msg: SyncMessage, via?: LinkTransport): void {
    if (!this.conditions.online) {
      this.traffic.dropped++;
      return;
    }
    this.traffic.received++;
    for (const h of [...this.handlers]) h(msg, via);
  }

  private later(fn: () => void, ms: number): void {
    const id = this.timers.setTimeout(() => {
      this.pendingTimers.delete(id);
      fn();
    }, ms);
    this.pendingTimers.add(id);
  }

  send(msg: SyncMessage): void {
    const c = this.conditions;
    if (!c.online) {
      this.traffic.dropped++;
      return;
    }
    if (c.dropRate > 0 && this.random() < c.dropRate) {
      this.traffic.dropped++;
      return;
    }
    const delay = () => c.latencyMs + (c.jitterMs > 0 ? this.random() * c.jitterMs : 0);
    const deliver = () => {
      if (!this.conditions.online) {
        this.traffic.dropped++;
        return;
      }
      this.traffic.sent++;
      this.inner.send(msg);
    };
    const d = delay();
    if (d <= 0) deliver();
    else this.later(deliver, d);
    if (c.duplicateRate > 0 && this.random() < c.duplicateRate) this.later(deliver, delay() + 5);
  }

  onMessage(handler: (msg: SyncMessage, via?: LinkTransport) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    for (const id of this.pendingTimers) this.timers.clearTimeout(id);
    this.pendingTimers.clear();
    this.unsub();
    this.inner.close();
    this.handlers.clear();
  }
}
