/**
 * One WebRTC DataChannel link to a replica on another computer, paired without a server:
 * the inviter's offer and the invitee's answer travel as copy-paste codes (rtc-codec.ts).
 * ICE is gathered completely before a code is produced (no trickle), so each side hands over
 * exactly one code.
 *
 * Messages are JSON strings; anything larger than a safe SCTP message is chunked and
 * reassembled. Sending applies backpressure via `bufferedAmount`.
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
  /** Give up if the link isn't up this long after the answer is applied. */
  connectTimeoutMs?: number;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const CHUNK = 16_000;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;

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
  remoteReplica: ReplicaId | null = null;
  remoteLabel: string | null = null;
  error: string | null = null;
  readonly createdAt = Date.now();

  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private handlers = new Set<(msg: SyncMessage) => void>();
  private stateHandlers = new Set<(link: RtcLink) => void>();
  private outbox: string[] = [];
  private partial = new Map<string, string[]>();
  private chunkSeq = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
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
    link.attach(link.pc.createDataChannel("weave", { ordered: true }));
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await waitForGathering(link.pc, opts.gatherTimeoutMs ?? 4000);
    const offer: PairingOffer = { v: 1, k: "offer", pid: link.pid, room: me.room, from: me.replica, label: me.label, sdp: link.pc.localDescription?.sdp ?? "" };
    link.code = await encodePairing(offer);
    link.setState("waiting-answer");
    return link;
  }

  /** Invitee: consume an offer code and produce the answer code. */
  static async accept(offer: PairingOffer, me: RtcIdentity, opts: RtcOptions = {}): Promise<RtcLink> {
    const link = new RtcLink("invitee", offer.pid, opts);
    link.remoteReplica = offer.from;
    link.remoteLabel = offer.label;
    link.pc.addEventListener("datachannel", (e) => link.attach(e.channel));
    await link.pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await waitForGathering(link.pc, opts.gatherTimeoutMs ?? 4000);
    const answer: PairingAnswer = { v: 1, k: "answer", pid: offer.pid, room: me.room, from: me.replica, label: me.label, sdp: link.pc.localDescription?.sdp ?? "" };
    link.code = await encodePairing(answer);
    link.setState("connecting");
    link.armConnectTimeout();
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
    await this.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    this.armConnectTimeout();
  }

  private armConnectTimeout(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.state === "connecting") this.fail("Couldn't reach the other computer. Strict networks may need a TURN server.");
    }, this.opts.connectTimeoutMs ?? 20_000);
  }

  private attach(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.bufferedAmountLowThreshold = LOW_WATER;
    dc.addEventListener("open", () => {
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.setState("connected");
      this.flush();
    });
    dc.addEventListener("close", () => {
      if (this.state !== "failed") this.setState("closed");
    });
    dc.addEventListener("bufferedamountlow", () => this.flush());
    dc.addEventListener("message", (e) => this.onData(e.data));
  }

  private onConnectionState = () => {
    const s = this.pc.connectionState;
    if (s === "connected" && this.dc?.readyState === "open") this.setState("connected");
    else if (s === "disconnected" && this.state === "connected") this.setState("disconnected"); // may recover on its own
    else if (s === "failed") this.fail("The connection to the other computer was lost.");
    else if (s === "closed") this.setState("closed");
  };

  private fail(message: string): void {
    this.error = message;
    this.setState("failed");
    this.close();
  }

  private setState(s: RtcLinkState): void {
    if (this.state === s) return;
    if ((this.state === "closed" || this.state === "failed") && s !== "failed") return;
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

  /* ------------------------------------------------------------ framing */

  send(msg: SyncMessage): void {
    if (this.state === "closed" || this.state === "failed") return;
    const json = JSON.stringify(msg);
    if (json.length <= CHUNK) this.outbox.push("m" + json);
    else {
      const id = `${this.pid}-${++this.chunkSeq}`;
      const n = Math.ceil(json.length / CHUNK);
      for (let i = 0; i < n; i++) this.outbox.push(`c${id}|${i}|${n}|${json.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    }
    this.flush();
  }

  private flush(): void {
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") return;
    while (this.outbox.length && dc.bufferedAmount < HIGH_WATER) {
      try {
        dc.send(this.outbox.shift()!);
      } catch {
        return; // channel closing; anti-entropy repairs anything lost
      }
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
      parts[i] = data.slice(c + 1);
      if (parts.filter((p) => p !== undefined).length < n) return;
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
    if (!this.remoteReplica && typeof msg.from === "string") this.remoteReplica = msg.from;
    for (const h of [...this.handlers]) h(msg);
  }

  close(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    try {
      this.dc?.close();
    } catch {
      /* already closed */
    }
    try {
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.outbox = [];
    this.partial.clear();
    if (this.state !== "failed") this.setState("closed");
  }
}
