/**
 * One-line, plain-language summaries of a conflict for knot badges and tooltips:
 * "Colour: B's teal beat A's vermilion". The explainer panel carries the full story.
 */
import type { Conflict, Op, OpId, PropKey, ReplicaId } from "@/lib/crdt/types";
import { colorName, propsNoun, shapeNoun } from "@/lib/crdt/describe";
import type { Thread } from "./useThreads";

export type Segment = string | { thread: Thread };

const PRIORITY: PropKey[] = ["fill", "stroke", "x", "w", "points", "strokeWidth", "fontSize", "opacity", "z"];

function leadProp(props: readonly PropKey[]): PropKey | null {
  for (const p of PRIORITY) if (props.includes(p)) return p;
  return props[0] ?? null;
}

function wrote(op: Op | undefined, prop: PropKey): unknown {
  if (!op) return undefined;
  if (op.kind === "shape.update" || op.kind === "shape.create") return (op.props as Partial<Record<PropKey, unknown>>)[prop];
  return undefined;
}

/** A short noun phrase for the value an op wrote: "teal", "move", "8px line"… */
function valueWord(op: Op | undefined, props: readonly PropKey[]): string {
  const p = leadProp(props);
  if (!p) return "edit";
  const v = wrote(op, p);
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

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface KnotSummary {
  segments: Segment[];
  /** Same sentence as plain text (aria-label, title). */
  text: string;
}

export function knotSummary(c: Conflict, getOp: (id: OpId) => Op | undefined, threadOf: (r: ReplicaId) => Thread): KnotSummary {
  const segs: Segment[] = [];
  const t = (r: ReplicaId | undefined) => threadOf(r ?? "");
  switch (c.kind) {
    case "concurrent-write": {
      const [wId, lId] = c.ops;
      const wOp = getOp(wId),
        lOp = getOp(lId);
      const W = t(wOp?.replica ?? c.replicas[0]),
        L = t(lOp?.replica ?? c.replicas[1]);
      const noun = capital(propsNoun(c.props));
      if (c.valuesEqual) {
        segs.push(`${noun}: `, { thread: W }, " and ", { thread: L }, " made the same change — no visible difference");
      } else {
        segs.push(`${noun}: `, { thread: W }, `'s ${valueWord(wOp, c.props)} beat `, { thread: L }, `'s ${valueWord(lOp, c.props)}`);
      }
      break;
    }
    case "delete-vs-edit": {
      const [editId, delId] = c.winner === c.ops[1] ? [c.ops[1], c.ops[0]] : [c.ops[0], c.ops[1]];
      const E = t(getOp(editId)?.replica),
        D = t(getOp(delId)?.replica);
      segs.push({ thread: D }, ` deleted this ${shapeNoun(c.shapeType)} while `, { thread: E }, " was editing it — the edit kept it alive");
      break;
    }
    case "concurrent-text": {
      const seen = new Set<string>();
      const who: Thread[] = [];
      for (const r of c.replicas) {
        const th = t(r);
        if (seen.has(th.label)) continue;
        seen.add(th.label);
        who.push(th);
      }
      segs.push("Text: ");
      who.forEach((th, i) => {
        if (i > 0) segs.push(i === who.length - 1 ? " and " : ", ");
        segs.push({ thread: th });
      });
      segs.push(" typed here at the same time — both kept, woven together");
      break;
    }
  }
  const text = segs.map((s) => (typeof s === "string" ? s : s.thread.label)).join("");
  return { segments: segs, text };
}

/** Order conflicts for a shape: visible (value-changing) knots first, then by recency. */
export function rankConflicts(list: readonly Conflict[]): Conflict[] {
  return list
    .filter((c) => c.status === "live")
    .sort((a, b) => Number(a.valuesEqual) - Number(b.valuesEqual) || b.lamport - a.lamport);
}
