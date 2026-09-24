"use client";
/**
 * Tooltip card for a hovered / focused knot. HTML overlay in screen space (follows the
 * camera). The precise engine answer is fetched lazily, only while the card is open.
 */
import { memo, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Conflict } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { worldToScreen } from "./camera";
import { useInteraction } from "./interaction";
import { knotSummary, type Segment } from "./knotText";
import { useThreads } from "./useThreads";

export const KnotTooltip = memo(function KnotTooltip() {
  const hover = useInteraction((s) => s.knotHover);
  const cam = useUi((s) => s.camera);
  const scrubbing = useUi((s) => s.scrub !== null);
  const reduced = useReducedMotion() ?? false;
  const pos = hover && !scrubbing ? worldToScreen(cam, hover.x, hover.y) : null;
  return (
    <AnimatePresence>
      {hover && pos && (
        <motion.div
          key={hover.shapeId}
          role="tooltip"
          className="sheet pointer-events-none absolute z-30 w-max max-w-[320px] px-3 py-2.5 text-[13px] leading-snug text-ink"
          style={{ left: pos.x + 18, top: pos.y - 12, transformOrigin: "0% 0%" }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <TooltipBody conflictIds={hover.conflictIds} />
        </motion.div>
      )}
    </AnimatePresence>
  );
});

function TooltipBody({ conflictIds }: { conflictIds: string[] }) {
  const session = useSession();
  const threads = useThreads();
  const version = useReplicaView((v) => v.version);
  const conflicts = useMemo(() => {
    const all = session.replica.getView().conflicts;
    return conflictIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Conflict => !!c);
    // `version` re-resolves the conflicts when the log changes.
  }, [session, conflictIds, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const primary = conflicts[0];
  const answer = useMemo(() => (primary ? (session.replica.explain(primary.id)?.answer ?? null) : null), [session, primary]);
  if (!primary) return null;
  const shown = conflicts.slice(0, 3);
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((c) => (
        <p key={c.id} className="flex items-start gap-2">
          <span aria-hidden className="mt-[5px] inline-block size-2 shrink-0 rotate-45 rounded-[2px]" style={{ background: c.valuesEqual ? "transparent" : "var(--knot)", border: "1.5px solid var(--knot)" }} />
          <span>
            <Segments segments={knotSummary(c, (id) => session.replica.getOp(id), threads).segments} />
            {c === primary && (
              <>
                <span className="text-muted"> · </span>
                <span className="font-medium text-knot underline decoration-dotted underline-offset-2">Why?</span>
              </>
            )}
          </span>
        </p>
      ))}
      {conflicts.length > shown.length && <p className="pl-4 text-xs text-muted">+{conflicts.length - shown.length} more knots on this shape</p>}
      {answer && <p className="border-t border-dashed border-line pt-1.5 pl-4 text-xs text-ink-2">{answer}</p>}
      <p className="pl-4 font-mono text-[10.5px] uppercase tracking-wider text-muted">Click the knot to open the explainer</p>
    </div>
  );
}

export function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        typeof s === "string" ? (
          <span key={i}>{s}</span>
        ) : (
          <span key={i} className="inline-flex items-baseline">
            <span
              className="mx-[1px] inline-flex h-[17px] min-w-[17px] translate-y-[1px] items-center justify-center rounded-[5px] px-1 font-mono text-[11px] font-bold text-white"
              style={{ background: s.thread.color }}
            >
              {s.thread.label}
            </span>
          </span>
        ),
      )}
    </>
  );
}
