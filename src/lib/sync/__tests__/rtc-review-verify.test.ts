/**
 * Second pass over the WebRTC adversarial-review fixes: edge cases the first regression tests
 * (rtc-review.test.ts) don't reach — chunk boundaries at every surrogate parity, leaked
 * RTCPeerConnections on every error path, ICE recovering right before the "disconnected"
 * deadline, unicast routing, and catch-up over a bandwidth-limited link.
 *
 * The last block pins gaps that are still open as `it.fails`: each one fails today (so the
 * suite stays green); when the gap is fixed, the test starts "passing" and vitest reports it —
 * flip it to `it(...)` then.
 */
import { afterEach, describe, expect, it } from "vitest";
import { vcEquals } from "../../crdt/vector-clock";
import { WhiteboardSession } from "../../session/session";
import type { MergeReport, SessionOptions } from "../../session/types";
import type { SyncMessage } from "../protocol";
import { chunkString, RtcLink } from "../rtc";
import { decodePairing, encodePairing } from "../rtc-codec";
import { MemoryHub } from "../transport";
import { FakeDataChannel, FakePeerConnection, FakeRTC } from "./fake-rtc";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await sleep(5);
  }
}
const me = (replica: string) => ({ room: "r", replica, label: "A" });
const utf8 = (s: string) => new TextDecoder().decode(new TextEncoder().encode(s));

function session(id: string, extra: Partial<SessionOptions> = {}, hub = new MemoryHub()) {
  const s = new WhiteboardSession({ room: "verify", pane: id, replicaId: `r${id}`, transport: hub.connect(), storage: null, useLocks: false, heartbeatMs: 40, RTCPeerConnection: FakeRTC, ...extra });
  s.start();
  return s;
}

async function pair(a: WhiteboardSession, b: WhiteboardSession): Promise<string> {
  const inv = await a.createInvite();
  const rep = await b.acceptInvite(inv.code!);
  await a.completeInvite(rep.code!);
  await until(() => a.getState().rtc.links.some((l) => l.state === "connected") && b.getState().rtc.links.some((l) => l.state === "connected"));
  return inv.pid;
}

async function linkedPair(opts: Record<string, unknown> = {}) {
  const a = await RtcLink.invite(me("ra"), { RTCPeerConnection: FakeRTC, ...opts });
  const b = await RtcLink.accept((await decodePairing(a.code!)) as never, me("rb"), { RTCPeerConnection: FakeRTC, ...opts });
  await a.complete(b.code!);
  await until(() => a.state === "connected" && b.state === "connected");
  return { a, b };
}

/** Drive the fake pc's connectionState like a browser would. */
function setPc(link: RtcLink, state: string) {
  const pc = (link as unknown as { pc: FakePeerConnection & { emit(t: string): void } }).pc;
  pc.connectionState = state as FakePeerConnection["connectionState"];
  pc.emit("connectionstatechange");
}

/**
 * Bandwidth-limited DataChannels: `rate` chars/s per channel, FIFO; bufferedAmount drains as a
 * message goes out (like a browser), so the backlog-aware catch-up code paths run.
 */
function throttleChannels(rate: number): () => void {
  const orig = FakeDataChannel.prototype.send;
  const timers = new Set<ReturnType<typeof setInterval>>();
  type Ch = FakeDataChannel & { q?: { data: string; left: number }[]; t?: ReturnType<typeof setInterval>; emit(t: string, e?: unknown): void };
  FakeDataChannel.prototype.send = function (this: Ch, data: string) {
    if (this.readyState !== "open") throw new Error("InvalidStateError");
    this.q ??= [];
    this.q.push({ data, left: data.length });
    this.bufferedAmount += data.length;
    if (this.t) return;
    this.t = setInterval(() => {
      let budget = rate / 100;
      while (budget > 0 && this.q!.length) {
        const h = this.q![0];
        const take = Math.min(budget, h.left);
        h.left -= take;
        budget -= take;
        if (h.left > 0) break;
        this.q!.shift();
        const before = this.bufferedAmount;
        this.bufferedAmount -= h.data.length;
        if (before > this.bufferedAmountLowThreshold && this.bufferedAmount <= this.bufferedAmountLowThreshold) this.emit("bufferedamountlow");
        const peer = this.peer as Ch | null;
        if (peer && peer.readyState === "open") peer.emit("message", { data: h.data });
      }
    }, 10);
    timers.add(this.t);
  };
  return () => {
    FakeDataChannel.prototype.send = orig;
    for (const t of timers) clearInterval(t);
  };
}

const POINTS = Array.from({ length: 60 }, (_, i) => [i * 3.3, i * 1.7] as [number, number]);

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

/* ------------------------------------------------------------------ (1) chunking */

describe("chunking keeps every surrogate pair whole", () => {
  it("random JSON (emoji, ZWJ sequences, CJK, escapes) survives chunking + per-chunk UTF-8 at many sizes", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = ["a", "😀", "🧵", "中", "é", "\n", '"', "\\", "\u{10FFFF}", "\u{1F468}‍\u{1F469}", "\ud800"];
    for (let iter = 0; iter < 120; iter++) {
      let s = "";
      const len = 1 + Math.floor(rnd() * 300);
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const json = JSON.stringify({ s }); // lone surrogates come out escaped; pairs stay raw
      for (const size of [2, 3, 4, 5, 7, 16, 33]) {
        const parts = chunkString(json, size);
        expect(parts.map(utf8).join("")).toBe(json);
        for (const p of parts) expect(p.length).toBeLessThanOrEqual(size);
      }
    }
  });

  it("a boundary right after a high surrogate moves back one; right after the low half it doesn't", () => {
    const s = "a".repeat(9) + "😀" + "b"; // [9] high, [10] low
    expect(chunkString(s, 10)).toEqual(["a".repeat(9), "😀b"]);
    expect(chunkString(s, 11)).toEqual(["a".repeat(9) + "😀", "b"]);
  });

  it("RtcLink: multi-chunk messages of consecutive astral characters arrive intact at every offset parity", async () => {
    const { a, b } = await linkedPair();
    const got: SyncMessage[] = [];
    b.onMessage((m) => got.push(m));
    for (let lead = 0; lead < 4; lead++) {
      const key = "k".repeat(lead) + "😀".repeat(20_000) + "中".repeat(3) + "🧵".repeat(10_001);
      a.send({ v: 1, from: "ra", nonce: "n", t: "sync-req", vc: { [key]: 1 } });
      await until(() => got.length === lead + 1);
      expect(Object.keys((got[lead] as { vc: Record<string, number> }).vc)[0] === key).toBe(true);
    }
    a.close();
  });
});

/* ------------------------------------------------------------------ (8) leaks */

describe("no RTCPeerConnection outlives a failed pairing step", () => {
  it("invite, accept and complete errors all close the peer connection they made", async () => {
    const made: FakePeerConnection[] = [];
    class Rec extends FakePeerConnection {
      constructor(c?: unknown) {
        super(c);
        made.push(this);
      }
    }
    class BadOffer extends Rec {
      async createOffer(): Promise<{ type: string; sdp: string }> {
        throw new Error("boom");
      }
    }
    class BadRemote extends Rec {
      async setRemoteDescription(): Promise<void> {
        throw new Error("InvalidAccessError");
      }
    }
    class BadAnswer extends Rec {
      async createAnswer(): Promise<{ type: string; sdp: string }> {
        throw new Error("boom");
      }
    }
    await expect(RtcLink.invite(me("ra"), { RTCPeerConnection: BadOffer as never })).rejects.toThrow();
    const good = await RtcLink.invite(me("ra"), { RTCPeerConnection: Rec as never });
    const offer = await decodePairing(good.code!);
    await expect(RtcLink.accept(offer as never, me("rb"), { RTCPeerConnection: BadRemote as never })).rejects.toThrow(/couldn't be used/);
    await expect(RtcLink.accept(offer as never, me("rb"), { RTCPeerConnection: BadAnswer as never })).rejects.toThrow();
    const bad = await encodePairing({ v: 1, k: "answer", pid: good.pid, room: "r", from: "rb", label: "B", sdp: "junk" });
    await expect(good.complete(bad)).rejects.toThrow();
    expect(good.state).toBe("failed");
    expect(made.map((p) => p.connectionState)).toEqual(["closed", "closed", "closed", "closed"]);
  });

  it("session: a failed accept registers nothing, and the same invite can be accepted again", async () => {
    const made: FakePeerConnection[] = [];
    let failNext = true;
    class Flaky extends FakePeerConnection {
      constructor(c?: unknown) {
        super(c);
        made.push(this);
      }
      async createAnswer(): Promise<{ type: string; sdp: string }> {
        if (failNext) {
          failNext = false;
          throw new Error("boom");
        }
        return super.createAnswer();
      }
    }
    const a = session("a", { room: "leak" });
    const b = session("b", { room: "leak", RTCPeerConnection: Flaky as never });
    await until(() => a.getState().ready && b.getState().ready);
    const inv = await a.createInvite();
    await expect(b.acceptInvite(inv.code!)).rejects.toThrow();
    expect(b.getState().rtc.links).toHaveLength(0);
    expect(made[0].connectionState).toBe("closed");
    const rep = await b.acceptInvite(inv.code!);
    await a.completeInvite(rep.code!);
    await until(() => b.getState().rtc.links[0]?.state === "connected");
    a.dispose();
    b.dispose();
  });
});

/* ------------------------------------------------------------------ (10)/(11) lifecycle */

describe("'disconnected' has a deadline, and recovery resets it", () => {
  it("stays disconnected until the deadline, then fails once; a late pc 'failed' changes nothing", async () => {
    const { a, b } = await linkedPair({ disconnectTimeoutMs: 100 });
    const states: string[] = [];
    a.onState((l) => states.push(l.state));
    setPc(a, "disconnected");
    await sleep(60);
    expect(a.state).toBe("disconnected");
    await sleep(100);
    expect(a.state).toBe("failed");
    setPc(a, "failed");
    expect(states).toEqual(["disconnected", "failed"]);
    b.close();
  });

  it("recovering just before the deadline keeps the link; the next outage gets a full new deadline", async () => {
    const { a, b } = await linkedPair({ disconnectTimeoutMs: 100 });
    setPc(a, "disconnected");
    await sleep(85);
    setPc(a, "connected");
    expect(a.state).toBe("connected");
    await sleep(40); // past the first deadline
    expect(a.state).toBe("connected");
    setPc(a, "disconnected");
    await sleep(70);
    expect(a.state).toBe("disconnected");
    await sleep(70);
    expect(a.state).toBe("failed");
    b.close();
  });

  it("an ICE 'connected' without an open reliable channel doesn't count as recovered", async () => {
    const { a, b } = await linkedPair({ disconnectTimeoutMs: 60 });
    setPc(a, "disconnected");
    (a as unknown as { dc: FakeDataChannel }).dc.readyState = "closing";
    setPc(a, "connected");
    expect(a.state).toBe("disconnected");
    await sleep(100);
    expect(a.state).toBe("failed");
    b.close();
  });
});

/* ------------------------------------------------------------------ (4) routing + backlog */

describe("unicast and catch-up over paired links", () => {
  it("catch-up for a local tab never crosses the WebRTC link, and the remote's never hits BroadcastChannel", async () => {
    const hubA = new MemoryHub();
    const a = session("a", {}, hubA);
    const b = session("b");
    await until(() => a.getState().ready && b.getState().ready);
    const pid = await pair(a, b);
    const onBc: SyncMessage[] = [];
    hubA.connect().onMessage((m) => onBc.push(m));
    const dc = (a as unknown as { links: Map<string, { dc: FakeDataChannel }> }).links.get(pid)!.dc;
    for (let i = 0; i < 5; i++) a.transact((tx) => void tx.create({ type: "rect", props: { x: i, y: 0, w: 1, h: 1 } }));
    await until(() => b.replica.getView().shapes.length === 5);
    const mark = dc.sent.length;
    const a2 = session("a2", {}, hubA);
    await until(() => a2.replica.getView().shapes.length === 5);
    await sleep(100);
    expect(dc.sent.slice(mark).filter((f) => f.includes('"to":"ra2"'))).toHaveLength(0);
    expect(onBc.filter((m) => m.to === "rb")).toHaveLength(0);
    a.dispose();
    a2.dispose();
    b.dispose();
  });

  it("a catch-up bigger than the link can carry quickly is sent once, and liveness never lapses", async () => {
    restore = throttleChannels(300_000);
    const a = session("a", { heartbeatMs: 150 });
    const b = session("b", { heartbeatMs: 150 });
    await until(() => a.getState().ready && b.getState().ready);
    for (let i = 0; i < 500; i++) a.transact((tx) => void tx.create({ type: "stroke", props: { x: i, y: i, w: 100, h: 100, points: POINTS } as never }));
    const logChars = JSON.stringify(a.replica.getView().log).length;
    let wire = 0;
    const count = FakeDataChannel.prototype.send;
    FakeDataChannel.prototype.send = function (this: FakeDataChannel, d: string) {
      if (this.label === "weave") wire += d.length;
      return count.call(this, d);
    };
    let unreachable = false;
    const watch = setInterval(() => {
      if (b.getState().peers.find((p) => p.replica === "ra")?.status === "unreachable") unreachable = true;
    }, 50);
    await pair(a, b);
    await until(() => vcEquals(a.replica.getView().vc, b.replica.getView().vc), 20_000);
    await sleep(500);
    clearInterval(watch);
    // ~1.8 s of transfer with a heartbeat every 150 ms: the old code re-pushed on every one.
    expect(wire / logChars).toBeLessThan(1.25);
    expect(unreachable).toBe(false);
    a.dispose();
    b.dispose();
  });
});

/* ------------------------------------------------------------------ still open */

describe("known gaps (it.fails: flip to it() once fixed)", () => {
  it("(2) an ops message with a null entry is dropped quietly while a merge window is open", async () => {
    const hub = new MemoryHub();
    const a = session("a", {}, hub);
    await until(() => a.getState().ready);
    a.setOnline(false);
    a.transact((tx) => void tx.create({ type: "rect", props: { x: 0, y: 0, w: 10, h: 10 } }));
    a.setOnline(true); // opens a "rejoined" merge window
    const msg = { v: 1, from: "rk", nonce: "n", t: "ops", ops: [null], reason: "catchup" } as unknown as SyncMessage;
    // integrateRemote reads op.kind / op.shapeId before the replica's isValidOp filter runs.
    expect(() => (a as unknown as { handle(m: SyncMessage): void }).handle(msg)).not.toThrow();
    a.dispose();
  });

  it("(13) after the remote tab forks, its old identity still reads as 'another computer'", async () => {
    const hubB = new MemoryHub();
    const a = session("a", { room: "fork" });
    const b = session("b", { room: "fork" }, hubB);
    await until(() => a.getState().ready && b.getState().ready);
    await pair(a, b);
    await until(() => a.getState().peers.find((p) => p.replica === "rb")?.transport === "webrtc");
    // Same id + smaller nonce on B's own channel: B (no Web Locks) forks to a new id.
    hubB.connect().send({ v: 1, from: "rb", nonce: "0", t: "bye" } as SyncMessage);
    await until(() => b.replica.id !== "rb");
    const nid = b.replica.id;
    await until(() => a.getState().peers.some((p) => p.replica === nid && p.transport === "webrtc"));
    // The UI's peerPlace(): transport "webrtc", or a replica some link has reached → remote.
    const st = a.getState();
    const old = st.peers.find((p) => p.replica === "rb")!;
    const reached = new Set(st.rtc.links.map((l) => l.remoteReplica));
    const shownAsRemote = old.transport === "webrtc" || reached.has("rb");
    a.dispose();
    b.dispose();
    expect(shownAsRemote).toBe(true);
  });

  it("(15) a catch-up whose 250-op messages each take > 3 s still yields one complete merge report", async () => {
    // Session clock runs 10x real time: 400k chars/s real ≈ a 40 KB/s link in session time,
    // so each 250-stroke catch-up message (~270 KB) takes ~6.7 session-seconds to arrive.
    restore = throttleChannels(400_000);
    const t00 = Date.now();
    const now = () => t00 + (Date.now() - t00) * 10;
    const mk = (id: string) => session(id, { room: "slowmerge", heartbeatMs: 150, now });
    const a = mk("a");
    const b = mk("b");
    await until(() => a.getState().ready && b.getState().ready);
    let shared = "";
    a.transact((tx) => void (shared = tx.create({ type: "rect", props: { x: 0, y: 0, w: 10, h: 10, fill: "#fff" } })));
    await pair(a, b);
    await until(() => !!b.replica.getShape(shared) && a.getState().peers.some((p) => p.replica === "rb" && p.converged), 10_000);
    const N = 500;
    a.setOnline(false);
    b.setOnline(false);
    for (let i = 0; i < N; i++) a.transact((tx) => void tx.create({ type: "stroke", props: { x: i, y: i, w: 100, h: 100, points: POINTS } as never }));
    for (let i = 0; i < N; i++) b.transact((tx) => void tx.create({ type: "stroke", props: { x: -i, y: i, w: 100, h: 100, points: POINTS } as never }));
    a.transact((tx) => tx.update(shared, { fill: "#f00" }));
    b.transact((tx) => tx.update(shared, { fill: "#00f" }));
    const reports: MergeReport[] = [];
    a.onEvent((e) => e.type === "merge" && reports.push(e.report));
    a.setOnline(true);
    b.setOnline(true);
    await until(() => vcEquals(a.replica.getView().vc, b.replica.getView().vc), 30_000);
    await sleep(800);
    const got = reports.map((r) => [r.receivedOpIds.length, r.newConflicts.length]);
    a.dispose();
    b.dispose();
    // today: [[0, 0], [1, 1]] — "received nothing", then a second report with just the conflict
    expect(got).toEqual([[N + 1, 1]]);
  }, 60_000);
});
