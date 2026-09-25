/**
 * WhiteboardSession: one tab's (or one /split pane's) runtime — replica + transport + network
 * simulator + anti-entropy + peers + presence + persistence + identity.
 *
 * Lifecycle: the constructor is side-effect free; `start()` opens the channel, takes the
 * identity lease, picks a label and starts timers; `dispose()` is synchronous and idempotent.
 */
import { Replica } from "../crdt/replica";
import { isValidOp } from "../crdt/sanitize";
import type { Op, OpId, ReplicaId, ShapeId, ShapeView, TransactOptions, Tx, TxnId, UndoResult, VectorClock } from "../crdt/types";
import { vcEquals, vcGet, vcLeq } from "../crdt/vector-clock";
import { NetworkSim } from "../sync/network";
import {
  BUFFER_STUCK_MS,
  DEFAULT_CONDITIONS,
  HEARTBEAT_MS,
  PEER_STALE_MS,
  PROTOCOL_VERSION,
  type NetworkConditions,
  type PresenceState,
  type SyncMessage,
  type Transport,
} from "../sync/protocol";
import { BroadcastTransport } from "../sync/transport";
import { LinkRouter, type Path } from "../sync/router";
import { RtcLink, rtcAvailable, type RtcOptions } from "../sync/rtc";
import { decodePairing, PairingCodeError, type PairingAnswer } from "../sync/rtc-codec";
import { isValidMessage, RELAY_MAX_HOPS, sanitizePresence } from "../sync/validate";
import { threadColor } from "../ui/colors";
import { Persistence, safeSessionStorage, storageKey } from "./persistence";
import type {
  MergeReport,
  PeerInfo,
  PeerStatus,
  RtcLinkInfo,
  SessionEvent,
  SessionOptions,
  SessionState,
  StorageLike,
  TimerApi,
  WhiteboardSessionApi,
} from "./types";

const LABEL_WAIT_MS = 350;
/**
 * A merge window closes once clocks match, after this long with no merge traffic, or at the
 * cap. "Traffic" includes a WebRTC link still carrying a large catch-up (chunks arriving, or
 * our own backlog draining): on a slow link one 250-op message can take longer than this.
 */
const MERGE_IDLE_MS = 3000;
/** Cap for a window with no link progress; one whose catch-up is still flowing may run to the hard cap. */
const MERGE_WINDOW_MAX_MS = 30_000;
const MERGE_WINDOW_HARD_MAX_MS = 10 * 60_000;
const IDLE_MAX_MS = 5 * 60_000;
const PRESENCE_MS = 33;
const CHUNK_OPS = 250;

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

function randomId(random: () => number, len = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  if (random === Math.random && typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    for (const b of bytes) s += alphabet[b % alphabet.length];
    // replica ids must start with a letter so they read as ids, not numbers
    return "r" + s.slice(1);
  }
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return "r" + s.slice(1);
}

interface PeerRecord {
  replica: ReplicaId;
  nonce: string;
  label: string;
  vc: VectorClock;
  stateHash: string;
  lastSeen: number;
  visible: boolean;
  left: boolean;
  rtc: boolean;
  presence: PresenceState | null;
  presenceSeq: number;
  status: PeerStatus;
  /** Last time we heard it directly (0 = only ever through a bridge tab's relay). */
  lastDirect: number;
  /** Path its latest message arrived on ("base" or a link's pid). */
  path: Path;
  /** The bridge tab that relayed its latest message, or null when heard directly. */
  via: ReplicaId | null;
  /** On another computer: heard over a WebRTC link, or relayed across one. */
  remote: boolean;
  /** Its path just went away (link closed, cable pulled): unreachable until heard again. */
  cut: boolean;
}

/** How a message reached us. */
interface Route {
  path: Path;
  relay: ReplicaId | null;
  remote: boolean;
}

interface MergeWindow {
  direction: MergeReport["direction"];
  peers: Set<ReplicaId>;
  openedAt: number;
  lastActivity: number;
  /** Last time a WebRTC link showed progress (chunk arrived / backlog draining). */
  lastLinkProgress: number;
  apartMs: number;
  vcBefore: VectorClock;
  received: OpId[];
  /** Distinct local ops pushed during the window (fallback when no peer reported its clock). */
  sent: Set<OpId>;
  /** How many of our ops each peer had when it first reported its clock in this window. */
  peerHad: Map<ReplicaId, number>;
  before: Map<ShapeId, ShapeView | null>;
  conflictsBefore: Set<string>;
  resurrected: Set<ShapeId>;
}

const EMPTY_PRESENCE = (label: string): PresenceState => ({
  label,
  color: threadColor(label),
  cursor: null,
  drawing: null,
  preview: null,
  selection: [],
  editingText: null,
});

export class WhiteboardSession implements WhiteboardSessionApi {
  readonly replica: Replica;
  private readonly opts: SessionOptions;
  private readonly room: string;
  private readonly pane: string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timers: TimerApi;
  private readonly heartbeatMs: number;
  private readonly nonce: string;
  private readonly persistence: Persistence;

  private net: NetworkSim | null = null;
  private router: LinkRouter | null = null;
  private links = new Map<string, RtcLink>();
  private linkWasUp = new Set<string>();
  private started = false;
  private disposed = false;
  private ready = false;
  private labelForced: boolean;
  private leaseHeld = false;
  private releaseLease: (() => void) | null = null;
  private forkedFrom: ReplicaId | null = null;

  private conditions: NetworkConditions;
  private offlineSince: number | null = null;
  private peers = new Map<ReplicaId, PeerRecord>();
  private announced = new Set<ReplicaId>();
  private inflight = new Map<ReplicaId, { vc: VectorClock; until: number }>();
  private window: MergeWindow | null = null;
  private mergeHistory: MergeReport[] = [];
  private stuckSince: number | null = null;

  private presence: PresenceState;
  private presenceSeq = 0;
  /** Counter on our hello / heartbeat / bye, so bridges forward each exactly once. */
  private beat = 0;
  /** Highest beat of each author we have relayed (per instance nonce). */
  private relayedUpTo = new Map<ReplicaId, { nonce: string; beat: number }>();
  /** Last value of router.activity() a merge window saw. */
  private linkActivitySeen = -1;
  /** Invite pids this tab withdrew before any reply arrived (to explain a stale reply later). */
  private withdrawnInvites = new Set<string>();
  private presenceTimer: unknown = null;
  private presenceDirty = false;
  private remotePresence: ReadonlyMap<ReplicaId, PresenceState> = new Map();
  private presenceListeners = new Set<() => void>();

  private listeners = new Set<() => void>();
  private eventHandlers = new Set<(e: SessionEvent) => void>();
  private state: SessionState;
  private stateDirty = true;
  private notifyQueued = false;

  private intervals: unknown[] = [];
  private saveTimer: unknown = null;
  private unsubReplica: (() => void) | null = null;
  private domCleanup: (() => void) | null = null;
  private convergeWaiters = new Set<{ resolve: () => void; reject: (e: Error) => void; timer: unknown }>();

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.room = opts.room;
    this.pane = opts.pane ?? "main";
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.timers = opts.timers ?? defaultTimers;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.nonce = randomId(this.random, 10);
    this.conditions = { ...DEFAULT_CONDITIONS, ...opts.conditions };
    const storage: StorageLike | null = opts.storage === undefined ? safeSessionStorage() : opts.storage;
    this.persistence = new Persistence(storage, storageKey(this.room, this.pane));
    const persisted = opts.fresh ? null : this.persistence.load();
    if (opts.fresh) this.persistence.clear();
    const id = opts.replicaId ?? persisted?.replica ?? randomId(this.random);
    this.labelForced = !!opts.label;
    // "?" = not chosen yet (never collides; replaced before the session becomes ready).
    const label = opts.label ?? persisted?.label ?? "?";
    this.replica = new Replica({
      replica: id,
      label,
      now: () => this.now() + this.conditions.clockSkewMs,
      persisted: persisted ?? undefined,
    });
    this.presence = EMPTY_PRESENCE(label);
    this.state = this.buildState();
  }

  /* ================================================================ lifecycle */

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const transport: Transport = this.opts.transport ?? new BroadcastTransport(`weave:${this.room}`);
    this.router = new LinkRouter(transport);
    // The cable switch and chaos sit in front of *every* path, WebRTC included.
    this.net = new NetworkSim(this.router, { conditions: this.conditions, timers: this.timers, random: this.random });
    this.net.onMessage((m, _via, path) => this.handle(m, path ?? "base"));
    this.unsubReplica = this.replica.subscribe(() => {
      this.scheduleSave();
      this.touch();
    });
    this.intervals.push(this.timers.setInterval(() => this.tick(), this.heartbeatMs));
    this.installDomHooks();
    void this.boot();
  }

  private async boot(): Promise<void> {
    await this.claimIdentity();
    if (this.disposed) return;
    this.sendHello(true);
    if (!this.labelForced) {
      await new Promise<void>((r) => this.timers.setTimeout(r, LABEL_WAIT_MS));
      if (this.disposed) return;
      this.pickLabel();
    }
    this.ready = true;
    this.sendHello(true);
    this.touch();
  }

  private async claimIdentity(): Promise<void> {
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (this.opts.useLocks === false || !locks) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const id = this.replica.id;
      const granted = await new Promise<boolean>((resolve) => {
        locks
          .request(`weave:rid:${id}`, { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            resolve(true);
            return new Promise<void>((release) => {
              this.releaseLease = release;
            });
          })
          .catch(() => resolve(false));
      });
      if (this.disposed) {
        this.releaseLease?.();
        return;
      }
      if (granted) {
        this.leaseHeld = true;
        return;
      }
      // Another live tab/pane owns this id (duplicated tab, window.open clone…): fork.
      this.forkTo(randomId(this.random), "This tab was a copy of another tab (same identity), so it continues as a new replica.");
    }
  }

  private forkTo(newId: ReplicaId, reason: string): void {
    const old = this.replica.id;
    this.forkedFrom = old;
    const label = this.labelForced ? this.replica.label : this.freeLabel(new Set([this.replica.label]));
    this.replica.fork(newId, label);
    this.presence = { ...this.presence, label, color: threadColor(label) };
    this.saveNow(true);
    this.emit({ type: "fork", from: old, to: newId, reason });
    this.touch();
  }

  private installDomHooks(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const onVis = () => {
      if (document.visibilityState === "visible") this.syncNow();
      else {
        this.saveNow();
        this.sendHeartbeat();
      }
    };
    const onHide = () => {
      this.saveNow();
      this.send({ ...this.envelope(), t: "bye", beat: ++this.beat });
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    this.domCleanup = () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.started) {
      this.send({ ...this.envelope(), t: "bye", beat: ++this.beat });
      this.saveNow();
    }
    this.disposed = true;
    for (const id of this.intervals) this.timers.clearInterval(id);
    this.intervals = [];
    if (this.saveTimer) this.timers.clearTimeout(this.saveTimer);
    if (this.presenceTimer) this.timers.clearTimeout(this.presenceTimer);
    this.unsubReplica?.();
    this.domCleanup?.();
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.net?.close();
    this.releaseLease?.();
    this.releaseLease = null;
    for (const w of this.convergeWaiters) {
      this.timers.clearTimeout(w.timer);
      w.reject(new Error("session disposed"));
    }
    this.convergeWaiters.clear();
    this.listeners.clear();
    this.presenceListeners.clear();
    this.eventHandlers.clear();
  }

  /* ================================================================ state */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(handler: (e: SessionEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(e: SessionEvent): void {
    for (const h of [...this.eventHandlers]) h(e);
  }

  private touch(): void {
    this.stateDirty = true;
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      this.checkWaiters();
      for (const l of [...this.listeners]) l();
    });
  }

  getState(): SessionState {
    if (this.stateDirty) {
      this.state = this.buildState();
      this.stateDirty = false;
    }
    return this.state;
  }

  private peerInfos(): PeerInfo[] {
    const view = this.replica.getView();
    const self = this.replica.id;
    const out: PeerInfo[] = [];
    const rtc = this.router?.rtcPeers() ?? new Set<ReplicaId>();
    for (const p of this.peers.values()) {
      const converged = vcEquals(p.vc, view.vc) && p.stateHash === view.stateHash;
      // Reached over WebRTC right now: the paired tab itself, or a tab behind a live path that
      // crossed a link (the other computer's other tabs, relayed by a bridge tab).
      const overRtc = rtc.has(p.replica) || (p.remote && !p.cut && !p.left && (this.router?.isOpenPath(p.path) ?? false));
      out.push({
        replica: p.replica,
        label: p.label,
        color: threadColor(p.label),
        status: p.status,
        lastSeen: p.lastSeen,
        vc: p.vc,
        stateHash: p.stateHash,
        transport: overRtc ? "webrtc" : "broadcast",
        remote: p.remote,
        relay: p.via,
        converged,
        diverged: vcEquals(p.vc, view.vc) && p.stateHash !== view.stateHash,
        unseenByPeer: Math.max(0, vcGet(view.vc, self) - vcGet(p.vc, self)),
        presence: p.presence,
      });
    }
    return out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  }

  private knownVcs(): VectorClock[] {
    return [...this.peers.values()].filter((p) => !p.left).map((p) => p.vc);
  }

  private buildState(): SessionState {
    const view = this.replica.getView();
    const self = this.replica.id;
    const mine = vcGet(view.vc, self);
    const known = this.knownVcs();
    const minSeen = known.length ? Math.min(...known.map((vc) => vcGet(vc, self))) : mine;
    const traffic = this.net?.traffic ?? { sent: 0, received: 0, dropped: 0 };
    return {
      ready: this.ready,
      room: this.room,
      pane: this.pane,
      replica: self,
      label: this.replica.label,
      color: threadColor(this.replica.label),
      forkedFrom: this.forkedFrom,
      network: this.conditions,
      rtc: { available: this.rtcSupported(), links: [...this.links.values()].map(linkInfo) },
      peers: this.peerInfos(),
      offlineSince: this.offlineSince,
      unsyncedLocalOps: known.length ? Math.max(0, mine - minSeen) : this.offlineSince ? this.localOpsSince(this.offlineSince) : 0,
      stableVc: this.stableVcCached(known),
      lastMerge: this.mergeHistory[this.mergeHistory.length - 1] ?? null,
      mergeHistory: this.mergeHistory,
      traffic: { ...traffic },
      storage: { bytes: this.persistence.bytes, error: this.persistence.error },
    };
  }

  private stableVcMemo: VectorClock = {};
  private stableVcCached(known: VectorClock[]): VectorClock {
    const next = this.replica.stableFrontier(known);
    if (!vcEquals(next, this.stableVcMemo)) this.stableVcMemo = next;
    return this.stableVcMemo;
  }

  private localOpsSince(t: number): number {
    const self = this.replica.id;
    return this.replica.getView().log.filter((o) => o.replica === self && o.meta.wallTime - this.conditions.clockSkewMs >= t).length;
  }

  /* ================================================================ network controls */

  setOnline(online: boolean): void {
    if (online === this.conditions.online) return;
    if (!online) {
      // Last word before the cable is pulled: peers show us unreachable now, not in PEER_STALE_MS.
      this.sendHeartbeat(true);
      this.offlineSince = this.now();
      this.closeWindow(true);
      this.net?.setConditions({ online: false });
      this.conditions = { ...this.conditions, online: false };
      this.remotePresence = new Map();
      for (const p of this.peers.values()) p.presence = null;
      this.notifyPresence();
    } else {
      const apart = this.offlineSince ? this.now() - this.offlineSince : 0;
      this.offlineSince = null;
      this.conditions = { ...this.conditions, online: true };
      this.net?.setConditions({ online: true });
      this.inflight.clear();
      this.openWindow("rejoined", [], apart);
      this.sendHello(true);
    }
    this.touch();
  }

  setConditions(patch: Partial<NetworkConditions>): void {
    if (patch.online !== undefined && patch.online !== this.conditions.online) this.setOnline(patch.online);
    const { online: _ignored, ...rest } = patch;
    void _ignored;
    this.conditions = { ...this.conditions, ...rest };
    this.net?.setConditions(rest);
    this.touch();
  }

  /* ================================================================ WebRTC pairing */

  private rtcSupported(): boolean {
    return rtcAvailable(this.opts.RTCPeerConnection);
  }

  private rtcOptions(): RtcOptions {
    return { iceServers: this.opts.iceServers, RTCPeerConnection: this.opts.RTCPeerConnection };
  }

  private me() {
    return { room: this.room, replica: this.replica.id, label: this.replica.label };
  }

  private registerLink(link: RtcLink): RtcLinkInfo {
    this.links.set(link.pid, link);
    this.router?.addLink(link);
    link.onState((l) => this.onLinkState(l));
    this.touch();
    return linkInfo(link);
  }

  private onLinkState(link: RtcLink): void {
    if (this.disposed) return;
    if (link.state === "connected") {
      const first = !this.linkWasUp.has(link.pid);
      this.linkWasUp.add(link.pid);
      // Introduce ourselves over the new path; anti-entropy takes it from there.
      this.sendHello(true);
      if (first) this.emit({ type: "link", link: linkInfo(link), change: "connected" });
    } else if (link.state === "failed") {
      this.cutPath(link.pid);
      this.router?.removeLink(link.pid);
      this.emit({ type: "link", link: linkInfo(link), change: "failed" });
    } else if (link.state === "closed") {
      this.cutPath(link.pid);
      this.router?.removeLink(link.pid);
      if (this.linkWasUp.has(link.pid)) this.emit({ type: "link", link: linkInfo(link), change: "lost" });
    }
    this.touch();
  }

  /**
   * A path went away (a link closed or failed): every tab we last heard over it is unreachable
   * *now* — a remote tab that reloaded sent a "hidden" heartbeat first and would otherwise
   * read as idle (and "In sync") for minutes. Tabs that only heard them through us are told too.
   */
  private cutPath(pid: string): void {
    for (const p of this.peers.values()) if (!p.left && !p.cut && p.path === pid) this.cutPeer(p);
  }

  /** `p` is out of reach: show it so now, tell the tabs we relayed it to, and cut what came through it. */
  private cutPeer(p: PeerRecord): void {
    p.cut = true;
    p.status = "unreachable";
    if (p.presence) {
      p.presence = null;
      this.rebuildPresence();
    }
    this.sendLost(p, p.path);
    this.cutRelayedThrough(p.replica);
  }

  /** A bridge tab left or went silent: the tabs we only heard through it are out of reach too. */
  private cutRelayedThrough(bridge: ReplicaId): void {
    for (const q of this.peers.values()) {
      if (q.via === bridge && !q.left && !q.cut) this.cutPeer(q);
    }
  }

  /** Tell the tabs we relayed `p` to that we can't reach it any more. */
  private sendLost(p: PeerRecord, lostPath: Path): void {
    const last = this.relayedUpTo.get(p.replica);
    if (!this.router || !this.conditions.online || !last || last.nonce !== p.nonce) return;
    this.router.forward(
      {
        v: PROTOCOL_VERSION,
        from: p.replica,
        nonce: p.nonce,
        t: "heartbeat",
        label: p.label,
        vc: p.vc,
        stateHash: p.stateHash,
        rtc: p.rtc,
        visible: p.visible,
        beat: last.beat,
        relay: { by: this.replica.id, hops: 1, far: true, lost: true },
      },
      lostPath,
    );
  }

  private requireRtc(): void {
    if (this.disposed || !this.started) throw new PairingCodeError("This board isn't running.");
    if (!this.ready) throw new PairingCodeError("Still starting up — try again in a moment.");
    if (!this.rtcSupported()) throw new PairingCodeError("This browser doesn't support WebRTC.");
  }

  async createInvite(): Promise<RtcLinkInfo> {
    this.requireRtc();
    const link = await RtcLink.invite(this.me(), this.rtcOptions());
    if (this.disposed) {
      link.close();
      throw new PairingCodeError("This board was closed.");
    }
    return this.registerLink(link);
  }

  private pendingAccepts = new Map<string, Promise<RtcLinkInfo>>();

  async acceptInvite(text: string): Promise<RtcLinkInfo> {
    this.requireRtc();
    const offer = await decodePairing(text);
    if (offer.k !== "offer") {
      throw this.replyProblem(offer) ?? new PairingCodeError("That's a reply code. Paste it under “Invite a computer”, where the invite was made.");
    }
    if (offer.from === this.replica.id) throw new PairingCodeError("That's this tab's own invite — open it on the other computer.");
    if (offer.room !== this.room) throw new RoomMismatchError(offer.room);
    const existing = this.links.get(offer.pid);
    if (existing) return linkInfo(existing);
    const pending = this.pendingAccepts.get(offer.pid);
    if (pending) return pending;
    const p = (async () => {
      const link = await RtcLink.accept(offer, this.me(), this.rtcOptions());
      if (this.disposed) {
        link.close();
        throw new PairingCodeError("This board was closed.");
      }
      return this.registerLink(link);
    })();
    this.pendingAccepts.set(offer.pid, p);
    try {
      return await p;
    } finally {
      this.pendingAccepts.delete(offer.pid);
    }
  }

  async completeInvite(text: string): Promise<RtcLinkInfo> {
    this.requireRtc();
    const answer = await decodePairing(text);
    if (answer.k !== "answer") throw new PairingCodeError("That's an invite, not a reply. Paste the reply code the other computer showed you.");
    const problem = this.replyProblem(answer);
    if (problem) throw problem;
    const link = this.links.get(answer.pid)!;
    await link.complete(text);
    this.touch();
    return linkInfo(link);
  }

  /**
   * Why a reply code can't be used here — null if it answers one of this tab's open invites.
   * Stale and reused codes get the real reason, not a generic "doesn't match".
   */
  private replyProblem(answer: PairingAnswer): PairingCodeError | null {
    if (answer.from === this.replica.id) return new PairingCodeError("That's this tab's own reply code — send it back to the computer that invited you.");
    const link = this.links.get(answer.pid);
    if (link?.role === "inviter") {
      if (link.state === "waiting-answer") return null;
      const who = link.remoteLabel ? `Tab ${this.peers.get(link.remoteReplica ?? "")?.label ?? link.remoteLabel}` : "another computer";
      if (link.remoteReplicas.has(answer.from)) {
        return new PairingCodeError(
          link.state === "connected" || link.state === "disconnected"
            ? `That reply was already used — this invite is connected to ${who}.`
            : "That reply was already used for this invite. If it didn't connect, make a new invite.",
        );
      }
      return new PairingCodeError(`That invite was already used by ${who}. Make a new invite for this computer (“Invite another computer”).`);
    }
    if (this.withdrawnInvites.has(answer.pid)) {
      return new PairingCodeError("That reply is for an invite you replaced or cancelled. Send them your newest invite link, and paste the reply to that one.");
    }
    if (link?.role === "invitee") return new PairingCodeError("That's a reply code for an invite this tab joined — it belongs on the computer that made the invite.");
    return new PairingCodeError("No open invite in this tab matches that reply. Was it made in another tab?");
  }

  closeLink(pid: string): void {
    const link = this.links.get(pid);
    if (!link) return;
    if (link.role === "inviter" && (link.state === "gathering" || link.state === "waiting-answer")) this.withdrawnInvites.add(pid);
    this.links.delete(pid);
    this.router?.removeLink(pid);
    // Deliberate: tell the other side first, so it can say "disconnected" rather than "lost".
    link.disconnect();
    this.touch();
  }

  syncNow(): void {
    this.sendHello(true);
    this.sendHeartbeat();
    for (const p of this.peers.values()) if (!p.left && this.reachableDirectly(p)) this.pushTo(p.replica, p.vc, true);
  }

  whenConverged(timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.isConverged()) {
        resolve();
        return;
      }
      const w = {
        resolve,
        reject,
        timer: this.timers.setTimeout(() => {
          this.convergeWaiters.delete(w);
          reject(new Error("timed out waiting for convergence"));
        }, timeoutMs),
      };
      this.convergeWaiters.add(w);
    });
  }

  private isConverged(): boolean {
    const view = this.replica.getView();
    if (view.pending.length) return false;
    for (const p of this.peers.values()) {
      if (p.left || p.status === "unreachable") continue;
      if (!vcEquals(p.vc, view.vc) || p.stateHash !== view.stateHash) return false;
    }
    return true;
  }

  private checkWaiters(): void {
    if (!this.convergeWaiters.size || !this.isConverged()) return;
    for (const w of this.convergeWaiters) {
      this.timers.clearTimeout(w.timer);
      w.resolve();
    }
    this.convergeWaiters.clear();
  }

  /* ================================================================ messaging */

  private envelope() {
    return { v: PROTOCOL_VERSION, from: this.replica.id, nonce: this.nonce } as const;
  }

  private send(msg: SyncMessage): void {
    if (this.disposed || !this.net) return;
    this.net.send(msg);
  }

  private visible(): boolean {
    return typeof document === "undefined" ? true : document.visibilityState !== "hidden";
  }

  private sendHello(wantReply: boolean, to?: ReplicaId): void {
    const view = this.replica.getView();
    this.send({
      ...this.envelope(),
      to,
      t: "hello",
      label: this.replica.label,
      vc: view.vc,
      stateHash: view.stateHash,
      wantReply,
      rtc: this.rtcSupported(),
      visible: this.visible(),
      // Unicast replies are never relayed, so only broadcasts need a beat.
      ...(to ? {} : { beat: ++this.beat }),
    });
  }

  private sendHeartbeat(offline = false): void {
    const view = this.replica.getView();
    this.send({
      ...this.envelope(),
      t: "heartbeat",
      label: this.replica.label,
      vc: view.vc,
      stateHash: view.stateHash,
      rtc: this.rtcSupported(),
      visible: this.visible(),
      beat: ++this.beat,
      ...(offline ? { offline: true } : {}),
    });
  }

  /** Its latest message came directly, not through a bridge: a unicast can reach it. */
  private reachableDirectly(p: PeerRecord): boolean {
    return p.via === null && p.lastDirect > 0;
  }

  /** Heard directly and recently: relayed copies about it are ignored (the direct path is authoritative). */
  private heardDirectly(p: PeerRecord): boolean {
    return this.reachableDirectly(p) && this.now() - p.lastDirect < PEER_STALE_MS;
  }

  /**
   * Bridge tabs (those with a WebRTC link) forward presence-class messages between their paths
   * — BroadcastChannel → links, a link → BroadcastChannel and the other links — so the tabs on
   * both computers see each other: labels stay unique, "In sync with…" and the avatars are
   * right. Each message is forwarded once (per-author beat) and at most RELAY_MAX_HOPS times.
   * Ops are never relayed: anti-entropy already carries them through the bridge.
   */
  private maybeRelay(msg: SyncMessage, path: Path): void {
    const router = this.router;
    if (!router || msg.to || (msg.t !== "hello" && msg.t !== "heartbeat" && msg.t !== "bye")) return;
    if (msg.beat === undefined) return; // an older build: nothing to dedupe by
    const hops = msg.relay?.hops ?? 0;
    if (hops >= RELAY_MAX_HOPS) return;
    if (path === "base" && !router.hasOpenLinkBesides("base")) return; // not a bridge
    const last = this.relayedUpTo.get(msg.from);
    if (last && last.nonce === msg.nonce && msg.beat <= last.beat) return;
    this.relayedUpTo.set(msg.from, { nonce: msg.nonce, beat: msg.beat });
    router.forward({ ...msg, relay: { by: this.replica.id, hops: hops + 1, far: !!msg.relay?.far || path !== "base" } }, path);
  }

  /** Send a peer the ops it lacks (suppressing duplicate pushes while earlier ones are in flight). */
  private pushTo(peer: ReplicaId, peerVc: VectorClock, force = false): void {
    const ops = this.replica.opsSince(peerVc);
    if (ops.length === 0) return;
    // A slow WebRTC link still carrying an earlier push: don't queue the same ops behind
    // themselves. The peer's next heartbeat after the queue drains re-evaluates the gap.
    if ((this.router?.backlogTo(peer) ?? 0) > 0) return;
    const ourVc = this.replica.getView().vc;
    const inflight = this.inflight.get(peer);
    const t = this.now();
    if (!force && inflight && inflight.until > t && vcLeq(ourVc, inflight.vc)) return;
    if (this.window) this.window.lastActivity = t;
    const c = this.conditions;
    this.inflight.set(peer, { vc: ourVc, until: t + 3 * (c.latencyMs + c.jitterMs) + 600 });
    for (let i = 0; i < ops.length; i += CHUNK_OPS) {
      this.send({ ...this.envelope(), to: peer, t: "ops", ops: ops.slice(i, i + CHUNK_OPS), reason: "catchup" });
    }
    if (this.window) for (const o of ops) if (o.replica === this.replica.id) this.window.sent.add(o.id);
  }

  private upsertPeer(
    msg: { from: ReplicaId; nonce: string; label: string; vc: VectorClock; stateHash: string; visible: boolean; rtc: boolean },
    reconnecting: boolean,
    route: Route,
  ): PeerRecord {
    const t = this.now();
    let p = this.peers.get(msg.from);
    const wasAway = !p || p.status === "unreachable" || p.left;
    if (!p) {
      p = {
        replica: msg.from,
        nonce: msg.nonce,
        label: msg.label,
        vc: msg.vc,
        stateHash: msg.stateHash,
        lastSeen: t,
        visible: msg.visible,
        left: false,
        rtc: msg.rtc,
        presence: null,
        presenceSeq: -1,
        status: "online",
        lastDirect: 0,
        path: route.path,
        via: route.relay,
        remote: route.remote,
        cut: false,
      };
      this.peers.set(msg.from, p);
    }
    if (msg.nonce !== p.nonce) p.presenceSeq = -1; // a reloaded tab restarts its presence seq
    const announce = (p.left || (p.label === "?" && msg.label !== "?") || !this.announced.has(msg.from)) && msg.label !== "?";
    const prevVc = p.vc;
    Object.assign(p, { nonce: msg.nonce, label: msg.label, vc: msg.vc, stateHash: msg.stateHash, lastSeen: t, visible: msg.visible, left: false, rtc: msg.rtc });
    Object.assign(p, { path: route.path, via: route.relay, remote: route.remote, cut: false });
    if (!route.relay) p.lastDirect = t;
    p.status = msg.visible ? "online" : "idle";
    // Announce once the peer has a letter — and again when a tab that said bye comes back.
    if (announce) {
      this.announced.add(msg.from);
      this.emit({ type: "peer-joined", replica: msg.from });
    }
    // An unreachable peer came back with edits we haven't seen → a merge moment for us too.
    const ourVc = this.replica.getView().vc;
    if ((wasAway || reconnecting) && this.conditions.online && !vcLeq(msg.vc, ourVc) && !this.window) {
      this.openWindow(prevVc !== msg.vc ? "peer-returned" : "joined", [msg.from], 0);
    }
    if (this.window) {
      this.window.peers.add(msg.from);
      if (!this.window.peerHad.has(msg.from)) this.window.peerHad.set(msg.from, vcGet(msg.vc, this.replica.id));
    }
    // Label collision among live peers (relayed ones included, so letters are unique across
    // computers): the greater replica id re-picks (display only).
    if (!this.labelForced && this.ready && msg.label !== "?" && msg.label === this.replica.label && this.replica.id > msg.from) this.pickLabel();
    return p;
  }

  private peerLeft(replica: ReplicaId): void {
    const p = this.peers.get(replica);
    if (!p || p.left) return;
    this.announced.delete(replica);
    p.presenceSeq = -1;
    p.left = true;
    p.status = "left";
    p.presence = null;
    this.rebuildPresence();
    this.emit({ type: "peer-left", replica });
    this.cutRelayedThrough(replica);
  }

  private handle(raw: SyncMessage, path: Path = "base"): void {
    if (this.disposed || !isValidMessage(raw)) return;
    const msg = raw;
    if (msg.to && msg.to !== this.replica.id) return;
    const relay = msg.relay;
    if (msg.from === this.replica.id) {
      // Someone else is using our identity (only possible without Web Locks). A relayed copy of
      // our own message that came back around through two bridges is not that.
      if (!relay && msg.nonce !== this.nonce && !this.leaseHeld && this.nonce > msg.nonce) {
        this.forkTo(randomId(this.random), "Another tab was using this tab's identity, so this one continues as a new replica.");
        this.sendHello(true);
      }
      return;
    }
    if (relay) {
      this.handleRelayed(msg, relay, path);
      return;
    }
    this.maybeRelay(msg, path);
    const route: Route = { path, relay: null, remote: path !== "base" };
    switch (msg.t) {
      case "hello": {
        this.upsertPeer(msg, msg.wantReply, route);
        if (msg.wantReply) this.sendHello(false, msg.from);
        this.pushTo(msg.from, msg.vc, true);
        break;
      }
      case "heartbeat": {
        const before = this.peers.get(msg.from)?.vc;
        const p = this.upsertPeer(msg, false, route);
        if (msg.offline) {
          this.cutPeer(p); // its cable is being pulled; nothing we send would arrive
          break;
        }
        this.pushTo(msg.from, msg.vc);
        // Message-driven liveness: a peer whose clock moved hears from us immediately.
        if (before && !vcEquals(before, msg.vc)) this.sendHeartbeat();
        break;
      }
      case "ops": {
        const p = this.peers.get(msg.from);
        if (p) p.lastSeen = this.now();
        this.integrateRemote(msg.ops);
        break;
      }
      case "sync-req": {
        this.pushTo(msg.from, msg.vc, true);
        break;
      }
      case "presence": {
        const p = this.peers.get(msg.from);
        if (!p) return;
        if (msg.nonce !== p.nonce) {
          p.nonce = msg.nonce;
          p.presenceSeq = -1;
        }
        if (msg.seq <= p.presenceSeq) return;
        const state = sanitizePresence(msg.state);
        if (!state) return;
        p.presenceSeq = msg.seq;
        p.presence = state;
        p.lastSeen = this.now();
        this.rebuildPresence();
        return; // presence lives in its own store; don't rebuild session state at 30 Hz
      }
      case "bye": {
        this.peerLeft(msg.from);
        break;
      }
    }
    this.touch();
  }

  /**
   * A copy a bridge tab forwarded: it only updates what we show about a tab we can't hear
   * directly (never a reply, never a push — its catch-up flows through the bridge).
   */
  private handleRelayed(msg: SyncMessage, relay: NonNullable<SyncMessage["relay"]>, path: Path): void {
    const p = this.peers.get(msg.from);
    if (relay.lost) {
      // The bridge we heard this tab through can't reach it any more.
      if (p && !p.left && !p.cut && p.via === relay.by && !this.heardDirectly(p)) this.cutPeer(p);
      this.touch();
      return;
    }
    this.maybeRelay(msg, path);
    if (p && this.heardDirectly(p)) return; // the direct path is authoritative
    const route: Route = { path, relay: relay.by, remote: relay.far || path !== "base" };
    switch (msg.t) {
      case "hello":
      case "heartbeat": {
        const peer = this.upsertPeer(msg, false, route);
        if (msg.t === "heartbeat" && msg.offline) this.cutPeer(peer);
        break;
      }
      case "bye":
        if (p && p.nonce === msg.nonce) this.peerLeft(msg.from);
        break;
    }
    this.touch();
  }

  private integrateRemote(raw: Op[]): void {
    // Validate element by element before anything reads them (a malformed entry from a buggy
    // or hostile peer must not throw out of the message handler and drop the valid ops).
    const ops = raw.filter(isValidOp);
    const w = this.window;
    if (w) {
      for (const op of ops) {
        if (op.kind === "snapshot.mark" || w.before.has(op.shapeId)) continue;
        const v = this.replica.getShape(op.shapeId, { includeDead: true });
        w.before.set(op.shapeId, v && v.alive ? v : null);
      }
    }
    const res = this.replica.receive(ops);
    if (res.applied.length) this.persistence.append(res.applied);
    if (w && res.applied.length) w.lastActivity = this.now();
    if (w) {
      w.received.push(...res.applied.map((o) => o.id));
      for (const s of res.resurrected) w.resurrected.add(s);
    } else if (res.applied.length && (res.newConflicts.length || res.resurrected.length)) {
      // Conflicts can surface outside a reconnect (e.g. latency/jitter): report them too.
      this.openWindow("peer-returned", [], 0);
      const nw = this.window!;
      nw.received.push(...res.applied.map((o) => o.id));
      for (const c of res.newConflicts) nw.conflictsBefore.delete(c);
      for (const s of res.resurrected) nw.resurrected.add(s);
    }
    const collisions = (res as { collisions?: OpId[] }).collisions ?? [];
    if (collisions.some((id) => id.startsWith(this.replica.id + ":"))) {
      this.forkTo(randomId(this.random), "Two tabs wrote different edits under the same identity; this one continues as a new replica.");
    }
    if (res.buffered > 0) {
      if (this.stuckSince === null) this.stuckSince = this.now();
    } else this.stuckSince = null;
    this.maybeCloseWindow();
  }

  /* ================================================================ merge windows */

  private openWindow(direction: MergeReport["direction"], peers: ReplicaId[], apartMs: number): void {
    if (this.window) return;
    this.linkActivitySeen = this.router?.activity() ?? -1;
    this.window = {
      direction,
      peers: new Set(peers),
      openedAt: this.now(),
      lastActivity: this.now(),
      lastLinkProgress: -Infinity,
      apartMs,
      vcBefore: this.replica.getView().vc,
      received: [],
      sent: new Set(),
      peerHad: new Map(),
      before: new Map(),
      conflictsBefore: new Set(this.replica.getView().conflicts.map((c) => c.id)),
      resurrected: new Set(),
    };
  }

  private maybeCloseWindow(): void {
    const w = this.window;
    if (!w) return;
    const t = this.now();
    // A link still carrying a big catch-up (chunks arriving, our backlog draining) is activity:
    // a single 250-op message can take longer than MERGE_IDLE_MS on a slow link.
    if (this.router) {
      const act = this.router.activity();
      if (act !== this.linkActivitySeen || this.router.busy()) w.lastLinkProgress = t;
      this.linkActivitySeen = act;
    }
    const flowing = t - w.lastLinkProgress <= MERGE_IDLE_MS;
    if (flowing) w.lastActivity = Math.max(w.lastActivity, w.lastLinkProgress);
    const age = t - w.openedAt;
    if (age > MERGE_WINDOW_HARD_MAX_MS || (age > MERGE_WINDOW_MAX_MS && !flowing) || t - w.lastActivity > MERGE_IDLE_MS) return this.closeWindow();
    const view = this.replica.getView();
    if (view.pending.length) return;
    const live = [...this.peers.values()].filter((p) => !p.left && p.status !== "unreachable");
    if (live.length === 0) return;
    if (live.every((p) => vcEquals(p.vc, view.vc)) && w.received.length + w.sent.size > 0) this.closeWindow();
  }

  private closeWindow(discard = false): void {
    const w = this.window;
    this.window = null;
    if (!w || discard) return;
    if (w.received.length === 0 && w.sent.size === 0) return;
    const view = this.replica.getView();
    const newConflicts = view.conflicts.filter((c) => !w.conflictsBefore.has(c.id)).map((c) => c.id);
    // A first join that only caught us up isn't a "merge moment".
    if (w.direction === "joined" && w.sent.size === 0 && newConflicts.length === 0) return;
    const changed = [...w.before].map(([shapeId, before]) => {
      const after = this.replica.getShape(shapeId);
      return { shapeId, before, after };
    });
    const report: MergeReport = {
      id: `m${this.now()}-${this.mergeHistory.length}`,
      at: this.now(),
      direction: w.direction,
      peers: [...w.peers],
      vcBefore: w.vcBefore,
      vcAfter: view.vc,
      receivedOpIds: w.received,
      sentCount: this.sentInWindow(w, view.vc),
      changed,
      newConflicts,
      resurrected: [...w.resurrected].filter((s) => !!this.replica.getShape(s)),
      apartMs: w.apartMs,
    };
    this.mergeHistory = [...this.mergeHistory.slice(-19), report];
    this.emit({ type: "merge", report });
    this.touch();
  }

  /** Our edits the peers hadn't seen when the window opened (per their own first report). */
  private sentInWindow(w: MergeWindow, vcAfter: VectorClock): number {
    if (w.peerHad.size === 0) return w.sent.size;
    const mine = vcGet(vcAfter, this.replica.id);
    let n = 0;
    for (const had of w.peerHad.values()) n = Math.max(n, mine - had);
    return Math.max(0, n);
  }

  /* ================================================================ timers */

  private tick(): void {
    if (this.disposed) return;
    const t = this.now();
    if (this.conditions.online) {
      this.sendHeartbeat();
      // Peer liveness (frozen while we're offline: we simply can't know).
      let presenceChanged = false;
      const silenced: ReplicaId[] = [];
      for (const p of this.peers.values()) {
        if (p.left) continue;
        const age = t - p.lastSeen;
        const next: PeerStatus = p.cut
          ? "unreachable"
          : age < PEER_STALE_MS
            ? p.visible
              ? "online"
              : "idle"
            : !p.visible && age < IDLE_MAX_MS
              ? "idle"
              : "unreachable";
        if (next !== p.status) {
          p.status = next;
          if (next === "unreachable" && p.presence) {
            p.presence = null;
            presenceChanged = true;
          }
          if (next === "unreachable") silenced.push(p.replica);
        }
      }
      // A bridge that went silent takes the tabs behind it along.
      for (const r of silenced) this.cutRelayedThrough(r);
      if (presenceChanged) this.rebuildPresence();
      // Causal gaps that don't heal on their own → ask the peers.
      if (this.stuckSince !== null && t - this.stuckSince > BUFFER_STUCK_MS) {
        const vc = this.replica.getView().vc;
        for (const p of this.peers.values()) if (!p.left && this.reachableDirectly(p)) this.send({ ...this.envelope(), to: p.replica, t: "sync-req", vc });
        this.stuckSince = t;
      }
    }
    this.maybeCloseWindow();
    this.touch();
  }

  /* ================================================================ labels */

  private usedLabels(): Set<string> {
    const used = new Set<string>();
    for (const p of this.peers.values()) if (!p.left && p.replica !== this.replica.id && p.label !== "?") used.add(p.label);
    for (const [r, info] of this.replica.getView().replicas) if (r !== this.replica.id) used.add(info.label.replace(/\d+$/, ""));
    return used;
  }

  private freeLabel(extra: Set<string> = new Set()): string {
    const used = this.usedLabels();
    for (const e of extra) used.add(e);
    for (let i = 0; i < 26; i++) {
      const l = String.fromCharCode(65 + i);
      if (!used.has(l)) return l;
    }
    return "Z";
  }

  private pickLabel(): void {
    const used = this.usedLabels();
    const current = this.replica.label;
    // Keep a persisted label if nobody else is using it.
    const label = !used.has(current) && this.replicaHasHistory() ? current : this.freeLabel();
    if (label !== current) {
      this.replica.setLabel(label);
      this.presence = { ...this.presence, label, color: threadColor(label) };
      this.saveNow(true);
    }
    this.touch();
  }

  private replicaHasHistory(): boolean {
    return vcGet(this.replica.getView().vc, this.replica.id) > 0;
  }

  /* ================================================================ edits */

  private afterLocal(ops: Op[]): void {
    if (!ops.length) return;
    this.persistence.append(ops);
    this.saveNow(); // write-ahead: persisted before broadcast
    this.send({ ...this.envelope(), t: "ops", ops, reason: "live" });
    this.touch();
  }

  transact(build: (tx: Tx) => void, opts: TransactOptions = {}): { txn: TxnId; ops: Op[] } {
    if (!this.ready || this.disposed) return { txn: "", ops: [] };
    const res = this.replica.transact(build, { ...opts, offline: !this.conditions.online });
    this.afterLocal(res.ops);
    return res;
  }

  undo(): UndoResult | null {
    if (!this.ready) return null;
    const r = this.replica.undo({ offline: !this.conditions.online });
    if (r) {
      this.afterLocal(r.ops);
      this.emit({ type: "undo", result: r, redo: false });
    }
    return r;
  }

  redo(): UndoResult | null {
    if (!this.ready) return null;
    const r = this.replica.redo({ offline: !this.conditions.online });
    if (r) {
      this.afterLocal(r.ops);
      this.emit({ type: "undo", result: r, redo: true });
    }
    return r;
  }

  markSnapshot(name: string): Op | null {
    if (!this.ready) return null;
    const op = this.replica.markSnapshot(name, { offline: !this.conditions.online });
    this.afterLocal([op]);
    return op;
  }

  restoreSnapshot(snapshotId: string): { txn: TxnId; ops: Op[] } | null {
    if (!this.ready) return null;
    const r = this.replica.restoreSnapshot(snapshotId, { offline: !this.conditions.online });
    if (r) this.afterLocal(r.ops);
    return r;
  }

  adoptConflictValue(conflictId: string, opId: OpId): { txn: TxnId; ops: Op[] } | null {
    if (!this.ready) return null;
    const r = this.replica.adoptConflictValue(conflictId, opId, { offline: !this.conditions.online });
    if (r) this.afterLocal(r.ops);
    return r;
  }

  /* ================================================================ presence */

  updatePresence(patch: Partial<Omit<PresenceState, "label" | "color">>): void {
    this.presence = { ...this.presence, ...patch, label: this.replica.label, color: threadColor(this.replica.label) };
    this.presenceDirty = true;
    if (this.presenceTimer || !this.ready) return;
    this.presenceTimer = this.timers.setTimeout(() => {
      this.presenceTimer = null;
      if (!this.presenceDirty) return;
      this.presenceDirty = false;
      this.send({ ...this.envelope(), t: "presence", seq: ++this.presenceSeq, state: this.presence });
    }, PRESENCE_MS);
  }

  getPresence(): ReadonlyMap<ReplicaId, PresenceState> {
    return this.remotePresence;
  }

  subscribePresence(listener: () => void): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  private rebuildPresence(): void {
    const m = new Map<ReplicaId, PresenceState>();
    for (const p of this.peers.values()) if (p.presence && !p.left && p.status !== "unreachable") m.set(p.replica, p.presence);
    this.remotePresence = m;
    this.notifyPresence();
  }

  private notifyPresence(): void {
    for (const l of [...this.presenceListeners]) l();
  }

  /* ================================================================ persistence */

  private scheduleSave(): void {
    if (this.saveTimer || this.disposed) return;
    this.saveTimer = this.timers.setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 400);
  }

  private saveNow(force = false): void {
    if (this.disposed) return;
    const p = this.replica.toPersisted();
    const prevError = this.persistence.error;
    this.persistence.save({ replica: p.replica, label: p.label, ancestors: p.ancestors, undo: p.undo, txnCounter: p.txnCounter }, force);
    if (this.persistence.error && this.persistence.error !== prevError) {
      this.emit({ type: "storage-error", message: `Couldn't save this tab's history: ${this.persistence.error}` });
    }
  }

  resetRoom(): string {
    this.persistence.clear();
    const room = `r-${randomId(this.random, 6).slice(1)}`;
    return room;
  }
}

/** An invite for a different board: the UI offers to switch to it. */
export class RoomMismatchError extends PairingCodeError {
  constructor(readonly room: string) {
    super(`This invite is for another board (“${room}”). Open the invite link to join it.`);
  }
}

function linkInfo(l: RtcLink): RtcLinkInfo {
  return {
    pid: l.pid,
    role: l.role,
    state: l.state,
    code: l.code,
    remoteReplica: l.remoteReplica,
    remoteReplicas: [...l.remoteReplicas],
    remoteLabel: l.remoteLabel,
    error: l.error,
    remoteClosed: l.remoteClosed,
    createdAt: l.createdAt,
  };
}

export function createSession(opts: SessionOptions): WhiteboardSessionApi {
  return new WhiteboardSession(opts);
}
