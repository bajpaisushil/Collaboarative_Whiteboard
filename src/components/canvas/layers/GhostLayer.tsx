"use client";
/**
 * What-if ghosts and the focused-conflict halo.
 * - Ghost of a conflict side: the shape as that side would have left it ("B's version"),
 *   drawn dashed in B's thread colour, with a dotted connector to the real shape.
 * - Ghost of a counterfactual: the shape under the alternative rule (or crossed out if the
 *   alternative would have deleted it).
 */
import { memo, useMemo } from "react";
import { useReducedMotion } from "motion/react";
import type { Conflict, ShapeView } from "@/lib/crdt/types";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import type { UiState } from "@/lib/ui/store";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import type { Rect } from "@/lib/ui/geometry";
import { ShapeSvg } from "../ShapeSvg";
import { centerOf, displayBounds } from "../shapeUtils";
import { useThreads, type Thread } from "../useThreads";

interface GhostModel {
  real: ShapeView;
  ghost: ShapeView | null;
  color: string;
  thread: Thread | null;
  label: string;
}

function findConflict(session: WhiteboardSessionApi, id: string, lineageKey?: string): Conflict | null {
  const all = session.replica.getView().conflicts;
  return all.find((c) => c.id === id) ?? (lineageKey ? all.find((c) => c.lineageKey === lineageKey) : undefined) ?? null;
}

function computeGhost(session: WhiteboardSessionApi, g: NonNullable<UiState["ghost"]>, threads: (r: string) => Thread): GhostModel | null {
  const r = session.replica;
  if (g.counterfactual) {
    const exp = r.explain(g.conflictId);
    const cf = exp?.counterfactuals.find((c) => c.id === g.counterfactual);
    if (!exp || !cf?.result) return null;
    const real = r.getShape(exp.conflict.shapeId, { includeDead: true });
    if (!real) return null;
    const res = cf.result;
    const ghost = res.alive === false ? null : { ...real, ...res.props, text: res.text ?? real.text, runs: res.text !== undefined ? undefined : real.runs };
    return { real, ghost, color: "var(--focus)", thread: null, label: cf.title };
  }
  const conflict = findConflict(session, g.conflictId);
  // Concurrent typing is merged, not picked: there is no losing side to draw (the explainer
  // shows the woven text instead; the focus halo marks the shape).
  if (conflict?.kind === "concurrent-text") return null;
  const side =g.opId ?? conflict?.ops.find((o) => o !== conflict.winner) ?? conflict?.ops[1];
  const res = r.ghost(g.conflictId, side);
  const shapeId = conflict?.shapeId ?? res?.shape?.id;
  if (!res || !shapeId) return null;
  const real = r.getShape(shapeId, { includeDead: true });
  if (!real) return null;
  const op = side ? r.getOp(side) : undefined;
  const thread = op ? threads(op.replica) : null;
  const color = thread?.color ?? "var(--knot)";
  const who = thread ? `${thread.label}'s` : "The other";
  return {
    real,
    ghost: res.shape,
    color,
    thread,
    label: res.shape ? `${who} version` : `${who} version — deleted`,
  };
}

export const GhostLayer = memo(function GhostLayer() {
  const session = useSession();
  const ghost = useUi((s) => s.ghost);
  const zoom = useUi((s) => s.camera.zoom);
  const version = useReplicaView((v) => v.version);
  const threads = useThreads();
  const model = useMemo(
    () => (ghost && version >= 0 ? computeGhost(session, ghost, threads) : null),
    [session, ghost, threads, version],
  );
  if (!model) return null;
  const k = 1 / zoom;
  const realBox = displayBounds(model.real);
  const ghostBox = model.ghost ? displayBounds(model.ghost) : realBox;
  const a = centerOf(ghostBox),
    b = centerOf(realBox);
  const apart = Math.hypot(a.x - b.x, a.y - b.y) > 12 * k;
  return (
    <g data-layer="ghost" pointerEvents="none" aria-hidden>
      {model.ghost ? <ShapeSvg shape={model.ghost} ghost ghostColor={model.color} /> : <Tombstone box={realBox} color={model.color} k={k} />}
      {apart && (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={model.color} strokeWidth={1.5} strokeDasharray="1 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle cx={b.x} cy={b.y} r={3 * k} fill={model.color} />
          <circle cx={a.x} cy={a.y} r={3 * k} fill="var(--panel)" stroke={model.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
      <GhostLabel box={ghostBox} k={k} color={model.color} thread={model.thread} text={model.label} />
    </g>
  );
});

function Tombstone({ box, color, k }: { box: Rect; color: string; k: number }) {
  const pad = 4 * k;
  const x0 = box.x - pad,
    y0 = box.y - pad,
    x1 = box.x + box.w + pad,
    y1 = box.y + box.h + pad;
  return (
    <g>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={6 * k} fill={`color-mix(in oklab, ${color} 8%, transparent)`} stroke={color} strokeWidth={1.75} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
      <path d={`M ${x0} ${y0} L ${x1} ${y1} M ${x1} ${y0} L ${x0} ${y1}`} stroke={color} strokeOpacity={0.75} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function GhostLabel({ box, k, color, thread, text }: { box: Rect; k: number; color: string; thread: Thread | null; text: string }) {
  const chars = Math.min(text.length, 44);
  const shown = text.length > 44 ? `${text.slice(0, 43)}…` : text;
  const width = 16 + chars * 6.2 + (thread ? 20 : 0);
  return (
    <g transform={`translate(${box.x} ${box.y + box.h}) scale(${k})`}>
      <g transform="translate(0 8)">
        <rect width={width} height={20} rx={10} fill="var(--panel)" stroke={color} strokeWidth={1.25} strokeDasharray="4 2.5" />
        {thread && (
          <g transform="translate(4 3)">
            <rect width={14} height={14} rx={4} fill={color} />
            <text x={7} y={10.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-mono), monospace">
              {thread.label}
            </text>
          </g>
        )}
        <text x={thread ? 24 : 9} y={14} fontSize={11} fontWeight={500} fill="var(--ink)" fontFamily="var(--font-geist-sans), system-ui">
          {shown}
        </text>
      </g>
    </g>
  );
}

/** Knot-coloured halo behind the shape of the focused conflict (drawn under the shapes). */
export const FocusHalo = memo(function FocusHalo() {
  const session = useSession();
  const focus = useUi((s) => s.focus);
  const zoom = useUi((s) => s.camera.zoom);
  const version = useReplicaView((v) => v.version);
  const reduced = useReducedMotion() ?? false;
  const shape = useMemo(() => {
    if (!focus || version < 0) return null;
    const c = findConflict(session, focus.id, focus.lineageKey);
    return c ? session.replica.getShape(c.shapeId, { includeDead: true }) : null;
  }, [session, focus, version]);
  if (!shape) return null;
  const k = 1 / zoom;
  const b = displayBounds(shape);
  const pad = 10 * k;
  return (
    <g data-layer="focus-halo" pointerEvents="none" aria-hidden>
      <rect x={b.x - pad * 1.8} y={b.y - pad * 1.8} width={b.w + pad * 3.6} height={b.h + pad * 3.6} rx={16 * k} fill="var(--knot-soft)" />
      <rect
        x={b.x - pad}
        y={b.y - pad}
        width={b.w + pad * 2}
        height={b.h + pad * 2}
        rx={10 * k}
        fill="none"
        stroke="var(--knot)"
        strokeWidth={2}
        strokeDasharray={shape.alive ? "8 5" : "3 4"}
        vectorEffect="non-scaling-stroke"
      >
        {!reduced && <animate attributeName="stroke-dashoffset" from="0" to="-26" dur="1.4s" repeatCount="indefinite" />}
      </rect>
    </g>
  );
});
