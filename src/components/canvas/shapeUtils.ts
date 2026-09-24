/**
 * Small pure helpers shared by the canvas layers, the gesture controller and the dock.
 */
import type { Point, ShapeId, ShapeProps, ShapeType, ShapeView } from "@/lib/crdt/types";
import { shapeNoun } from "@/lib/crdt/describe";
import { hitTest, shapeBounds, type Rect } from "@/lib/ui/geometry";
import { measuredTextHeight, TEXT_PADDING } from "./textLayout";

/** The "ink" swatch adapts to the theme (dark ink on paper, light ink on the navy loom). */
export const INK = "#1d1b16";

/** Map a stored colour to a paint value; ink follows the theme. */
export function paint(color: string): string {
  return color.toLowerCase() === INK ? "var(--ink)" : color;
}

export const NO_FILL = new Set(["none", "transparent", ""]);

export function hasFill(fill: string): boolean {
  return !NO_FILL.has(fill);
}

export const RESIZABLE: ReadonlySet<ShapeType> = new Set<ShapeType>(["rect", "ellipse", "sticky", "text"]);
export const FILLABLE: ReadonlySet<ShapeType> = new Set<ShapeType>(["rect", "ellipse", "sticky"]);
export const STROKED: ReadonlySet<ShapeType> = new Set<ShapeType>(["stroke", "arrow", "text", "rect", "ellipse"]);
export const WIDTHED: ReadonlySet<ShapeType> = new Set<ShapeType>(["stroke", "arrow", "rect", "ellipse"]);

export const PROP_DEFAULTS: ShapeProps = {
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  points: [],
  stroke: INK,
  fill: "none",
  strokeWidth: 4,
  opacity: 1,
  fontSize: 20,
  z: 0,
};

/** A throwaway ShapeView for drafts, remote previews and ghosts (never stored). */
export function draftView(id: string, type: ShapeType, props: Partial<ShapeProps>, text = ""): ShapeView {
  return { ...PROP_DEFAULTS, ...props, id, type, text, createdBy: "", lastEditedBy: "", alive: true };
}

/** Every ShapeProps key of a view, for duplicating. */
export function propsOf(s: ShapeView): ShapeProps {
  return {
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    points: s.points,
    stroke: s.stroke,
    fill: s.fill,
    strokeWidth: s.strokeWidth,
    opacity: s.opacity,
    fontSize: s.fontSize,
    z: s.z,
  };
}

const heightCache = new WeakMap<ShapeView, ShapeView>();

/**
 * The shape as displayed: a `text` shape grows to fit its content (its stored h is only a
 * minimum). Cached per view identity, so it is free for unchanged shapes.
 */
export function displayShape(s: ShapeView): ShapeView {
  if (s.type !== "text") return s;
  const hit = heightCache.get(s);
  if (hit) return hit;
  const w = Math.abs(s.w);
  const need = measuredTextHeight(s.text, s.fontSize, w, TEXT_PADDING);
  const out = need > Math.abs(s.h) ? { ...s, h: need } : s;
  heightCache.set(s, out);
  return out;
}

export function displayBounds(s: ShapeView): Rect {
  return shapeBounds(displayShape(s));
}

export function hitShape(s: ShapeView, x: number, y: number, tol: number): boolean {
  return hitTest(displayShape(s), x, y, tol);
}

/** Topmost shape under a world point. */
export function topmostAt(shapes: readonly ShapeView[], x: number, y: number, tol: number): ShapeView | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hitShape(shapes[i], x, y, tol)) return shapes[i];
  }
  return null;
}

export function maxZ(shapes: readonly ShapeView[]): number {
  let z = -Infinity;
  for (const s of shapes) if (s.z > z) z = s.z;
  return Number.isFinite(z) ? z : 0;
}

export function minZ(shapes: readonly ShapeView[]): number {
  let z = Infinity;
  for (const s of shapes) if (s.z < z) z = s.z;
  return Number.isFinite(z) ? z : 0;
}

/** "sticky note" for one, "3 shapes" for many (or "3 sticky notes" when uniform). */
export function countNoun(shapes: readonly Pick<ShapeView, "type">[]): string {
  if (shapes.length === 1) return shapeNoun(shapes[0].type);
  const types = new Set(shapes.map((s) => s.type));
  if (types.size === 1) return `${shapes.length} ${pluralNoun(shapes[0].type)}`;
  return `${shapes.length} shapes`;
}

function pluralNoun(t: ShapeType): string {
  const n = shapeNoun(t);
  return n === "text" ? "texts" : n.endsWith("s") ? n : `${n}s`;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function centerOf(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Normalised rect from two corners. */
export function rectFrom(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** Relative-to-origin arrow/stroke props for world points. */
export function relativePoints(world: readonly Point[]): { x: number; y: number; w: number; h: number; points: Point[] } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of world) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const ox = round2(minX),
    oy = round2(minY);
  const points: Point[] = world.map((p) =>
    p.length === 3 ? ([round2(p[0] - ox), round2(p[1] - oy), round2(p[2])] as const) : ([round2(p[0] - ox), round2(p[1] - oy)] as const),
  );
  return { x: ox, y: oy, w: round2(maxX - minX), h: round2(maxY - minY), points };
}

/** Merge preview props onto a view (identity kept when nothing changes). */
export function withProps(s: ShapeView, props: Partial<ShapeProps> | undefined): ShapeView {
  if (!props) return s;
  return { ...s, ...props };
}

export function isAlive(id: ShapeId, byId: ReadonlyMap<ShapeId, ShapeView>): boolean {
  return byId.has(id);
}
