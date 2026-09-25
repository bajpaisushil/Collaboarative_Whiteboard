import { describe, expect, it } from "vitest";
import { WhiteboardSession, RoomMismatchError } from "../../session/session";
import type { SessionOptions } from "../../session/types";
import type { SyncMessage } from "../protocol";
import { LinkRouter } from "../router";
import { RtcLink } from "../rtc";
import { decodePairing, encodePairing, extractPairingCode, PairingCodeError } from "../rtc-codec";
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

describe("pairing codes", () => {
  it("round-trips offers and answers, and finds codes inside pasted links", async () => {
    const offer = { v: 1 as const, k: "offer" as const, pid: "p1", room: "lobby", from: "rabc", label: "A", sdp: "v=0\r\n".repeat(200) };
    const code = await encodePairing(offer);
    expect(code).toMatch(/^W1\.[zj]\./);
    expect(code.length).toBeLessThan(400); // compression keeps links chat-friendly
    expect(await decodePairing(code)).toEqual(offer);
    const link = `https://weave.example/?room=lobby#join=${code}`;
    expect(extractPairingCode(`Here you go: ${link} thanks!`)).toBe(code);
    expect(await decodePairing(link)).toEqual(offer);
  });

  it("rejects garbage and truncated codes with friendly messages", async () => {
    await expect(decodePairing("hello")).rejects.toThrow(PairingCodeError);
    const code = await encodePairing({ v: 1, k: "answer", pid: "p", room: "r", from: "x", label: "B", sdp: "sdp" });
    await expect(decodePairing(code.slice(0, code.length - 6))).rejects.toThrow(/incomplete|valid/);
  });
});

describe("RtcLink over a fake peer connection", () => {
  const me = (replica: string) => ({ room: "r", replica, label: replica.toUpperCase() });

  it("connects via invite → accept → complete and reassembles >1 MB messages", async () => {
    const a = await RtcLink.invite(me("ra"), { RTCPeerConnection: FakeRTC });
    expect(a.state).toBe("waiting-answer");
    const b = await RtcLink.accept((await decodePairing(a.code!)) as never, me("rb"), { RTCPeerConnection: FakeRTC });
    await a.complete(b.code!);
    await until(() => a.state === "connected" && b.state === "connected");
    const got: SyncMessage[] = [];
    b.onMessage((m) => got.push(m));
    const big = "x".repeat(1_200_000);
    a.send({ v: 1, from: "ra", nonce: "n", t: "sync-req", vc: { [big]: 1 } });
    a.send({ v: 1, from: "ra", nonce: "n", t: "bye" });
    await until(() => got.length === 2);
    expect(Object.keys((got[0] as { vc: Record<string, number> }).vc)[0].length).toBe(1_200_000);
    expect(got[1].t).toBe("bye");
    expect(b.remoteReplica).toBe("ra");
    a.close();
    await until(() => b.state === "closed");
  });

  it("rejects a reply for a different invite and reused invites", async () => {
    const a = await RtcLink.invite(me("ra"), { RTCPeerConnection: FakeRTC });
    const other = await RtcLink.invite(me("rz"), { RTCPeerConnection: FakeRTC });
    const b = await RtcLink.accept((await decodePairing(other.code!)) as never, me("rb"), { RTCPeerConnection: FakeRTC });
    await expect(a.complete(b.code!)).rejects.toThrow(/different invite/);
    await expect(a.complete(a.code!)).rejects.toThrow(/invite, not a reply/);
    for (const l of [a, other, b]) l.close();
  });
});

describe("LinkRouter", () => {
  it("fans out to every path and tags where messages came from", async () => {
    const hub = new MemoryHub();
    const r = new LinkRouter(hub.connect());
    const peer = hub.connect();
    const seen: [string, string | undefined][] = [];
    r.onMessage((m, via) => seen.push([m.t, via]));
    const onPeer: SyncMessage[] = [];
    peer.onMessage((m) => onPeer.push(m));
    r.send({ v: 1, from: "a", nonce: "n", t: "bye" });
    peer.send({ v: 1, from: "b", nonce: "n", t: "bye" });
    await until(() => onPeer.length === 1 && seen.length === 1);
    expect(seen[0]).toEqual(["bye", "broadcast"]);
    r.close();
  });
});

function mk(id: string, extra: Partial<SessionOptions> = {}) {
  // Separate hubs: the ONLY way these two sessions can talk is the (fake) WebRTC link.
  const s = new WhiteboardSession({
    room: "two-computers",
    pane: id,
    replicaId: `r${id}`,
    transport: new MemoryHub().connect(),
    storage: null,
    useLocks: false,
    heartbeatMs: 40,
    RTCPeerConnection: FakeRTC,
    ...extra,
  });
  s.start();
  return s;
}

describe("two computers paired over WebRTC", () => {
  it("pairs, syncs, merges offline edits with a knot, and survives a disconnect", async () => {
    const a = mk("a");
    const b = mk("b");
    await until(() => a.getState().ready && b.getState().ready);
    // Each "computer" picked "A" on its own; pairing resolves the clash.
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "sticky", props: { x: 0, y: 0, w: 200, h: 150, fill: "#ffe58a" }, text: "Plan" });
    });

    const invite = await a.createInvite();
    expect(invite.code).toMatch(/^W1\./);
    const reply = await b.acceptInvite(`https://x.test/?room=two-computers#join=${invite.code}`);
    await a.completeInvite(reply.code!);
    await until(() => a.getState().rtc.links.some((l) => l.state === "connected"));
    await until(() => b.replica.getView().shapes.length === 1);
    await until(() => a.getState().label !== b.getState().label);
    expect(a.getState().peers.find((p) => p.replica === "rb")?.transport).toBe("webrtc");

    // Offline edits on both computers merge into one explained knot.
    b.setOnline(false);
    a.transact((tx) => tx.update(id, { fill: "#ffc2a8" }));
    b.transact((tx) => tx.update(id, { fill: "#b8ecd9" }));
    b.setOnline(true);
    await until(() => a.replica.getView().stateHash === b.replica.getView().stateHash && a.replica.getView().conflicts.length === 1);
    expect(a.replica.explain(a.replica.getView().conflicts[0].id)?.convergence.equal).toBe(true);

    // Closing the link: edits keep working locally; the peer is no longer reachable over it.
    a.closeLink(invite.pid);
    await until(() => b.getState().rtc.links.every((l) => l.state === "closed"));
    b.transact((tx) => tx.update(id, { x: 50, y: 50 }));
    await sleep(150);
    expect(a.replica.getView().shapes[0].x).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("explains wrong codes, own invites and other boards", async () => {
    const a = mk("c");
    const b = mk("d", { room: "another-board" });
    await until(() => a.getState().ready && b.getState().ready);
    const invite = await a.createInvite();
    await expect(a.acceptInvite(invite.code!)).rejects.toThrow(/own invite/);
    await expect(b.acceptInvite(invite.code!)).rejects.toBeInstanceOf(RoomMismatchError);
    await expect(a.completeInvite(invite.code!)).rejects.toThrow(/invite, not a reply/);
    await expect(a.acceptInvite("not a code")).rejects.toThrow(/doesn't look like/);
    a.dispose();
    b.dispose();
  });
});
