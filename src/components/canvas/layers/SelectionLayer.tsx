"use client";
/**
 * Local selection chrome in the local thread colour: per-shape outlines, group bounds,
 * resize handles (rect / ellipse / sticky / text), arrow endpoint handles, the marquee.
 * Strokes are move-only. Handles carry data-handle / data-shape for the controller.
 */
import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ShapeView } from "@/lib/crdt/types";
import { useReplicaView } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { unionRects, type Rect } from "@/lib/ui/geometry";
import type { Handle } from "../controller";
import { useInteraction } from "../interaction";
import { displayBounds, RESIZABLE, withProps } from "../shapeUtils";
import { useSelfThread } from "../useThreads";

const HANDLE_CURSOR: Record<Exclude<Handle, "a0" | "a1">, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export const SelectionLayer = memo(function SelectionLayer() {
  const selection = useUi((s) => s.selection);
  const zoom = useUi((s) => s.camera.zoom);
  const editing = useUi((s) => s.editingText);
  const tool = useUi((s) => s.tool);
  const scrubbing = useUi((s) => s.scrub !== null);
  const raw = useReplicaView(useShallow((v) => selection.map((id) => v.shapeById.get(id) ?? null)));
  const preview = useInteraction((s) => s.preview);
  const marquee = useInteraction((s) => s.marquee);
  const self = useSelfThread();

  if (scrubbing) return null;
  const k = 1 / zoom;
  const shapes = raw.filter((s): s is ShapeView => !!s).map((s) => withProps(s, preview?.get(s.id)));
  const boxes = shapes.map(displayBounds);
  const group = boxes.length > 1 ? unionRects(boxes) : null;
  const single = shapes.length === 1 ? shapes[0] : null;
  const showHandles = single && tool === "select" && editing !== single.id;
  const resizing = single && preview?.get(single.id)?.w !== undefined ? boxes[0] : null;

  return (
    <g data-layer="selection">
      {boxes.map((b, i) => (
        <Outline key={shapes[i].id} box={b} k={k} color={self.color} shape={shapes[i]} />
      ))}
      {group && (
        <rect
          x={group.x - 8 * k}
          y={group.y - 8 * k}
          width={group.w + 16 * k}
          height={group.h + 16 * k}
          rx={8 * k}
          fill="none"
          stroke={self.color}
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {showHandles && single.type === "arrow" && <ArrowHandles shape={single} k={k} color={self.color} />}
      {showHandles && RESIZABLE.has(single.type) && <BoxHandles id={single.id} box={boxes[0]} k={k} color={self.color} />}
      {resizing && <SizeChip box={resizing} k={k} color={self.color} />}
      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill={`color-mix(in oklab, ${self.color} 9%, transparent)`}
          stroke={self.color}
          strokeWidth={1}
          strokeDasharray="5 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </g>
  );
});

function Outline({ box, k, color, shape }: { box: Rect; k: number; color: string; shape: ShapeView }) {
  if (shape.type === "arrow") return null; // endpoints are the affordance
  const pad = shape.type === "stroke" ? 2 * k : 4 * k;
  return (
    <rect
      x={box.x - pad}
      y={box.y - pad}
      width={box.w + pad * 2}
      height={box.h + pad * 2}
      rx={(shape.type === "ellipse" ? 6 : 4) * k}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

function BoxHandles({ id, box, k, color }: { id: string; box: Rect; k: number; color: string }) {
  const pad = 4 * k;
  const x0 = box.x - pad,
    y0 = box.y - pad,
    x1 = box.x + box.w + pad,
    y1 = box.y + box.h + pad;
  const xm = (x0 + x1) / 2,
    ym = (y0 + y1) / 2;
  const small = box.w * (1 / k) < 36 || box.h * (1 / k) < 36; // tiny on screen: corners only
  const spots: [Exclude<Handle, "a0" | "a1">, number, number][] = [
    ["nw", x0, y0],
    ["ne", x1, y0],
    ["se", x1, y1],
    ["sw", x0, y1],
  ];
  if (!small) spots.push(["n", xm, y0], ["e", x1, ym], ["s", xm, y1], ["w", x0, ym]);
  const s = 8 * k;
  return (
    <g>
      {spots.map(([h, x, y]) => (
        <g key={h} data-handle={h} data-shape={id} style={{ cursor: HANDLE_CURSOR[h] }}>
          {/* larger invisible grab area */}
          <rect x={x - s * 1.25} y={y - s * 1.25} width={s * 2.5} height={s * 2.5} fill="transparent" />
          <rect x={x - s / 2} y={y - s / 2} width={s} height={s} rx={2 * k} fill="#fff" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  );
}

function ArrowHandles({ shape, k, color }: { shape: ShapeView; k: number; color: string }) {
  const p0 = shape.points[0] ?? [0, 0];
  const p1 = shape.points[shape.points.length - 1] ?? [0, 0];
  const ends: ["a0" | "a1", number, number][] = [
    ["a0", shape.x + p0[0], shape.y + p0[1]],
    ["a1", shape.x + p1[0], shape.y + p1[1]],
  ];
  return (
    <g>
      <line
        x1={ends[0][1]}
        y1={ends[0][2]}
        x2={ends[1][1]}
        y2={ends[1][2]}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      {ends.map(([h, x, y]) => (
        <g key={h} data-handle={h} data-shape={shape.id} style={{ cursor: "crosshair" }}>
          <circle cx={x} cy={y} r={11 * k} fill="transparent" />
          <circle cx={x} cy={y} r={5.5 * k} fill="#fff" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  );
}

function SizeChip({ box, k, color }: { box: Rect; k: number; color: string }) {
  const text = `${Math.round(box.w)} × ${Math.round(box.h)}`;
  const w = 14 + text.length * 6.4;
  return (
    <g transform={`translate(${box.x + box.w / 2} ${box.y + box.h}) scale(${k})`} pointerEvents="none">
      <g transform={`translate(${-w / 2} 12)`}>
        <rect width={w} height={18} rx={9} fill={color} />
        <text x={w / 2} y={12.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#fff" fontFamily="var(--font-geist-mono), monospace">
          {text}
        </text>
      </g>
    </g>
  );
}
