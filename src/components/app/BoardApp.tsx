"use client";
/**
 * The "/" board: reads the room from the URL, acquires this tab's session, waits until the
 * identity lease is settled (`state.ready`), then mounts the full board surface.
 */
import { useEffect, useMemo, useState } from "react";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { SessionProvider, useAcquiredSession, useSessionState } from "@/lib/session/react";
import { BoardSurface } from "./BoardSurface";
import { parseBoardParams, stripFreshParam, type BoardParams } from "./params";
import { selectReady } from "./selectors";
import { Splash } from "./Splash";
import { applyStoredTheme } from "./theme";

const SLOW_START_MS = 4000;

export default function BoardApp() {
  // Client-only component (loaded with ssr:false), so reading the URL on first render is safe.
  const [params] = useState<BoardParams>(() => parseBoardParams(window.location.search));

  useEffect(() => {
    applyStoredTheme();
  }, []);

  useEffect(() => {
    if (params.fresh) stripFreshParam();
  }, [params.fresh]);

  const options = useMemo(
    () => ({ room: params.room, pane: params.pane, label: params.label, fresh: params.fresh }),
    [params],
  );
  const session = useAcquiredSession(options);

  if (!session) return <Splash />;
  return (
    <SessionProvider session={session}>
      <ReadyGate session={session} compact={params.compact} />
    </SessionProvider>
  );
}

function ReadyGate({ session, compact }: { session: WhiteboardSessionApi; compact: boolean }) {
  const ready = useSessionState(selectReady);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (!ready) {
    return (
      <Splash
        message="Claiming this tab’s identity…"
        hint={
          slow
            ? "Still waiting. If this tab was duplicated, the original copy may be holding the identity — it will fork into a new letter in a moment."
            : undefined
        }
      />
    );
  }
  return <BoardSurface session={session} compact={compact} />;
}
