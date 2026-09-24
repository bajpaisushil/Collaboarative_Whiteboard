/**
 * Pure geometry helpers shared by the canvas, thumbnails and hit-testing.
 */
import { getStroke } from "perfect-freehand";
import type { Point, ShapeView } from "../crdt/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const strokePathCache = new WeakMap<readonly Point[], Map<number, string>>();

/** SVG path (filled outline) for a freehand stroke; cached per points array identity. */
export function freehandPath(points: readonly Point[], size: number): string {
  let bySize = strokePathCache.get(points);
  if (!bySize) {
    bySize = new Map();
    strokePathCache.set(points, bySize);
  }
  const hit = bySize.get(size);
  if (hit) return hit;
  const outline = getStroke(points as unknown as number[][], {
    size: Math.max(1, size * 1.6),
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: points.length > 0 && points[0].length < 3,
    last: true,
  });
  const d = outlineToPath(outline);
  bySize.set(size, d);
  return d;
}

function outlineToPath(pts: number[][]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) {
    const [x, y] = pts[0];
    return `M ${x} ${y} l 0.01 0`;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  let d = `M ${r(pts[0][0])} ${r(pts[0][1])} Q`;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    d += ` ${r(x0)} ${r(y0)} ${r((x0 + x1) / 2)} ${r((y0 + y1) / 2)}`;
  }
  return d + " Z";
}

/** Bounding box of relative points. */
export function pointsBounds(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** World-space bounding box of a shape (strokes/arrows derive it from points). */
export function shapeBounds(s: Pick<ShapeView, "type" | "x" | "y" | "w" | "h" | "points" | "strokeWidth">): Rect {
  if (s.type === "stroke" || s.type === "arrow") {
    const b = pointsBounds(s.points);
    const pad = s.strokeWidth;
    return { x: s.x + b.x - pad, y: s.y + b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContains(r: Rect, x: number, y: number, pad = 0): boolean {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Precise hit test in world coordinates with a tolerance (in world units). */
export function hitTest(s: ShapeView, x: number, y: number, tol: number): boolean {
  const b = shapeBounds(s);
  if (!rectContains(b, x, y, tol)) return false;
  switch (s.type) {
    case "stroke":
    case "arrow": {
      const pts = s.points;
      const reach = tol + s.strokeWidth / 2 + 2;
      if (pts.length === 1) return Math.hypot(x - (s.x + pts[0][0]), y - (s.y + pts[0][1])) <= reach;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(x, y, s.x + pts[i - 1][0], s.y + pts[i - 1][1], s.x + pts[i][0], s.y + pts[i][1]) <= reach)
          return true;
      }
      return false;
    }
    case "ellipse": {
      const rx = Math.abs(s.w) / 2 + tol,
        ry = Math.abs(s.h) / 2 + tol;
      const cx = b.x + b.w / 2,
        cy = b.y + b.h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const v = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      const filled = s.fill !== "none" && s.fill !== "transparent";
      if (filled) return v <= 1;
      const rxi = Math.max(0, rx - tol * 2 - s.strokeWidth),
        ryi = Math.max(0, ry - tol * 2 - s.strokeWidth);
      const vi = rxi > 0 && ryi > 0 ? ((x - cx) / rxi) ** 2 + ((y - cy) / ryi) ** 2 : 2;
      return v <= 1 && vi >= 1;
    }
    case "rect": {
      const filled = s.fill !== "none" && s.fill !== "transparent";
      if (filled) return true;
      const inner = { x: b.x + tol + s.strokeWidth, y: b.y + tol + s.strokeWidth, w: b.w - 2 * (tol + s.strokeWidth), h: b.h - 2 * (tol + s.strokeWidth) };
      return !(inner.w > 0 && inner.h > 0 && rectContains(inner, x, y));
    }
    default:
      return true;
  }
}

/** Arrowhead polygon points for an arrow from (x1,y1) to (x2,y2). */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a1 = ang + Math.PI - 0.45,
    a2 = ang + Math.PI + 0.45;
  const p1 = [x2 + Math.cos(a1) * size, y2 + Math.sin(a1) * size];
  const p2 = [x2 + Math.cos(a2) * size, y2 + Math.sin(a2) * size];
  return `${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`;
}

/** Ramer–Douglas–Peucker simplification (keeps pressure). */
export function simplifyPoints(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0,
      idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i][0], points[i][1], points[s][0], points[s][1], points[e][0], points[e][1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
