/**
 * A reload ends every WebRTC link (no server to re-pair through). The reloaded page must say so
 * instead of silently showing "Just you": links are remembered in sessionStorage and read once.
 */
import { describe, expect, it } from "vitest";
import type { RtcLinkInfo, SessionState } from "@/lib/session/types";
import { linksToRemember, reloadNotice, rememberLinks, takeRememberedLinks } from "../pairing/linkMemory";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

const link = (patch: Partial<RtcLinkInfo>): RtcLinkInfo => ({
  pid: "p",
  role: "inviter",
  state: "connected",
  code: null,
  remoteReplica: "rb",
  remoteReplicas: ["rb"],
  remoteLabel: "A",
  error: null,
  remoteClosed: false,
  createdAt: 0,
  ...patch,
});

const state = (links: RtcLinkInfo[], peers: { replica: string; label: string }[] = []) =>
  ({ rtc: { available: true, links }, peers }) as unknown as SessionState;

describe("link memory across a reload", () => {
  it("remembers live and pending links (with the remote tab's current letter), then reads them once", () => {
    const storage = memoryStorage();
    const st = state(
      [link({ pid: "p1" }), link({ pid: "p2", role: "invitee", state: "connecting", remoteReplica: "rc", remoteLabel: "A" }), link({ pid: "p3", state: "closed" })],
      [{ replica: "rb", label: "C" }],
    );
    rememberLinks(storage, "room", "main", linksToRemember(st));
    const back = takeRememberedLinks(storage, "room", "main");
    expect(back).toEqual([
      { role: "inviter", stage: "linked", remoteLabel: "C" }, // the live letter, not the one in the invite
      { role: "invitee", stage: "pending", remoteLabel: "A" },
    ]);
    expect(takeRememberedLinks(storage, "room", "main")).toEqual([]); // once
    // Nothing live → nothing stored.
    rememberLinks(storage, "room", "main", linksToRemember(state([link({ state: "failed" })])));
    expect(storage.m.size).toBe(0);
  });

  it("words the notice for a lost link, a pending invite and a pending reply", () => {
    expect(reloadNotice([{ role: "inviter", stage: "linked", remoteLabel: "B" }])?.title).toBe(
      "Your link to Tab B on another computer ended when this page reloaded",
    );
    expect(reloadNotice([{ role: "inviter", stage: "pending", remoteLabel: null }])?.title).toMatch(/invite was cancelled/);
    expect(reloadNotice([{ role: "invitee", stage: "pending", remoteLabel: "A" }])?.title).toMatch(/reply code was cancelled/);
    expect(reloadNotice([])).toBeNull();
  });

  it("ignores garbage in storage", () => {
    const storage = memoryStorage();
    storage.setItem("weave:rtc-links:room:main", "{not json");
    expect(takeRememberedLinks(storage, "room", "main")).toEqual([]);
    storage.setItem("weave:rtc-links:room:main", JSON.stringify([{ stage: "nope" }, 3, null, { stage: "linked", role: "x", remoteLabel: 5 }]));
    expect(takeRememberedLinks(storage, "room", "main")).toEqual([{ role: "inviter", stage: "linked", remoteLabel: null }]);
  });
});
