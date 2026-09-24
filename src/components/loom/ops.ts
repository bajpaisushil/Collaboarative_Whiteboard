/**
 * Plain (non-React) lookups over ops for the Loom. Kept out of components so caches can live
 * at module level without tripping render-purity rules.
 */
import { describeOp, propsNoun, shapeNoun } from "@/lib/crdt/describe";
import type { Conflict, Op, OpId, ReplicaId, ReplicaReadApi, ShapeId, ShapeType, VectorClock } from "@/lib/crdt/types";

const typeCaches = new WeakMap<ReplicaReadApi, Map<ShapeId, ShapeType>>();

/**
 * The type of the shape an op touched. A shape's type never changes, so hits are cached per
 * replica. Uses the creating op (`sh_${opId}`) first — O(1), no view materialisation.
 */
export function shapeTypeOf(replica: ReplicaReadApi, op: Op): ShapeType | undefined {
  if (op.kind === "snapshot.mark") return undefined;
  if (op.kind === "shape.create") return op.shapeType;
  let cache = typeCaches.get(replica);
  if (!cache) {
    cache = new Map();
    typeCaches.set(replica, cache);
  }
  const hit = cache.get(op.shapeId);
  if (hit) return hit;
  const createId = op.shapeId.startsWith("sh_") ? op.shapeId.slice(3) : null;
  const create = createId ? replica.getOp(createId) : undefined;
  const type =
    create && create.kind === "shape.create" ? create.shapeType : (replica.getShape(op.shapeId, { includeDead: true })?.type ?? undefined);
  if (type) cache.set(op.shapeId, type);
  return type;
}

export interface OpSummary {
  /** Shape noun shown before the summary for edits of an existing shape ("sticky note"). */
  noun: string | null;
  /** describeOp text, e.g. "moved to (340, 120)". */
  text: string;
}

export function opSummary(replica: ReplicaReadApi, op: Op): OpSummary {
  const type = shapeTypeOf(replica, op);
  const text = describeOp(op, type);
  const noun = op.kind === "shape.create" || op.kind === "snapshot.mark" || !type ? null : shapeNoun(type);
  return { noun, text };
}

export function shapeIdOf(op: Op): ShapeId | null {
  return op.kind === "snapshot.mark" ? null : op.shapeId;
}

export type KindFilter = "all" | "create" | "update" | "delete" | "text" | "snapshot";

export const KIND_FILTERS: readonly { value: KindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "text", label: "Text" },
  { value: "snapshot", label: "Snapshot" },
];

export function kindGroup(op: Op): Exclude<KindFilter, "all"> {
  switch (op.kind) {
    case "shape.create":
      return "create";
    case "shape.update":
      return "update";
    case "shape.delete":
      return "delete";
    case "snapshot.mark":
      return "snapshot";
    default:
      return "text";
  }
}

/** A conflict that still shows on the board and actually changed something. */
export function isLiveKnot(c: Conflict): boolean {
  return c.status === "live" && !c.valuesEqual;
}

/** One-line plain description of a knot, for aria-labels and tooltips. */
export function knotPhrase(c: Conflict, labelOf: (r: ReplicaId) => string): string {
  const who = c.replicas.map(labelOf);
  const names = who.length <= 2 ? who.join(" and ") : `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`;
  const noun = shapeNoun(c.shapeType);
  switch (c.kind) {
    case "concurrent-write":
      return `${names} changed the ${noun}'s ${propsNoun(c.props)} at the same time`;
    case "delete-vs-edit":
      return `one of ${names} deleted the ${noun} while the other edited it`;
    case "concurrent-text":
      return `${names} typed into the ${noun} at the same time`;
  }
}

/** For a waiting op: the first missing dependency ("B's edit #4"), given our clock. */
export function missingDependency(op: Op, vc: VectorClock): { replica: ReplicaId; counter: number } | null {
  const own = vc[op.replica] ?? 0;
  if (own < op.counter - 1) return { replica: op.replica, counter: own + 1 };
  for (const k of Object.keys(op.vc)) {
    if (k === op.replica) continue;
    const have = vc[k] ?? 0;
    if (have < op.vc[k]) return { replica: k, counter: have + 1 };
  }
  return null;
}

/** Ids in the causal past of the given ops, computed from their clocks (fallback for explain()). */
export function causalPastFromClocks(log: readonly Op[], ops: readonly Op[]): Set<OpId> {
  const out = new Set<OpId>();
  for (const o of log) {
    for (const f of ops) {
      if (o.id !== f.id && o.counter <= (f.vc[o.replica] ?? 0)) {
        out.add(o.id);
        break;
      }
    }
  }
  return out;
}
