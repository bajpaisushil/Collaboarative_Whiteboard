/**
 * Plain-language descriptions of ops, props and shapes. Pure; shared by the explainer
 * (engine) and the UI (log table, conflict cards, toasts).
 */
import type { Op, PropKey, ShapeProps, ShapeType } from "./types";

const COLOR_NAMES: Record<string, string> = {
  "#1d1b16": "ink",
  "#e4572e": "vermilion",
  "#d99100": "amber",
  "#1b998b": "teal",
  "#4f5ddb": "indigo",
  "#c2185b": "magenta",
  "#5b8c3a": "moss",
  "#8a8475": "stone",
  "#ffe58a": "butter yellow",
  "#ffc2a8": "peach",
  "#b8ecd9": "mint",
  "#bcd4ff": "sky blue",
  "#f3c1e3": "pink",
  "#e6e0d2": "linen",
  "#ffffff": "white",
  "#000000": "black",
  none: "no fill",
  transparent: "no fill",
};

export function colorName(c: string): string {
  return COLOR_NAMES[c.toLowerCase()] ?? c;
}

export function shapeNoun(type: ShapeType): string {
  switch (type) {
    case "stroke":
      return "drawing";
    case "rect":
      return "rectangle";
    case "ellipse":
      return "ellipse";
    case "arrow":
      return "arrow";
    case "sticky":
      return "sticky note";
    case "text":
      return "text";
  }
}

const r = (n: number) => Math.round(n);

/** "moved to (340, 120)", "recoloured to teal", "resized to 200×120"… */
export function describeProps(props: Partial<ShapeProps>, type?: ShapeType): string {
  const parts: string[] = [];
  const hasPos = props.x !== undefined || props.y !== undefined;
  const hasSize = props.w !== undefined || props.h !== undefined;
  if (hasPos && hasSize && type !== "stroke" && type !== "arrow") {
    parts.push(`set bounds to (${r(props.x ?? 0)}, ${r(props.y ?? 0)}) ${r(Math.abs(props.w ?? 0))}×${r(Math.abs(props.h ?? 0))}`);
  } else {
    if (hasPos) parts.push(`moved to (${r(props.x ?? 0)}, ${r(props.y ?? 0)})`);
    if (hasSize && type !== "stroke" && type !== "arrow") parts.push(`resized to ${r(Math.abs(props.w ?? 0))}×${r(Math.abs(props.h ?? 0))}`);
  }
  if (props.points !== undefined) parts.push(type === "arrow" ? "re-aimed the arrow" : "reshaped the path");
  if (props.fill !== undefined) parts.push(type === "sticky" ? `made it ${colorName(props.fill)}` : `filled it ${colorName(props.fill)}`);
  if (props.stroke !== undefined) parts.push(type === "text" ? `coloured the text ${colorName(props.stroke)}` : `outlined it ${colorName(props.stroke)}`);
  if (props.strokeWidth !== undefined) parts.push(`set line width ${props.strokeWidth}`);
  if (props.opacity !== undefined) parts.push(`set opacity ${Math.round(props.opacity * 100)}%`);
  if (props.fontSize !== undefined) parts.push(`set font size ${props.fontSize}`);
  if (props.z !== undefined) parts.push("changed its stacking order");
  if (parts.length === 0) return "touched it (keep-alive)";
  return parts.join(", ");
}

/** Human noun for a set of props: "position", "colour", "size"… */
export function propsNoun(props: readonly PropKey[]): string {
  const set = new Set(props);
  const names: string[] = [];
  if (set.has("x") || set.has("y") || set.has("w") || set.has("h")) {
    const pos = set.has("x") || set.has("y");
    const size = set.has("w") || set.has("h");
    names.push(pos && size ? "position & size" : pos ? "position" : "size");
  }
  if (set.has("fill")) names.push("colour");
  if (set.has("stroke")) names.push("outline colour");
  if (set.has("points")) names.push("path");
  if (set.has("strokeWidth")) names.push("line width");
  if (set.has("opacity")) names.push("opacity");
  if (set.has("fontSize")) names.push("font size");
  if (set.has("z")) names.push("stacking order");
  return names.join(", ") || "properties";
}

function quote(text: string, max = 24): string {
  const t = text.replace(/\n/g, "⏎");
  return `“${t.length > max ? t.slice(0, max - 1) + "…" : t}”`;
}

/** One-line summary of an op, e.g. "moved the sticky note to (340, 120)". */
export function describeOp(op: Op, shapeType?: ShapeType): string {
  const noun = shapeType ? shapeNoun(shapeType) : "shape";
  switch (op.kind) {
    case "shape.create": {
      const n = shapeNoun(op.shapeType);
      return `created ${/^[aeiou]/.test(n) ? "an" : "a"} ${n}`;
    }
    case "shape.update":
      return Object.keys(op.props).length === 0 ? `restored the ${noun}` : `${describeProps(op.props, shapeType)}`;
    case "shape.delete":
      return `deleted the ${noun}`;
    case "text.insert":
      return `typed ${quote(op.text)}`;
    case "text.delete":
      return `deleted ${op.chars.length} character${op.chars.length === 1 ? "" : "s"}`;
    case "text.undelete":
      return `restored ${op.chars.length} character${op.chars.length === 1 ? "" : "s"}`;
    case "snapshot.mark":
      return `took snapshot ${quote(op.name, 32)}`;
  }
}

export function kindLabel(op: Op): string {
  switch (op.kind) {
    case "shape.create":
      return "create";
    case "shape.update":
      return "update";
    case "shape.delete":
      return "delete";
    case "text.insert":
      return "type";
    case "text.delete":
      return "erase text";
    case "text.undelete":
      return "restore text";
    case "snapshot.mark":
      return "snapshot";
  }
}
