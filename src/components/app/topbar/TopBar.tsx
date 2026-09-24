"use client";
/**
 * Floating top sheet. Full: wordmark · identity · cable switch (hero) · peers · convergence ·
 * knots · mode · undo/redo · open-tab/split · panel · theme · help. Compact (/split panes):
 * identity · cable · peers · knots · undo/redo. Uses container queries so it adapts to the
 * pane's width, not the window's.
 */
import clsx from "clsx";
import { CircleQuestionMark, PanelRightClose, PanelRightOpen } from "lucide-react";
import { usePane } from "@/lib/ui/pane";
import { useUi, useUiStore } from "@/lib/ui/store";
import { IconButton } from "@/components/ui/IconButton";
import { CableControl } from "./CableSwitch";
import { ClockTag } from "./ClockTag";
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
      <Wordmark />
      <Divider />
      <IdentityPill />
      <CableControl />

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-1">
        <PeerAvatars />
        <span className="@max-3xl:hidden">
          <ConvergenceBadge />
        </span>
      </div>

      <KnotCounter />
      <ModeToggle />
      <Divider />
      <UndoRedo />
      <Divider className="@max-3xl:hidden" />
      <span className="flex items-center @max-3xl:hidden">
        <TabLinks />
      </span>
      <PanelToggle />
      <span className="@max-2xl:hidden">
        <ThemeToggle />
      </span>
      <HelpButton />

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
      label={open ? "Close the Why panel" : "Open the Why panel — knots, loom, log, snapshots"}
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
      onClick={() => store.getState().set({ showShortcuts: true })}
    />
  );
}
