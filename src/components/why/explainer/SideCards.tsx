"use client";
/**
 * One card per side: who, what they did, their stamp, and what happened to it — plus the
 * manual override ("Use A's peach" / "Delete it anyway"). Hover or focus previews that side
 * as a ghost on the canvas.
 */
import clsx from "clsx";
import { Check, WifiOff } from "lucide-react";
import type { OpId, PropKey, ShapeProps, ShapeView } from "@/lib/crdt/types";
import { canonicalJson } from "@/lib/crdt/hash";
import { Swatch, ThreadChip } from "../bits";
import { capital, causeWord, clockTime, valueSwatch, valueWord } from "../format";
import { roleWord, useExplainer, type DisplaySide, type WhyVariant } from "./model";

export type AdoptState = { kind: "button"; label: string; destructive?: boolean } | { kind: "current" } | { kind: "none" };

function sameValues(wrote: Partial<ShapeProps>, shape: ShapeView, props: readonly PropKey[]): boolean {
  for (const p of props) {
    const v = (wrote as Partial<Record<PropKey, unknown>>)[p];
    if (v === undefined) continue;
    if (canonicalJson(v) !== canonicalJson((shape as unknown as Record<PropKey, unknown>)[p])) return false;
  }
  return true;
}

/** Can this side's value be adopted right now, and how should the control read? */
export function adoptStateFor(d: DisplaySide, kind: string, props: readonly PropKey[], shape: ShapeView | null): AdoptState {
  if (!shape) return { kind: "none" };
  if (kind === "concurrent-write") {
    if (!d.side.wrote) return { kind: "none" };
    if (!shape.alive) return { kind: "none" };
    if (sameValues(d.side.wrote, shape, props)) return { kind: "current" };
    return { kind: "button", label: `Use ${d.thread.label}'s ${valueWord(d.side.wrote, props)}` };
  }
  if (kind === "delete-vs-edit") {
    if (d.role === "delete") return shape.alive ? { kind: "button", label: "Delete it anyway", destructive: true } : { kind: "none" };
    return shape.alive ? { kind: "current" } : { kind: "none" };
  }
  return { kind: "none" };
}

function roleClass(role: DisplaySide["role"]): string {
  return role === "winner" || role === "edit" || role === "first" ? "solid" : "quiet";
}

export function SideCard({
  d,
  variant,
  adopt,
  onAdopt,
  onEnter,
  onLeave,
  layout,
}: {
  d: DisplaySide;
  variant: WhyVariant;
  adopt: AdoptState;
  onAdopt: (opId: OpId) => void;
  onEnter: (opId: OpId) => void;
  onLeave: () => void;
  layout: "row" | "column";
}) {
  const model = useExplainer();
  const { side, thread } = d;
  const props = model.conflict.props;
  const swatch = valueSwatch(side.wrote, props);
  const tone = roleClass(d.role);
  const compact = variant === "seam";
  return (
    <div
      className={clsx(
        "group/side relative flex min-w-0 gap-3 rounded-[12px] border bg-panel transition-[border-color,background-color] duration-150",
        "hover:bg-panel-2/60 focus-within:bg-panel-2/60",
        layout === "row" ? "items-start px-3 py-2.5" : "flex-col px-2.5 py-2.5",
      )}
      style={{ borderColor: tone === "solid" ? `color-mix(in oklab, ${thread.color} 45%, var(--line))` : "var(--line)" }}
      onPointerEnter={() => onEnter(side.opId)}
      onPointerLeave={onLeave}
      onFocus={() => onEnter(side.opId)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onLeave();
      }}
    >
      <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full" style={{ background: thread.color, opacity: tone === "solid" ? 1 : 0.35 }} />
      <div className={clsx("flex min-w-0 flex-1 flex-col gap-1", layout === "row" && "pl-1")}>
        <div className="flex flex-wrap items-center gap-1.5">
          <ThreadChip thread={thread} size="sm" />
          <span className={clsx("font-medium text-ink", compact ? "text-[12px]" : "text-[12.5px]")}>
            {thread.label}&rsquo;s {side.kind === "shape.delete" ? "delete" : "edit"}
          </span>
          <span
            className="rounded-full px-1.5 py-[2px] text-[10.5px] font-semibold leading-none"
            style={
              tone === "solid"
                ? { background: thread.color, color: "var(--panel)" }
                : { color: "var(--ink-2)", boxShadow: "inset 0 0 0 1px var(--line-2)" }
            }
          >
            {roleWord(d.role)}
          </span>
        </div>
        <p className={clsx("text-ink-2", compact ? "text-[11.5px] leading-snug" : "text-[12.5px] leading-snug")}>
          {swatch && <Swatch color={swatch} className="mr-1" />}
          {capital(side.summary)}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          <span className="font-mono tabular-nums text-ink-2" title="Lamport stamp">
            L{side.lamport}
          </span>
          <span className="font-mono tabular-nums" title="Wall-clock time on that tab (informational only — never used to decide)">
            {clockTime(side.wallTime)}
          </span>
          {side.offline && (
            <span className="inline-flex items-center gap-1" title="Made while that tab was offline">
              <WifiOff aria-hidden className="size-3" />
              offline
            </span>
          )}
          {side.cause !== "user" && <span>via {causeWord(side.cause)}</span>}
        </p>
      </div>
      {adopt.kind === "button" && (
        <button
          type="button"
          onClick={() => onAdopt(side.opId)}
          className={clsx(
            "shrink-0 self-start rounded-[9px] border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors",
            adopt.destructive ? "border-[color-mix(in_oklab,var(--knot)_40%,var(--line))] text-knot hover:bg-[var(--knot-soft)]" : "border-line-2 text-ink hover:bg-panel-2",
            layout === "column" && "w-full self-stretch",
          )}
          title={
            adopt.destructive
              ? `Delete the ${model.noun} now — ${thread.label}'s original intent. Undo brings it back.`
              : `Write ${thread.label}'s value again as a new edit. Undo brings the other value back.`
          }
        >
          {adopt.label}
        </button>
      )}
      {adopt.kind === "current" && (
        <span className="inline-flex shrink-0 items-center gap-1 self-start text-[11px] font-medium text-ok">
          <Check aria-hidden className="size-3.5" strokeWidth={2.4} />
          on the board
        </span>
      )}
    </div>
  );
}
