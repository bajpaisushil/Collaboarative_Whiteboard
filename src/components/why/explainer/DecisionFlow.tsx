"use client";
/**
 * "Who wins, and why?" — the merge rules as a flow the edits fall through, one node per
 * rule (explanation.steps). The rule that decided it lights up in the winner's thread
 * colour; rules that weren't needed are dimmed.
 */
import clsx from "clsx";
import { Check, Info, Minus, Star, X, type LucideIcon } from "lucide-react";
import { memo } from "react";
import type { DecisionStep, StepOutcome } from "@/lib/crdt/types";
import { Switch } from "@/components/ui/Switch";
import { ThreadChip } from "../bits";
import { replicaOfOp } from "../threads";
import { useExplainer } from "./model";

const ICON: Record<StepOutcome, LucideIcon> = {
  pass: Check,
  fail: X,
  decisive: Star,
  skipped: Minus,
  info: Info,
};

const OUTCOME_WORD: Record<StepOutcome, string> = {
  pass: "yes",
  fail: "no",
  decisive: "decides it",
  skipped: "not needed",
  info: "",
};

function Node({ step, color, technical, last }: { step: DecisionStep; color: string; technical: boolean; last: boolean }) {
  const Icon = ICON[step.outcome];
  const decisive = step.outcome === "decisive";
  const skipped = step.outcome === "skipped";
  const text = technical ? step.technical : step.plain;
  return (
    <li className={clsx("relative flex gap-3 pb-4", last && "pb-0", skipped && "opacity-55")}>
      {/* the thread linking nodes */}
      {!last && <span aria-hidden className="absolute bottom-0 left-[13px] top-[28px] w-[2px] rounded-full bg-line-2" />}
      <span
        aria-hidden
        className="relative z-[1] mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
        style={
          decisive
            ? { background: color, color: "var(--panel)", boxShadow: `0 0 0 4px color-mix(in oklab, ${color} 22%, transparent)` }
            : step.outcome === "fail"
              ? { background: "var(--panel)", color: "var(--knot)", boxShadow: "inset 0 0 0 1.5px color-mix(in oklab, var(--knot) 55%, var(--line))" }
              : step.outcome === "pass"
                ? { background: "var(--panel)", color: "var(--ok)", boxShadow: "inset 0 0 0 1.5px color-mix(in oklab, var(--ok) 55%, var(--line))" }
                : { background: "var(--panel-2)", color: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--line-2)" }
        }
      >
        <Icon className="size-3.5" strokeWidth={2.4} fill={decisive ? "currentColor" : "none"} />
      </span>
      <div
        className={clsx("min-w-0 flex-1 rounded-[12px] px-3 py-2", decisive ? "border" : "border border-transparent")}
        style={decisive ? { borderColor: `color-mix(in oklab, ${color} 50%, var(--line))`, background: `color-mix(in oklab, ${color} 7%, var(--panel))` } : undefined}
      >
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={clsx("text-[13px] font-semibold", skipped ? "text-ink-2" : "text-ink")}>{step.title}</span>
          {OUTCOME_WORD[step.outcome] && (
            <span
              className="rounded-full px-1.5 py-[2px] text-[10.5px] font-semibold uppercase leading-none tracking-[0.06em]"
              style={
                decisive
                  ? { background: color, color: "var(--panel)" }
                  : step.outcome === "fail"
                    ? { color: "var(--knot)", background: "var(--knot-soft)" }
                    : step.outcome === "pass"
                      ? { color: "var(--ok)", background: "color-mix(in oklab, var(--ok) 12%, transparent)" }
                      : { color: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--line-2)" }
              }
            >
              {OUTCOME_WORD[step.outcome]}
            </span>
          )}
        </p>
        <p className={clsx("mt-1 leading-relaxed text-ink-2", technical ? "break-words font-mono text-[11.5px]" : "text-[12.5px]")}>{text}</p>
      </div>
    </li>
  );
}

export const DecisionFlow = memo(function DecisionFlow({ technical, onTechnical }: { technical: boolean; onTechnical: (v: boolean) => void }) {
  const model = useExplainer();
  const { explanation, threadOf } = model;
  const color = model.lead.thread.color;
  const sup = explanation.supersededBy;
  const supThread = sup ? threadOf(replicaOfOp(sup.opId)) : null;
  const steps = explanation.steps;
  return (
    <div className="flex flex-col gap-4">
      <Switch
        checked={technical}
        onChange={onTechnical}
        label="Technical"
        description="Show the clocks, stamps and op ids each rule compares."
      />
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <Node key={s.id} step={s} color={color} technical={technical} last={i === steps.length - 1 && !sup} />
        ))}
        {sup && supThread && (
          <li className="relative flex gap-3">
            <span
              aria-hidden
              className="relative z-[1] mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
              style={{ background: supThread.color, color: "var(--panel)" }}
            >
              <span className="text-[11px] font-bold">{supThread.label}</span>
            </span>
            <div className="min-w-0 flex-1 rounded-[12px] border border-dashed border-line-2 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                Later, <ThreadChip thread={supThread} size="xs" /> overwrote both
              </p>
              <p className={clsx("mt-1 leading-relaxed text-ink-2", technical ? "font-mono text-[11.5px]" : "text-[12.5px]")}>
                {technical
                  ? `Current register holder = ${sup.opId} (causally after both).`
                  : `${supThread.label} changed it again after seeing both edits, so what you see now is ${supThread.label}'s. That was an ordinary overwrite, not a new knot.`}
              </p>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
});
