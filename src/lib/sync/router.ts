/**
 * LinkRouter: one Transport over every path to other replicas — BroadcastChannel for tabs on
 * this computer, plus one WebRTC link per paired computer.
 *
 * Broadcasts go out on every open path. Unicast messages (`to`) go only on the path the target
 * was last heard on (falling back to every path if we've never heard from it), so a catch-up
 * meant for a local tab isn't also pushed over every WebRTC link and vice versa. Every message
 * type is idempotent (ops dedupe by counter, presence by seq), so reaching a peer twice is
 * harmless. Replicas behind a link that aren't directly paired (the other computer's other
 * tabs) still converge: anti-entropy pushes transitively through the paired tab, and their
 * presence reaches us because the paired tab relays hello/heartbeat/bye (session.ts, `forward`).
 *
 * Only messages heard *directly* teach the router where a replica is: a relayed copy says
 * nothing about the author's own path (its unicast would reach the bridge, not the author).
 */
import type { ReplicaId } from "../crdt/types";
import type { LinkTransport, MessageHandler, SyncMessage, Transport } from "./protocol";
import type { RtcLink } from "./rtc";

export type Path = "base" | string; // "base" or an RtcLink pid

export class LinkRouter implements Transport {
  readonly kind: Transport["kind"];
  private handlers = new Set<MessageHandler>();
  private links = new Map<string, { link: RtcLink; unsub: () => void }>();
  private lastPath = new Map<ReplicaId, Path>();
  private unsubBase: () => void;

  constructor(private base: Transport) {
    this.kind = base.kind;
    this.unsubBase = base.onMessage((m) => this.dispatch(m, "base"));
  }

  private dispatch(msg: SyncMessage, path: Path): void {
    if (!msg || typeof msg !== "object") return; // the session validates the rest
    if (typeof msg.from === "string" && msg.from.length <= 64 && msg.relay === undefined) this.lastPath.set(msg.from, path);
    const via: LinkTransport = path === "base" ? "broadcast" : "webrtc";
    for (const h of [...this.handlers]) h(msg, via, path);
  }

  /** Register a link; a link object with the same pairing id replaces the previous one. */
  addLink(link: RtcLink): void {
    const prev = this.links.get(link.pid);
    if (prev?.link === link) return;
    if (prev) prev.unsub();
    const unsub = link.onMessage((m) => this.dispatch(m, link.pid));
    this.links.set(link.pid, { link, unsub });
  }

  removeLink(pid: string): void {
    const e = this.links.get(pid);
    if (!e) return;
    e.unsub();
    this.links.delete(pid);
    for (const [r, p] of this.lastPath) if (p === pid) this.lastPath.delete(r);
  }

  /** Replicas currently reachable over an open WebRTC link. */
  rtcPeers(): Set<ReplicaId> {
    const s = new Set<ReplicaId>();
    for (const { link } of this.links.values()) if (link.open && link.remoteReplica) s.add(link.remoteReplica);
    return s;
  }

  /** True if `path` is BroadcastChannel or a registered link whose channel is open. */
  isOpenPath(path: Path): boolean {
    return path === "base" || !!this.links.get(path)?.link.open;
  }

  /** Is there an open WebRTC link other than `path`? (Only bridges relay presence.) */
  hasOpenLinkBesides(path: Path): boolean {
    for (const [pid, { link }] of this.links) if (pid !== path && link.open) return true;
    return false;
  }

  /** Send on every open path except the one a message arrived on (bridging). */
  forward(msg: SyncMessage, except: Path): void {
    if (except !== "base") this.base.send(msg);
    for (const [pid, { link }] of this.links) if (pid !== except && link.open) link.send(msg);
  }

  /**
   * Changes whenever any link makes progress on a large message (a chunk arrived). A catch-up
   * message of hundreds of ops can take many seconds on a slow link; this is how the session
   * tells "still arriving" from "idle".
   */
  activity(): number {
    let n = 0;
    for (const { link } of this.links.values()) n += link.rxChunks;
    return n;
  }

  /** Some link still has bytes queued to send. */
  busy(): boolean {
    for (const { link } of this.links.values()) if (link.open && link.backlog > 0) return true;
    return false;
  }

  /** Bytes still queued towards `replica` on its WebRTC path (0 for BroadcastChannel peers). */
  backlogTo(replica: ReplicaId): number {
    const path = this.lastPath.get(replica);
    if (!path || path === "base") return 0;
    return this.links.get(path)?.link.backlog ?? 0;
  }

  send(msg: SyncMessage): void {
    if (msg.to) {
      const path = this.lastPath.get(msg.to);
      if (path === "base") return this.base.send(msg);
      const l = path ? this.links.get(path)?.link : undefined;
      if (l?.open) return l.send(msg);
      // Unknown or stale path: try everything.
    }
    this.base.send(msg);
    for (const { link } of this.links.values()) if (link.open) link.send(msg);
  }

  onMessage(handler: MessageHandler): () => void {
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
    this.lastPath.clear();
    this.base.close();
    this.handlers.clear();
  }
}
