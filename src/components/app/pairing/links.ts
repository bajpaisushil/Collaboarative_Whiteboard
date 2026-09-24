/**
 * Small helpers over WebRTC link state for the pairing UI and toasts: wording per state,
 * the remote tab's current letter, and which disconnects the user asked for (so the toast
 * says "Disconnected" rather than "Lost the connection").
 */
import type { RtcLinkInfo, SessionState, WhiteboardSessionApi } from "@/lib/session/types";
import { PairingCodeError } from "@/lib/sync/rtc-codec";
import { hasLabel } from "../selectors";

export type LinkState = RtcLinkInfo["state"];

/** Links that are finished: they only offer "Re-pair" / remove. */
export const isDeadLink = (l: Pick<RtcLinkInfo, "state">): boolean => l.state === "failed" || l.state === "closed";

export const selectRtcAvailable = (s: SessionState) => s.rtc.available;
export const selectRtcLinks = (s: SessionState) => s.rtc.links;
export const selectConnectedLinkCount = (s: SessionState) => {
  let n = 0;
  for (const l of s.rtc.links) if (l.state === "connected") n++;
  return n;
};
/** Replicas reached (now or earlier) over a WebRTC link, as a stable key ("r1,r2"). */
export const selectRemoteReplicasKey = (s: SessionState): string => {
  const ids: string[] = [];
  for (const l of s.rtc.links) if (l.remoteReplica) ids.push(l.remoteReplica);
  return ids.sort().join(",");
};

/**
 * The remote tab's letter as it is *now*: letters can change right after pairing (two
 * computers may both have a Tab A; one of them re-picks), so prefer the live peer entry
 * over the letter frozen into the pairing code.
 */
export function remoteLabelIn(state: SessionState, link: Pick<RtcLinkInfo, "remoteReplica" | "remoteLabel">): string | null {
  if (link.remoteReplica) {
    const peer = state.peers.find((p) => p.replica === link.remoteReplica);
    if (peer && hasLabel(peer)) return peer.label;
  }
  return link.remoteLabel && hasLabel({ label: link.remoteLabel }) ? link.remoteLabel : null;
}

/** "Tab B", or a neutral name while the other side is unknown. */
export function remoteName(label: string | null, fallback = "the other computer"): string {
  return label ? `Tab ${label}` : fallback;
}

/** Short status word for a link row. */
export const LINK_STATE_WORD: Record<LinkState, string> = {
  gathering: "Preparing…",
  "waiting-answer": "Waiting for their reply code",
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Interrupted — trying to recover…",
  failed: "Failed",
  closed: "Closed",
};

/* ------------------------------------------------------------ user-initiated closes */

const userClosed = new WeakMap<WhiteboardSessionApi, Set<string>>();

/** Close a link on purpose (the "lost" toast then reads "Disconnected"). */
export function disconnectLink(session: WhiteboardSessionApi, pid: string): void {
  let set = userClosed.get(session);
  if (!set) userClosed.set(session, (set = new Set()));
  set.add(pid);
  session.closeLink(pid);
}

/** True (once) if this link was closed by the user rather than lost. */
export function consumeUserClosed(session: WhiteboardSessionApi, pid: string): boolean {
  const set = userClosed.get(session);
  return !!set?.delete(pid);
}

/* ------------------------------------------------------------ errors */

/** User-facing text for anything the pairing calls throw. */
export function pairingErrorText(e: unknown): string {
  if (e instanceof PairingCodeError) return e.message;
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return message ? `Couldn’t set up the connection: ${message}` : "Couldn’t set up the connection — try again.";
}

/** RoomMismatchError (or anything shaped like it, across bundle copies). */
export function mismatchRoom(e: unknown): string | null {
  if (e && typeof e === "object" && "room" in e && typeof (e as { room: unknown }).room === "string") return (e as { room: string }).room;
  return null;
}
