"use client";
/**
 * X-ray: every shape wears a small thread tag — who made it and who touched it last — and a
 * faint outline in the last editor's thread pattern (dash + colour, never colour alone).
 */
import { memo } from "react";
import type { ShapeView } from "@/lib/crdt/types";
import { useReplicaView } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { displayBounds } from "../shapeUtils";
import { useThreads, type Thread } from "../useThreads";

const TagImpl = ({ shape, zoom, made, last }: { shape: ShapeView; zoom: number; made: Thread; last: Thread }) => {
  const b = displayBounds(shape);
  const k = 1 / zoom;
  const two = made.label !== last.label;
  const title = two ? `Created by ${made.label} · last edited by ${last.label}` : `Created and last edited by ${made.label}`;
  return (
    <g>
      <rect
        x={b.x - 3 * k}
        y={b.y - 3 * k}
        width={b.w + 6 * k}
        height={b.h + 6 * k}
        rx={6 * k}
        fill="none"
        stroke={last.color}
        strokeOpacity={0.6}
        strokeWidth={1}
        strokeDasharray={last.dash || undefined}
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${b.x - 3 * k} ${b.y - 3 * k}) scale(${k})`}>
        <title>{title}</title>
        <Chip x={0} thread={made} outlined={two} />
        {two && <Chip x={17} thread={last} outlined={false} />}
      </g>
    </g>
  );
};
const Tag = memo(TagImpl);

function Chip({ x, thread, outlined }: { x: number; thread: Thread; outlined: boolean }) {
  return (
    <g transform={`translate(${x} -17)`}>
      <rect width={15} height={14} rx={4} fill={outlined ? "var(--panel)" : thread.color} stroke={thread.color} strokeWidth={1.25} />
      <text
        x={7.5}
        y={10.5}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={700}
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
        fill={outlined ? thread.color : "#fff"}
      >
        {thread.label}
      </text>
    </g>
  );
}

export const XrayLayer = memo(function XrayLayer() {
  const shapes = useReplicaView((v) => v.shapes);
  const zoom = useUi((s) => s.camera.zoom);
  const hidden = useUi((s) => s.editingText);
  const threads = useThreads();
  return (
    <g data-layer="xray" pointerEvents="none" aria-hidden>
      {shapes.map((s) =>
        s.id === hidden ? null : <Tag key={s.id} shape={s} zoom={zoom} made={threads(s.createdBy)} last={threads(s.lastEditedBy)} />,
      )}
    </g>
  );
});
