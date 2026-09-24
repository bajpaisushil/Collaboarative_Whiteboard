/** Navigation helpers for spawning peers. Client-only. */

/** URL of a fresh peer tab in `room`. */
export function peerTabUrl(room: string): string {
  return `${window.location.pathname}?room=${encodeURIComponent(room)}&fresh=1`;
}

/** Open another replica of this room in a new browser tab. */
export function openPeerTab(room: string): void {
  window.open(peerTabUrl(room), "_blank", "noopener");
}

export const SPLIT_HREF = "/split";
