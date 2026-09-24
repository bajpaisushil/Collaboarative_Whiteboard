/**
 * Board URL parameters.
 *   ?room=<name>   room to join (default "lobby")
 *   &pane=<id>     storage namespace inside the tab (default "main"; /split iframes use A/B)
 *   &label=<L>     force a display letter
 *   &fresh=1       ignore persisted state (a new tab opened via "Open Tab B"); stripped after use
 *   &compact=1     compact chrome (embedded panes)
 */

export interface BoardParams {
  room: string;
  pane: string;
  label?: string;
  fresh: boolean;
  compact: boolean;
}

export const DEFAULT_ROOM = "lobby";

function clean(value: string | null, pattern: RegExp, max: number): string | undefined {
  if (!value) return undefined;
  const v = value.trim().slice(0, max);
  return v && pattern.test(v) ? v : undefined;
}

export function parseBoardParams(search: string): BoardParams {
  const q = new URLSearchParams(search);
  const truthy = (k: string) => {
    const v = q.get(k);
    return v !== null && v !== "0" && v !== "false";
  };
  return {
    room: clean(q.get("room"), /^[\w.-]+$/, 64) ?? DEFAULT_ROOM,
    pane: clean(q.get("pane"), /^[\w-]+$/, 16) ?? "main",
    label: clean(q.get("label"), /^[A-Za-z][0-9]?$/, 2)?.toUpperCase(),
    fresh: truthy("fresh"),
    compact: truthy("compact"),
  };
}

/** Remove `fresh` from the address bar so a reload keeps this tab's new identity. */
export function stripFreshParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("fresh")) return;
  url.searchParams.delete("fresh");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
