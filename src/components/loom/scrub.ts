/**
 * Time-travel positions. The timeline has `n + 2` slots for a log of `n` ops:
 *   slot 0       — before the first edit (empty board; scrub.atOpId === null)
 *   slot i (1…n) — the board right after log[i − 1] (scrub.atOpId === log[i − 1].id)
 *   slot n + 1   — live (scrub === null)
 * Scrubs are anchored to op ids, never to indices, so new ops (even ones that land earlier in
 * canonical order after a merge) never shift what you're looking at.
 */
import type { Op, OpId, ReplicaId, SnapshotInfo, VectorClock } from "@/lib/crdt/types";
import type { UiState } from "@/lib/ui/store";
import { vcEquals } from "@/lib/crdt/vector-clock";
import { editRef, plural } from "./format";

export type Scrub = NonNullable<UiState["scrub"]>;

/** True when the scrub is a canonical-prefix position (as opposed to a causal cut). */
export function isPrefixScrub(s: Scrub): s is Scrub & { atOpId: OpId | null } {
  return "atOpId" in s && s.atOpId !== undefined;
}

export function isCutScrub(s: Scrub | null): s is Scrub & { cut: VectorClock } {
  return !!s && !isPrefixScrub(s) && !!s.cut;
}

export function scrubForSlot(log: readonly Op[], slot: number): Scrub | null {
  const n = log.length;
  if (slot > n) return null;
  if (slot <= 0) return { atOpId: null, label: "Start" };
  const op = log[slot - 1];
  return { atOpId: op.id, label: `L${op.lamport}` };
}

/** Longest canonical prefix entirely inside a causal cut. */
export function cutPrefixLength(log: readonly Op[], cut: VectorClock): number {
  let p = 0;
  for (const op of log) {
    if (op.counter <= (cut[op.replica] ?? 0)) p++;
    else break;
  }
  return p;
}

export function slotOfScrub(scrub: Scrub | null, log: readonly Op[], indexOf: ReadonlyMap<OpId, number>): number {
  const n = log.length;
  if (!scrub) return n + 1;
  if (isPrefixScrub(scrub)) {
    if (scrub.atOpId === null) return 0;
    const i = indexOf.get(scrub.atOpId);
    return i === undefined ? n : i + 1;
  }
  if (scrub.cut) return cutPrefixLength(log, scrub.cut);
  return n + 1;
}

export function stepScrub(scrub: Scrub | null, delta: number, log: readonly Op[], indexOf: ReadonlyMap<OpId, number>): Scrub | null {
  const n = log.length;
  if (n === 0) return null;
  const slot = slotOfScrub(scrub, log, indexOf);
  const next = Math.max(0, Math.min(n + 1, slot + delta));
  return scrubForSlot(log, next);
}

export interface ScrubDescription {
  kind: "live" | "start" | "op" | "cut";
  title: string;
  detail: string;
  /** Compact phrase for sliders and announcements. */
  short: string;
  slot: number;
  total: number;
  /** For cut scrubs: how many ops the cut contains. */
  covered?: number;
  snapshot?: SnapshotInfo;
  op?: Op;
}

const CONSISTENT = "A consistent cut: every edit shown has its causes.";

export function describeScrub(
  scrub: Scrub | null,
  log: readonly Op[],
  indexOf: ReadonlyMap<OpId, number>,
  labelOf: (r: ReplicaId, fallback?: string) => string,
  snapshots: readonly SnapshotInfo[],
): ScrubDescription {
  const n = log.length;
  const slot = slotOfScrub(scrub, log, indexOf);
  if (!scrub) {
    return { kind: "live", title: "Live", detail: "The board as it is now.", short: `Live, ${plural(n, "edit")}`, slot, total: n };
  }
  if (isPrefixScrub(scrub)) {
    if (scrub.atOpId === null || slot === 0) {
      return {
        kind: "start",
        title: "Viewing the board before the first edit",
        detail: "Nothing had happened yet. Step forward with →.",
        short: "Before the first edit",
        slot,
        total: n,
      };
    }
    const op = log[slot - 1];
    const who = editRef(labelOf(op.replica, op.meta.author), op.counter);
    return {
      kind: "op",
      title: `Viewing the board as of ${who} (L${op.lamport})`,
      detail: CONSISTENT,
      short: `As of ${who}, L${op.lamport}, ${slot} of ${n}`,
      slot,
      total: n,
      op,
    };
  }
  const cut = scrub.cut ?? {};
  let covered = 0;
  for (const op of log) if (op.counter <= (cut[op.replica] ?? 0)) covered++;
  const snapshot = snapshots.find((s) => s.cut === cut) ?? snapshots.find((s) => vcEquals(s.cut, cut) && (!scrub.label || s.name === scrub.label));
  if (snapshot) {
    const author = labelOf(snapshot.replica, snapshot.author);
    return {
      kind: "cut",
      title: `Viewing snapshot “${snapshot.name}”`,
      detail: `Exactly what ${author} had seen when it was taken (L${snapshot.lamport}). ${CONSISTENT}`,
      short: `Snapshot ${snapshot.name}, ${covered} of ${n} edits`,
      slot,
      total: n,
      covered,
      snapshot,
    };
  }
  const name = scrub.label ?? "a causal cut";
  return {
    kind: "cut",
    title: `Viewing ${name}`,
    detail: CONSISTENT,
    short: `${name}, ${covered} of ${n} edits`,
    slot,
    total: n,
    covered,
  };
}
