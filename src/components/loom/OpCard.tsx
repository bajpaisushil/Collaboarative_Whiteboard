"use client";
/**
 * Floating card describing the hovered op: who, what, when (Lamport + vector clock + wall
 * time), whether every tab has seen it, and whether it's part of a knot.
 */
import { CloudOff, Hourglass } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import type { Conflict, ReplicaId } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { capitalize, causeHint, causeWord, clockTime, compactVc, editRef } from "./format";
import { useHoverTarget, type HoverTarget } from "./hover";
import { useLoomThreads, useStableVc } from "./hooks";
import { isLiveKnot, knotPhrase, missingDependency, opSummary } from "./ops";

const CARD_W = 292;

export function OpHoverCard() {
  const target = useHoverTarget();
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {target && (
        <motion.div
          key="op-card"
          role="tooltip"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: reduce ? 0.06 : 0.12, ease: [0.2, 0.8, 0.2, 1] }}
          className="pointer-events-none absolute z-50"
          style={{
            left: Math.max(8, Math.min(target.x - CARD_W / 2, target.rootWidth - CARD_W - 8)),
            top: target.y - 14,
            width: CARD_W,
          }}
        >
          <div className="-translate-y-full">
            <OpCardBody target={target} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function OpCardBody({ target }: { target: HoverTarget }) {
  const session = useSession();
  const threads = useLoomThreads();
  const stable = useStableVc();
  const conflicts = useReplicaView((v) => v.conflicts);
  const viewVc = useReplicaView((v) => v.vc);
  const { op, pending } = target;
  const thread = threads(op.replica, op.meta.author);
  const labelOf = (r: ReplicaId) => threads(r).label;
  const summary = useMemo(() => opSummary(session.replica, op), [session, op]);
  const knots = useMemo<Conflict[]>(() => conflicts.filter((c) => c.ops.includes(op.id)), [conflicts, op]);
  const isStable = op.counter <= (stable[op.replica] ?? 0);
  const cause = causeWord(op.meta.cause);
  const missing = pending ? missingDependency(op, viewVc) : null;
  const live = knots.find(isLiveKnot) ?? null;

  return (
    <div className="relative overflow-hidden rounded-[12px] border border-line bg-panel py-2.5 pl-3.5 pr-3 text-[12px] leading-snug text-ink-2 shadow-sheet">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: thread.color }} />
      <div className="flex items-center gap-2">
        <ThreadBadge label={thread.label} size="xs" solid />
        <span className="font-semibold text-ink">{editRef(thread.label, op.counter)}</span>
        <span className="ml-auto flex items-center gap-1">
          {op.meta.offline && (
            <span className="inline-flex items-center gap-1 rounded-full border border-line-2 px-1.5 py-px text-[10.5px] text-ink-2">
              <CloudOff aria-hidden className="size-3" strokeWidth={2} /> offline
            </span>
          )}
          {cause && (
            <span className="rounded-full bg-panel-2 px-1.5 py-px text-[10.5px] font-medium text-ink-2" title={causeHint(op.meta.cause)}>
              {cause}
            </span>
          )}
        </span>
      </div>

      <p className="mt-1.5 text-[12.5px] text-ink">
        {summary.noun && <span className="text-muted">{capitalize(summary.noun)} · </span>}
        {summary.noun ? summary.text : capitalize(summary.text)}
      </p>
      {op.meta.label && op.meta.cause === "user" && <p className="mt-0.5 text-[11.5px] text-muted">Part of “{op.meta.label}”</p>}

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-muted">
        <span title="Lamport clock — orders every edit, consistent with cause and effect">L{op.lamport}</span>
        <span aria-hidden>·</span>
        <span title="Vector clock — how many edits from each tab this edit had seen">{compactVc(op.vc, labelOf)}</span>
        <span aria-hidden>·</span>
        <span title="Wall-clock time on the author's machine — informational only, never used for ordering">{clockTime(op.meta.wallTime)}</span>
      </p>

      <div className="mt-2 border-t border-dashed border-line pt-1.5 text-[11.5px]">
        {pending ? (
          <p className="flex items-start gap-1.5">
            <Hourglass aria-hidden className="mt-px size-3.5 shrink-0 text-warn" strokeWidth={2} />
            <span>
              Arrived early — waiting for {missing ? editRef(labelOf(missing.replica), missing.counter) : "its causes"} before it can be applied.
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <StabilityGlyph stable={isStable} color={thread.color} />
            {isStable ? "Every tab has seen this edit" : "Not every tab has seen this edit yet"}
          </p>
        )}
        {knots.length > 0 && (
          <p className="mt-1 flex items-start gap-1.5 text-knot">
            <KnotIcon size={14} className="mt-px shrink-0" />
            <span>
              {live ? `Knot: ${knotPhrase(live, labelOf)}.` : "Was part of a knot that has since been settled."}
              {knots.length > 1 && ` (${knots.length} knots)`}
            </span>
          </p>
        )}
      </div>
      {!pending && <p className="mt-1.5 text-[10.5px] text-muted">Click to see the board as of this edit</p>}
    </div>
  );
}

export function StabilityGlyph({ stable, color, size = 12 }: { stable: boolean; color: string; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 12 12" className="shrink-0">
      {!stable && <circle cx={6} cy={6} r={5.2} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={1.2} />}
      <circle cx={6} cy={6} r={stable ? 4 : 2.8} fill={color} />
    </svg>
  );
}
