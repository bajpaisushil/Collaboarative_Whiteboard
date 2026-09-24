/**
 * Small, pure formatting helpers for the Loom (history ribbon, log table, snapshots).
 */
import type { OpCause, ReplicaId, VectorClock } from "@/lib/crdt/types";

/** Sort replica labels naturally: A < A2 < B < … */
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export interface VcEntry {
  replica: ReplicaId;
  label: string;
  n: number;
}

/** Non-zero vector-clock entries with display labels, sorted by label. */
export function vcEntries(vc: VectorClock, labelOf: (r: ReplicaId) => string): VcEntry[] {
  const out: VcEntry[] = [];
  for (const replica of Object.keys(vc)) {
    const n = vc[replica];
    if (n > 0) out.push({ replica, label: labelOf(replica), n });
  }
  return out.sort((a, b) => compareLabels(a.label, b.label));
}

/** "A5 B3" — labels with a digit (A2) get a separator so the counter stays readable: "A2·5". */
export function compactVc(vc: VectorClock, labelOf: (r: ReplicaId) => string): string {
  return vcEntries(vc, labelOf)
    .map((e) => `${e.label}${/\d$/.test(e.label) ? "·" : ""}${e.n}`)
    .join(" ");
}

/** "just now", "12s ago", "3 min ago", "2 h ago", or a date. */
export function relativeTime(then: number, now: number): string {
  const s = Math.round((now - then) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Wall-clock time of day, e.g. "14:02:33". Informational only — never used for ordering. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Short badge word for non-user causes (null for plain user edits / system marks). */
export function causeWord(cause: OpCause): string | null {
  switch (cause) {
    case "undo":
      return "undo";
    case "redo":
      return "redo";
    case "adopt":
      return "kept value";
    case "snapshot-restore":
      return "restore";
    default:
      return null;
  }
}

/** Longer explanation for a cause badge's tooltip. */
export function causeHint(cause: OpCause): string {
  switch (cause) {
    case "undo":
      return "An undo — a new compensating edit; history is never erased";
    case "redo":
      return "A redo — re-applies an undone edit as a new edit";
    case "adopt":
      return "Someone picked this value to settle a knot";
    case "snapshot-restore":
      return "Part of restoring a snapshot (ordinary, undoable edits)";
    case "system":
      return "Recorded by Weave itself";
    default:
      return "A normal edit";
  }
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "A's edit #12" — the per-tab sequence number reads better than a raw op id. */
export function editRef(label: string, counter: number): string {
  return `${label}'s edit #${counter}`;
}
