"use client";
/**
 * React bindings for a WhiteboardSession. Sessions are provided through context (never a
 * module singleton) so /split can render two independent panes in one document.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ReplicaId, ReplicaView } from "../crdt/types";
import type { PresenceState } from "../sync/protocol";
import type { SessionEvent, SessionOptions, SessionState, WhiteboardSessionApi } from "./types";
import { acquireSession, releaseSession } from "./registry";

const SessionContext = createContext<WhiteboardSessionApi | null>(null);

export function SessionProvider({ session, children }: { session: WhiteboardSessionApi; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): WhiteboardSessionApi {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

/**
 * Acquire (and start) a session for these options; StrictMode/HMR-safe via the registry's
 * refcount. Returns null until the client effect has run.
 */
export function useAcquiredSession(opts: SessionOptions | null): WhiteboardSessionApi | null {
  const [session, setSession] = useState<WhiteboardSessionApi | null>(null);
  const key = opts ? `${opts.room}:${opts.pane ?? "main"}` : null;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    const o = optsRef.current;
    if (!o) return;
    const s = acquireSession(o);
    setSession(s);
    return () => {
      releaseSession(s);
      setSession(null);
    };
  }, [key]);
  return session;
}

function useSelected<S, T>(subscribe: (l: () => void) => () => void, getSnapshot: () => S, selector: (s: S) => T): T {
  // Memoise the selection on snapshot identity so useSyncExternalStore sees stable values.
  const cache = useRef<{ snap: S; sel: (s: S) => T; value: T } | null>(null);
  const get = useCallback(() => {
    const snap = getSnapshot();
    const c = cache.current;
    if (c && c.snap === snap && c.sel === selector) return c.value;
    const value = selector(snap);
    if (c && Object.is(c.value, value)) {
      cache.current = { snap, sel: selector, value: c.value };
      return c.value;
    }
    cache.current = { snap, sel: selector, value };
    return value;
  }, [getSnapshot, selector]);
  return useSyncExternalStore(subscribe, get, get);
}

const identity = <T,>(x: T) => x;

/** Session state (peers, network, merge reports…). Pass a narrow selector. */
export function useSessionState<T = SessionState>(selector: (s: SessionState) => T = identity as (s: SessionState) => T): T {
  const session = useSession();
  const subscribe = useCallback((l: () => void) => session.subscribe(l), [session]);
  const get = useCallback(() => session.getState(), [session]);
  return useSelected(subscribe, get, selector);
}

/** Replica view (shapes, log, conflicts…). Pass a narrow selector; views are structurally shared. */
export function useReplicaView<T = ReplicaView>(selector: (v: ReplicaView) => T = identity as (v: ReplicaView) => T): T {
  const session = useSession();
  const subscribe = useCallback((l: () => void) => session.replica.subscribe(l), [session]);
  const get = useCallback(() => session.replica.getView(), [session]);
  return useSelected(subscribe, get, selector);
}

/** Remote presence (cursors, live strokes, previews). Only the presence layer should use this. */
export function usePresence(): ReadonlyMap<ReplicaId, PresenceState> {
  const session = useSession();
  const subscribe = useCallback((l: () => void) => session.subscribePresence(l), [session]);
  const get = useCallback(() => session.getPresence(), [session]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useSessionEvent(handler: (e: SessionEvent) => void): void {
  const session = useSession();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => session.onEvent((e) => ref.current(e)), [session]);
}
