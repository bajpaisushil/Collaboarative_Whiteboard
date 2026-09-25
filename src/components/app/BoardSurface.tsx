"use client";
/**
 * One complete board pane: providers (session, per-pane UI store, pane context, toasts) and
 * the layout — floating top sheet, full-bleed canvas with floating tool dock, time-travel /
 * diverging / merge cards top-centre, the Why sheet on the right, the Loom along the bottom,
 * and the identity frame around everything. /split renders two of these (compact).
 * Full panes also offer "Connect another computer" (WebRTC pairing); compact panes don't.
 */
import clsx from "clsx";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { StoreApi } from "zustand";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { SessionProvider } from "@/lib/session/react";
import { PaneProvider, usePane, type PaneContextValue } from "@/lib/ui/pane";
import { UiStoreProvider, useUi, type UiStore } from "@/lib/ui/store";
import { Canvas } from "@/components/canvas/Canvas";
import { ToolDock } from "@/components/canvas/ToolDock";
import { Loom } from "@/components/loom/Loom";
import { TimeTravelBanner } from "@/components/loom/TimeTravelBanner";
import { ToastProvider, ToastViewport } from "@/components/ui/Toast";
import { Coach } from "./Coach";
import { DivergingBanner } from "./DivergingBanner";
import { IdentityFrame } from "./IdentityFrame";
import { MergeCard } from "./MergeCard";
import { PairingDialog } from "./pairing/PairingDialog";
import { PairingProvider } from "./pairing/PairingProvider";
import type { IceMode } from "./pairing/store";
import { PaneHotkeys } from "./PaneHotkeys";
import { ReadyGate } from "./ReadyGate";
import { RegionBoundary } from "./RegionBoundary";
import { SessionToasts } from "./SessionToasts";
import { ShortcutSheet } from "./ShortcutSheet";
import { applyStoredTheme } from "./theme";
import { TOPBAR_HEIGHT, TOPBAR_HEIGHT_COMPACT, TopBar } from "./topbar/TopBar";
import { WhyDrawer } from "./WhyDrawer";
import { WhyDeepLink } from "@/components/why/WhyDeepLink";

export interface BoardSurfaceProps {
  session: WhiteboardSessionApi;
  /** Compact chrome for /split: slim top bar, no Why sheet, no coach. */
  compact?: boolean;
  /** Share a UI store created outside (e.g. /split syncing focus across panes). */
  uiStore?: StoreApi<UiStore>;
  paneId?: string;
  /** Invite code from the URL (`#join=`): the pairing dialog accepts it once (full panes only). */
  joinCode?: string | null;
  /** How this page reaches other computers (`?ice=`); only changes the pairing dialog's wording. */
  ice?: IceMode;
}

const INSET = 10;

/** Clicks on these keep their own focus; anything else focuses the pane root (hotkeys). */
const KEEPS_FOCUS =
  'input,textarea,select,button,a[href],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"]),[role="dialog"],[data-keep-focus]';

export function BoardSurface({ session, compact = false, uiStore, paneId = "main", joinCode = null, ice = "default" }: BoardSurfaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pane = useMemo<PaneContextValue>(() => ({ paneId, compact, rootRef }), [paneId, compact]);

  // Routes other than "/" (e.g. /split) don't run the theme boot script: honour the stored choice.
  useEffect(() => {
    applyStoredTheme();
  }, []);

  return (
    <ReadyGate session={session} compact={compact}>
      <SessionProvider session={session}>
        <UiStoreProvider store={uiStore}>
          <PaneProvider value={pane}>
            {compact ? (
              <ToastProvider>
                <BoardLayout rootRef={rootRef} compact paneId={paneId} />
              </ToastProvider>
            ) : (
              <PairingProvider joinCode={joinCode} ice={ice}>
                <ToastProvider>
                  <BoardLayout rootRef={rootRef} compact={false} paneId={paneId} />
                </ToastProvider>
              </PairingProvider>
            )}
          </PaneProvider>
        </UiStoreProvider>
      </SessionProvider>
    </ReadyGate>
  );
}

function BoardLayout({ rootRef, compact, paneId }: { rootRef: RefObject<HTMLDivElement | null>; compact: boolean; paneId: string }) {
  // Hold keyboard focus in this pane (hotkeys are bound to its root) unless something else
  // on the page already has it — e.g. the other pane in /split.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const active = document.activeElement;
    if (!active || active === document.body) el.focus({ preventScroll: true });
  }, [rootRef]);

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const target = e.target instanceof Element ? e.target : null;
    // Only look inside this pane: /split may wrap panes in focusable containers.
    const keeper = target?.closest(KEEPS_FOCUS);
    if (keeper && keeper !== root && root.contains(keeper)) return;
    if (document.activeElement !== root) root.focus({ preventScroll: true });
  };

  // One <main> landmark per page: /split's compact panes use a plain region instead.
  const Stage = compact ? "section" : "main";
  const chromeTop = INSET + (compact ? TOPBAR_HEIGHT_COMPACT : TOPBAR_HEIGHT) + (compact ? 8 : 10);
  const style = { "--chrome-top": `${chromeTop}px` } as CSSProperties;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-pane={paneId}
      data-focus-home=""
      onPointerDownCapture={onPointerDownCapture}
      className="relative isolate flex h-full w-full flex-col overflow-hidden bg-paper text-ink outline-none"
      style={style}
    >
      <PaneHotkeys />
      <SessionToasts />

      <Stage className="relative min-h-0 flex-1" aria-label="Board">
        {/* DOM order = keyboard order (top bar first); z-index sets the visual stacking. */}
        <div className="absolute inset-x-[10px] top-[10px] z-40">
          <TopBar />
        </div>

        <ClearOfSheet className="pointer-events-none absolute left-0 top-[var(--chrome-top)] z-30 flex flex-col items-center gap-2 px-4">
          <DivergingBanner />
          <div className="pointer-events-auto empty:hidden">
            <RegionBoundary name="Time travel banner">
              <TimeTravelBanner />
            </RegionBoundary>
          </div>
          <MergeCard />
        </ClearOfSheet>

        <div className="pointer-events-none absolute bottom-[10px] left-[10px] top-[var(--chrome-top)] z-20 flex items-center">
          <div className="pointer-events-auto">
            <RegionBoundary name="Tool dock">
              <ToolDock />
            </RegionBoundary>
          </div>
        </div>

        <div className="absolute inset-0">
          <RegionBoundary name="Canvas">
            <Canvas />
          </RegionBoundary>
        </div>

        {!compact && <WhyDrawer />}
        {!compact && <WhyDeepLink />}
        {!compact && <Coach />}

        <ClearOfSheet className="pointer-events-none absolute bottom-4 left-0 z-30 px-4">
          <ToastViewport />
        </ClearOfSheet>
      </Stage>

      <div className="relative z-30 flex-none">
        <RegionBoundary name="Loom">
          <Loom />
        </RegionBoundary>
      </div>

      <ShortcutSheet />
      {!compact && <PairingDialog />}
      <IdentityFrame />
    </div>
  );
}

/**
 * Full-width overlay column that, on wide panes, stops short of the open Why sheet so
 * centred cards (banners, merge report, toasts) stay visible beside it.
 */
function ClearOfSheet({ className, children }: { className: string; children: ReactNode }) {
  const { compact } = usePane();
  const sheetOpen = useUi((s) => s.panelOpen) && !compact;
  return <div className={clsx(className, "right-0", sheetOpen && "min-[900px]:right-[440px]")}>{children}</div>;
}
