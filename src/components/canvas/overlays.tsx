"use client";
/**
 * Small HTML overlays on top of the canvas: the empty-board hint, the time-travel tint and
 * the screen-reader live region.
 */
import { memo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useReplicaView } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { useInteraction } from "./interaction";

export const EmptyHint = memo(function EmptyHint() {
  const empty = useReplicaView((v) => v.shapes.length === 0);
  const scrubbing = useUi((s) => s.scrub !== null);
  const drawing = useInteraction((s) => s.draft !== null);
  const reduced = useReducedMotion() ?? false;
  const show = empty && !scrubbing && !drawing;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="empty"
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : 0.25 }}
        >
          <p className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] text-muted">
            Pick a tool — or press
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line-2 bg-panel px-1 font-mono text-[11px] text-ink-2 shadow-[0_1px_0_var(--line-2)]">
              P
            </kbd>
            and draw
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

/** Blueprint wash over the board while viewing history (the board is read-only). */
export const TimeTravelTint = memo(function TimeTravelTint() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundColor: "color-mix(in oklab, var(--thread-c) 5%, transparent)",
        backgroundImage:
          "linear-gradient(color-mix(in oklab, var(--thread-d) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--thread-d) 9%, transparent) 1px, transparent 1px)",
        backgroundSize: "96px 96px",
        boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--thread-d) 30%, transparent), inset 0 0 80px color-mix(in oklab, var(--thread-d) 10%, transparent)",
      }}
    />
  );
});

export const LiveRegion = memo(function LiveRegion() {
  const a = useInteraction((s) => s.announcement);
  return (
    <div aria-live="polite" aria-atomic className="sr-only">
      {a && <span key={a.n}>{a.text}</span>}
    </div>
  );
});
