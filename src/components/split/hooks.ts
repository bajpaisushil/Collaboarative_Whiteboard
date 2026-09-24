"use client";
/**
 * Hooks that read a *specific* session (not the one in context): the director's desk watches
 * both panes at once. Selectors must return primitives or references taken from the snapshot
 * (stable while unchanged) — they are re-run on every notification.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ReplicaView } from "@/lib/crdt/types";
import type { SessionState, WhiteboardSessionApi } from "@/lib/session/types";

const noopUnsubscribe = () => {};

/** Select from a session's state; `fallback` while the session doesn't exist yet. */
export function useSessionSelect<T>(session: WhiteboardSessionApi | null, selector: (s: SessionState) => T, fallback: T): T {
  const subscribe = useCallback((l: () => void) => (session ? session.subscribe(l) : noopUnsubscribe), [session]);
  const get = () => (session ? selector(session.getState()) : fallback);
  return useSyncExternalStore(subscribe, get, get);
}

/** Select from a session's replica view; `fallback` while the session doesn't exist yet. */
export function useViewSelect<T>(session: WhiteboardSessionApi | null, selector: (v: ReplicaView) => T, fallback: T): T {
  const subscribe = useCallback((l: () => void) => (session ? session.replica.subscribe(l) : noopUnsubscribe), [session]);
  const get = () => (session ? selector(session.replica.getView()) : fallback);
  return useSyncExternalStore(subscribe, get, get);
}

/** Subscribe to any `{subscribe, getSnapshot}` store (runner, tour). */
export function useExternal<T>(store: { subscribe: (l: () => void) => () => void; getSnapshot: () => T }): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (l: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/* ------------------------------------------------------------------ selectors (stable identity) */

export const selectReady = (s: SessionState) => s.ready;
export const selectOnline = (s: SessionState) => s.network.online;
export const selectUnsynced = (s: SessionState) => s.unsyncedLocalOps;
export const selectStateHash = (v: ReplicaView) => v.stateHash;
export const selectPendingCount = (v: ReplicaView) => v.pending.length;
