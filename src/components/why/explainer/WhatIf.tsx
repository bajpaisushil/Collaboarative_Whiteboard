"use client";
/**
 * "What if…" — the rules Weave could have used instead. Alternatives that would change the
 * board can be pinned as a ghost on the canvas; the rest say why nothing would change.
 */
import clsx from "clsx";
import { Eye, EyeOff } from "lucide-react";
import { memo } from "react";
import type { Counterfactual } from "@/lib/crdt/types";
import { useUiStore } from "@/lib/ui/store";
import { StatusChip } from "../bits";
import { toggleCounterfactual, usePinnedCounterfactual } from "./actions";
import { useExplainer } from "./model";

function Chip({ cf, pinned, onToggle }: { cf: Counterfactual; pinned: boolean; onToggle: () => void }) {
  const canGhost = !!cf.result && (cf.result.alive === false || !!cf.result.props || cf.result.text !== undefined);
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">{cf.title}</span>
        {cf.differs ? <StatusChip tone="knot">different result</StatusChip> : <StatusChip tone="ok" hollow>same result</StatusChip>}
      </span>
      <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-2">{cf.detail}</span>
    </>
  );
  if (!canGhost) {
    return <div className="rounded-[12px] border border-line bg-panel px-3 py-2.5">{body}</div>;
  }
  return (
    <button
      type="button"
      aria-pressed={pinned}
      onClick={onToggle}
      className={clsx(
        "group/cf block w-full rounded-[12px] border px-3 py-2.5 text-left transition-[background-color,border-color] duration-150",
        pinned ? "border-[var(--focus)] bg-[color-mix(in_oklab,var(--focus)_8%,var(--panel))]" : "border-line bg-panel hover:border-line-2 hover:bg-panel-2/60",
      )}
    >
      {body}
      <span className={clsx("mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium", pinned ? "text-[var(--focus)]" : "text-muted group-hover/cf:text-ink-2")}>
        {pinned ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
        {pinned ? "Showing this on the canvas — click to hide" : "Show this on the canvas"}
      </span>
    </button>
  );
}

export const WhatIf = memo(function WhatIf() {
  const model = useExplainer();
  const ui = useUiStore();
  const conflictId = model.conflict.id;
  const pinned = usePinnedCounterfactual(conflictId);
  const cfs = model.explanation.counterfactuals;
  if (cfs.length === 0) return <p className="text-[12.5px] text-ink-2">No alternatives to compare for this knot.</p>;
  return (
    <div className="flex flex-col gap-2">
      {cfs.map((cf) => (
        <Chip key={cf.id} cf={cf} pinned={pinned === cf.id} onToggle={() => toggleCounterfactual(ui, conflictId, cf.id)} />
      ))}
    </div>
  );
});
