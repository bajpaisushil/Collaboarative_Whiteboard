"use client";
/** One row of the operation log (fixed 28px height; positioned by the windowed list). */
import clsx from "clsx";
import { CloudOff, Hourglass } from "lucide-react";
import { memo } from "react";
import { kindLabel } from "@/lib/crdt/describe";
import type { Conflict, Op, ReplicaId, ReplicaReadApi, VectorClock } from "@/lib/crdt/types";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { capitalize, causeHint, causeWord, compactVc, editRef } from "./format";
import type { LoomThread } from "./hooks";
import { StabilityGlyph } from "./OpCard";
import { isLiveKnot, knotPhrase, missingDependency, opSummary } from "./ops";

export const ROW_H = 28;

export const COLUMNS_WIDE = "46px 30px 92px 78px minmax(0,1fr) 118px 150px";
export const COLUMNS_NARROW = "42px 28px minmax(0,1fr) 104px";

export interface LogRowProps {
  id: string;
  op: Op;
  pending: boolean;
  top: number;
  narrow: boolean;
  active: boolean;
  /** Outside the time-travel view (in its future, or outside the previewed cut). */
  dim: boolean;
  stable: boolean;
  knots: readonly Conflict[] | undefined;
  replica: ReplicaReadApi;
  threadOf: (r: ReplicaId, fallback?: string) => LoomThread;
  viewVc: VectorClock;
  onPick: (op: Op, pending: boolean) => void;
  onHover: (op: Op | null) => void;
  onKnot: (c: Conflict) => void;
}

export const LogRow = memo(function LogRow({
  id,
  op,
  pending,
  top,
  narrow,
  active,
  dim,
  stable,
  knots,
  replica,
  threadOf,
  viewVc,
  onPick,
  onHover,
  onKnot,
}: LogRowProps) {
  const thread = threadOf(op.replica, op.meta.author);
  const labelOf = (r: ReplicaId) => threadOf(r).label;
  const summary = opSummary(replica, op);
  const text = summary.noun ? `${capitalize(summary.noun)} · ${summary.text}` : capitalize(summary.text);
  const cause = causeWord(op.meta.cause);
  const knot = knots?.find(isLiveKnot) ?? knots?.[0];
  const missing = pending ? missingDependency(op, viewVc) : null;
  const waiting = missing ? `waiting for ${editRef(labelOf(missing.replica), missing.counter)}` : "waiting for its causes";

  const spoken = [
    `L${op.lamport}`,
    `${editRef(thread.label, op.counter)}: ${text}`,
    op.meta.offline ? "made offline" : "",
    cause ?? "",
    pending ? waiting : stable ? "seen by every tab" : "not yet seen by every tab",
    knot ? `knot: ${knotPhrase(knot, labelOf)}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-label={spoken}
      onClick={() => onPick(op, pending)}
      onPointerEnter={() => onHover(pending ? null : op)}
      className={clsx(
        "absolute inset-x-0 grid cursor-default items-center gap-2 px-2.5 text-[12px]",
        active ? "bg-[color-mix(in_oklab,var(--focus)_11%,var(--panel))] shadow-[inset_2px_0_0_var(--focus)]" : "hover:bg-panel-2",
        pending && "italic text-muted",
        dim && !active && "opacity-40",
      )}
      style={{ top, height: ROW_H, gridTemplateColumns: narrow ? COLUMNS_NARROW : COLUMNS_WIDE }}
    >
      <span className="font-mono text-[11px] tabular-nums text-ink-2">L{op.lamport}</span>
      <span className="flex items-center">
        <ThreadBadge label={thread.label} size="xs" dimmed={pending} />
      </span>
      {!narrow && <span className="truncate font-mono text-[10.5px] text-muted">{op.id}</span>}
      {!narrow && <span className="truncate text-[11.5px] text-ink-2">{kindLabel(op)}</span>}
      <span className={clsx("flex min-w-0 items-center gap-1.5", pending ? "text-muted" : "text-ink")}>
        {pending && <Hourglass aria-hidden className="size-3.5 shrink-0 text-warn" strokeWidth={2} />}
        <span className="truncate">{text}</span>
        {pending && <span className="shrink-0 truncate text-[11px] not-italic text-muted">— {waiting}</span>}
      </span>
      {!narrow && <span className="truncate font-mono text-[10.5px] text-muted">{compactVc(op.vc, labelOf)}</span>}
      <span className="flex min-w-0 items-center justify-end gap-1.5">
        {op.meta.offline && (
          <span title="Made while this tab was offline" className="inline-flex items-center gap-0.5 rounded-full border border-line-2 px-1.5 text-[10px] leading-4 not-italic text-ink-2">
            <CloudOff aria-hidden className="size-3" strokeWidth={2} />
            {!narrow && "offline"}
          </span>
        )}
        {cause && (
          <span title={causeHint(op.meta.cause)} className="rounded-full bg-panel-2 px-1.5 text-[10px] font-medium leading-4 not-italic text-ink-2">
            {cause}
          </span>
        )}
        {knot && (
          <span
            title={`Knot: ${knotPhrase(knot, labelOf)}${isLiveKnot(knot) ? "" : " (settled)"} — click to see why`}
            onClick={(e) => {
              e.stopPropagation();
              onKnot(knot);
            }}
            className={clsx(
              "inline-flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-[var(--knot-soft)]",
              isLiveKnot(knot) ? "text-knot" : "text-muted",
            )}
          >
            <KnotIcon size={14} />
          </span>
        )}
        {!pending && (
          <span title={stable ? "Every tab has seen this edit (stable)" : "Not every tab has seen this edit yet"} className="inline-flex">
            <StabilityGlyph stable={stable} color={thread.color} size={11} />
          </span>
        )}
      </span>
    </div>
  );
});
