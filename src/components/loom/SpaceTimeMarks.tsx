"use client";
/**
 * Interactive and overlay marks of the space-time diagram: knots, snapshot flags, folded
 * bundles, the live reed, the time-travel cursor / causal-cut frontier and the hover ring.
 * Overlays subscribe to their own slice of UI state so scrubbing never re-renders the dots.
 */
import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Conflict, OpId, ReplicaId, SnapshotInfo } from "@/lib/crdt/types";
import { useUi, useUiStore } from "@/lib/ui/store";
import { scrollToLeft } from "./dom";
import { FlagGlyph, KnotGlyph } from "./glyphs";
import type { StGeometry } from "./geometry";
import type { LoomThread } from "./hooks";
import type { Bundle, Lane, LoomModel } from "./model";
import { COL } from "./model";
import { isLiveKnot, knotPhrase } from "./ops";
import { isPrefixScrub, slotOfScrub } from "./scrub";

const activate = (fn: () => void) => (e: ReactKeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.stopPropagation();
    fn();
  }
};

/* ------------------------------------------------------------------ knots */

export function KnotMark({
  conflicts,
  x,
  y,
  focusedId,
  labelOf,
}: {
  conflicts: readonly Conflict[];
  x: number;
  y: number;
  focusedId: string | null;
  labelOf: (r: ReplicaId) => string;
}) {
  const store = useUiStore();
  const c = conflicts[0];
  const variant = isLiveKnot(c) ? "live" : c.status === "live" ? "benign" : "settled";
  const focused = conflicts.some((k) => k.id === focusedId);
  const extra = conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : "";
  const status = variant === "live" ? "" : variant === "benign" ? " Both wrote the same value." : " Since settled by a later edit.";
  const label = `Knot: ${knotPhrase(c, labelOf)}.${status}${extra} Show why.`;
  const open = () => store.getState().focusConflict({ id: c.id, lineageKey: c.lineageKey });
  const ghostOn = () => store.getState().set({ ghost: { conflictId: c.id } });
  const ghostOff = () => {
    const s = store.getState();
    if (s.ghost && s.ghost.conflictId === c.id && !s.ghost.opId && !s.ghost.counterfactual) s.set({ ghost: null });
  };
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={focused}
      className="group/knot cursor-pointer outline-none"
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onKeyDown={activate(open)}
      onPointerEnter={ghostOn}
      onPointerLeave={ghostOff}
      onFocus={ghostOn}
      onBlur={ghostOff}
    >
      <circle cx={x} cy={y} r={9} fill="transparent" />
      <circle cx={x} cy={y} r={9} fill="none" stroke="var(--focus)" strokeWidth={2} className="opacity-0 group-focus-visible/knot:opacity-100" />
      <KnotGlyph x={x} y={y} s={focused ? 5.2 : 4.2} variant={variant} focused={focused} />
    </g>
  );
}

/* ------------------------------------------------------------------ snapshot flags */

export function FlagMark({ snap, x, y, h, thread }: { snap: SnapshotInfo; x: number; y: number; h: number; thread: LoomThread }) {
  const store = useUiStore();
  const previewing = useUi((s) => !!s.scrub && s.scrub.cut === snap.cut);
  const label = `Snapshot “${snap.name}” by ${thread.label} — ${previewing ? "previewing" : "preview it"}`;
  const preview = () => store.getState().set({ scrub: { cut: snap.cut, label: snap.name } });
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={previewing}
      className="group/flag cursor-pointer outline-none"
      onClick={(e) => {
        e.stopPropagation();
        preview();
      }}
      onKeyDown={activate(preview)}
    >
      <rect x={x - 4} y={y - h - 2} width={16} height={h + 5} fill="transparent" />
      <rect x={x - 4} y={y - h - 3} width={17} height={h + 7} rx={4} fill="none" stroke="var(--focus)" strokeWidth={2} className="opacity-0 group-focus-visible/flag:opacity-100" />
      {previewing && <rect x={x - 4} y={y - h - 3} width={17} height={h + 7} rx={4} fill="color-mix(in oklab, var(--focus) 14%, transparent)" />}
      <FlagGlyph x={x} y={y + 3} h={h} color={thread.color} />
    </g>
  );
}

/* ------------------------------------------------------------------ bundles */

export function BundleMark({ bundle, geo, lanes, threads, onUnfold }: { bundle: Bundle; geo: StGeometry; lanes: readonly Lane[]; threads: LoomThread[]; onUnfold: (key: OpId) => void }) {
  const count = bundle.to - bundle.from + 1;
  const cx = bundle.x + bundle.w / 2;
  const top = geo.laneY(0) - geo.laneH / 2 + 3;
  const bottom = geo.laneY(lanes.length - 1) + geo.laneH / 2 - 3;
  const label = `${count} quieter edits folded here — expand`;
  const unfold = () => onUnfold(bundle.key);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      className="group/bundle cursor-pointer outline-none"
      onClick={(e) => {
        e.stopPropagation();
        unfold();
      }}
      onKeyDown={activate(unfold)}
    >
      <title>{label}</title>
      <rect
        x={bundle.x + 4}
        y={top}
        width={bundle.w - 8}
        height={bottom - top}
        rx={8}
        fill="var(--panel-2)"
        stroke="var(--line-2)"
        strokeDasharray="3 3"
        className="transition-[stroke] group-hover/bundle:stroke-[var(--ink-2)] group-focus-visible/bundle:stroke-[var(--focus)]"
      />
      {lanes.map((lane, l) => {
        const k = bundle.perLane[l];
        if (!k) return null;
        const y = geo.laneY(l);
        const w = Math.min(bundle.w - 22, 6 + Math.log2(k + 1) * 6);
        return <rect key={lane.replica} x={cx - w / 2} y={y - 2.5} width={w} height={5} rx={2.5} fill={threads[l].color} fillOpacity={0.75} />;
      })}
      <text x={cx} y={top + 11} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--ink-2)" fontFamily="var(--font-geist-mono), monospace">
        +{count}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ live reed */

export function LiveReed({ geo, live }: { geo: StGeometry; live: boolean }) {
  const store = useUiStore();
  const back = () => store.getState().set({ scrub: null });
  const x = geo.headX;
  const body = (
    <>
      <line x1={x} x2={x} y1={6} y2={geo.height - 4} stroke={live ? "var(--ok)" : "var(--line-2)"} strokeWidth={2} strokeLinecap="round" strokeOpacity={live ? 0.7 : 1} />
      <rect x={x - 15} y={1} width={30} height={13} rx={6.5} fill={live ? "var(--ok)" : "var(--panel-2)"} stroke={live ? "none" : "var(--line-2)"} />
      <text x={x} y={10.5} textAnchor="middle" fontSize={8.5} fontWeight={700} letterSpacing={0.6} fill={live ? "var(--panel)" : "var(--ink-2)"} fontFamily="var(--font-geist-mono), monospace">
        NOW
      </text>
    </>
  );
  if (live) return <g aria-hidden>{body}</g>;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label="Return to live"
      className="group/reed cursor-pointer outline-none"
      onClick={(e) => {
        e.stopPropagation();
        back();
      }}
      onKeyDown={activate(back)}
    >
      <title>Return to live (Esc)</title>
      <rect x={x - 16} y={0} width={32} height={geo.height} fill="transparent" />
      <rect x={x - 17} y={-1} width={34} height={17} rx={8} fill="none" stroke="var(--focus)" strokeWidth={2} className="opacity-0 group-focus-visible/reed:opacity-100" />
      {body}
    </g>
  );
}

/* ------------------------------------------------------------------ time-travel cursor */

/**
 * Prefix scrubs: a blueprint cursor after the op, with the future washed out. Keeps the
 * cursor in view when it moves (unless the user is dragging the diagram itself).
 */
export function ScrubCursor({ geo, model, scroller }: { geo: StGeometry; model: LoomModel; scroller: HTMLDivElement | null }) {
  const scrub = useUi((s) => s.scrub);
  const prefix = scrub && isPrefixScrub(scrub) ? scrub : null;
  const slot = prefix ? slotOfScrub(prefix, model.log, model.indexOf) : -1;
  const x = slot < 0 ? null : geo.xAfter(slot - 1);
  const op = slot > 0 ? model.log[slot - 1] : null;

  useEffect(() => {
    if (x === null || !scroller) return;
    const left = scroller.scrollLeft;
    const w = scroller.clientWidth;
    if (x < left + 40 || x > left + w - 60) scrollToLeft(scroller, x - w * 0.6);
  }, [x, scroller]);

  if (x === null) return null;
  const tag = op ? `L${op.lamport}` : "start";
  const tw = 12 + tag.length * 6;
  return (
    <g pointerEvents="none" aria-hidden>
      <rect x={x} y={0} width={Math.max(0, geo.headX - x - 3)} height={geo.height} fill="var(--panel)" fillOpacity={0.62} />
      <line x1={x} x2={x} y1={14} y2={geo.height} stroke="var(--focus)" strokeWidth={1.5} />
      <rect x={x - tw / 2} y={1} width={tw} height={13} rx={4} fill="var(--focus)" />
      <text x={x} y={10.5} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--panel)" fontFamily="var(--font-geist-mono), monospace">
        {tag}
      </text>
    </g>
  );
}

/** Cut scrubs (snapshot previews): the causal cut drawn as a zig-zag frontier across lanes. */
export function CutFrontier({ geo, frontier, label }: { geo: StGeometry; frontier: readonly number[]; label: string }) {
  if (frontier.length === 0) return null;
  const pts: string[] = [];
  frontier.forEach((idx, l) => {
    const x = geo.xAfter(idx);
    const y = geo.laneY(l);
    pts.push(`${x},${y - geo.laneH / 2}`, `${x},${y + geo.laneH / 2}`);
  });
  const x0 = geo.xAfter(frontier[0]);
  const tw = Math.min(180, 16 + label.length * 5.6);
  return (
    <g pointerEvents="none" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke="var(--focus)" strokeWidth={1.6} strokeDasharray="5 3" strokeLinejoin="round" />
      <rect x={x0 - 4} y={1} width={tw} height={13} rx={4} fill="var(--focus)" />
      <text x={x0 + 2} y={10.5} fontSize={9} fontWeight={600} fill="var(--panel)" fontFamily="var(--font-geist-sans), system-ui">
        {label.length > 30 ? `${label.slice(0, 29)}…` : label}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ hover ring */

/** Ring around the op hovered anywhere (diagram, ribbon, log table, canvas tools). */
export function HoverRing({ geo, model, laneOf }: { geo: StGeometry; model: LoomModel; laneOf: ReadonlyMap<ReplicaId, number> }) {
  const hoverOp = useUi((s) => s.hoverOp);
  const i = hoverOp ? model.indexOf.get(hoverOp) : undefined;
  if (i === undefined || geo.layout.bundleOf[i] >= 0) return null;
  const l = laneOf.get(model.log[i].replica);
  if (l === undefined) return null;
  const x = geo.layout.opX[i];
  const y = geo.laneY(l);
  return (
    <g pointerEvents="none" aria-hidden>
      <line x1={x} x2={x} y1={geo.laneY(0) - geo.laneH / 2} y2={geo.height - 4} stroke="var(--ink)" strokeOpacity={0.12} strokeWidth={COL - 6} strokeLinecap="round" />
      <circle cx={x} cy={y} r={geo.r + 5.5} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
    </g>
  );
}

