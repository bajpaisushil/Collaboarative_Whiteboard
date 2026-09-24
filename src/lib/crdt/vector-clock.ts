/**
 * Vector clocks and happened-before on ops. Missing entries are 0; clocks produced here never
 * store zero entries and always have sorted keys (canonical form).
 */
import type { CausalRef, OpId, ReplicaId, VcRelation, VectorClock } from "./types";

export const EMPTY_VC: VectorClock = Object.freeze({});

export function vcGet(vc: VectorClock, r: ReplicaId): number {
  return vc[r] ?? 0;
}

/** Canonical copy: sorted keys, no zero entries. */
export function vcNormalize(vc: VectorClock): VectorClock {
  const out: Record<ReplicaId, number> = {};
  for (const k of Object.keys(vc).sort()) {
    const v = vc[k];
    if (v > 0) out[k] = v;
  }
  return out;
}

export function vcMerge(a: VectorClock, b: VectorClock): VectorClock {
  const out: Record<ReplicaId, number> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) {
    const v = Math.max(vcGet(a, k), vcGet(b, k));
    if (v > 0) out[k] = v;
  }
  return out;
}

/** Pointwise minimum (the common past of two cuts). */
export function vcMeet(a: VectorClock, b: VectorClock): VectorClock {
  const out: Record<ReplicaId, number> = {};
  for (const k of Object.keys(a).sort()) {
    const v = Math.min(vcGet(a, k), vcGet(b, k));
    if (v > 0) out[k] = v;
  }
  return out;
}

export function vcSet(vc: VectorClock, r: ReplicaId, n: number): VectorClock {
  return vcNormalize({ ...vc, [r]: n });
}

export function vcLeq(a: VectorClock, b: VectorClock): boolean {
  for (const k in a) if (a[k] > vcGet(b, k)) return false;
  return true;
}

export function vcEquals(a: VectorClock, b: VectorClock): boolean {
  return vcLeq(a, b) && vcLeq(b, a);
}

export function vcCompare(a: VectorClock, b: VectorClock): VcRelation {
  const le = vcLeq(a, b);
  const ge = vcLeq(b, a);
  if (le && ge) return "equal";
  if (le) return "before";
  if (ge) return "after";
  return "concurrent";
}

/** Sum of entries: how many ops this clock covers. */
export function vcSize(vc: VectorClock): number {
  let n = 0;
  for (const k in vc) n += vc[k];
  return n;
}

export function vcReplicas(...vcs: VectorClock[]): ReplicaId[] {
  const s = new Set<ReplicaId>();
  for (const vc of vcs) for (const k in vc) if (vc[k] > 0) s.add(k);
  return [...s].sort();
}

/* ------------------------------------------------------------ op identity */

export function opIdOf(replica: ReplicaId, counter: number): OpId {
  return `${replica}:${counter}`;
}

export function parseOpId(id: OpId): { replica: ReplicaId; counter: number } {
  const i = id.lastIndexOf(":");
  return { replica: id.slice(0, i), counter: Number(id.slice(i + 1)) };
}

/** Anything with an identity and a causal context. */
export interface Causal {
  replica: ReplicaId;
  counter: number;
  vc: VectorClock;
}

/** x → y (x happened before y). O(1): y's clock is downward closed. */
export function happenedBefore(x: Causal, y: Causal): boolean {
  if (x.replica === y.replica && x.counter === y.counter) return false;
  return x.counter <= vcGet(y.vc, x.replica);
}

export function concurrent(x: Causal, y: Causal): boolean {
  if (x.replica === y.replica) return false;
  return !happenedBefore(x, y) && !happenedBefore(y, x);
}

export function refCausal(ref: CausalRef): Causal {
  const { replica, counter } = parseOpId(ref.opId);
  return { replica, counter, vc: ref.vc };
}

/** ref a → ref b */
export function refHappenedBefore(a: CausalRef, b: CausalRef): boolean {
  return happenedBefore(refCausal(a), refCausal(b));
}

/** The causal cut just before an op: its vc minus itself. */
export function cutBefore(op: Causal): VectorClock {
  return vcSet(op.vc, op.replica, op.counter - 1);
}

/** Is op covered by cut `vc`? */
export function coveredBy(op: { replica: ReplicaId; counter: number }, vc: VectorClock): boolean {
  return op.counter <= vcGet(vc, op.replica);
}
