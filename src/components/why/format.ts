/**
 * Small, pure formatting helpers for the Why panel. Engine copy (question, answer, steps…)
 * is rendered as-is; these only format values, stamps and times around it.
 */
import { colorName, propsNoun } from "@/lib/crdt/describe";
import type { OpCause, PropKey, ShapeProps, ShapeType, VectorClock } from "@/lib/crdt/types";

const PRIORITY: PropKey[] = ["fill", "stroke", "x", "w", "points", "strokeWidth", "fontSize", "opacity", "z"];

export function leadProp(props: readonly PropKey[]): PropKey | null {
  for (const p of PRIORITY) if (props.includes(p)) return p;
  return props[0] ?? null;
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Colour", "Position & size", "Line width"… */
export function propsTitle(props: readonly PropKey[]): string {
  return capital(propsNoun(props));
}

const r = (n: number | undefined) => Math.round(n ?? 0);

/**
 * A short noun phrase for the value a side wrote: "teal", "move", "resize", "8px line"…
 * Used in headlines ("B's teal beat A's vermilion").
 */
export function valueWord(values: Partial<ShapeProps> | null | undefined, props: readonly PropKey[]): string {
  const p = leadProp(props);
  if (!p) return "edit";
  const v = values ? (values as Partial<Record<PropKey, unknown>>)[p] : undefined;
  switch (p) {
    case "fill":
    case "stroke":
      return typeof v === "string" ? colorName(v) : "colour";
    case "x":
    case "y":
      return props.includes("w") || props.includes("h") ? "placement" : "move";
    case "w":
    case "h":
      return "resize";
    case "points":
      return "path";
    case "strokeWidth":
      return typeof v === "number" ? `${v}px line` : "line width";
    case "fontSize":
      return typeof v === "number" ? `${v}px text` : "text size";
    case "opacity":
      return typeof v === "number" ? `${Math.round(v * 100)}% opacity` : "opacity";
    case "z":
      return "stacking";
  }
}

/** A precise, readable value: "teal", "(340, 120)", "200×120", "(340, 120) · 200×120"… */
export function valueDetail(values: Partial<ShapeProps> | null | undefined, props: readonly PropKey[], type?: ShapeType): string {
  if (!values) return "—";
  const parts: string[] = [];
  const set = new Set(props);
  const pos = set.has("x") || set.has("y");
  const size = (set.has("w") || set.has("h")) && type !== "stroke" && type !== "arrow";
  if (pos) parts.push(`(${r(values.x)}, ${r(values.y)})`);
  if (size) parts.push(`${r(Math.abs(values.w ?? 0))}×${r(Math.abs(values.h ?? 0))}`);
  if (set.has("fill") && values.fill !== undefined) parts.push(colorName(values.fill));
  if (set.has("stroke") && values.stroke !== undefined) parts.push(colorName(values.stroke));
  if (set.has("points") && values.points !== undefined) parts.push(`${values.points.length}-point path`);
  if (set.has("strokeWidth") && values.strokeWidth !== undefined) parts.push(`${values.strokeWidth}px line`);
  if (set.has("opacity") && values.opacity !== undefined) parts.push(`${Math.round(values.opacity * 100)}% opacity`);
  if (set.has("fontSize") && values.fontSize !== undefined) parts.push(`${values.fontSize}px text`);
  if (set.has("z") && values.z !== undefined) parts.push(`layer ${Math.round(values.z * 100) / 100}`);
  return parts.join(" · ") || "—";
}

/** The colour swatch to show next to a value, if the lead prop is a colour. */
export function valueSwatch(values: Partial<ShapeProps> | null | undefined, props: readonly PropKey[]): string | null {
  if (!values) return null;
  const p = leadProp(props);
  if (p === "fill" && typeof values.fill === "string") return values.fill;
  if (p === "stroke" && typeof values.stroke === "string") return values.stroke;
  return null;
}

/** "14:03:22" (local). */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "3.2 s", "1 min 12 s" — for wall-clock gaps. */
export function gap(ms: number): string {
  const a = Math.abs(ms);
  if (a < 1000) return `${a} ms`;
  if (a < 60_000) return `${(a / 1000).toFixed(a < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(a / 60_000);
  const s = Math.round((a % 60_000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** "{A:6, B:3}" with display labels, sorted by label. */
export function formatVc(vc: VectorClock, labelOf: (replica: string) => string): string {
  const keys = Object.keys(vc).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  return "{" + keys.map((k) => `${labelOf(k)}:${vc[k]}`).join(", ") + "}";
}

const CAUSE_WORD: Record<OpCause, string> = {
  user: "a normal edit",
  undo: "an undo",
  redo: "a redo",
  "snapshot-restore": "a snapshot restore",
  adopt: "a manual pick in the explainer",
  system: "the system",
};

export function causeWord(cause: OpCause): string {
  return CAUSE_WORD[cause];
}

/** "1 shape", "3 shapes". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Quote user text for display: “hello”, with newlines shown and long text shortened. */
export function quoted(text: string, max = 28): string {
  const t = text.replace(/\n/g, "⏎");
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
}
