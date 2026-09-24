/**
 * LinkRouter: one Transport over every path to other replicas — BroadcastChannel for tabs on
 * this computer, plus one WebRTC DataChannel per paired computer. Messages go out on every
 * open path; receivers ignore unicast messages addressed to someone else, and every message
 * type is idempotent (ops dedupe by counter, presence by seq), so reaching a peer twice is
 * harmless. Replicas behind a link that aren't directly paired (e.g. the other computer's
 * other tabs) still converge: anti-entropy pushes transitively through the paired tab.
 */
import type { ReplicaId } from "../crdt/types";
import type { LinkTransport, SyncMessage, Transport } from "./protocol";
import type { RtcLink } from "./rtc";

export class LinkRouter implements Transport {
  readonly kind: Transport["kind"];
  private handlers = new Set<(msg: SyncMessage, via?: LinkTransport) => void>();
  private links = new Map<string, { link: RtcLink; unsub: () => void }>();
  private unsubBase: () => void;

  constructor(private base: Transport) {
    this.kind = base.kind;
    this.unsubBase = base.onMessage((m) => this.dispatch(m, base.kind === "memory" ? "broadcast" : (base.kind as LinkTransport)));
  }

  private dispatch(msg: SyncMessage, via: LinkTransport): void {
    for (const h of [...this.handlers]) h(msg, via);
  }

  addLink(link: RtcLink): void {
    if (this.links.has(link.pid)) return;
    const unsub = link.onMessage((m) => this.dispatch(m, "webrtc"));
    this.links.set(link.pid, { link, unsub });
  }

  removeLink(pid: string): void {
    const e = this.links.get(pid);
    if (!e) return;
    e.unsub();
    this.links.delete(pid);
  }

  /** Replicas currently reachable over an open WebRTC link. */
  rtcPeers(): Set<ReplicaId> {
    const s = new Set<ReplicaId>();
    for (const { link } of this.links.values()) if (link.open && link.remoteReplica) s.add(link.remoteReplica);
    return s;
  }

  send(msg: SyncMessage): void {
    this.base.send(msg);
    for (const { link } of this.links.values()) if (link.open) link.send(msg);
  }

  onMessage(handler: (msg: SyncMessage, via?: LinkTransport) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.unsubBase();
    for (const { link, unsub } of this.links.values()) {
      unsub();
      link.close();
    }
    this.links.clear();
    this.base.close();
    this.handlers.clear();
  }
}
