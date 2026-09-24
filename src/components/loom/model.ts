/**
 * Pure layout model for the Loom: lanes (one per replica), causal edges derived from vector
 * clocks, offline stretches, knot index and the column layout of the space-time diagram
 * (with long uneventful stretches folded into "+N edits" bundles).
 *
 * Everything is O(ops × replicas) and memoised by callers on `view.log` identity, which only
 * changes when ops are added.
 */
import type { Conflict, Op, OpId, ReplicaId, ReplicaInfo, SnapshotInfo, VectorClock } from "@/lib/crdt/types";
import { compareLabels } from "./format";
import { isLiveKnot } from "./ops";

/* ------------------------------------------------------------------ log model */

/** "`to` had seen `from`": `from` is the newest op of another replica that `to` newly observed. */
export interface LoomEdge {
  from: number;
  to: number;
}

/** A contiguous run (in the author's own sequence) of ops made while offline. */
export interface OfflineRun {
  replica: ReplicaId;
  /** Canonical indices of the first and last op of the run. */
  from: number;
  to: number;
}

export interface LoomModel {
  log: readonly Op[];
  indexOf: ReadonlyMap<OpId, number>;
  /** Sorted by `to` (and therefore safe to scan for a visible window). */
  edges: readonly LoomEdge[];
  /** 1 when the op is an endpoint of a cross-replica edge (a sync point). */
  linked: Uint8Array;
  offline: readonly OfflineRun[];
  firstIndex: ReadonlyMap<ReplicaId, number>;
  lastIndex: ReadonlyMap<ReplicaId, number>;
  counts: ReadonlyMap<ReplicaId, number>;
  snapshotAt: ReadonlyMap<number, OpId>;
}

export function buildLoomModel(log: readonly Op[]): LoomModel {
  const n = log.length;
  const indexOf = new Map<OpId, number>();
  for (let i = 0; i < n; i++) indexOf.set(log[i].id, i);

  const edges: LoomEdge[] = [];
  const linked = new Uint8Array(n);
  const prevVc = new Map<ReplicaId, VectorClock>();
  const firstIndex = new Map<ReplicaId, number>();
  const lastIndex = new Map<ReplicaId, number>();
  const counts = new Map<ReplicaId, number>();
  const offline: OfflineRun[] = [];
  const openRun = new Map<ReplicaId, OfflineRun>();
  const snapshotAt = new Map<number, OpId>();

  for (let i = 0; i < n; i++) {
    const op = log[i];
    const r = op.replica;
    if (!firstIndex.has(r)) firstIndex.set(r, i);
    lastIndex.set(r, i);
    counts.set(r, (counts.get(r) ?? 0) + 1);
    if (op.kind === "snapshot.mark") snapshotAt.set(i, op.id);

    // Direct causal dependencies: entries of other replicas that grew since r's previous op.
    const prev = prevVc.get(r);
    for (const k in op.vc) {
      if (k === r) continue;
      const c = op.vc[k];
      if (c <= (prev?.[k] ?? 0)) continue;
      const src = indexOf.get(`${k}:${c}`);
      if (src === undefined || src >= i) continue;
      edges.push({ from: src, to: i });
      linked[src] = 1;
      linked[i] = 1;
    }
    prevVc.set(r, op.vc);

    // Offline stretches, per author.
    const run = openRun.get(r);
    if (op.meta.offline) {
      if (run) run.to = i;
      else {
        const fresh = { replica: r, from: i, to: i };
        offline.push(fresh);
        openRun.set(r, fresh);
      }
    } else if (run) {
      openRun.delete(r);
    }
  }
  return { log, indexOf, edges, linked, offline, firstIndex, lastIndex, counts, snapshotAt };
}

/* ------------------------------------------------------------------ lanes */

export interface Lane {
  replica: ReplicaId;
  label: string;
  self: boolean;
  opCount: number;
}

export interface LaneLayout {
  lanes: Lane[];
  laneOf: ReadonlyMap<ReplicaId, number>;
}

/** One lane per replica that authored an op (plus us, plus authors of waiting ops), by label. */
export function buildLanes(
  model: LoomModel,
  replicas: ReadonlyMap<ReplicaId, ReplicaInfo>,
  self: ReplicaId,
  selfLabel: string,
  pending: readonly Op[],
): LaneLayout {
  const byId = new Map<ReplicaId, Lane>();
  for (const [id, info] of replicas) {
    byId.set(id, { replica: id, label: id === self ? selfLabel : info.label, self: id === self, opCount: model.counts.get(id) ?? info.opCount });
  }
  if (!byId.has(self)) byId.set(self, { replica: self, label: selfLabel, self: true, opCount: model.counts.get(self) ?? 0 });
  for (const op of pending) {
    if (!byId.has(op.replica)) byId.set(op.replica, { replica: op.replica, label: op.meta.author || "?", self: false, opCount: 0 });
  }
  const lanes = [...byId.values()].sort((a, b) => compareLabels(a.label, b.label) || (a.replica < b.replica ? -1 : 1));
  const laneOf = new Map(lanes.map((l, i) => [l.replica, i] as const));
  return { lanes, laneOf };
}

/* ------------------------------------------------------------------ knots & snapshots */

export interface KnotTie {
  a: number;
  b: number;
  conflict: Conflict;
}

export interface KnotIndex {
  /** Conflicts touching op i, live knots first. */
  byIndex: ReadonlyMap<number, readonly Conflict[]>;
  byOp: ReadonlyMap<OpId, readonly Conflict[]>;
  /** Two-op conflicts, as index pairs (for drawing the tie between the two threads). */
  ties: readonly KnotTie[];
}

const knotRank = (c: Conflict) => (isLiveKnot(c) ? 0 : c.status === "live" ? 1 : 2);

export function buildKnots(conflicts: readonly Conflict[], indexOf: ReadonlyMap<OpId, number>): KnotIndex {
  const byIndex = new Map<number, Conflict[]>();
  const byOp = new Map<OpId, Conflict[]>();
  const ties: KnotTie[] = [];
  for (const c of conflicts) {
    for (const id of c.ops) {
      const list = byOp.get(id) ?? [];
      list.push(c);
      byOp.set(id, list);
      const i = indexOf.get(id);
      if (i === undefined) continue;
      const li = byIndex.get(i) ?? [];
      li.push(c);
      byIndex.set(i, li);
    }
    if (c.ops.length === 2) {
      const a = indexOf.get(c.ops[0]);
      const b = indexOf.get(c.ops[1]);
      if (a !== undefined && b !== undefined) ties.push({ a: Math.min(a, b), b: Math.max(a, b), conflict: c });
    }
  }
  for (const l of byIndex.values()) l.sort((x, y) => knotRank(x) - knotRank(y));
  for (const l of byOp.values()) l.sort((x, y) => knotRank(x) - knotRank(y));
  return { byIndex, byOp, ties };
}

export function snapshotsByIndex(snapshots: readonly SnapshotInfo[], indexOf: ReadonlyMap<OpId, number>): ReadonlyMap<number, SnapshotInfo> {
  const out = new Map<number, SnapshotInfo>();
  for (const s of snapshots) {
    const i = indexOf.get(s.opId);
    if (i !== undefined) out.set(i, s);
  }
  return out;
}

/** Per lane: canonical index of the newest op of that replica inside the cut (−1 = none). */
export function cutFrontier(lanes: readonly Lane[], cut: VectorClock, indexOf: ReadonlyMap<OpId, number>): number[] {
  return lanes.map((l) => {
    const c = cut[l.replica] ?? 0;
    return c > 0 ? (indexOf.get(`${l.replica}:${c}`) ?? -1) : -1;
  });
}

/* ------------------------------------------------------------------ columns */

export const COL = 18;
export const PAD_L = 16;
export const BUNDLE_W = 68;
/** Fold uneventful stretches only once the history is long. */
export const BUNDLE_THRESHOLD = 150;
const MIN_RUN = 24;
const KEEP_EDGE = 3;
const KEEP_TAIL = 12;

export interface Bundle {
  from: number;
  to: number;
  /** Left edge and width in px. */
  x: number;
  w: number;
  /** Op id of the first folded op (stable key across appends). */
  key: OpId;
  /** Folded ops per lane index. */
  perLane: number[];
}

export interface ColumnLayout {
  /** Centre x per op (folded ops share their bundle's centre). */
  opX: Float64Array;
  /** Bundle index per op, −1 when drawn individually. */
  bundleOf: Int32Array;
  bundles: Bundle[];
  /** x just after the last column. */
  end: number;
}

export function layoutColumns(
  model: LoomModel,
  laneOf: ReadonlyMap<ReplicaId, number>,
  laneCount: number,
  keep: (i: number) => boolean,
  unfolded: ReadonlySet<OpId>,
): ColumnLayout {
  const { log } = model;
  const n = log.length;
  const opX = new Float64Array(n);
  const bundleOf = new Int32Array(n).fill(-1);
  const bundles: Bundle[] = [];
  let x = PAD_L;
  const place = (i: number) => {
    opX[i] = x + COL / 2;
    x += COL;
  };
  if (n <= BUNDLE_THRESHOLD) {
    for (let i = 0; i < n; i++) place(i);
    return { opX, bundleOf, bundles, end: x };
  }
  const interesting = (i: number) => i < 4 || i >= n - KEEP_TAIL || model.linked[i] === 1 || model.snapshotAt.has(i) || keep(i);
  let i = 0;
  while (i < n) {
    if (interesting(i)) {
      place(i++);
      continue;
    }
    let j = i;
    while (j < n && !interesting(j)) j++;
    const from = i + KEEP_EDGE;
    const to = j - 1 - KEEP_EDGE;
    if (j - i < MIN_RUN || unfolded.has(log[from].id)) {
      for (let k = i; k < j; k++) place(k);
    } else {
      for (let k = i; k < from; k++) place(k);
      const b = bundles.length;
      const perLane = new Array<number>(laneCount).fill(0);
      const cx = x + BUNDLE_W / 2;
      for (let k = from; k <= to; k++) {
        opX[k] = cx;
        bundleOf[k] = b;
        const l = laneOf.get(log[k].replica);
        if (l !== undefined) perLane[l]++;
      }
      bundles.push({ from, to, x, w: BUNDLE_W, key: log[from].id, perLane });
      x += BUNDLE_W;
      for (let k = to + 1; k < j; k++) place(k);
    }
    i = j;
  }
  return { opX, bundleOf, bundles, end: x };
}

/** First index whose x ≥ `x` (opX is non-decreasing). */
export function lowerBoundX(opX: Float64Array, x: number): number {
  let lo = 0;
  let hi = opX.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (opX[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
