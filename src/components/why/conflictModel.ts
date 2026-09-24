/**
 * Pure view-model for the knot list: categories, grouping by transaction pair, and the
 * one-line headlines ("Colour · B's teal beat A's vermilion") as thread-aware segments.
 */
import { describeOp, shapeNoun } from "@/lib/crdt/describe";
import type { Conflict, Op, OpId, ShapeProps, ShapeType } from "@/lib/crdt/types";
import { capital, plural, propsTitle, quoted, valueWord } from "./format";
import { replicaOfOp, type Thread, type ThreadOf } from "./threads";

export type Category = "contested" | "revived" | "interleaved" | "benign";

export const CATEGORY_ORDER: readonly Category[] = ["contested", "revived", "interleaved", "benign"];

export const CATEGORY_COPY: Record<Category, { title: string; tagline: string }> = {
  contested: { title: "Contested", tagline: "A value was lost — one edit's value won, the other waits in history." },
  revived: { title: "Revived", tagline: "A delete was overridden — someone was still editing." },
  interleaved: { title: "Interleaved", tagline: "Both kept — order decided where they typed at the same spot." },
  benign: { title: "Agreed", tagline: "Both tabs made the same change, so there was nothing to decide." },
};

export function categoryOf(c: Conflict): Category {
  if (c.valuesEqual) return "benign";
  if (c.kind === "delete-vs-edit") return "revived";
  if (c.kind === "concurrent-text") return "interleaved";
  return "contested";
}

export interface ConflictGroup {
  key: string;
  category: Category;
  /** Newest first. */
  conflicts: Conflict[];
  lead: Conflict;
  live: boolean;
  lamport: number;
}

/** Group by (category, kind, txn pair) — one clash of two user actions = one card. */
export function groupConflicts(conflicts: readonly Conflict[]): Record<Category, ConflictGroup[]> {
  const byKey = new Map<string, ConflictGroup>();
  for (const c of conflicts) {
    const category = categoryOf(c);
    const key = `${category}|${c.kind}|${[...new Set(c.txns)].sort().join("+")}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, category, conflicts: [], lead: c, live: false, lamport: 0 };
      byKey.set(key, g);
    }
    g.conflicts.push(c);
  }
  const out: Record<Category, ConflictGroup[]> = { contested: [], revived: [], interleaved: [], benign: [] };
  for (const g of byKey.values()) {
    g.conflicts.sort((a, b) => Number(b.status === "live") - Number(a.status === "live") || b.lamport - a.lamport);
    g.lead = g.conflicts[0];
    g.live = g.conflicts.some((c) => c.status === "live");
    g.lamport = Math.max(...g.conflicts.map((c) => c.lamport));
    out[g.category].push(g);
  }
  for (const k of CATEGORY_ORDER) out[k].sort((a, b) => Number(b.live) - Number(a.live) || b.lamport - a.lamport);
  return out;
}

/* ------------------------------------------------------------------ headlines */

export type Segment = string | { thread: Thread };

export interface Headline {
  /** Short topic before the dot: "Colour", "Revived", "Text". */
  topic: string;
  segments: Segment[];
  /** Plain-text version (aria-label / title). */
  text: string;
}

type GetOp = (id: OpId) => Op | undefined;

function wrote(op: Op | undefined): Partial<ShapeProps> | null {
  return op && op.kind === "shape.update" ? op.props : null;
}

function toText(topic: string, segs: Segment[]): string {
  return `${topic} · ${segs.map((s) => (typeof s === "string" ? s : s.thread.label)).join("")}`;
}

function distinctThreads(c: Conflict, threadOf: ThreadOf): Thread[] {
  const seen = new Set<string>();
  const out: Thread[] = [];
  for (const id of c.ops) {
    const t = threadOf(replicaOfOp(id));
    if (seen.has(t.label)) continue;
    seen.add(t.label);
    out.push(t);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function joinThreads(threads: Thread[]): Segment[] {
  const segs: Segment[] = [];
  threads.forEach((t, i) => {
    if (i > 0) segs.push(i === threads.length - 1 ? " and " : ", ");
    segs.push({ thread: t });
  });
  return segs;
}

/** Headline for one conflict (or the lead of a group, with `group` for mixed winners). */
export function headlineFor(c: Conflict, getOp: GetOp, threadOf: ThreadOf, group?: readonly Conflict[]): Headline {
  const segs: Segment[] = [];
  let topic: string;
  switch (c.kind) {
    case "concurrent-write": {
      topic = propsTitle(c.props);
      const [wId, lId] = c.ops;
      const W = threadOf(replicaOfOp(wId));
      const L = threadOf(replicaOfOp(lId));
      if (c.valuesEqual) {
        segs.push(...joinThreads([W, L].sort((a, b) => a.label.localeCompare(b.label))), ` both chose ${valueWord(wrote(getOp(wId)), c.props)}`);
        break;
      }
      if (group && group.length > 1) {
        const wins = new Map<string, { thread: Thread; n: number }>();
        for (const g of group) {
          const t = threadOf(replicaOfOp(g.ops[0]));
          const e = wins.get(t.label) ?? { thread: t, n: 0 };
          e.n++;
          wins.set(t.label, e);
        }
        if (wins.size > 1) {
          const list = [...wins.values()].sort((a, b) => b.n - a.n);
          list.forEach((e, i) => {
            if (i > 0) segs.push(", ");
            segs.push({ thread: e.thread }, ` won ${e.n}`);
          });
          segs.push(" — decided shape by shape");
          break;
        }
      }
      segs.push({ thread: W }, `'s ${valueWord(wrote(getOp(wId)), c.props)} beat `, { thread: L }, `'s ${valueWord(wrote(getOp(lId)), c.props)}`);
      break;
    }
    case "delete-vs-edit": {
      topic = "Revived";
      const [editId, delId] = c.ops;
      const E = threadOf(replicaOfOp(editId));
      const D = threadOf(replicaOfOp(delId));
      segs.push({ thread: E }, "'s edit outlived ", { thread: D }, "'s delete");
      break;
    }
    case "concurrent-text": {
      topic = "Text";
      const who = distinctThreads(c, threadOf);
      segs.push(...joinThreads(who), c.valuesEqual ? " typed the same thing at the same spot" : " typed at the same spot — both kept");
      break;
    }
  }
  return { topic, segments: segs, text: toText(topic, segs) };
}

/** Status line: "live" or who superseded it. */
export function statusFor(c: Conflict, threadOf: ThreadOf): { live: boolean; text: string; thread: Thread | null } {
  if (c.status === "live") return { live: true, text: c.valuesEqual ? "no visible effect" : "live", thread: null };
  const by = c.resolvedBy ? threadOf(replicaOfOp(c.resolvedBy.opId)) : null;
  if (!by) return { live: false, text: "settled", thread: null };
  if (c.kind === "delete-vs-edit") return { live: false, text: "deleted again by", thread: by };
  switch (c.resolvedBy?.cause) {
    case "adopt":
      return { live: false, text: "resolved by", thread: by };
    case "undo":
      return { live: false, text: "undone by", thread: by };
    case "snapshot-restore":
      return { live: false, text: "snapshot restored by", thread: by };
    default:
      return { live: false, text: "superseded by", thread: by };
  }
}

/** "B · Recolour  vs  A · Move 3 shapes" — the user actions behind the knot. */
export function actionsFor(c: Conflict, getOp: GetOp, threadOf: ThreadOf, shapeType: ShapeType): { thread: Thread; label: string }[] {
  const seen = new Set<string>();
  const out: { thread: Thread; label: string }[] = [];
  for (const id of c.ops) {
    const op = getOp(id);
    const t = threadOf(replicaOfOp(id));
    const key = `${t.label}|${op?.meta.txn ?? id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = op?.meta.label ?? (op ? capital(describeOp(op, shapeType)) : "Edit");
    out.push({ thread: t, label: op?.kind === "text.insert" && !op.meta.label ? `Typed ${quoted(op.text, 16)}` : label });
  }
  return out.slice(0, 3);
}

export function groupNoun(g: ConflictGroup): string {
  if (g.conflicts.length === 1) return shapeNoun(g.lead.shapeType);
  const types = new Set(g.conflicts.map((c) => c.shapeType));
  const shapes = new Set(g.conflicts.map((c) => c.shapeId)).size;
  if (types.size === 1) {
    const n = shapeNoun(g.lead.shapeType);
    return plural(shapes, n, n === "text" ? "texts" : `${n}s`);
  }
  return plural(shapes, "shape");
}
