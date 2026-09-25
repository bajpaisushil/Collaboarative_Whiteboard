/**
 * Minimal in-memory RTCPeerConnection/RTCDataChannel pair for node tests. Two fakes are
 * "wired" when the inviter applies the invitee's answer: the offer SDP carries a registry key,
 * so the answer side can find its peer. Data channels deliver asynchronously (like the real
 * thing) and track bufferedAmount so backpressure code paths run.
 */

type Listener = (e: unknown) => void;

class Emitter {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener) {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  protected emit(type: string, e: unknown = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
}

export class FakeDataChannel extends Emitter {
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: FakeDataChannel | null = null;
  /** Every string sent (for assertions about framing). */
  sent: string[] = [];
  constructor(readonly label: string) {
    super();
  }
  /** @internal */ open() {
    this.readyState = "open";
    this.emit("open");
  }
  send(data: string) {
    if (this.readyState !== "open") throw new Error("InvalidStateError");
    this.sent.push(data);
    this.bufferedAmount += data.length;
    const peer = this.peer;
    queueMicrotask(() => {
      this.bufferedAmount = Math.max(0, this.bufferedAmount - data.length);
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold) this.emit("bufferedamountlow");
      if (peer && peer.readyState === "open") peer.emit("message", { data });
    });
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.emit("close");
    const p = this.peer;
    if (p && p.readyState !== "closed") queueMicrotask(() => p.close());
  }
}

const registry = new Map<string, FakePeerConnection>();
let seq = 0;

export class FakePeerConnection extends Emitter {
  iceGatheringState: "new" | "gathering" | "complete" = "new";
  connectionState: "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed" = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  private key = `fake-${++seq}`;
  private channel: FakeDataChannel | null = null;
  /** Set to make this side never connect (connect-timeout tests). */
  static blackhole = false;

  constructor(readonly config?: unknown) {
    super();
    registry.set(this.key, this);
  }
  createDataChannel(label: string) {
    this.channel = new FakeDataChannel(label);
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: `v=0 offer ${this.key}` };
  }
  async createAnswer() {
    return { type: "answer", sdp: `v=0 answer ${this.key}` };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
    this.iceGatheringState = "complete";
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d;
    if (d.type === "answer" && this.channel && !FakePeerConnection.blackhole) {
      const peerKey = d.sdp.split(" ").pop()!;
      const peer = registry.get(peerKey);
      if (!peer) return;
      const remote = new FakeDataChannel(this.channel.label);
      this.channel.peer = remote;
      remote.peer = this.channel;
      queueMicrotask(() => {
        this.connectionState = peer.connectionState = "connected";
        peer.emit("datachannel", { channel: remote });
        this.channel!.open();
        remote.open();
        this.emit("connectionstatechange");
        peer.emit("connectionstatechange");
      });
    }
  }
  close() {
    this.connectionState = "closed";
    this.channel?.close();
    registry.delete(this.key);
    this.emit("connectionstatechange");
  }
}

export const FakeRTC = FakePeerConnection as unknown as typeof RTCPeerConnection;
