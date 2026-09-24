"use client";
/**
 * The seam: the director's desk between the two stages. It sees what neither tab can — both
 * documents, both cables, both fingerprints — and scripts classic conflicts.
 *
 * Providers: Tab A's session (conflicts are deterministic, so A's list equals B's once
 * converged), the seam's own UI store (its knot focus is mirrored into both panes by the
 * bridge) and a pane context rooted at the seam, so hotkeys bound by embedded components stay
 * inside it.
 */
import { useMemo, useRef } from "react";
import { SessionProvider } from "@/lib/session/react";
import { isTypingTarget, PaneProvider, usePaneKeydown, type PaneContextValue } from "@/lib/ui/pane";
import { UiStoreProvider, useUiStore } from "@/lib/ui/store";
import { ToastProvider, ToastViewport } from "@/components/ui/Toast";
import { useExternal } from "./hooks";
import type { ScenarioRunner } from "./runner";
import { ScenePanel } from "./ScenePanel";
import { SeamFooter } from "./SeamFooter";
import { SeamHeader } from "./SeamHeader";
import { SeamKnots } from "./SeamKnots";
import { SeamThreads } from "./SeamThreads";
import { TwoThreads } from "./SplitSplash";
import type { Stage } from "./stage";
import type { TourController } from "./tour";
import { TourCoach } from "./TourCoach";

export interface SeamProps {
  stage: Stage | null;
  runner: ScenarioRunner;
  tour: TourController;
  room: string;
  /** Narrow layout: the seam is a drawer with a close button. */
  onClose?: () => void;
}

export function Seam({ stage, ...rest }: SeamProps) {
  if (!stage) {
    return (
      <aside aria-label="Director’s view" className="sheet grid min-h-0 place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <TwoThreads width={120} />
          <p role="status" className="text-[12.5px] text-ink-2">
            Setting up the director’s desk…
          </p>
        </div>
      </aside>
    );
  }
  return <SeamDesk stage={stage} {...rest} />;
}

function SeamDesk({ stage, runner, tour, room, onClose }: SeamProps & { stage: Stage }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pane = useMemo<PaneContextValue>(() => ({ paneId: "seam", compact: true, rootRef }), []);
  const touring = useExternal(tour).active;

  return (
    <SessionProvider session={stage.panes.A.session}>
      <UiStoreProvider store={stage.seam}>
        <PaneProvider value={pane}>
          <ToastProvider>
            <aside
              ref={rootRef}
              tabIndex={-1}
              aria-label="Director’s view"
              data-pane="seam"
              className="sheet relative isolate flex h-full min-h-0 flex-col overflow-hidden outline-none"
            >
              <SeamHotkeys />
              <SeamThreads />
              <SeamHeader stage={stage} onClose={onClose} />
              <div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
                {touring ? <TourCoach tour={tour} stage={stage} /> : <ScenePanel runner={runner} tour={tour} stage={stage} />}
                <SeamKnots stage={stage} />
                <SeamFooter room={room} />
              </div>
              <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20">
                <ToastViewport />
              </div>
            </aside>
          </ToastProvider>
        </PaneProvider>
      </UiStoreProvider>
    </SessionProvider>
  );
}

/** Escape inside the desk closes the focused knot (everywhere) before anything else. */
function SeamHotkeys() {
  const ui = useUiStore();
  usePaneKeydown((e) => {
    if (e.key !== "Escape" || isTypingTarget(e.target)) return false;
    const s = ui.getState();
    if (s.ghost && !s.focus) {
      s.set({ ghost: null });
      return true;
    }
    if (!s.focus) return false;
    s.focusConflict(null);
    return true;
  });
  return null;
}
