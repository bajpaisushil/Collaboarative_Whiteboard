"use client";
/**
 * `?explain=<conflictId>` deep links. Conflict ids are deterministic, so the same id exists in
 * every converged tab — but a freshly opened tab may not have synced yet, so we wait for the
 * conflict to appear (falling back to the same kind + shape after a while, in case partial
 * delivery re-identified it), then focus it, open the Why panel and drop the parameter.
 */
import { useEffect } from "react";
import { useSession } from "@/lib/session/react";
import { useUiStore } from "@/lib/ui/store";

const FALLBACK_AFTER_MS = 6000;

function stripParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("explain")) return;
  url.searchParams.delete("explain");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Resolve `?explain=` once for this pane. Safe to call from several components. */
export function useExplainDeepLink(): void {
  const session = useSession();
  const ui = useUiStore();
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("explain");
    if (!wanted) return;
    // `${kind}:${shapeId}:` — shape ids contain one colon themselves (sh_<replica>:<n>).
    const prefix = `${wanted.split(":").slice(0, 3).join(":")}:`;
    const started = Date.now();
    let done = false;
    const attempt = () => {
      if (done) return;
      const conflicts = session.replica.getView().conflicts;
      const c =
        conflicts.find((x) => x.id === wanted) ??
        (Date.now() - started > FALLBACK_AFTER_MS ? [...conflicts].reverse().find((x) => x.id.startsWith(prefix)) : undefined);
      if (!c) return;
      done = true;
      ui.getState().focusConflict({ id: c.id, lineageKey: c.lineageKey });
      stripParam();
      cleanup();
    };
    const unsub = session.replica.subscribe(attempt);
    const timer = setTimeout(attempt, FALLBACK_AFTER_MS + 100);
    // Declared after the subscriptions it tears down; `attempt` only runs from here on.
    function cleanup() {
      unsub();
      clearTimeout(timer);
    }
    attempt();
    return () => {
      done = true;
      cleanup();
    };
  }, [session, ui]);
}

/**
 * Mount once per full board pane (always, even while the Why sheet is closed) so a shared
 * link opens the explanation on page load. Renders nothing.
 */
export function WhyDeepLink(): null {
  useExplainDeepLink();
  return null;
}
