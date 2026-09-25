/**
 * Minimal in-memory RTCPeerConnection/RTCDataChannel pair for node tests. Two fakes are
 * "wired" when the inviter applies the invitee's answer: the offer SDP carries a registry key,
 * so the answer side can find its peer. Data channels deliver asynchronously (like the real
 * thing), round-trip strings through UTF-8 exactly like a real DataChannel (so a lone
 * surrogate becomes U+FFFD), and track bufferedAmount so backpressure code paths run.
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
  constructor(
    readonly label: string,
    readonly init?: RTCDataChannelInit,
  ) {
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
    const wire = new TextDecoder().decode(new TextEncoder().encode(data)); // USVString on the wire
    queueMicrotask(() => {
      this.bufferedAmount = Math.max(0, this.bufferedAmount - data.length);
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold) this.emit("bufferedamountlow");
      if (peer && peer.readyState === "open") peer.emit("message", { data: wire });
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
  private channels: FakeDataChannel[] = [];
  /** Set to make this side never connect (connect-timeout tests). */
  static blackhole = false;

  constructor(readonly config?: unknown) {
    super();
    registry.set(this.key, this);
  }
  createDataChannel(label: string, init?: RTCDataChannelInit) {
    const ch = new FakeDataChannel(label, init);
    this.channels.push(ch);
    return ch;
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
    if (d.type === "answer" && !/^v=0 answer fake-\d+$/.test(d.sdp)) throw new Error("InvalidAccessError: bad answer SDP");
    if (d.type === "answer" && this.channels.length && !FakePeerConnection.blackhole) {
      const peerKey = d.sdp.split(" ").pop()!;
      const peer = registry.get(peerKey);
      if (!peer) return;
      const pairs = this.channels.map((local) => {
        const remote = new FakeDataChannel(local.label, local.init);
        local.peer = remote;
        remote.peer = local;
        peer.channels.push(remote);
        return [local, remote] as const;
      });
      queueMicrotask(() => {
        this.connectionState = peer.connectionState = "connected";
        for (const [, remote] of pairs) peer.emit("datachannel", { channel: remote });
        for (const [local, remote] of pairs) {
          local.open();
          remote.open();
        }
        this.emit("connectionstatechange");
        peer.emit("connectionstatechange");
      });
    }
  }
  close() {
    if (this.connectionState === "closed") return;
    this.connectionState = "closed";
    for (const ch of this.channels) ch.close();
    registry.delete(this.key);
    this.emit("connectionstatechange");
  }
}

export const FakeRTC = FakePeerConnection as unknown as typeof RTCPeerConnection;
