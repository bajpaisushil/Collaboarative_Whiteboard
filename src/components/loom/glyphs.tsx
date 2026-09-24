"use client";
/**
 * SVG glyphs of the Loom's visual language, shared by the space-time diagram and its legend:
 * op dots (shape encodes the kind, fill encodes online/offline, a halo means "not yet seen by
 * every tab"), knots and snapshot flags.
 */
import type { OpKind } from "@/lib/crdt/types";

export interface OpGlyphProps {
  kind: OpKind;
  x: number;
  y: number;
  r: number;
  color: string;
  /** Pattern fill for ops made offline (hatched). */
  hatch?: string | null;
  stable: boolean;
  opacity?: number;
}

/** create = larger dot · update = dot · delete = square · text = pill. */
export function OpGlyph({ kind, x, y, r, color, hatch, stable, opacity }: OpGlyphProps) {
  const fill = hatch ?? color;
  const stroke = hatch ? color : "var(--panel)";
  const sw = hatch ? 1.3 : 1;
  let body;
  switch (kind) {
    case "shape.create":
      body = <circle cx={x} cy={y} r={r + 0.8} fill={fill} stroke={stroke} strokeWidth={sw} />;
      break;
    case "shape.delete": {
      const s = r * 1.7;
      body = <rect x={x - s / 2} y={y - s / 2} width={s} height={s} rx={1.4} fill={fill} stroke={stroke} strokeWidth={sw} />;
      break;
    }
    case "text.insert":
    case "text.delete":
    case "text.undelete": {
      const w = r * 2 + 3;
      const h = r * 1.6;
      body = <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} />;
      break;
    }
    default:
      body = <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />;
  }
  return (
    <g opacity={opacity}>
      {!stable && <circle cx={x} cy={y} r={r + 3.6} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1.3} />}
      {body}
    </g>
  );
}

/** ◆ knot. `variant`: live (solid), benign/settled (hollow). */
export function KnotGlyph({ x, y, s, variant, focused }: { x: number; y: number; s: number; variant: "live" | "benign" | "settled"; focused?: boolean }) {
  const d = `M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z`;
  return (
    <g>
      {focused && <circle cx={x} cy={y} r={s + 4.5} fill="var(--knot-soft)" stroke="var(--knot)" strokeWidth={1.4} />}
      <path
        d={d}
        fill={variant === "live" ? "var(--knot)" : "var(--panel)"}
        stroke={variant === "settled" ? "var(--muted)" : "var(--knot)"}
        strokeWidth={variant === "live" ? 1 : 1.4}
        strokeLinejoin="round"
      />
    </g>
  );
}

/** Snapshot flag planted at (x, y) (the pole's foot). */
export function FlagGlyph({ x, y, h, color }: { x: number; y: number; h: number; color: string }) {
  return (
    <g>
      <line x1={x} x2={x} y1={y} y2={y - h} stroke="var(--ink-2)" strokeWidth={1.3} strokeLinecap="round" />
      <path d={`M${x} ${y - h}L${x + 10} ${y - h + 3.5}L${x} ${y - h + 7}Z`} fill={color} stroke="var(--panel)" strokeWidth={0.9} strokeLinejoin="round" />
    </g>
  );
}

/** Diagonal hatch pattern definition (reference with `url(#id)`). */
export function HatchPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={4} height={4} fill="var(--panel)" />
      <rect width={4} height={4} fill={color} fillOpacity={0.12} />
      <line x1={0} y1={0} x2={0} y2={4} stroke={color} strokeWidth={1.7} />
    </pattern>
  );
}

/** Lighter hatch for background bands (offline stretches on a lane). */
export function BandPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={5} height={5} fill={color} fillOpacity={0.05} />
      <line x1={0} y1={0} x2={0} y2={5} stroke={color} strokeOpacity={0.3} strokeWidth={1.4} />
    </pattern>
  );
}
