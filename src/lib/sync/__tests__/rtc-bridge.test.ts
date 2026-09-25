/**
 * Multi-computer behaviour found by the WebRTC verification pass:
 * - tabs that only reach each other through a bridge tab (the other computer's other tabs) see
 *   each other — relayed presence keeps letters unique and statuses honest;
 * - a path that goes away (link closed, remote reload, deliberate disconnect, cable pulled)
 *   makes the tabs behind it unreachable at once instead of "In sync" for seconds or minutes;
 * - stale / reused pairing codes explain themselves;
 * - a reply code's lifetime matches what the browser will actually honour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { vcEquals } from "../../crdt/vector-clock";
import { WhiteboardSession } from "../../session/session";
import type { SessionEvent, SessionOptions } from "../../session/types";
import { REPLY_EXPIRED, REPLY_TTL_MS, RtcLink } from "../rtc";
import { decodePairing } from "../rtc-codec";
import { MemoryHub } from "../transport";
import { FakeDataChannel, FakePeerConnection, FakeRTC } from "./fake-rtc";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 4000, what = "condition") {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${what}`);
    await sleep(5);
  }
}

const live: WhiteboardSession[] = [];
afterEach(() => {
  for (const s of live.splice(0)) s.dispose();
  vi.useRealTimers();
});

function session(id: string, hub: MemoryHub, extra: Partial<SessionOptions> = {}) {
  const s = new WhiteboardSession({ room: "bridge", pane: id, replicaId: `r${id}`, transport: hub.connect(), storage: null, useLocks: false, heartbeatMs: 40, RTCPeerConnection: FakeRTC, ...extra });
  s.start();
  live.push(s);
  return s;
}

async function pair(a: WhiteboardSession, b: WhiteboardSession): Promise<string> {
  const inv = await a.createInvite();
  const rep = await b.acceptInvite(inv.code!);
  await a.completeInvite(rep.code!);
  await until(() => a.getState().rtc.links.some((l) => l.pid === inv.pid && l.state === "connected") && b.getState().rtc.links.some((l) => l.pid === inv.pid && l.state === "connected"), 4000, "link up");
  return inv.pid;
}

const peer = (s: WhiteboardSession, replica: string) => s.getState().peers.find((p) => p.replica === replica);
type LinkInternals = { close(): void; dc: FakeDataChannel };
const linkObj = (s: WhiteboardSession, pid: string) => (s as unknown as { links: Map<string, LinkInternals> }).links.get(pid)!;
const ready = (...ss: WhiteboardSession[]) => until(() => ss.every((s) => s.getState().ready), 4000, "ready");

/** Computer 1: tabs a1 + a2 (one BroadcastChannel); computer 2: tabs c1 + c2. a1 ↔ c1 paired. */
async function twoComputers() {
  const hub1 = new MemoryHub();
  const hub2 = new MemoryHub();
  const a1 = session("a1", hub1);
  const a2 = session("a2", hub1);
  const c1 = session("c1", hub2);
  const c2 = session("c2", hub2);
  await ready(a1, a2, c1, c2);
  // Each computer on its own picks A and B: the same two letters on both sides.
  await until(() => new Set([a1, a2].map((s) => s.getState().label)).size === 2 && new Set([c1, c2].map((s) => s.getState().label)).size === 2, 4000, "local letters");
  const pid = await pair(a1, c1);
  return { a1, a2, c1, c2, pid, all: [a1, a2, c1, c2] };
}

describe("tabs behind a bridge see each other (relayed presence)", () => {
  it("every tab on both computers sees the other three, with unique letters, on the right side", async () => {
    const { a1, a2, c1, c2, all } = await twoComputers();
    const ids = all.map((s) => s.replica.id);
    await until(
      () => all.every((s) => ids.every((id) => id === s.replica.id || peer(s, id)?.status === "online")) && new Set(all.map((s) => s.getState().label)).size === 4,
      6000,
      "everyone sees everyone with unique letters",
    );
    // Letters agree everywhere: what a2 calls c2 is what c2 calls itself.
    for (const s of all) for (const o of all) if (o !== s) expect(peer(s, o.replica.id)!.label).toBe(o.getState().label);

    // Non-bridge tabs: the other computer's tabs are remote (over WebRTC, through the bridge).
    const c2onA2 = peer(a2, c2.replica.id)!;
    expect(c2onA2).toMatchObject({ transport: "webrtc", remote: true, relay: a1.replica.id });
    const a2onC2 = peer(c2, a2.replica.id)!;
    expect(a2onC2).toMatchObject({ transport: "webrtc", remote: true, relay: c1.replica.id });
    // …and their own computer's tabs stay local.
    expect(peer(a2, a1.replica.id)).toMatchObject({ transport: "broadcast", remote: false, relay: null });
    expect(peer(c2, c1.replica.id)).toMatchObject({ transport: "broadcast", remote: false, relay: null });
  });

  it("edits from non-bridge tabs converge everywhere, and nobody unicasts to a tab it only hears through a relay", async () => {
    const { a1, a2, c1, c2, pid, all } = await twoComputers();
    const link = linkObj(c1, pid);
    const mark = link.dc.sent.length;
    a2.transact((tx) => void tx.create({ type: "rect", props: { x: 1, y: 1, w: 5, h: 5 } }));
    c2.transact((tx) => void tx.create({ type: "rect", props: { x: 9, y: 9, w: 5, h: 5 } }));
    await until(() => all.every((s) => s.replica.getView().shapes.length === 2 && vcEquals(s.replica.getView().vc, a1.replica.getView().vc)), 6000, "convergence");
    await sleep(200);
    // c1 knows a2 only through a1: its catch-up for a2 flows via a1, never addressed to a2.
    expect(link.dc.sent.slice(mark).filter((f) => f.includes(`"to":"${a2.replica.id}"`))).toHaveLength(0);
    // …and it doesn't rename the link: its other end is still a1.
    expect(c1.getState().rtc.links[0].remoteReplica).toBe(a1.replica.id);
  });

  it("when the bridge's link closes, the tabs behind it turn unreachable at once on both computers", async () => {
    const { a1, a2, c1, c2, pid, all } = await twoComputers();
    const ids = all.map((s) => s.replica.id);
    await until(() => all.every((s) => ids.every((id) => id === s.replica.id || peer(s, id)?.status === "online")), 6000, "everyone online");
    linkObj(c1, pid).close(); // abrupt (crash / reload): no goodbye of any kind
    await until(() => a1.getState().rtc.links[0]?.state === "closed", 2000, "a1 notices");
    await sleep(20);
    for (const [s, gone] of [
      [a1, [c1, c2]],
      [a2, [c1, c2]],
      [c1, [a1, a2]],
      [c2, [a1, a2]],
    ] as const) {
      for (const g of gone) expect(peer(s, g.replica.id)?.status, `${s.replica.id} sees ${g.replica.id}`).toBe("unreachable");
    }
    // Local tabs are untouched.
    expect(peer(a2, a1.replica.id)?.status).toBe("online");
    expect(peer(c2, c1.replica.id)?.status).toBe("online");
    // And it stays that way (the old heartbeat age would have said "online" for 5 s).
    await sleep(200);
    expect(peer(a2, c2.replica.id)?.status).toBe("unreachable");
  });
});

describe("a bridge tab that goes away takes the tabs behind it along", () => {
  it("closing the bridge tab: its local tab stops showing the other computer, and the other computer stops showing it", async () => {
    const { a1, a2, c1, c2, all } = await twoComputers();
    const ids = all.map((s) => s.replica.id);
    await until(() => all.every((s) => ids.every((id) => id === s.replica.id || peer(s, id)?.status === "online")), 6000, "everyone online");
    a1.dispose(); // says bye on every path, then its link closes
    await until(() => c1.getState().rtc.links[0]?.state === "closed", 2000, "c1's link closes");
    await sleep(30);
    expect(peer(a2, a1.replica.id)?.status).toBe("left");
    expect(peer(a2, c1.replica.id)?.status).toBe("unreachable");
    expect(peer(a2, c2.replica.id)?.status).toBe("unreachable");
    expect(peer(c1, a1.replica.id)?.status).toBe("left");
    expect(peer(c1, a2.replica.id)?.status).toBe("unreachable");
    expect(peer(c2, a2.replica.id)?.status).toBe("unreachable"); // two hops away: told by c1
    expect(peer(c2, c1.replica.id)?.status).toBe("online");
  });
});

describe("a path that goes away is reflected at once", () => {
  it("remote reload: a tab that went idle (hidden) and whose link then closed reads unreachable, not idle for minutes", async () => {
    const hub1 = new MemoryHub();
    const a = session("a", hub1);
    const b = session("b", new MemoryHub());
    await ready(a, b);
    const pid = await pair(a, b);
    // What a reloading tab says first: "hidden" (its visibilitychange heartbeat)…
    (b as unknown as { visible: () => boolean }).visible = () => false;
    await until(() => peer(a, b.replica.id)?.status === "idle", 2000, "idle");
    // …then the page goes away without its "bye" getting out.
    linkObj(b, pid).close();
    await until(() => a.getState().rtc.links[0]?.state === "closed", 2000, "closed");
    expect(peer(a, b.replica.id)?.status).toBe("unreachable");
    await sleep(150); // a few heartbeats later: still unreachable
    expect(peer(a, b.replica.id)?.status).toBe("unreachable");
  });

  it("deliberate disconnect: the other side learns it was on purpose and stops claiming the tab is there", async () => {
    const a = session("a", new MemoryHub());
    const b = session("b", new MemoryHub());
    await ready(a, b);
    const pid = await pair(a, b);
    const events: SessionEvent[] = [];
    b.onEvent((e) => events.push(e));
    a.closeLink(pid);
    await until(() => b.getState().rtc.links[0]?.state === "closed", 2000, "b closed");
    const lost = events.find((e) => e.type === "link") as Extract<SessionEvent, { type: "link" }> | undefined;
    expect(lost?.change).toBe("lost");
    expect(lost?.link.remoteClosed).toBe(true);
    expect(b.getState().rtc.links[0].remoteClosed).toBe(true);
    expect(peer(b, a.replica.id)?.status).toBe("unreachable");
  });

  it("pulling the cable tells peers right away; plugging it back in brings the tab back", async () => {
    const hub = new MemoryHub();
    const a = session("a", hub);
    const b = session("b", hub);
    await ready(a, b);
    await until(() => peer(b, a.replica.id)?.status === "online", 2000, "online");
    a.setOnline(false);
    await sleep(10);
    expect(peer(b, a.replica.id)?.status).toBe("unreachable");
    a.setOnline(true);
    await until(() => peer(b, a.replica.id)?.status === "online", 2000, "back online");
  });
});

describe("stale and reused pairing codes say what happened", () => {
  it("a reply to a replaced invite, a reply to a used invite, and a tab's own reply", async () => {
    const a = session("a", new MemoryHub());
    const b = session("b", new MemoryHub());
    const c = session("c", new MemoryHub());
    await ready(a, b, c);
    // (a) the inviter replaced its invite after sending it
    const first = await a.createInvite();
    const staleReply = await b.acceptInvite(first.code!);
    a.closeLink(first.pid); // "Make a new invite" withdraws the unanswered one
    const second = await a.createInvite();
    await expect(a.completeInvite(staleReply.code!)).rejects.toThrow(/replaced or cancelled/);
    await expect(b.completeInvite(staleReply.code!)).rejects.toThrow(/this tab's own reply code/);
    // the fresh invite still works
    b.closeLink(staleReply.pid);
    const reply = await b.acceptInvite(second.code!);
    await a.completeInvite(reply.code!);
    await until(() => a.getState().rtc.links.some((l) => l.state === "connected"), 2000, "connected");
    await until(() => !!peer(a, b.replica.id), 2000, "b known");
    // (b) a third computer opened the already-used invite
    const thirdReply = await c.acceptInvite(second.code!);
    await expect(a.completeInvite(thirdReply.code!)).rejects.toThrow(/already used by Tab/);
    // pasted under "Join an invite" instead: same explanation, not "paste it into the computer that made the invite"
    await expect(a.acceptInvite(thirdReply.code!)).rejects.toThrow(/already used by Tab/);
    // the same reply pasted twice
    await expect(a.completeInvite(reply.code!)).rejects.toThrow(/already used — this invite is connected/);
  });
});

describe("reply-code lifetime", () => {
  it("defaults to about 3 minutes (below the browser's own DTLS give-up), with a clear message", async () => {
    expect(REPLY_TTL_MS).toBeLessThanOrEqual(200_000);
    vi.useFakeTimers();
    const inviter = await RtcLink.invite({ room: "r", replica: "ra", label: "A" }, { RTCPeerConnection: FakeRTC });
    const offer = await decodePairing(inviter.code!);
    const invitee = await RtcLink.accept(offer as never, { room: "r", replica: "rb", label: "B" }, { RTCPeerConnection: FakeRTC });
    vi.advanceTimersByTime(REPLY_TTL_MS - 1000);
    expect(invitee.state).toBe("connecting");
    vi.advanceTimersByTime(2000);
    expect(invitee.state).toBe("failed");
    expect(invitee.error).toBe(REPLY_EXPIRED);
    inviter.close();
  });

  it("a connection that fails before it ever connected blames the code or the network, not a 'lost' connection", async () => {
    const inviter = await RtcLink.invite({ room: "r", replica: "ra", label: "A" }, { RTCPeerConnection: FakeRTC });
    const invitee = await RtcLink.accept((await decodePairing(inviter.code!)) as never, { room: "r", replica: "rb", label: "B" }, { RTCPeerConnection: FakeRTC });
    const pc = (invitee as unknown as { pc: FakePeerConnection & { emit(t: string): void } }).pc;
    pc.connectionState = "failed";
    pc.emit("connectionstatechange");
    expect(invitee.state).toBe("failed");
    expect(invitee.error).toMatch(/reply code expired or the computers couldn’t reach each other/);
    expect(invitee.error).not.toMatch(/was lost/);
    inviter.close();
  });
});
