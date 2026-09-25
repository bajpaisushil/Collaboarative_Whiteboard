/**
 * WebRTC links can't survive a reload (there is no server to re-pair through), and the page
 * that reloaded would otherwise show "Just you" with no hint it was ever linked. So each full
 * pane remembers its live and in-progress links in sessionStorage (which survives a reload of
 * the same tab); after a reload the toasts read — and clear — that note once.
 */
import type { RtcLinkInfo, SessionState } from "@/lib/session/types";
import type { StorageLike } from "@/lib/session/types";
import { isDeadLink, remoteLabelIn } from "./links";

export interface RememberedLink {
  role: RtcLinkInfo["role"];
  /** "linked": it was connected (or recovering); "pending": an invite or reply code in progress. */
  stage: "linked" | "pending";
  remoteLabel: string | null;
}

const key = (room: string, pane: string) => `weave:rtc-links:${room}:${pane}`;

/** What to remember about this tab's links right now (dead links are already over). */
export function linksToRemember(state: SessionState): RememberedLink[] {
  const out: RememberedLink[] = [];
  for (const l of state.rtc.links) {
    if (isDeadLink(l)) continue;
    out.push({
      role: l.role,
      stage: l.state === "connected" || l.state === "disconnected" ? "linked" : "pending",
      remoteLabel: remoteLabelIn(state, l),
    });
  }
  return out;
}

export function rememberLinks(storage: StorageLike | null, room: string, pane: string, links: RememberedLink[]): void {
  if (!storage) return;
  try {
    if (links.length === 0) storage.removeItem(key(room, pane));
    else storage.setItem(key(room, pane), JSON.stringify(links));
  } catch {
    /* storage full or blocked: the notice is a nicety */
  }
}

/** The links this tab had before it (re)loaded — read once, then forgotten. */
export function takeRememberedLinks(storage: StorageLike | null, room: string, pane: string): RememberedLink[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key(room, pane));
    storage.removeItem(key(room, pane));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is RememberedLink => !!l && typeof l === "object" && (l.stage === "linked" || l.stage === "pending"))
      .map((l) => ({ role: l.role === "invitee" ? "invitee" : "inviter", stage: l.stage, remoteLabel: typeof l.remoteLabel === "string" ? l.remoteLabel.slice(0, 8) : null }));
  } catch {
    return [];
  }
}

/** Toast copy for links a reload ended, or null if there were none. */
export function reloadNotice(links: readonly RememberedLink[]): { title: string; detail: string } | null {
  const linked = links.filter((l) => l.stage === "linked");
  if (linked.length > 0) {
    const names = linked.map((l) => (l.remoteLabel ? `Tab ${l.remoteLabel}` : "a tab")).filter((n, i, a) => a.indexOf(n) === i);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return {
      title: `Your link to ${who} on another computer ended when this page reloaded`,
      detail: "Links between computers don’t survive a reload. Every edit is still here — re-pair to sync again.",
    };
  }
  if (links.length > 0) {
    const reply = links.some((l) => l.role === "invitee");
    return {
      title: reply ? "Your reply code was cancelled when this page reloaded" : "Your invite was cancelled when this page reloaded",
      detail: reply ? "Open the invite link again to get a new reply code." : "Make a new invite and send that one instead.",
    };
  }
  return null;
}
