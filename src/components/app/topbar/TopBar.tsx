"use client";
/**
 * Floating top sheet. Full: wordmark · identity · cable switch (hero) · peers · convergence ·
 * knots · mode · undo/redo · open-tab/split · connect another computer · panel · theme · help.
 * Compact (/split panes): identity · cable · peers · knots · undo/redo (no pairing there).
 *
 * It adapts to the PANE's width (container queries on the header), not the window's. Labels
 * collapse to icons in priority order as the bar narrows (header width):
 *   < 1500  split-view text, X-ray key cap, "Connect computer" → "Connect"
 *   < 1380  wordmark text, "Open Tab B" text, "Connect" text (laptop icon + badge stay)
 *   < 1240  Draw / X-ray labels
 *   < 1170  "You are", convergence verdict text
 *   < 1000  cable sub-line, "Just you"
 *   <  920  open-tab / split links
 *   <  820  convergence badge, theme toggle
 *   <  700  wordmark
 *   <  650  mode toggle (X still works)
 *   <  480  help button ("?" still opens the sheet; phones have no keyboard) — room for the laptop
 *   <  460  identity text (letter stays)   ← compact panes in a narrow split
 *   <  400  "Online"/"Offline" text (the plug graphic and aria state stay)
 */
import clsx from "clsx";
import { CircleQuestionMark, PanelRightClose, PanelRightOpen } from "lucide-react";
import { usePane } from "@/lib/ui/pane";
import { useUi, useUiStore } from "@/lib/ui/store";
import { IconButton } from "@/components/ui/IconButton";
import { CableControl } from "./CableSwitch";
import { ClockTag } from "./ClockTag";
import { ConnectButton } from "./ConnectButton";
import { ConvergenceBadge } from "./ConvergenceBadge";
import { IdentityPill } from "./IdentityPill";
import { KnotCounter } from "./KnotCounter";
import { ModeToggle } from "./ModeToggle";
import { PeerAvatars } from "./PeerAvatars";
import { TabLinks } from "./TabLinks";
import { ThemeToggle } from "./ThemeToggle";
import { UndoRedo } from "./UndoRedo";
import { Wordmark } from "./Wordmark";

/** Heights used by BoardSurface to place floating chrome under the bar. */
export const TOPBAR_HEIGHT = 52;
export const TOPBAR_HEIGHT_COMPACT = 44;

function Divider({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("mx-0.5 h-6 w-px shrink-0 bg-line", className)} />;
}

export function TopBar() {
  const { compact } = usePane();
  return compact ? <CompactBar /> : <FullBar />;
}

function FullBar() {
  return (
    <header
      aria-label="Board controls"
      className="sheet @container relative flex items-center gap-1.5 px-2"
      style={{ height: TOPBAR_HEIGHT }}
    >
      <Wordmark className="@max-[700px]:hidden" />
      <Divider className="@max-[700px]:hidden" />
      <IdentityPill />
      <CableControl />

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-1">
        <PeerAvatars />
        <span className="flex @max-[820px]:hidden">
          <ConvergenceBadge />
        </span>
      </div>

      <KnotCounter />
      <span className="flex @max-[650px]:hidden">
        <ModeToggle />
      </span>
      <Divider />
      <UndoRedo />
      <Divider className="@max-[920px]:hidden" />
      <span className="flex items-center @max-[920px]:hidden">
        <TabLinks />
      </span>
      <ConnectButton />
      <PanelToggle />
      <span className="flex @max-[820px]:hidden">
        <ThemeToggle />
      </span>
      <span className="flex @max-[480px]:hidden">
        <HelpButton />
      </span>

      <ClockTag />
    </header>
  );
}

function CompactBar() {
  return (
    <header
      aria-label="Board controls"
      className="sheet @container relative flex items-center gap-1.5 px-1.5"
      style={{ height: TOPBAR_HEIGHT_COMPACT, borderRadius: 12 }}
    >
      <IdentityPill compact />
      <CableControl compact />
      <div className="flex min-w-0 flex-1 items-center justify-center px-1">
        <PeerAvatars compact />
      </div>
      <KnotCounter />
      <UndoRedo />
      <ClockTag />
    </header>
  );
}

function PanelToggle() {
  const open = useUi((s) => s.panelOpen);
  const store = useUiStore();
  return (
    <IconButton
      icon={open ? PanelRightClose : PanelRightOpen}
      label="Why panel — knots and snapshots"
      pressed={open}
      onClick={() => store.getState().set({ panelOpen: !open })}
    />
  );
}

function HelpButton() {
  const store = useUiStore();
  return (
    <IconButton
      icon={CircleQuestionMark}
      label="Keyboard shortcuts"
      shortcut="?"
      aria-keyshortcuts="?"
      aria-haspopup="dialog"
      onClick={() => store.getState().set({ showShortcuts: true })}
    />
  );
}
