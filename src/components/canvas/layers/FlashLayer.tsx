"use client";
/**
 * Merge choreography: after a reconnect, changed shapes pulse in their author's thread
 * colour; resurrected shapes fade in from a dashed tombstone outline with a "revived" tag.
 */
import { memo, useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import type { ShapeId, ShapeView } from "@/lib/crdt/types";
import { useReplicaView } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { displayBounds } from "../shapeUtils";
import { useThreads } from "../useThreads";

const DURATION = 1.5;
const NONE: ShapeId[] = [];

export const FlashLayer = memo(function FlashLayer() {
  const flash = useUi((s) => s.flash);
  const zoom = useUi((s) => s.camera.zoom);
  const reduced = useReducedMotion() ?? false;
  const threads = useThreads();
  const [doneAt, setDoneAt] = useState<number | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setDoneAt(flash.at), DURATION * 1000 + 250);
    return () => clearTimeout(t);
  }, [flash]);

  const active = flash && doneAt !== flash.at ? flash : null;
  const revived = active ? active.revived : NONE;
  const changed = active ? active.shapeIds.filter((id) => !revived.includes(id)) : NONE;
  const shapes = useReplicaView(useShallow((v) => [...changed, ...revived].map((id) => v.shapeById.get(id) ?? null)));

  if (!active) return null;
  const k = 1 / zoom;
  return (
    <g data-layer="flash" pointerEvents="none" aria-hidden>
      {shapes.map((s, i) => {
        if (!s) return null;
        const isRevived = i >= changed.length;
        const key = `${active.at}:${s.id}`;
        return isRevived ? (
          <Revived key={key} shape={s} k={k} reduced={reduced} />
        ) : (
          <Pulse key={key} shape={s} k={k} reduced={reduced} color={threads(s.lastEditedBy).color} />
        );
      })}
    </g>
  );
});

function Pulse({ shape, k, reduced, color }: { shape: ShapeView; k: number; reduced: boolean; color: string }) {
  const b = displayBounds(shape);
  const pad = 6 * k;
  const common = {
    x: b.x - pad,
    y: b.y - pad,
    width: b.w + pad * 2,
    height: b.h + pad * 2,
    rx: 8 * k,
    fill: `color-mix(in oklab, ${color} 10%, transparent)`,
    stroke: color,
    strokeWidth: 2.5,
    vectorEffect: "non-scaling-stroke" as const,
  };
  if (reduced) return <rect {...common} opacity={0.9} />;
  return (
    <motion.rect
      {...common}
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: [0, 1, 0.85, 0], scale: [0.94, 1.03, 1, 1.02] }}
      transition={{ duration: DURATION, times: [0, 0.18, 0.6, 1], ease: "easeOut" }}
    />
  );
}

function Revived({ shape, k, reduced }: { shape: ShapeView; k: number; reduced: boolean }) {
  const b = displayBounds(shape);
  const pad = 5 * k;
  const outline = (
    <rect
      x={b.x - pad}
      y={b.y - pad}
      width={b.w + pad * 2}
      height={b.h + pad * 2}
      rx={8 * k}
      fill="none"
      stroke="var(--ok)"
      strokeWidth={1.75}
      strokeDasharray="5 4"
      vectorEffect="non-scaling-stroke"
    />
  );
  const tag = (
    <g transform={`translate(${b.x - pad} ${b.y - pad}) scale(${k})`}>
      <g transform="translate(0 -22)">
        <rect width={58} height={17} rx={8.5} fill="var(--ok)" />
        <text x={29} y={12} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff" fontFamily="var(--font-geist-sans), system-ui">
          revived
        </text>
      </g>
    </g>
  );
  if (reduced) {
    return (
      <g>
        {outline}
        {tag}
      </g>
    );
  }
  return (
    <g>
      {/* A paper veil lifts off the shape: it "materialises" out of its tombstone outline. */}
      <motion.rect
        x={b.x - 1}
        y={b.y - 1}
        width={b.w + 2}
        height={b.h + 2}
        rx={6 * k}
        fill="var(--paper)"
        initial={{ opacity: 0.92 }}
        animate={{ opacity: 0 }}
        transition={{ duration: DURATION * 0.7, ease: "easeOut", delay: 0.15 }}
      />
      <motion.g initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ duration: DURATION + 0.2, times: [0, 0.7, 1] }}>
        {outline}
        {tag}
      </motion.g>
    </g>
  );
}
