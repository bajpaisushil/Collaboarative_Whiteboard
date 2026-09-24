/**
 * Geometry for the "Replay the merge" space-time strip: two lanes (one per side's tab), the
 * recent common past, each side's private history, the two edits, and each edit's causal
 * cone (from `explanation.causalPast`). Pure — no React.
 */
import type { Explanation, Op, OpId } from "@/lib/crdt/types";
import { counterOfOp, replicaOfOp } from "../threads";
import type { DisplaySide } from "./model";

export const RP = {
  w: 360,
  h: 156,
  laneY: [44, 112] as const,
  xStart: 34,
  xFirst: 58,
  xLast: 282,
  resultX: 334,
  resultY: 78,
};

export type DotRole = "common" | "private" | "edit";

export interface ReplayDot {
  id: OpId;
  lane: 0 | 1;
  role: DotRole;
  lamport: number;
  counter: number;
  x: number;
}

export interface ReplayGeometry {
  dots: ReplayDot[];
  edits: [ReplayDot, ReplayDot];
  /** Earlier ops on each lane not drawn. */
  hidden: [number, number];
  /** Ops (any tab) both edits had seen. */
  commonTotal: number;
  /** For each lane's edit: x of the last dot on the other lane it had seen (cone edge). */
  seenEdge: [number, number];
}

const KEEP_COMMON = 3;
const KEEP_PRIVATE = 4;

export function buildReplay(explanation: Explanation, sides: [DisplaySide, DisplaySide], getOp: (id: OpId) => Op | undefined): ReplayGeometry {
  const pasts = sides.map((d) => new Set(explanation.causalPast[d.side.opId] ?? [])) as [Set<OpId>, Set<OpId>];
  let commonTotal = 0;
  for (const id of pasts[0]) if (pasts[1].has(id)) commonTotal++;

  const raw: Omit<ReplayDot, "x">[] = [];
  const hidden: [number, number] = [0, 0];
  sides.forEach((d, i) => {
    const lane = i as 0 | 1;
    const replica = d.side.replica;
    const own = d.side.vc[replica] ?? counterOfOp(d.side.opId);
    const ids = new Set<OpId>();
    for (const p of pasts) for (const id of p) if (replicaOfOp(id) === replica && counterOfOp(id) < own) ids.add(id);
    const sorted = [...ids].sort((a, b) => counterOfOp(a) - counterOfOp(b));
    const common = sorted.filter((id) => pasts[0].has(id) && pasts[1].has(id));
    const priv = sorted.filter((id) => !(pasts[0].has(id) && pasts[1].has(id)));
    const keptCommon = common.slice(-KEEP_COMMON);
    const keptPriv = priv.slice(-KEEP_PRIVATE);
    hidden[lane] = sorted.length - keptCommon.length - keptPriv.length;
    const push = (id: OpId, role: DotRole) => raw.push({ id, lane, role, lamport: getOp(id)?.lamport ?? 0, counter: counterOfOp(id) });
    keptCommon.forEach((id) => push(id, "common"));
    keptPriv.forEach((id) => push(id, "private"));
    push(d.side.opId, "edit");
  });

  const order = [...raw].sort((a, b) => a.lamport - b.lamport || (a.id < b.id ? -1 : 1));
  const n = order.length;
  const step = n > 1 ? Math.min(34, (RP.xLast - RP.xFirst) / (n - 1)) : 0;
  const xOf = new Map<OpId, number>();
  order.forEach((d, i) => xOf.set(d.id, RP.xFirst + i * step));
  const dots: ReplayDot[] = raw.map((d) => ({ ...d, x: xOf.get(d.id) ?? RP.xFirst }));
  const edits = [dots.find((d) => d.lane === 0 && d.role === "edit")!, dots.find((d) => d.lane === 1 && d.role === "edit")!] as [ReplayDot, ReplayDot];

  const seenEdge = ([0, 1] as const).map((lane) => {
    const otherLane = lane === 0 ? 1 : 0;
    const seen = dots.filter((d) => d.lane === otherLane && d.role === "common");
    if (seen.length) return Math.max(...seen.map((d) => d.x));
    return hidden[otherLane] > 0 ? RP.xStart + 6 : RP.xStart - 8;
  }) as [number, number];

  return { dots, edits, hidden, commonTotal, seenEdge };
}

/** Cone polygon for lane `lane`'s edit: everything left of it on its lane, and left of `seenX` on the other. */
export function conePoints(lane: 0 | 1, editX: number, seenX: number): string {
  const [yT, yB] = RP.laneY;
  const pad = 13;
  const xs = RP.xStart - 6;
  if (lane === 0) {
    return [
      [xs, yT - pad],
      [editX + 9, yT - pad],
      [editX + 9, yT + 3],
      [seenX + 9, yB + pad],
      [xs, yB + pad],
    ]
      .map((p) => p.join(","))
      .join(" ");
  }
  return [
    [xs, yB + pad],
    [editX + 9, yB + pad],
    [editX + 9, yB - 3],
    [seenX + 9, yT - pad],
    [xs, yT - pad],
  ]
    .map((p) => p.join(","))
    .join(" ");
}
