"use client";
/**
 * Other replicas, live: cursors with their letter, in-progress strokes / shapes, drag
 * previews (50%), selections in their thread dash pattern, and "B is typing…" markers.
 * Presence is ephemeral (never logged) and lives in its own 30 Hz store.
 */
import { memo } from "react";
import { useReducedMotion } from "motion/react";
import type { ReplicaId, ShapeView } from "@/lib/crdt/types";
import type { PresenceDrawing, PresenceState } from "@/lib/sync/protocol";
import { usePresence, useReplicaView, useSessionState } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { threadColor, threadDash } from "@/lib/ui/colors";
import { ShapeSvg } from "../ShapeSvg";
import { displayBounds, draftView, rectFrom, relativePoints, withProps } from "../shapeUtils";

interface Peer {
  id: ReplicaId;
  p: PresenceState;
  color: string;
  dash: string;
}

export const PresenceLayer = memo(function PresenceLayer({ cursorsOnly = false }: { cursorsOnly?: boolean }) {
  const presence = usePresence();
  const byId = useReplicaView((v) => v.shapeById);
  const zoom = useUi((s) => s.camera.zoom);
  const reduced = useReducedMotion() ?? false;
  const self = useSessionState((s) => s.replica);
  if (presence.size === 0) return null;
  const k = 1 / zoom;
  const peers: Peer[] = [];
  for (const [id, p] of presence) if (id !== self) peers.push({ id, p, color: threadColor(p.label), dash: threadDash(p.label) });

  return (
    <g data-layer="presence" pointerEvents="none" aria-hidden>
      {!cursorsOnly &&
        peers.map(({ id, p, color, dash }) => (
          <g key={`work-${id}`}>
            {p.selection.map((sid) => {
              const s = byId.get(sid);
              if (!s) return null;
              const moved = withProps(s, p.preview?.find((x) => x.shapeId === sid)?.props);
              return <RemoteOutline key={sid} shape={moved} color={color} dash={dash} label={p.label} k={k} />;
            })}
            {p.preview?.map(({ shapeId, props }) => {
              const s = byId.get(shapeId);
              return s ? <ShapeSvg key={shapeId} shape={withProps(s, props)} fade={0.5} /> : null;
            })}
            {p.drawing && <RemoteDrawing id={id} drawing={p.drawing} />}
            {p.editingText && byId.get(p.editingText) && <TypingMarker shape={byId.get(p.editingText)!} color={color} label={p.label} k={k} />}
          </g>
        ))}
      {peers.map(({ id, p, color }) =>
        p.cursor ? <Cursor key={`cur-${id}`} x={p.cursor.x} y={p.cursor.y} k={k} color={color} label={p.label} smooth={!reduced} /> : null,
      )}
    </g>
  );
});

function RemoteDrawing({ id, drawing }: { id: string; drawing: PresenceDrawing }) {
  const pts = drawing.points;
  if (pts.length === 0) return null;
  let view: ShapeView;
  switch (drawing.tool) {
    case "stroke":
      view = draftView(`remote-${id}`, "stroke", { points: pts, stroke: drawing.stroke, strokeWidth: drawing.strokeWidth });
      break;
    case "arrow": {
      const rel = relativePoints([pts[0], pts[pts.length - 1]]);
      const a = pts[0],
        b = pts[pts.length - 1];
      view = draftView(`remote-${id}`, "arrow", {
        ...rel,
        points: [
          [a[0] - rel.x, a[1] - rel.y],
          [b[0] - rel.x, b[1] - rel.y],
        ],
        stroke: drawing.stroke,
        strokeWidth: drawing.strokeWidth,
      });
      break;
    }
    default: {
      const a = pts[0],
        b = pts[pts.length - 1];
      view = draftView(`remote-${id}`, drawing.tool, {
        ...rectFrom(a[0], a[1], b[0], b[1]),
        stroke: drawing.stroke,
        fill: drawing.fill,
        strokeWidth: drawing.strokeWidth,
      });
    }
  }
  return <ShapeSvg shape={view} fade={0.55} />;
}

function RemoteOutline({ shape, color, dash, label, k }: { shape: ShapeView; color: string; dash: string; label: string; k: number }) {
  const b = displayBounds(shape);
  const pad = 6 * k;
  return (
    <g>
      <rect
        x={b.x - pad}
        y={b.y - pad}
        width={b.w + pad * 2}
        height={b.h + pad * 2}
        rx={6 * k}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeDasharray={dash || undefined}
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${b.x + b.w + pad} ${b.y + b.h + pad}) scale(${k})`}>
        <rect x={-15} y={2} width={15} height={13} rx={3.5} fill={color} />
        <text x={-7.5} y={11.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-mono), monospace">
          {label}
        </text>
      </g>
    </g>
  );
}

function TypingMarker({ shape, color, label, k }: { shape: ShapeView; color: string; label: string; k: number }) {
  const b = displayBounds(shape);
  const text = `${label} is typing…`;
  const w = 20 + text.length * 6;
  return (
    <g transform={`translate(${b.x} ${b.y}) scale(${k})`}>
      <g transform="translate(0 -26)">
        <rect width={w} height={20} rx={10} fill={color} />
        <circle cx={10} cy={10} r={3} fill="#fff" opacity={0.9} />
        <text x={18} y={14} fontSize={11} fontWeight={600} fill="#fff" fontFamily="var(--font-geist-sans), system-ui">
          {text}
        </text>
      </g>
    </g>
  );
}

function Cursor({ x, y, k, color, label, smooth }: { x: number; y: number; k: number; color: string; label: string; smooth: boolean }) {
  // CSS transform (not the attribute) so remote cursors glide between 30 Hz updates.
  return (
    <g style={{ transform: `translate(${x}px, ${y}px) scale(${k})`, transition: smooth ? "transform 90ms linear" : undefined }}>
      <path
        d="M 0 0 L 0 16.5 L 4.6 12.6 L 7.6 19.4 L 10.4 18.2 L 7.5 11.6 L 13.4 11.4 Z"
        fill={color}
        stroke="#fff"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <g transform="translate(13 17)">
        <rect width={18} height={16} rx={5} fill={color} stroke="#fff" strokeWidth={1.2} />
        <text x={9} y={11.8} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-mono), monospace">
          {label}
        </text>
      </g>
    </g>
  );
}
