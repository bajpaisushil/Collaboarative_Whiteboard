"use client";
/**
 * Hovering an op in the loom / log outlines the shape it touched, in its author's thread.
 * Dead shapes (e.g. hovering a delete) show as a dashed tombstone.
 */
import { memo, useMemo } from "react";
import { describeOp } from "@/lib/crdt/describe";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { displayBounds } from "../shapeUtils";
import { useThreads } from "../useThreads";

export const HoverLayer = memo(function HoverLayer() {
  const session = useSession();
  const hoverOp = useUi((s) => s.hoverOp);
  const zoom = useUi((s) => s.camera.zoom);
  const version = useReplicaView((v) => v.version);
  const threads = useThreads();
  const model = useMemo(() => {
    if (!hoverOp || version < 0) return null;
    const op = session.replica.getOp(hoverOp);
    if (!op || op.kind === "snapshot.mark") return null;
    const shape = session.replica.getShape(op.shapeId, { includeDead: true });
    if (!shape) return null;
    return { shape, thread: threads(op.replica), text: describeOp(op, shape.type) };
  }, [session, hoverOp, version, threads]);
  if (!model) return null;
  const k = 1 / zoom;
  const b = displayBounds(model.shape);
  const pad = 7 * k;
  const text = model.text.length > 40 ? `${model.text.slice(0, 39)}…` : model.text;
  const w = 26 + text.length * 6;
  return (
    <g data-layer="hover-op" pointerEvents="none" aria-hidden>
      <rect
        x={b.x - pad}
        y={b.y - pad}
        width={b.w + pad * 2}
        height={b.h + pad * 2}
        rx={8 * k}
        fill={`color-mix(in oklab, ${model.thread.color} 8%, transparent)`}
        stroke={model.thread.color}
        strokeWidth={2}
        strokeDasharray={model.shape.alive ? model.thread.dash || undefined : "3 4"}
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${b.x - pad} ${b.y - pad}) scale(${k})`}>
        <g transform="translate(0 -24)">
          <rect width={w} height={19} rx={9.5} fill="var(--panel)" stroke={model.thread.color} strokeWidth={1.25} />
          <rect x={3} y={2.5} width={14} height={14} rx={4} fill={model.thread.color} />
          <text x={10} y={13} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-mono), monospace">
            {model.thread.label}
          </text>
          <text x={22} y={13.3} fontSize={11} fill="var(--ink)" fontFamily="var(--font-geist-sans), system-ui">
            {text}
          </text>
        </g>
      </g>
    </g>
  );
});
