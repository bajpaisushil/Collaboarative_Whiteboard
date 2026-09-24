"use client";
/**
 * Pure presentational SVG for one ShapeView in world coordinates (the parent applies the
 * camera transform). Shared by the live canvas, explainer filmstrips, loom previews and ghosts.
 */
import { memo } from "react";
import type { ReplicaId, ShapeView } from "@/lib/crdt/types";
import { arrowHead, freehandPath, shapeBounds, unionRects, type Rect } from "@/lib/ui/geometry";
import { displayShape, hasFill, INK, paint } from "./shapeUtils";
import { STICKY_PADDING, TEXT_FONT_STACK, TEXT_LINE_HEIGHT, TEXT_PADDING } from "./textLayout";

export interface ShapeSvgProps {
  shape: ShapeView;
  /** Tint text runs by author (X-ray mode). */
  authorship?: boolean;
  /** Resolve a replica to its thread colour (for authorship tints). */
  colorOf?: (replica: ReplicaId) => string;
  /** Render as a what-if ghost: dashed outline in `ghostColor`, translucent fill. */
  ghost?: boolean;
  ghostColor?: string;
  /** Hide text (e.g. while the text editor overlays this shape). */
  hideText?: boolean;
  /** Extra opacity multiplier (remote previews, drafts). Default 1. */
  fade?: number;
  /**
   * X-ray: wash the shape's own paint toward the paper so authorship tints and knots read
   * first. Pure paint (no filters), so it costs nothing while panning; text stays full ink.
   */
  muted?: boolean;
}

/** Paint mixed toward the paper — "desaturated" in both themes. */
function mute(color: string, keep = 52): string {
  return color === "none" ? color : `color-mix(in oklab, ${color} ${keep}%, var(--paper))`;
}

const STICKY_DEFAULT = "#ffe58a";

function TextBlock({
  shape,
  authorship,
  colorOf,
  color,
  padding,
  clip,
}: {
  shape: ShapeView;
  authorship?: boolean;
  colorOf?: (r: ReplicaId) => string;
  color: string;
  padding: number;
  clip: boolean;
}) {
  const b = shapeBounds(shape);
  const runs = shape.runs;
  return (
    <foreignObject x={b.x} y={b.y} width={Math.max(1, b.w)} height={Math.max(1, b.h)} style={{ overflow: "visible", pointerEvents: "none" }}>
      <div
        style={{
          padding,
          fontSize: shape.fontSize,
          lineHeight: TEXT_LINE_HEIGHT,
          color,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          wordBreak: "break-word",
          fontFamily: TEXT_FONT_STACK,
          width: "100%",
          height: "100%",
          overflow: clip ? "hidden" : "visible",
          boxSizing: "border-box",
        }}
      >
        {authorship && runs && colorOf
          ? runs.map((r, i) => (
              <span
                key={i}
                style={{
                  background: `color-mix(in oklab, ${colorOf(r.replica)} 22%, transparent)`,
                  boxShadow: `inset 0 -2px 0 ${colorOf(r.replica)}`,
                  borderRadius: 2,
                }}
              >
                {r.text}
              </span>
            ))
          : shape.text}
      </div>
    </foreignObject>
  );
}

function ShapeSvgImpl({ shape: raw, authorship, colorOf, ghost, ghostColor = "var(--knot)", hideText, fade = 1, muted = false }: ShapeSvgProps) {
  const s = displayShape(raw);
  const opacity = (ghost ? 0.9 : s.opacity) * fade;
  const dash = ghost ? "6 5" : undefined;
  const wash = muted && !ghost;
  const strokeColor = ghost ? ghostColor : wash ? mute(paint(s.stroke)) : paint(s.stroke);
  const rawFill = hasFill(s.fill) ? paint(s.fill) : "none";
  const fill = wash ? mute(rawFill) : rawFill;
  const ghostFill = ghost ? (fill === "none" ? "none" : `color-mix(in oklab, ${fill} 35%, transparent)`) : fill;

  switch (s.type) {
    case "stroke": {
      if (ghost) {
        const d = s.points.map((p, i) => `${i ? "L" : "M"} ${s.x + p[0]} ${s.y + p[1]}`).join(" ");
        return (
          <path
            d={d}
            fill="none"
            stroke={ghostColor}
            strokeWidth={Math.max(1.5, s.strokeWidth / 2)}
            strokeDasharray={dash}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={opacity}
          />
        );
      }
      return (
        <g transform={`translate(${s.x} ${s.y})`} opacity={opacity}>
          <path d={freehandPath(s.points, s.strokeWidth)} fill={strokeColor} />
        </g>
      );
    }
    case "rect":
      return (
        <rect
          x={Math.min(s.x, s.x + s.w)}
          y={Math.min(s.y, s.y + s.h)}
          width={Math.abs(s.w)}
          height={Math.abs(s.h)}
          rx={8}
          fill={ghostFill}
          stroke={strokeColor}
          strokeWidth={s.strokeWidth}
          strokeDasharray={dash}
          strokeLinejoin="round"
          opacity={opacity}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={s.x + s.w / 2}
          cy={s.y + s.h / 2}
          rx={Math.abs(s.w) / 2}
          ry={Math.abs(s.h) / 2}
          fill={ghostFill}
          stroke={strokeColor}
          strokeWidth={s.strokeWidth}
          strokeDasharray={dash}
          opacity={opacity}
        />
      );
    case "arrow": {
      const [p0, p1] = [s.points[0] ?? [0, 0], s.points[s.points.length - 1] ?? [0, 0]];
      const x1 = s.x + p0[0],
        y1 = s.y + p0[1],
        x2 = s.x + p1[0],
        y2 = s.y + p1[1];
      const head = Math.max(10, s.strokeWidth * 3.2);
      // Stop the shaft short of the tip so the round cap doesn't poke through the head.
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = len > head ? (len - head * 0.6) / len : 1;
      return (
        <g opacity={opacity}>
          <line
            x1={x1}
            y1={y1}
            x2={x1 + (x2 - x1) * k}
            y2={y1 + (y2 - y1) * k}
            stroke={strokeColor}
            strokeWidth={s.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
          <polygon points={arrowHead(x1, y1, x2, y2, head)} fill={strokeColor} stroke={strokeColor} strokeWidth={1} strokeLinejoin="round" />
        </g>
      );
    }
    case "sticky": {
      const b = shapeBounds(s);
      // Sticky paper keeps more of its colour: its ink text must stay readable on navy too.
      const paper = wash ? mute(rawFill === "none" ? STICKY_DEFAULT : rawFill, 74) : rawFill === "none" ? STICKY_DEFAULT : rawFill;
      return (
        <g opacity={opacity}>
          {!ghost && <rect x={b.x + 1.5} y={b.y + 4} width={b.w} height={b.h} rx={6} fill="#0000001c" />}
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={6}
            fill={ghost ? ghostFill : paper}
            stroke={ghost ? ghostColor : "#00000014"}
            strokeWidth={ghost ? 2 : 1}
            strokeDasharray={dash}
          />
          {!ghost && b.h > 22 && (
            // The adhesive strip: a slightly deeper band along the top edge.
            <rect x={b.x} y={b.y} width={b.w} height={Math.min(10, b.h * 0.08)} rx={6} fill="#0000000d" />
          )}
          {!hideText && <TextBlock shape={s} authorship={authorship} colorOf={colorOf} color={INK} padding={STICKY_PADDING} clip />}
        </g>
      );
    }
    case "text": {
      const b = shapeBounds(s);
      // An empty text box would be invisible: show a faint dashed placeholder instead.
      const placeholder = !ghost && !hideText && s.text.length === 0;
      return (
        <g opacity={opacity}>
          {ghost && <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={ghostColor} strokeDasharray={dash} rx={4} />}
          {placeholder && (
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="var(--line-2)" strokeDasharray="4 4" rx={4} vectorEffect="non-scaling-stroke" />
          )}
          {!hideText && (
            <TextBlock shape={s} authorship={authorship} colorOf={colorOf} color={ghost ? ghostColor : paint(s.stroke)} padding={TEXT_PADDING} clip={false} />
          )}
        </g>
      );
    }
  }
}

export const ShapeSvg = memo(ShapeSvgImpl);

/**
 * Standalone thumbnail of a set of shapes (filmstrips, snapshot previews).
 * `focus` limits the viewBox to those shape ids (plus padding) if given.
 */
export function ShapesThumb({
  shapes,
  width,
  height,
  focus,
  padding = 24,
  authorship,
  colorOf,
  className,
  background = "var(--paper)",
}: {
  shapes: ShapeView[];
  width: number | string;
  height: number | string;
  focus?: Rect | null;
  padding?: number;
  authorship?: boolean;
  colorOf?: (r: ReplicaId) => string;
  className?: string;
  background?: string;
}) {
  const box = focus ?? unionRects(shapes.map((s) => shapeBounds(displayShape(s)))) ?? { x: 0, y: 0, w: 100, h: 60 };
  const vb = `${box.x - padding} ${box.y - padding} ${Math.max(1, box.w) + padding * 2} ${Math.max(1, box.h) + padding * 2}`;
  return (
    <svg viewBox={vb} width={width} height={height} className={className} preserveAspectRatio="xMidYMid meet" style={{ background }} role="img" aria-label="Board preview">
      {shapes.map((s) => (
        <ShapeSvg key={s.id} shape={s} authorship={authorship} colorOf={colorOf} />
      ))}
    </svg>
  );
}
