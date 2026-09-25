/**
 * Regression tests for issues found in the adversarial review of the WebRTC layer.
 */
import { describe, expect, it } from "vitest";
import { WhiteboardSession } from "../../session/session";
import type { SessionEvent, SessionOptions } from "../../session/types";
import type { SyncMessage } from "../protocol";
import { RtcLink, chunkString } from "../rtc";
import { decodePairing, encodePairing } from "../rtc-codec";
import { MemoryHub } from "../transport";
import { FakeRTC } from "./fake-rtc";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await sleep(10);
  }
}
const me = (replica: string) => ({ room: "r", replica, label: "A" });

describe("chunking never splits a surrogate pair", () => {
  it("chunkString keeps emoji whole", () => {
    const s = "a".repeat(15_999) + "😀" + "b".repeat(20);
    const parts = chunkString(s, 16_000);
    expect(parts.join("")).toBe(s);
    for (const p of parts) {
      const last = p.charCodeAt(p.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it("a large message with emoji at a chunk boundary arrives byte-identical over a UTF-8 channel", async () => {
    const a = await RtcLink.invite(me("ra"), { RTCPeerConnection: FakeRTC });
    const b = await RtcLink.accept((await decodePairing(a.code!)) as never, me("rb"), { RTCPeerConnection: FakeRTC });
    await a.complete(b.code!);
    await until(() => a.open && b.open);
    const got: SyncMessage[] = [];
    b.onMessage((m) => got.push(m));
    // Put an emoji straddling every 16k boundary.
    const key = Array.from({ length: 6 }, () => "x".repeat(15_990) + "🙂🧵").join("");
    a.send({ v: 1, from: "ra", nonce: "n", t: "sync-req", vc: { [key]: 1 } });
    await until(() => got.length === 1);
    expect(Object.keys((got[0] as { vc: Record<string, number> }).vc)[0]).toBe(key);
    a.close();
  });
});

describe("link lifecycle", () => {
  it("the invitee waits patiently for its reply to be pasted (no 20 s give-up)", async () => {
    const a = await RtcLink.invite(me("ra"), { RTCPeerConnection: FakeRTC });
    const b = await RtcLink.accept((await decodePairing(a.code!)) as never, me("rb"), { RTCPeerConnection: FakeRTC, connectTimeoutMs: 30 });
    await sleep(120);
    expect(b.state).toBe("connecting"); // connectTimeoutMs only applies to the inviter
    await a.complete(b.code!);
    await until(() => a.state === "connected" && b.state === "connected");
    a.close();
  });

  it("a damaged reply fails the invite instead of leaving it 'connecting' forever", async () => {
    const a = await RtcLink.invite(me("ra"), { RTCPeerConnection: FakeRTC });
    const bad = await encodePairing({ v: 1, k: "answer", pid: a.pid, room: "r", from: "rb", label: "B", sdp: "garbage" });
    await expect(a.complete(bad)).rejects.toThrow(/couldn't be used/);
    expect(a.state).toBe("failed");
  });

  it("when the other computer closes, our side closes too — one 'lost', no later 'failed'", async () => {
    const hubA = new MemoryHub(),
      hubB = new MemoryHub();
    const mk = (id: string, hub: MemoryHub) => {
      const s = new WhiteboardSession({ room: "x", pane: id, replicaId: `r${id}`, transport: hub.connect(), storage: null, useLocks: false, heartbeatMs: 40, RTCPeerConnection: FakeRTC });
      s.start();
      return s;
    };
    const a = mk("a", hubA),
      b = mk("b", hubB);
    await until(() => a.getState().ready && b.getState().ready);
    const events: string[] = [];
    b.onEvent((e) => e.type === "link" && events.push(e.change));
    const inv = await a.createInvite();
    const rep = await b.acceptInvite(inv.code!);
    await a.completeInvite(rep.code!);
    await until(() => b.getState().rtc.links.some((l) => l.state === "connected"));
    a.closeLink(inv.pid);
    await until(() => b.getState().rtc.links.every((l) => l.state === "closed"));
    await sleep(100);
    expect(events).toEqual(["connected", "lost"]);
    a.dispose();
    b.dispose();
  });
});

function session(hub: MemoryHub, id: string, extra: Partial<SessionOptions> = {}) {
  const s = new WhiteboardSession({ room: "v", pane: id, replicaId: `r${id}`, transport: hub.connect(), storage: null, useLocks: false, heartbeatMs: 40, RTCPeerConnection: FakeRTC, ...extra });
  s.start();
  return s;
}

describe("session robustness", () => {
  it("drops malformed messages instead of crashing", async () => {
    const hub = new MemoryHub();
    const a = session(hub, "a");
    await until(() => a.getState().ready);
    const evil = hub.connect();
    const base = { v: 1, from: "revil", nonce: "n1" };
    const bad: unknown[] = [
      { ...base, t: "hello", label: 5, vc: {}, stateHash: "h", wantReply: false, rtc: false, visible: true },
      { ...base, t: "heartbeat", label: "E", vc: null, stateHash: "h", rtc: false, visible: true },
      { ...base, t: "heartbeat", label: "E", vc: { x: -1 }, stateHash: "h", rtc: false, visible: true },
      { ...base, t: "ops", ops: "nope", reason: "live" },
      { ...base, t: "presence", seq: 1, state: { label: "E", color: 3 } },
      { ...base, t: "sync-req", vc: "all" },
      { v: 1, t: "bye" },
      null,
      "garbage",
    ];
    for (const m of bad) evil.send(m as SyncMessage);
    await sleep(80);
    expect(() => a.getState()).not.toThrow();
    expect(a.getState().peers.find((p) => p.replica === "revil")).toBeUndefined();
    expect(a.getPresence().size).toBe(0);
    a.dispose();
  });

  it("a reloaded peer's presence shows again immediately (seq restarts with a new instance)", async () => {
    const hub = new MemoryHub();
    const a = session(hub, "a");
    await until(() => a.getState().ready);
    const peer = hub.connect();
    const hello = (nonce: string) => ({ v: 1, from: "rp", nonce, t: "hello", label: "P", vc: {}, stateHash: "h", wantReply: false, rtc: false, visible: true });
    const presence = (nonce: string, seq: number, x: number) => ({
      v: 1,
      from: "rp",
      nonce,
      t: "presence",
      seq,
      state: { label: "P", color: "#000", cursor: { x, y: 0 }, drawing: null, preview: null, selection: [], editingText: null },
    });
    peer.send(hello("old") as SyncMessage);
    peer.send(presence("old", 5000, 1) as SyncMessage);
    await until(() => a.getPresence().get("rp")?.cursor?.x === 1);
    // Reload: same replica id, new instance nonce, seq restarts at 1.
    peer.send({ v: 1, from: "rp", nonce: "old", t: "bye" } as SyncMessage);
    peer.send(hello("new") as SyncMessage);
    peer.send(presence("new", 1, 2) as SyncMessage);
    await until(() => a.getPresence().get("rp")?.cursor?.x === 2);
    a.dispose();
  });

  it("a duplicated bye announces the peer leaving once", async () => {
    const hub = new MemoryHub();
    const a = session(hub, "a");
    await until(() => a.getState().ready);
    const peer = hub.connect();
    const left: SessionEvent[] = [];
    a.onEvent((e) => e.type === "peer-left" && left.push(e));
    peer.send({ v: 1, from: "rq", nonce: "n", t: "hello", label: "Q", vc: {}, stateHash: "h", wantReply: false, rtc: false, visible: true } as SyncMessage);
    await until(() => a.getState().peers.some((p) => p.replica === "rq"));
    peer.send({ v: 1, from: "rq", nonce: "n", t: "bye" } as SyncMessage);
    peer.send({ v: 1, from: "rq", nonce: "n", t: "bye" } as SyncMessage);
    await sleep(60);
    expect(left).toHaveLength(1);
    a.dispose();
  });

  it("two concurrent acceptInvite calls for one invite end up with one working link", async () => {
    const a = session(new MemoryHub(), "a", { room: "w" });
    const b = session(new MemoryHub(), "b", { room: "w" });
    await until(() => a.getState().ready && b.getState().ready);
    const inv = await a.createInvite();
    const [r1, r2] = await Promise.all([b.acceptInvite(inv.code!), b.acceptInvite(inv.code!)]);
    expect(r1.pid).toBe(r2.pid);
    expect(b.getState().rtc.links).toHaveLength(1);
    await a.completeInvite(r1.code!);
    a.transact((tx) => {
      tx.create({ type: "rect", props: { w: 10, h: 10 } });
    });
    await until(() => b.replica.getView().shapes.length === 1);
    a.dispose();
    b.dispose();
  });
});
