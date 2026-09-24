/**
 * /split URL handling. The room lives in `?room=` so a reload restores the same two panes
 * (each pane's replica is persisted per room + pane in this tab's sessionStorage).
 *   ?room=<name>   room both panes join (generated as `split-xxxxxx` when missing)
 *   &tour=1        start the 60-second guided tour on load
 * Client-only.
 */

const ROOM_PATTERN = /^[\w.-]{1,64}$/;
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export interface SplitParams {
  room: string;
  tour: boolean;
  /** The room was generated here (not in the URL yet). */
  generated: boolean;
}

/** "split-" + 6 random base36 characters. */
export function newSplitRoom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `split-${s}`;
}

export function readSplitParams(search: string): SplitParams {
  const q = new URLSearchParams(search);
  const raw = q.get("room")?.trim() ?? "";
  const tourRaw = q.get("tour");
  const tour = tourRaw !== null && tourRaw !== "0" && tourRaw !== "false";
  if (ROOM_PATTERN.test(raw)) return { room: raw, tour, generated: false };
  return { room: newSplitRoom(), tour, generated: true };
}

function replaceQuery(mutate: (q: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Put the room into the address bar without navigating (reload → same panes). */
export function writeRoomToUrl(room: string): void {
  replaceQuery((q) => q.set("room", room));
}

/** The tour is a one-shot: don't restart it on reload. */
export function stripTourParam(): void {
  if (!new URLSearchParams(window.location.search).has("tour")) return;
  replaceQuery((q) => q.delete("tour"));
}

/** The normal board in the same room (a real tab joins as the next free letter). */
export function boardUrl(room: string): string {
  return `/?room=${encodeURIComponent(room)}`;
}

/** Absolute URL of the board in this room, for copying. */
export function absoluteBoardUrl(room: string): string {
  return new URL(boardUrl(room), window.location.origin).toString();
}

/**
 * Start over in a brand-new room. Deliberately a full document navigation (not a client-side
 * route change): it disposes both sessions, their channels, locks and pane stores cleanly.
 */
export function goToFreshRoom(): void {
  const next = new URL(`/split?room=${encodeURIComponent(newSplitRoom())}`, window.location.origin);
  window.location.assign(next.href);
}
