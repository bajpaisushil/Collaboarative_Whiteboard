"use client";
/**
 * Knot counter: how many live conflicts (concurrent edits that actually changed something)
 * are on the board. Click opens the Why panel (or, in compact panes, focuses the latest knot).
 */
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useReplicaView, useSession } from "@/lib/session/react";
import { usePane } from "@/lib/ui/pane";
import { useUi, useUiStore } from "@/lib/ui/store";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { latestLiveKnot, selectLiveKnotCount } from "../selectors";

export function KnotCounter() {
  const session = useSession();
  const store = useUiStore();
  const { compact } = usePane();
  const count = useReplicaView(selectLiveKnotCount);
  const whyOpen = useUi((s) => s.panelOpen && s.lensTab === "why");
  const reduce = useReducedMotion();
  const has = count > 0;

  const onClick = () => {
    const ui = store.getState();
    if (compact) {
      const knot = latestLiveKnot(session.replica.getView().conflicts);
      if (knot) ui.focusConflict({ id: knot.id, lineageKey: knot.lineageKey });
      return;
    }
    if (whyOpen) ui.set({ panelOpen: false });
    else ui.set({ panelOpen: true, lensTab: "why" });
  };

  const name = has ? `${count} ${count === 1 ? "knot" : "knots"}` : "No knots";

  return (
    <Tooltip
      content={
        <TipBody title={name}>
          A knot is a place where two tabs changed the same thing at the same time — neither had seen the other’s edit.
          Weave picks a winner deterministically; click to see exactly why.
        </TipBody>
      }
      wide
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={compact ? undefined : whyOpen}
        aria-label={`${name}. ${compact ? "Show the latest knot" : whyOpen ? "Close the Why panel" : "Open the Why panel"}`}
        className={clsx(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold tabular-nums transition-colors",
          has
            ? "bg-[var(--knot-soft)] text-knot shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--knot)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--knot)_20%,transparent)]"
            : "text-muted hover:bg-panel-2 hover:text-ink-2",
          whyOpen && !compact && "ring-2 ring-[color-mix(in_oklab,var(--knot)_35%,transparent)]",
        )}
      >
        <KnotIcon size={17} strokeWidth={2} />
        <span className="relative inline-grid min-w-[1ch] overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={count}
              initial={reduce ? { opacity: 0 } : { y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: 12, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="col-start-1 row-start-1"
            >
              {count}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
    </Tooltip>
  );
}
