/**
 * "Connect another computer" UI logic: board URL parameters (`?ice=`, `#join=`, invite links)
 * and the pairing store's flows, driven against a fake session (no WebRTC needed).
 */
import { describe, expect, it } from "vitest";
import type { RtcLinkInfo, WhiteboardSessionApi } from "@/lib/session/types";
import { RoomMismatchError } from "@/lib/session/session";
import { encodePairing, PairingCodeError } from "@/lib/sync/rtc-codec";
import { consumeUserClosed } from "../pairing/links";
import { createPairingStore } from "../pairing/store";
import { inviteLink, joinPath, parseBoardParams, parseIceParam, parseJoinHash } from "../params";

describe("board params", () => {
  it("reads ?ice=none and URL-encoded JSON ICE servers", () => {
    expect(parseBoardParams("?room=lab&ice=none").iceServers).toEqual([]);
    const turn = [{ urls: "turn:turn.example.com:3478", username: "u", credential: "p" }, "stun:stun.example.org"];
    const p = parseBoardParams(`?room=lab&ice=${encodeURIComponent(JSON.stringify(turn))}`);
    expect(p.iceServers).toEqual([turn[0], { urls: "stun:stun.example.org" }]);
    expect(p.iceInvalid).toBeUndefined();
    expect(parseBoardParams("?room=lab").iceServers).toBeUndefined();
  });

  it("ignores unreadable ice values (and flags them)", () => {
    expect(parseIceParam("[1,2]")).toBeUndefined();
    expect(parseIceParam('[{"urls":"http://evil"}]')).toBeUndefined();
    const p = parseBoardParams("?ice=%7Bnope");
    expect(p.iceServers).toBeUndefined();
    expect(p.iceInvalid).toBe(true);
  });

  it("finds the invite code in a #join= fragment", () => {
    expect(parseJoinHash("#join=W1.z.abc_-9")).toBe("W1.z.abc_-9");
    expect(parseJoinHash("#x=1&join=W1.j.eyJ")).toBe("W1.j.eyJ");
    expect(parseJoinHash("#join=hello")).toBeNull();
    expect(parseJoinHash("")).toBeNull();
  });

  it("builds invite links with the code in the fragment, carrying ?ice=", () => {
    const loc = { origin: "https://weave.example", pathname: "/", search: "?room=lab&label=A&ice=none" };
    // ice rides in the fragment (never sent to a server), next to the code.
    expect(inviteLink(loc, "lab", "W1.z.abc")).toBe("https://weave.example/?room=lab#join=W1.z.abc&ice=none");
    expect(inviteLink({ ...loc, search: "" }, "lab", "W1.z.abc")).toBe("https://weave.example/?room=lab#join=W1.z.abc");
    expect(joinPath(loc, "other.board", "W1.z.abc")).toBe("/?room=other.board#join=W1.z.abc&ice=none");
    // A page opened from such a link keeps using those ICE servers (read from the fragment).
    expect(parseBoardParams("?room=lab", "#ice=none").iceServers).toEqual([]);
    const turn = [{ urls: "turn:t.example:3478", username: "u", credential: "secret" }];
    const link = inviteLink({ origin: "https://w.example", pathname: "/", search: `?ice=${encodeURIComponent(JSON.stringify(turn))}` }, "lab", "W1.z.abc");
    expect(new URL(link).search).toBe("?room=lab"); // credentials not in the query
    expect(parseBoardParams(new URL(link).search, new URL(link).hash).iceServers).toEqual(turn);
  });
});

/* ------------------------------------------------------------------ pairing store */

type Link = RtcLinkInfo;

function fakeSession(opts: { accept?: (text: string) => Promise<Link> } = {}) {
  const links = new Map<string, Link>();
  const closed: string[] = [];
  let n = 0;
  const link = (patch: Partial<Link>): Link => ({
    pid: `p${++n}`,
    role: "inviter",
    state: "waiting-answer",
    code: `W1.z.invite${n}`,
    remoteReplica: null,
    remoteReplicas: [],
    remoteLabel: null,
    error: null,
    remoteClosed: false,
    createdAt: n,
    ...patch,
  });
  const api = {
    getState: () => ({ rtc: { available: true, links: [...links.values()] } }),
    async createInvite() {
      const l = link({});
      links.set(l.pid, l);
      return l;
    },
    async acceptInvite(text: string) {
      if (opts.accept) return opts.accept(text);
      const l = link({ role: "invitee", state: "connecting", code: "W1.z.reply" });
      links.set(l.pid, l);
      return l;
    },
    async completeInvite(text: string) {
      const l = [...links.values()].find((x) => x.role === "inviter" && x.state === "waiting-answer");
      if (!l || !text.includes("W1.")) throw new PairingCodeError("No open invite in this tab matches that reply.");
      l.state = "connecting";
      return l;
    },
    closeLink(pid: string) {
      closed.push(pid);
      links.delete(pid);
    },
  };
  return { session: api as unknown as WhiteboardSessionApi, links, closed };
}

describe("pairing store", () => {
  it("creates an invite; a new one withdraws the unanswered previous invite", async () => {
    const { session, closed } = fakeSession();
    const store = createPairingStore(session);
    await store.getState().createInvite();
    const first = store.getState().invite;
    expect(first).toMatchObject({ phase: "ready", pid: "p1", code: "W1.z.invite1" });
    await store.getState().createInvite();
    expect(closed).toEqual(["p1"]);
    expect(store.getState().invite.pid).toBe("p2");
  });

  it("a connected tab can invite another computer; the working link stays", async () => {
    const { session, links, closed } = fakeSession();
    const store = createPairingStore(session);
    await store.getState().createInvite();
    links.get("p1")!.state = "connected";
    await store.getState().createInvite(); // "Invite another computer"
    expect(closed).toEqual([]);
    expect(store.getState().invite).toMatchObject({ phase: "ready", pid: "p2" });
    expect([...links.keys()]).toEqual(["p1", "p2"]);
  });

  it("shows reply-code errors inline and keeps the draft", async () => {
    const { session } = fakeSession();
    const store = createPairingStore(session);
    await store.getState().completeInvite("   ");
    expect(store.getState().invite.replyError).toMatch(/Paste the reply code/);
    await store.getState().createInvite();
    await store.getState().completeInvite("not a code");
    expect(store.getState().invite).toMatchObject({ completing: false, draft: "not a code" });
    expect(store.getState().invite.replyError).toMatch(/No open invite/);
  });

  it("accepts an invite and exposes the reply code", async () => {
    const { session } = fakeSession();
    const store = createPairingStore(session);
    const pending = store.getState().acceptInvite("https://weave.example/?room=r#join=W1.z.abc");
    expect(store.getState().join.phase).toBe("accepting"); // spinner right away
    await pending;
    expect(store.getState().join).toMatchObject({ phase: "ready", reply: "W1.z.reply", error: null, mismatch: null });
  });

  it("offers to switch boards on RoomMismatchError", async () => {
    const { session } = fakeSession({
      accept: async () => {
        throw new RoomMismatchError("other-board");
      },
    });
    const store = createPairingStore(session);
    await store.getState().acceptInvite("see https://weave.example/?room=other-board#join=W1.z.abc");
    expect(store.getState().join).toMatchObject({ phase: "idle", error: null, mismatch: { room: "other-board", code: "W1.z.abc" } });
  });

  it("routes a reply code pasted into the join track to this tab's own open invite", async () => {
    const { session, links } = fakeSession();
    const store = createPairingStore(session);
    await store.getState().createInvite();
    const reply = await encodePairing({ v: 1, k: "answer", pid: "p1", room: "r", from: "rB", label: "B", sdp: "sdp" });
    store.getState().setTrack("join");
    await store.getState().acceptInvite(reply);
    expect(store.getState().track).toBe("invite");
    expect(store.getState().join.phase).toBe("idle");
    expect(links.get("p1")?.state).toBe("connecting");
  });

  it("re-pairs a dead link with a fresh invite, and remembers deliberate disconnects", async () => {
    const { session, links, closed } = fakeSession();
    const store = createPairingStore(session);
    await store.getState().createInvite();
    links.get("p1")!.state = "closed";
    store.getState().repair("p1");
    expect(store.getState()).toMatchObject({ open: true, track: "invite" });
    await new Promise((r) => setTimeout(r, 0));
    expect(closed).toContain("p1");
    expect(store.getState().invite).toMatchObject({ phase: "ready", pid: "p2" });

    store.getState().disconnect("p2");
    expect(store.getState().invite.phase).toBe("idle");
    expect(consumeUserClosed(session, "p2")).toBe(true);
    expect(consumeUserClosed(session, "p2")).toBe(false);
  });
});
