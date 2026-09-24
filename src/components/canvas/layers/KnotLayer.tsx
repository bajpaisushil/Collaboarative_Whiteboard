"use client";
/**
 * Knots: a badge at the top-right of every shape with a live conflict. Hover (or keyboard
 * focus) shows the one-line story; click opens the explainer for that conflict.
 */
import { memo, useEffect, useMemo } from "react";
import type { Conflict, ShapeId } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { useInteraction, useInteractionStore } from "../interaction";
import { knotSummary, rankConflicts } from "../knotText";
import { displayBounds } from "../shapeUtils";
import { useThreads } from "../useThreads";

interface KnotSpec {
  shapeId: ShapeId;
  conflicts: Conflict[];
  x: number;
  y: number;
}

export const KnotLayer = memo(function KnotLayer() {
  const conflictsByShape = useReplicaView((v) => v.conflictsByShape);
  const byId = useReplicaView((v) => v.shapeById);
  const zoom = useUi((s) => s.camera.zoom);
  const focusId = useUi((s) => s.focus?.id ?? null);
  const hidden = useInteraction((s) => s.hidden);
  const ix = useInteractionStore();

  const knots = useMemo(() => {
    const out: KnotSpec[] = [];
    for (const [shapeId, list] of conflictsByShape) {
      const shape = byId.get(shapeId);
      if (!shape) continue;
      const live = rankConflicts(list);
      if (live.length === 0) continue;
      const b = displayBounds(shape);
      out.push({ shapeId, conflicts: live, x: b.x + b.w, y: b.y });
    }
    return out;
  }, [conflictsByShape, byId]);

  // Keep the tooltip honest: drop it when its knot is untied / hidden, follow the shape if
  // it moved, and never leave it behind when this layer goes away (time travel).
  useEffect(() => {
    const h = ix.getState().knotHover;
    if (!h) return;
    const kn = knots.find((x) => x.shapeId === h.shapeId);
    if (!kn || hidden.has(kn.shapeId)) ix.setState({ knotHover: null });
    else {
      const ids = kn.conflicts.map((c) => c.id);
      const same = ids.length === h.conflictIds.length && ids.every((id, i) => id === h.conflictIds[i]);
      if (kn.x !== h.x || kn.y !== h.y || !same) ix.setState({ knotHover: { ...h, x: kn.x, y: kn.y, conflictIds: ids } });
    }
  }, [knots, hidden, ix]);
  useEffect(() => () => ix.setState({ knotHover: null }), [ix]);

  if (knots.length === 0) return null;
  const k = 1 / zoom;
  return (
    <g data-layer="knots">
      {knots.map((kn) =>
        hidden.has(kn.shapeId) ? null : (
          <Knot key={kn.shapeId} spec={kn} k={k} focused={kn.conflicts.some((c) => c.id === focusId)} />
        ),
      )}
    </g>
  );
});

const Knot = memo(function Knot({ spec, k, focused }: { spec: KnotSpec; k: number; focused: boolean }) {
  const session = useSession();
  const ui = useUiStore();
  const ix = useInteractionStore();
  const threads = useThreads();
  const primary = spec.conflicts[0];
  const benign = spec.conflicts.every((c) => c.valuesEqual);
  const count = spec.conflicts.length;
  const label = useMemo(() => {
    const s = knotSummary(primary, (id) => session.replica.getOp(id), threads).text;
    return `Conflict${count > 1 ? ` (1 of ${count})` : ""}: ${s}. Press Enter to see why.`;
  }, [primary, session, threads, count]);

  const hover = (pinned: boolean) =>
    ix.setState({ knotHover: { shapeId: spec.shapeId, conflictIds: spec.conflicts.map((c) => c.id), x: spec.x, y: spec.y, pinned } });
  const unhover = (force: boolean) => {
    const cur = ix.getState().knotHover;
    if (cur && cur.shapeId === spec.shapeId && (force || !cur.pinned)) ix.setState({ knotHover: null });
  };
  const open = () => {
    ui.getState().focusConflict({ id: primary.id, lineageKey: primary.lineageKey });
    ix.setState({ knotHover: null });
  };

  const fill = benign ? "var(--panel)" : "var(--knot)";
  const thread = benign ? "var(--knot)" : "#fff";
  return (
    <g
      transform={`translate(${spec.x + 2 * k} ${spec.y - 2 * k}) scale(${k})`}
      data-canvas-ignore=""
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={focused}
      style={{ cursor: "pointer", outline: "none" }}
      className="group"
      onPointerEnter={() => hover(false)}
      onPointerLeave={() => unhover(false)}
      onFocus={() => hover(true)}
      onBlur={() => unhover(true)}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      }}
    >
      {/* generous invisible hit target */}
      <circle r={16} fill="transparent" />
      {focused && <circle r={15} fill="none" stroke="var(--knot)" strokeWidth={1.5} strokeDasharray="3 2.5" />}
      <circle r={13.5} fill="none" stroke="var(--focus)" strokeWidth={2} className="opacity-0 group-focus-visible:opacity-100" />
      <circle r={10.5} fill={fill} stroke="var(--knot)" strokeWidth={benign ? 1.5 : 0} className="transition-transform duration-150 group-hover:scale-110" />
      {/* two threads crossing over-under: the knot */}
      <g fill="none" strokeLinecap="round">
        <path d="M -5.5 3.5 C -2 3.5 2 -3.5 5.5 -3.5" stroke={fill} strokeWidth={4} />
        <path d="M -5.5 3.5 C -2 3.5 2 -3.5 5.5 -3.5" stroke={thread} strokeWidth={1.7} />
        <path d="M -5.5 -3.5 C -2 -3.5 2 3.5 5.5 3.5" stroke={fill} strokeWidth={4} />
        <path d="M -5.5 -3.5 C -2 -3.5 2 3.5 5.5 3.5" stroke={thread} strokeWidth={1.7} />
      </g>
      {count > 1 && (
        <g transform="translate(9 -9)">
          <circle r={6.5} fill="var(--ink)" stroke="var(--panel)" strokeWidth={1.5} />
          <text textAnchor="middle" y={3.2} fontSize={8.5} fontWeight={700} fill="var(--panel)" fontFamily="var(--font-geist-mono), monospace">
            {count > 9 ? "9+" : count}
          </text>
        </g>
      )}
    </g>
  );
});
