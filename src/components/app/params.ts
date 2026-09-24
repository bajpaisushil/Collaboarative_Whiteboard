/**
 * Board URL parameters for "/".
 *   ?room=<name>   room to join (default "lobby")
 *   &label=<L>     force a display letter
 *   &fresh=1       ignore persisted state (a new tab opened via "Open Tab B"); stripped after use
 */

export interface BoardParams {
  room: string;
  label?: string;
  fresh: boolean;
}

export const DEFAULT_ROOM = "lobby";

function clean(value: string | null, pattern: RegExp, max: number): string | undefined {
  if (!value) return undefined;
  const v = value.trim().slice(0, max);
  return v && pattern.test(v) ? v : undefined;
}

export function parseBoardParams(search: string): BoardParams {
  const q = new URLSearchParams(search);
  const fresh = q.get("fresh");
  return {
    room: clean(q.get("room"), /^[\w.-]+$/, 64) ?? DEFAULT_ROOM,
    label: clean(q.get("label"), /^[A-Za-z]$/, 1)?.toUpperCase(),
    fresh: fresh !== null && fresh !== "0" && fresh !== "false",
  };
}

/** Remove `fresh` from the address bar so a reload keeps this tab's new identity. */
export function stripFreshParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("fresh")) return;
  url.searchParams.delete("fresh");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
