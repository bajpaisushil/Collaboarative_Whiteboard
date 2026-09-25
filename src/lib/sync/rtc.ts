/**
 * One WebRTC link to a replica on another computer, paired without a server: the inviter's
 * offer and the invitee's answer travel as copy-paste codes (rtc-codec.ts). ICE is gathered
 * completely before a code is produced (no trickle), so each side hands over exactly one code.
 *
 * Two DataChannels per link:
 * - "weave"      ordered + reliable: ops, hello, sync-req, bye (anything that must arrive).
 * - "weave-fast" unordered, maxRetransmits 0: heartbeats and presence — periodic, so a lost one
 *   is replaced by the next, and they never queue behind a large catch-up.
 *
 * Messages are JSON strings; anything larger than a safe SCTP message is chunked (never
 * splitting a UTF-16 surrogate pair — DataChannels carry UTF-8, so a lone surrogate would be
 * replaced with U+FFFD and corrupt the op) and reassembled. Sending applies backpressure.
 */
import type { ReplicaId } from "../crdt/types";
import type { SyncMessage } from "./protocol";
import { decodePairing, encodePairing, PairingCodeError, type PairingAnswer, type PairingOffer } from "./rtc-codec";

export type RtcLinkState = "gathering" | "waiting-answer" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

export interface RtcOptions {
  iceServers?: RTCIceServer[];
  /** Injectable for tests. */
  RTCPeerConnection?: typeof RTCPeerConnection;
  /** Max time to wait for ICE gathering before producing a code with what we have. */
  gatherTimeoutMs?: number;
  /** Inviter: give up if the link isn't up this long after the reply code is applied. */
  connectTimeoutMs?: number;
  /** Invitee: how long a reply code stays usable (the inviter pastes it by hand, maybe much later). */
  replyTtlMs?: number;
  /** Give up on a link that stays "disconnected" (ICE lost) this long. */
  disconnectTimeoutMs?: number;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const CHUNK = 16_000;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;
const FAST_TYPES: ReadonlySet<SyncMessage["t"]> = new Set(["heartbeat", "presence"]);

export function rtcAvailable(ctor?: typeof RTCPeerConnection): boolean {
  return !!(ctor ?? (typeof RTCPeerConnection !== "undefined" ? RTCPeerConnection : undefined));
}

function randomPid(): string {
  const a = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

function waitForGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      pc.removeEventListener("icecandidate", onCandidate);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
    pc.addEventListener("icecandidate", onCandidate);
  });
}

/** Split a string into ≤`size`-code-unit pieces without cutting a surrogate pair. */
export function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(s.length, i + size);
    if (end < s.length) {
      const c = s.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end--; // keep the high surrogate with its low half
    }
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

export interface RtcIdentity {
  room: string;
  replica: ReplicaId;
  label: string;
}

export class RtcLink {
  readonly pid: string;
  readonly role: "inviter" | "invitee";
  state: RtcLinkState = "gathering";
  /** The code this side must hand to the other side (offer for inviters, answer for invitees). */
  code: string | null = null;
  /** The replica on the other end (updated from its messages, so it follows a remote fork). */
  remoteReplica: ReplicaId | null = null;
  remoteLabel: string | null = null;
  error: string | null = null;
  readonly createdAt = Date.now();

  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private handlers = new Set<(msg: SyncMessage) => void>();
  private stateHandlers = new Set<(link: RtcLink) => void>();
  private outbox: string[] = [];
  private outboxBytes = 0;
  private partial = new Map<string, string[]>();
  private chunkSeq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: RtcOptions;

  private constructor(role: "inviter" | "invitee", pid: string, opts: RtcOptions) {
    this.role = role;
    this.pid = pid;
    this.opts = opts;
    const Ctor = opts.RTCPeerConnection ?? RTCPeerConnection;
    this.pc = new Ctor({ iceServers: opts.iceServers ?? DEFAULT_ICE_SERVERS });
    this.pc.addEventListener("connectionstatechange", this.onConnectionState);
  }

  /** Inviter: create the offer code. */
  static async invite(me: RtcIdentity, opts: RtcOptions = {}): Promise<RtcLink> {
    const link = new RtcLink("inviter", randomPid(), opts);
    try {
      link.attach(link.pc.createDataChannel("weave", { ordered: true }));
      link.attach(link.pc.createDataChannel("weave-fast", { ordered: false, maxRetransmits: 0 }));
      await link.pc.setLocalDescription(await link.pc.createOffer());
      await waitForGathering(link.pc, opts.gatherTimeoutMs ?? 4000);
      const offer: PairingOffer = { v: 1, k: "offer", pid: link.pid, room: me.room, from: me.replica, label: me.label, sdp: link.pc.localDescription?.sdp ?? "" };
      link.code = await encodePairing(offer);
    } catch (e) {
      link.close();
      throw e;
    }
    link.setState("waiting-answer");
    return link;
  }

  /** Invitee: consume an offer code and produce the answer code. */
  static async accept(offer: PairingOffer, me: RtcIdentity, opts: RtcOptions = {}): Promise<RtcLink> {
    const link = new RtcLink("invitee", offer.pid, opts);
    link.remoteReplica = offer.from;
    link.remoteLabel = offer.label;
    link.pc.addEventListener("datachannel", (e) => link.attach(e.channel));
    try {
      await link.pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      await waitForGathering(link.pc, opts.gatherTimeoutMs ?? 4000);
      const answer: PairingAnswer = { v: 1, k: "answer", pid: offer.pid, room: me.room, from: me.replica, label: me.label, sdp: link.pc.localDescription?.sdp ?? "" };
      link.code = await encodePairing(answer);
    } catch (e) {
      link.close();
      throw e instanceof PairingCodeError ? e : new PairingCodeError("That invite couldn't be used — ask for a fresh one.");
    }
    link.setState("connecting");
    // The inviter pastes our reply by hand, possibly minutes later: wait patiently.
    link.armTimer(opts.replyTtlMs ?? 15 * 60_000, "The reply code expired before it was used — make a new invite.");
    return link;
  }

  /** Inviter: apply the invitee's answer code. */
  async complete(answerText: string): Promise<void> {
    if (this.role !== "inviter") throw new PairingCodeError("Only the tab that made the invite can use a reply code.");
    const answer = await decodePairing(answerText);
    if (answer.k !== "answer") throw new PairingCodeError("That's an invite, not a reply. Paste the code the other computer showed after opening your invite.");
    if (answer.pid !== this.pid) throw new PairingCodeError("That reply belongs to a different invite.");
    if (this.state !== "waiting-answer") throw new PairingCodeError("This invite was already used.");
    this.remoteReplica = answer.from;
    this.remoteLabel = answer.label;
    this.setState("connecting");
    this.armTimer(this.opts.connectTimeoutMs ?? 30_000, "Couldn't reach the other computer. Strict networks may need a TURN server.");
    try {
      await this.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch {
      this.fail("That reply code couldn't be used — it may be damaged or from an older invite.");
      throw new PairingCodeError("That reply code couldn't be used — it may be damaged or from an older invite.");
    }
  }

  private armTimer(ms: number, message: string): void {
    this.clearTimer();
    const from = this.state;
    this.timer = setTimeout(() => {
      if (this.state === from) this.fail(message);
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private attach(dc: RTCDataChannel): void {
    if (dc.label === "weave-fast") {
      this.fast = dc;
      dc.addEventListener("message", (e) => this.onData(e.data));
      return;
    }
    this.dc = dc;
    dc.bufferedAmountLowThreshold = LOW_WATER;
    dc.addEventListener("open", () => {
      this.clearTimer();
      this.setState("connected");
      this.flush();
    });
    // The other computer closed (or the transport died): release our side too.
    dc.addEventListener("close", () => this.close());
    dc.addEventListener("bufferedamountlow", () => this.flush());
    dc.addEventListener("message", (e) => this.onData(e.data));
  }

  private onConnectionState = () => {
    const s = this.pc.connectionState;
    if (s === "connected" && this.dc?.readyState === "open") {
      this.clearTimer();
      this.setState("connected");
    } else if (s === "disconnected" && this.state === "connected") {
      // ICE lost the path; browsers often recover within seconds. Don't wait forever.
      this.setState("disconnected");
      this.armTimer(this.opts.disconnectTimeoutMs ?? 30_000, "The connection to the other computer was lost.");
    } else if (s === "failed") this.fail("The connection to the other computer was lost.");
    else if (s === "closed") this.close();
  };

  private fail(message: string): void {
    if (this.state === "closed" || this.state === "failed") return;
    this.error = message;
    this.setState("failed");
    this.close();
  }

  private setState(s: RtcLinkState): void {
    if (this.state === s) return;
    // Terminal states are final: no "failed" after "closed", nothing after either.
    if (this.state === "closed" || this.state === "failed") return;
    this.state = s;
    for (const h of [...this.stateHandlers]) h(this);
  }

  onState(handler: (link: RtcLink) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onMessage(handler: (msg: SyncMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get open(): boolean {
    return this.dc?.readyState === "open";
  }

  /** Bytes queued locally or in the reliable channel's buffer (used to avoid re-pushing catch-up). */
  get backlog(): number {
    return this.outboxBytes + (this.dc?.bufferedAmount ?? 0);
  }

  /* ------------------------------------------------------------ framing */

  send(msg: SyncMessage): void {
    if (this.state === "closed" || this.state === "failed") return;
    const json = JSON.stringify(msg);
    if (FAST_TYPES.has(msg.t) && json.length <= CHUNK && this.fast?.readyState === "open") {
      try {
        this.fast.send("m" + json);
        return;
      } catch {
        // fall back to the reliable channel
      }
    }
    if (json.length <= CHUNK) this.enqueue("m" + json);
    else {
      const id = `${this.pid}-${++this.chunkSeq}`;
      const parts = chunkString(json, CHUNK);
      parts.forEach((p, i) => this.enqueue(`c${id}|${i}|${parts.length}|${p}`));
    }
    this.flush();
  }

  private enqueue(frame: string): void {
    this.outbox.push(frame);
    this.outboxBytes += frame.length;
  }

  private flush(): void {
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") return;
    while (this.outbox.length && dc.bufferedAmount < HIGH_WATER) {
      const frame = this.outbox[0];
      try {
        dc.send(frame);
      } catch {
        return; // channel closing; anti-entropy repairs anything lost
      }
      this.outbox.shift();
      this.outboxBytes -= frame.length;
    }
  }

  private onData(data: unknown): void {
    if (typeof data !== "string" || data.length === 0) return;
    let json: string | null = null;
    if (data[0] === "m") json = data.slice(1);
    else if (data[0] === "c") {
      const a = data.indexOf("|"),
        b = data.indexOf("|", a + 1),
        c = data.indexOf("|", b + 1);
      if (a < 0 || b < 0 || c < 0) return;
      const id = data.slice(1, a);
      const i = Number(data.slice(a + 1, b));
      const n = Number(data.slice(b + 1, c));
      if (!Number.isInteger(i) || !Number.isInteger(n) || n <= 0 || n > 10_000 || i < 0 || i >= n) return;
      let parts = this.partial.get(id);
      if (!parts) {
        if (this.partial.size > 64) this.partial.clear(); // bound memory against garbage
        this.partial.set(id, (parts = new Array<string>(n)));
      }
      if (parts.length !== n) return;
      parts[i] = data.slice(c + 1);
      for (let k = 0; k < n; k++) if (parts[k] === undefined) return;
      this.partial.delete(id);
      json = parts.join("");
    }
    if (json === null) return;
    let msg: SyncMessage;
    try {
      msg = JSON.parse(json) as SyncMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") return;
    if (typeof msg.from === "string" && msg.from.length <= 64) this.remoteReplica = msg.from;
    for (const h of [...this.handlers]) h(msg);
  }

  close(): void {
    this.clearTimer();
    for (const ch of [this.dc, this.fast]) {
      try {
        ch?.close();
      } catch {
        /* already closed */
      }
    }
    try {
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.outbox = [];
    this.outboxBytes = 0;
    this.partial.clear();
    this.setState("closed");
  }
}
