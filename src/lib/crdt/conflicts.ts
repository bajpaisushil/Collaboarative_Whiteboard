/**
 * Deterministic conflict detection (docs/ARCHITECTURE.md §5). A pure function of the ops on a
 * shape + its current record, so every converged replica derives identical conflicts and ids.
 */
import { canonicalJson } from "./hash";
import { compareOps } from "./oplog";
import { compareStamps, isAlive, registerValuesOf } from "./document";
import type { Conflict, Op, PropKey, RegisterKey, RegisterValues, ReplicaId, ShapeRecord } from "./types";
import { PROPS_OF, REGISTER_KEYS } from "./types";
import { concurrent, happenedBefore } from "./vector-clock";

/**
 * Mutually-maximal concurrent pairs between two single-replica op lists (each sorted by
 * counter): (x, y) with x ∥ y, x the latest op in S1 concurrent with y, and vice versa.
 */
export function mutualMaximalPairs(s1: readonly Op[], s2: readonly Op[]): [Op, Op][] {
  const latestConcurrent = (list: readonly Op[], other: Op): Op | null => {
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      if (happenedBefore(x, other)) return null; // older ones are before too
      if (!happenedBefore(other, x)) return x; // concurrent
    }
    return null;
  };
  const pairs: [Op, Op][] = [];
  for (const y of s2) {
    const x = latestConcurrent(s1, y);
    if (!x) continue;
    if (latestConcurrent(s2, x) === y) pairs.push([x, y]);
  }
  return pairs;
}

function groupByReplica(ops: readonly Op[]): Map<ReplicaId, Op[]> {
  const m = new Map<ReplicaId, Op[]>();
  for (const op of ops) {
    let l = m.get(op.replica);
    if (!l) m.set(op.replica, (l = []));
    l.push(op);
  }
  for (const l of m.values()) l.sort((a, b) => a.counter - b.counter);
  return m;
}

function replicaPairs(m: Map<ReplicaId, Op[]>): [ReplicaId, ReplicaId][] {
  const keys = [...m.keys()].sort();
  const out: [ReplicaId, ReplicaId][] = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) out.push([keys[i], keys[j]]);
  return out;
}

const isKeepAlive = (op: Op) => op.kind === "shape.update" || op.kind === "text.insert" || op.kind === "text.undelete";

const byCanonical = (a: Op, b: Op) => compareOps(a, b);

export function detectShapeConflicts(rec: ShapeRecord, shapeOps: readonly Op[], getOp: (id: string) => Op | undefined): Conflict[] {
  const out: Conflict[] = [];

  /* ---------------- concurrent-write (per register) */
  const pairRegs = new Map<string, { a: Op; b: Op; regs: RegisterKey[] }>();
  const updates = shapeOps.filter((o) => o.kind === "shape.update");
  if (updates.length > 1) {
    for (const key of REGISTER_KEYS) {
      const writers = updates.filter((o) => o.kind === "shape.update" && registerValuesOf(o.props)[key] !== undefined);
      if (writers.length < 2) continue;
      const g = groupByReplica(writers);
      for (const [r1, r2] of replicaPairs(g)) {
        for (const [x, y] of mutualMaximalPairs(g.get(r1)!, g.get(r2)!)) {
          const [a, b] = [x, y].sort(byCanonical);
          const k = `${a.id}|${b.id}`;
          const entry = pairRegs.get(k);
          if (entry) entry.regs.push(key);
          else pairRegs.set(k, { a, b, regs: [key] });
        }
      }
    }
  }
  for (const { a, b, regs } of pairRegs.values()) {
    // winner = greater canonical stamp
    const winner = b;
    const loser = a;
    const wv = registerValuesOf((winner as Op & { kind: "shape.update" }).props);
    const lv = registerValuesOf((loser as Op & { kind: "shape.update" }).props);
    let valuesEqual = true;
    const props: PropKey[] = [];
    for (const key of regs) {
      const same = canonicalJson(wv[key]) === canonicalJson(lv[key]);
      if (!same) valuesEqual = false;
      if (key === "bounds") {
        const w = wv.bounds as RegisterValues["bounds"],
          l = lv.bounds as RegisterValues["bounds"];
        for (const p of ["x", "y", "w", "h"] as const) if (w[p] !== l[p]) props.push(p);
      } else if (!same) props.push(...PROPS_OF[key]);
    }
    if (props.length === 0) for (const key of regs) props.push(...PROPS_OF[key]);
    const holderIds = regs.map((k) => rec.registers[k].stamp.opId);
    const live = holderIds.includes(winner.id);
    let resolvedBy: Conflict["resolvedBy"];
    if (!live) {
      const holder = regs
        .map((k) => rec.registers[k].stamp)
        .sort((s1, s2) => compareStamps(s2, s1))[0];
      const hop = getOp(holder.opId);
      resolvedBy = { opId: holder.opId, cause: hop?.meta.cause ?? "user" };
    }
    const replicas = [a.replica, b.replica].sort();
    out.push({
      id: `concurrent-write:${rec.id}:${a.id}|${b.id}`,
      kind: "concurrent-write",
      shapeId: rec.id,
      shapeType: rec.type,
      props,
      ops: [winner.id, loser.id],
      winner: winner.id,
      replicas,
      txns: [winner.meta.txn, loser.meta.txn],
      status: live ? "live" : "superseded",
      valuesEqual,
      lineageKey: `concurrent-write:${rec.id}:${replicas.join("+")}:${[...regs].sort().join(",")}`,
      resolvedBy,
      lamport: Math.max(a.lamport, b.lamport),
    });
  }

  /* ---------------- delete-vs-edit */
  const deletes = shapeOps.filter((o) => o.kind === "shape.delete");
  if (deletes.length) {
    const edits = shapeOps.filter(isKeepAlive);
    const gd = groupByReplica(deletes);
    const ge = groupByReplica(edits);
    for (const [rd, dl] of gd) {
      for (const [re, el] of ge) {
        if (rd === re) continue;
        for (const [d, e] of mutualMaximalPairs(dl, el)) {
          const alive = isAlive(rec);
          const observedBy = rec.deletes.find((ref) => e.counter <= (ref.vc[e.replica] ?? 0));
          const live = alive && !observedBy;
          const replicas = [d.replica, e.replica].sort();
          const [a, b] = [d, e].sort(byCanonical);
          out.push({
            id: `delete-vs-edit:${rec.id}:${a.id}|${b.id}`,
            kind: "delete-vs-edit",
            shapeId: rec.id,
            shapeType: rec.type,
            props: [],
            ops: [e.id, d.id],
            winner: e.id,
            replicas,
            txns: [e.meta.txn, d.meta.txn],
            status: live ? "live" : "superseded",
            valuesEqual: false,
            lineageKey: `delete-vs-edit:${rec.id}:${d.replica}>${e.replica}`,
            resolvedBy: observedBy ? { opId: observedBy.opId, cause: getOp(observedBy.opId)?.meta.cause ?? "user" } : undefined,
            lamport: Math.max(d.lamport, e.lamport),
          });
        }
      }
    }
  }

  /* ---------------- concurrent-text (per anchor) */
  if (rec.text) {
    const inserts = shapeOps.filter((o) => o.kind === "text.insert") as (Op & { kind: "text.insert" })[];
    if (inserts.length > 1) {
      const byAnchor = new Map<string, Op[]>();
      for (const op of inserts) {
        const k = op.after ?? "^";
        let l = byAnchor.get(k);
        if (!l) byAnchor.set(k, (l = []));
        l.push(op);
      }
      for (const [anchorKey, list] of byAnchor) {
        if (list.length < 2) continue;
        const g = groupByReplica(list);
        if (g.size < 2) continue;
        for (const [r1, r2] of replicaPairs(g)) {
          for (const [x, y] of mutualMaximalPairs(g.get(r1)!, g.get(r2)!)) {
            if (!concurrent(x, y)) continue;
            const [a, b] = [x, y].sort(byCanonical);
            // Merged order at an anchor: newer (greater stamp) first.
            const ordered = [b, a];
            const replicas = [a.replica, b.replica].sort();
            out.push({
              id: `concurrent-text:${rec.id}:${anchorKey}:${a.id}|${b.id}`,
              kind: "concurrent-text",
              shapeId: rec.id,
              shapeType: rec.type,
              props: [],
              ops: ordered.map((o) => o.id),
              winner: null,
              replicas,
              txns: ordered.map((o) => o.meta.txn),
              status: "live",
              valuesEqual: (a as Op & { kind: "text.insert" }).text === (b as Op & { kind: "text.insert" }).text,
              anchor: anchorKey === "^" ? null : anchorKey,
              lineageKey: `concurrent-text:${rec.id}:${anchorKey}:${replicas.join("+")}`,
              lamport: Math.max(a.lamport, b.lamport),
            });
          }
        }
      }
    }
  }

  return out.sort((c1, c2) => c1.lamport - c2.lamport || (c1.id < c2.id ? -1 : 1));
}
