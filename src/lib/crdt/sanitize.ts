/**
 * Op sanitising & validation. Every op that enters a log (local or remote) has finite numbers,
 * no -0, rounded coordinates and no undefined keys — so JSON and structured-clone transports
 * produce identical states.
 */
import type { Op, Point, ShapeProps, ShapeType } from "./types";
import { PROP_KEYS } from "./types";

export function num(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export function sanitizePoints(points: unknown): Point[] {
  if (!Array.isArray(points)) return [];
  const out: Point[] = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    out.push(p.length >= 3 && p[2] !== undefined ? [num(p[0]), num(p[1]), num(p[2])] : [num(p[0]), num(p[1])]);
  }
  return out;
}

const NUMERIC: ReadonlySet<keyof ShapeProps> = new Set(["x", "y", "w", "h", "strokeWidth", "opacity", "fontSize", "z"]);

export function sanitizeProps(props: Partial<Record<keyof ShapeProps, unknown>>): Partial<ShapeProps> {
  const out: Partial<Record<keyof ShapeProps, unknown>> = {};
  for (const k of PROP_KEYS) {
    const v = props[k];
    if (v === undefined) continue;
    if (k === "points") out.points = sanitizePoints(v);
    else if (NUMERIC.has(k)) out[k] = num(v);
    else out[k] = String(v);
  }
  return out as Partial<ShapeProps>;
}

const SHAPE_TYPES: ReadonlySet<ShapeType> = new Set(["stroke", "rect", "ellipse", "arrow", "sticky", "text"]);

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNat = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Structural validation of an op received from the wire. */
export function isValidOp(op: unknown): op is Op {
  if (!op || typeof op !== "object") return false;
  const o = op as Record<string, unknown>;
  if (!isStr(o.id) || !isStr(o.replica) || !isNat(o.counter) || (o.counter as number) < 1 || !isNat(o.lamport)) return false;
  if (o.id !== `${o.replica}:${o.counter}`) return false;
  if (!o.vc || typeof o.vc !== "object") return false;
  const vc = o.vc as Record<string, unknown>;
  if (vc[o.replica as string] !== o.counter) return false;
  for (const k in vc) if (!isNat(vc[k])) return false;
  const meta = o.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== "object" || !isStr(meta.txn) || typeof meta.cause !== "string") return false;
  switch (o.kind) {
    case "shape.create": {
      if (!isStr(o.shapeId) || !SHAPE_TYPES.has(o.shapeType as ShapeType)) return false;
      const p = o.props as Record<string, unknown> | undefined;
      if (!p || typeof p !== "object") return false;
      return PROP_KEYS.every((k) => p[k] !== undefined);
    }
    case "shape.update": {
      if (!isStr(o.shapeId) || !o.props || typeof o.props !== "object") return false;
      const p = o.props as Record<string, unknown>;
      const b = ["x", "y", "w", "h"].filter((k) => p[k] !== undefined).length;
      return b === 0 || b === 4; // bounds register is written whole
    }
    case "shape.delete":
      return isStr(o.shapeId);
    case "text.insert":
      return isStr(o.shapeId) && (o.after === null || isStr(o.after)) && typeof o.text === "string" && o.text.length > 0;
    case "text.delete":
    case "text.undelete":
      return isStr(o.shapeId) && Array.isArray(o.chars) && o.chars.every(isStr);
    case "snapshot.mark":
      return isStr(o.snapshotId) && typeof o.name === "string" && !!o.cut && typeof o.cut === "object";
    default:
      return false;
  }
}

/** Deep copy through JSON so the local copy of an op equals what any transport delivers. */
export function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
