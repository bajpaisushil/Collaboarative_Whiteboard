"use client";
/**
 * The "/" board: reads the room from the URL, acquires this tab's session, waits until the
 * identity lease and label are settled (`state.ready` — the label is "?" before that), then
 * mounts the full board surface. An invite link's `#join=` code is captured here and handed
 * to the board, which accepts it once the session is ready.
 */
import { useEffect, useMemo, useState } from "react";
import type { SessionOptions } from "@/lib/session/types";
import { useAcquiredSession } from "@/lib/session/react";
import { BoardSurface } from "./BoardSurface";
import { parseBoardParams, parseJoinHash, stripFreshParam, type BoardParams } from "./params";
import { ReadyGate } from "./ReadyGate";
import { Splash } from "./Splash";
import { applyStoredTheme } from "./theme";

export default function BoardApp() {
  // Client-only component (loaded with ssr:false), so reading the URL on first render is safe.
  const [params] = useState<BoardParams>(() => parseBoardParams(window.location.search));
  const [joinCode] = useState<string | null>(() => parseJoinHash(window.location.hash));

  useEffect(() => {
    applyStoredTheme();
  }, []);

  // `fresh` is captured in state above; drop it from the address bar so a reload keeps
  // this tab's (new) identity instead of wiping it again.
  useEffect(() => {
    if (params.fresh) stripFreshParam();
  }, [params.fresh]);

  useEffect(() => {
    if (params.iceInvalid) console.warn("Weave: ignoring the ?ice= parameter — expected `none` or a JSON array of ICE servers.");
  }, [params.iceInvalid]);

  const options = useMemo<SessionOptions>(
    () => ({ room: params.room, pane: "main", label: params.label, fresh: params.fresh, iceServers: params.iceServers }),
    [params],
  );
  const session = useAcquiredSession(options);

  if (!session) return <Splash />;
  return (
    <ReadyGate session={session}>
      <BoardSurface session={session} joinCode={joinCode} />
    </ReadyGate>
  );
}
