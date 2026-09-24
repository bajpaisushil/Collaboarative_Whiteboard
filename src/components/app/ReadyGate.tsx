"use client";
/**
 * Holds back its children until the session is ready (identity lease held, label chosen).
 * Before that the label is "?" and edits are no-ops, so nothing identity-bearing is shown.
 * Works without a SessionProvider (it subscribes to the session it is given).
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { Splash } from "./Splash";

const SLOW_START_MS = 4000;

export function useSessionReady(session: WhiteboardSessionApi): boolean {
  const subscribe = useCallback((l: () => void) => session.subscribe(l), [session]);
  const get = useCallback(() => session.getState().ready, [session]);
  return useSyncExternalStore(subscribe, get, get);
}

export function ReadyGate({
  session,
  compact = false,
  children,
}: {
  session: WhiteboardSessionApi;
  /** Smaller splash for embedded panes (/split). */
  compact?: boolean;
  children: ReactNode;
}) {
  const ready = useSessionReady(session);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (ready) return children;
  return (
    <Splash
      compact={compact}
      message="Claiming this tab’s identity…"
      hint={
        slow
          ? "Still waiting. If this tab was duplicated, the original copy may be holding the identity — this one will continue as a new letter in a moment."
          : undefined
      }
    />
  );
}
