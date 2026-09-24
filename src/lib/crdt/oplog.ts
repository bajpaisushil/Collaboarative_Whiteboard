/**
 * Operation log: every integrated op, deduplicated, with canonical (lamport, replica, counter)
 * order and indexes by shape and by replica. Canonical order is a linear extension of
 * causality (Lamport property), so every prefix is a consistent cut.
 */
import type { Op, OpId, ReplicaId, ShapeId } from "./types";
import { parseOpId } from "./vector-clock";

export function compareOps(a: Op, b: Op): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.replica !== b.replica) return a.replica < b.replica ? -1 : 1;
  return a.counter - b.counter;
}

function insertSorted(arr: Op[], op: Op): number {
  // Fast path: most ops are appended at the end.
  if (arr.length === 0 || compareOps(arr[arr.length - 1], op) < 0) {
    arr.push(op);
    return arr.length - 1;
  }
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareOps(arr[mid], op) < 0) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, op);
  return lo;
}

export function shapeIdOfOp(op: Op): ShapeId | null {
  return op.kind === "snapshot.mark" ? null : op.shapeId;
}

export class OpLog {
  private byId = new Map<OpId, Op>();
  private canonical: Op[] = [];
  private byShape = new Map<ShapeId, Op[]>();
  /** Per replica: ops indexed by counter − 1 (causal delivery keeps these contiguous). */
  private byReplica = new Map<ReplicaId, Op[]>();
  /** Bumped on every append; lowest canonical index touched since last `takeLowWater()`. */
  version = 0;
  private lowWater = Infinity;

  get size(): number {
    return this.canonical.length;
  }

  has(id: OpId): boolean {
    return this.byId.has(id);
  }

  get(id: OpId): Op | undefined {
    return this.byId.get(id);
  }

  getByCounter(replica: ReplicaId, counter: number): Op | undefined {
    return this.byReplica.get(replica)?.[counter - 1];
  }

  /** Returns the canonical index the op landed at, or -1 if already present. */
  append(op: Op): number {
    if (this.byId.has(op.id)) return -1;
    this.byId.set(op.id, op);
    const idx = insertSorted(this.canonical, op);
    if (idx < this.lowWater) this.lowWater = idx;
    const sid = shapeIdOfOp(op);
    if (sid) {
      let list = this.byShape.get(sid);
      if (!list) this.byShape.set(sid, (list = []));
      insertSorted(list, op);
    }
    let rl = this.byReplica.get(op.replica);
    if (!rl) this.byReplica.set(op.replica, (rl = []));
    rl[op.counter - 1] = op;
    this.version++;
    return idx;
  }

  /** Lowest canonical index modified since the last call (Infinity if none). */
  takeLowWater(): number {
    const lw = this.lowWater;
    this.lowWater = Infinity;
    return lw;
  }

  all(): readonly Op[] {
    return this.canonical;
  }

  forShape(id: ShapeId): readonly Op[] {
    return this.byShape.get(id) ?? [];
  }

  forReplica(r: ReplicaId): readonly Op[] {
    return this.byReplica.get(r) ?? [];
  }

  replicas(): ReplicaId[] {
    return [...this.byReplica.keys()].sort();
  }

  indexOf(id: OpId): number {
    const op = this.byId.get(id);
    if (!op) return -1;
    let lo = 0,
      hi = this.canonical.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareOps(this.canonical[mid], op) < 0) lo = mid + 1;
      else hi = mid;
    }
    return this.canonical[lo] === op ? lo : -1;
  }

  /** Every op id in the causal past of `vc` (excluding `exclude`). */
  pastOf(vc: Readonly<Record<ReplicaId, number>>, exclude?: OpId): OpId[] {
    const out: OpId[] = [];
    for (const r in vc) {
      const list = this.byReplica.get(r);
      if (!list) continue;
      const n = Math.min(vc[r], list.length);
      for (let i = 0; i < n; i++) {
        const op = list[i];
        if (op && op.id !== exclude) out.push(op.id);
      }
    }
    return out;
  }
}

export { parseOpId };
