/**
 * Board URL parameters for "/".
 *   ?room=<name>   room to join (default "lobby")
 *   &label=<L>     force a display letter
 *   &fresh=1       ignore persisted state (a new tab opened via "Open Tab B"); stripped after use
 *   &ice=none      WebRTC with host candidates only (no STUN) — LAN demos and tests
 *   &ice=<json>    custom ICE servers: a URL-encoded JSON array of RTCIceServer objects
 *                  (`ice` is also read from the #fragment — invite links carry it there so
 *                  TURN credentials never reach a server's access logs)
 *                  (or of "stun:…"/"turn:…" strings), e.g. to add a TURN server
 *   #join=W1.…     an invite from another computer: the pairing dialog opens and accepts it
 */
import { extractPairingCode } from "@/lib/sync/rtc-codec";

export interface BoardParams {
  room: string;
  label?: string;
  fresh: boolean;
  /** undefined = the session's default (public STUN); [] = host candidates only. */
  iceServers?: RTCIceServer[];
  /** The raw `ice` value, carried into invite links so both computers use the same servers. */
  ice?: string;
  /** Set when `ice` was present but unreadable (it is then ignored). */
  iceInvalid?: boolean;
}

export const DEFAULT_ROOM = "lobby";

function clean(value: string | null, pattern: RegExp, max: number): string | undefined {
  if (!value) return undefined;
  const v = value.trim().slice(0, max);
  return v && pattern.test(v) ? v : undefined;
}

const ICE_URL = /^(stun|stuns|turn|turns):\S+$/i;

function iceServer(item: unknown): RTCIceServer | null {
  if (typeof item === "string") return ICE_URL.test(item) ? { urls: item } : null;
  if (!item || typeof item !== "object") return null;
  const { urls, username, credential } = item as Record<string, unknown>;
  const list = typeof urls === "string" ? [urls] : Array.isArray(urls) ? urls : null;
  if (!list || list.length === 0 || !list.every((u) => typeof u === "string" && ICE_URL.test(u))) return null;
  const server: RTCIceServer = { urls: typeof urls === "string" ? urls : (list as string[]) };
  if (typeof username === "string") server.username = username;
  if (typeof credential === "string") server.credential = credential;
  return server;
}

/**
 * `ice` parameter → ICE servers. "none" (or "host"/"lan") → [] (host candidates only);
 * a JSON array (or single object) of RTCIceServer; a bare "stun:…"/"turn:…" URL.
 * Returns undefined for a missing or unreadable value (the default servers are used).
 */
export function parseIceParam(value: string | null): RTCIceServer[] | undefined {
  if (value === null) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (/^(none|host|lan)$/i.test(v)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return ICE_URL.test(v) ? [{ urls: v }] : undefined;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const out: RTCIceServer[] = [];
  for (const item of items) {
    const server = iceServer(item);
    if (!server) return undefined;
    out.push(server);
  }
  return out;
}

/** `ice` from the query, or from the fragment (where invite links put it). */
function readIce(search: string, hash: string): string | undefined {
  const fromQuery = new URLSearchParams(search).get("ice")?.trim();
  if (fromQuery) return fromQuery;
  return new URLSearchParams(hash.replace(/^#/, "")).get("ice")?.trim() || undefined;
}

export function parseBoardParams(search: string, hash = ""): BoardParams {
  const q = new URLSearchParams(search);
  const fresh = q.get("fresh");
  const ice = readIce(search, hash);
  const iceServers = parseIceParam(ice ?? null);
  return {
    room: clean(q.get("room"), /^[\w.-]+$/, 64) ?? DEFAULT_ROOM,
    label: clean(q.get("label"), /^[A-Za-z]$/, 1)?.toUpperCase(),
    fresh: fresh !== null && fresh !== "0" && fresh !== "false",
    iceServers,
    ice: iceServers ? ice : undefined,
    iceInvalid: ice !== undefined && iceServers === undefined ? true : undefined,
  };
}

/** Remove `fresh` from the address bar so a reload keeps this tab's new identity. */
export function stripFreshParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("fresh")) return;
  url.searchParams.delete("fresh");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/* ------------------------------------------------------------------ invite links */

/** The pairing code in a `#join=W1.…` fragment, or null. */
export function parseJoinHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h) return null;
  const value = new URLSearchParams(h).get("join");
  return value ? extractPairingCode(value) : null;
}

/** Drop `join=` from the fragment (keeping anything else) so a reload doesn't re-accept it. */
export function stripJoinHash(): void {
  const url = new URL(window.location.href);
  const rest = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (!rest.has("join")) return;
  rest.delete("join");
  const hash = rest.toString();
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`);
}

/**
 * Fragment for a join link: the code, plus this page's `ice` override if any (so a LAN demo's
 * `ice=none` carries over). Both live in the fragment, which browsers never send to a server —
 * so neither pairing codes nor TURN credentials end up in access logs.
 */
function joinFragment(code: string, loc: Pick<Location, "search"> & { hash?: string }): string {
  const f = new URLSearchParams();
  f.set("join", code);
  const ice = readIce(loc.search, loc.hash ?? "");
  if (ice) f.set("ice", ice);
  // Keep the code readable (URLSearchParams would escape nothing in W1.z.<base64url> anyway).
  return f.toString();
}

/** The link another computer opens to accept an invite: `…?room=R#join=<code>[&ice=…]`. */
export function inviteLink(loc: Pick<Location, "origin" | "pathname" | "search"> & { hash?: string }, room: string, code: string): string {
  return `${loc.origin}${loc.pathname}?${new URLSearchParams({ room })}#${joinFragment(code, loc)}`;
}

/** Same-origin path that opens board `room` and accepts `code` there. */
export function joinPath(loc: Pick<Location, "pathname" | "search"> & { hash?: string }, room: string, code: string): string {
  return `${loc.pathname}?${new URLSearchParams({ room })}#${joinFragment(code, loc)}`;
}
