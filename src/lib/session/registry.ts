/**
 * Session registry on globalThis: StrictMode double-mount and Fast Refresh re-execution
 * must never create two live sessions for one (room, pane).
 */
import type { SessionOptions, WhiteboardSessionApi } from "./types";
import { createSession } from "./session";

interface Entry {
  session: WhiteboardSessionApi;
  refs: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

type Registry = Map<string, Entry>;

const g = globalThis as unknown as { __weaveSessions?: Registry };

function registry(): Registry {
  if (!g.__weaveSessions) g.__weaveSessions = new Map();
  return g.__weaveSessions;
}

export function sessionKey(opts: Pick<SessionOptions, "room" | "pane">): string {
  return `${opts.room}:${opts.pane ?? "main"}`;
}

export function acquireSession(opts: SessionOptions): WhiteboardSessionApi {
  const reg = registry();
  const key = sessionKey(opts);
  const existing = reg.get(key);
  if (existing) {
    existing.refs++;
    if (existing.disposeTimer) {
      clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    return existing.session;
  }
  const session = createSession(opts);
  reg.set(key, { session, refs: 1, disposeTimer: null });
  session.start();
  return session;
}

export function releaseSession(session: WhiteboardSessionApi): void {
  const reg = registry();
  for (const [key, entry] of reg) {
    if (entry.session !== session) continue;
    entry.refs--;
    if (entry.refs <= 0 && !entry.disposeTimer) {
      // Deferred so StrictMode's unmount→remount reuses the same instance.
      entry.disposeTimer = setTimeout(() => {
        if (entry.refs <= 0) {
          reg.delete(key);
          entry.session.dispose();
        }
      }, 0);
    }
    return;
  }
}

/** Dispose everything (HMR of the registry module / tests). */
export function disposeAllSessions(): void {
  const reg = registry();
  for (const entry of reg.values()) entry.session.dispose();
  reg.clear();
}
