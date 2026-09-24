/**
 * RGA sequence CRDT for sticky/text content (docs/ARCHITECTURE.md §3.3).
 * Tree: each char's parent is `after`; siblings ordered by DESCENDING (lamport, replica);
 * document order = pre-order DFS. Char visibility is observed-remove (shows vs hides).
 * State objects are immutable: every update returns a new RgaState.
 */
import { antichainInsert, orVisible } from "./antichain";
import type { CausalRef, CharId, Op, OpId, ReplicaId, RgaNode, RgaState, TextRun } from "./types";

export const EMPTY_RGA: RgaState = Object.freeze({ nodes: Object.freeze({}) as Record<CharId, RgaNode> });

export function charIdOf(opId: OpId, index: number): CharId {
  return `${opId}.${index}`;
}

function refOf(op: Op): CausalRef {
  return { opId: op.id, lamport: op.lamport, vc: op.vc };
}

export function rgaInsert(state: RgaState, op: Op & { kind: "text.insert" }): RgaState {
  const chars = Array.from(op.text);
  if (chars.length === 0) return state;
  if (state.nodes[charIdOf(op.id, 0)]) return state; // idempotent
  const nodes: Record<CharId, RgaNode> = { ...state.nodes };
  let after = op.after;
  const show = [refOf(op)];
  for (let i = 0; i < chars.length; i++) {
    const id = charIdOf(op.id, i);
    nodes[id] = { id, ch: chars[i], after, lamport: op.lamport, replica: op.replica, opId: op.id, shows: show, hides: [] };
    after = id;
  }
  return { nodes };
}

function updateChars(state: RgaState, chars: readonly CharId[], fn: (n: RgaNode) => RgaNode): RgaState {
  let nodes: Record<CharId, RgaNode> | null = null;
  for (const id of chars) {
    const n = (nodes ?? state.nodes)[id];
    if (!n) continue;
    const next = fn(n);
    if (next === n) continue;
    if (!nodes) nodes = { ...state.nodes };
    nodes[id] = next;
  }
  return nodes ? { nodes } : state;
}

export function rgaDelete(state: RgaState, op: Op & { kind: "text.delete" }): RgaState {
  const ref = refOf(op);
  return updateChars(state, op.chars, (n) => {
    const hides = antichainInsert(n.hides, ref);
    return hides === n.hides ? n : { ...n, hides };
  });
}

export function rgaUndelete(state: RgaState, op: Op & { kind: "text.undelete" }): RgaState {
  const ref = refOf(op);
  return updateChars(state, op.chars, (n) => {
    const shows = antichainInsert(n.shows, ref);
    return shows === n.shows ? n : { ...n, shows };
  });
}

export function isCharVisible(n: RgaNode): boolean {
  return orVisible(n.shows, n.hides);
}

/** Sibling order: descending (lamport, replica). */
export function compareSiblings(a: { lamport: number; replica: ReplicaId }, b: { lamport: number; replica: ReplicaId }): number {
  if (a.lamport !== b.lamport) return b.lamport - a.lamport;
  return a.replica < b.replica ? 1 : a.replica > b.replica ? -1 : 0;
}

export interface RgaLayout {
  /** All nodes (incl. tombstones) in document order. */
  order: RgaNode[];
  /** Visible nodes in document order. */
  visible: RgaNode[];
  text: string;
  /** Position of each char in `order`. */
  index: Map<CharId, number>;
  children: Map<CharId | null, RgaNode[]>;
}

const layoutCache = new WeakMap<RgaState, RgaLayout>();

export function rgaLayout(state: RgaState): RgaLayout {
  const hit = layoutCache.get(state);
  if (hit) return hit;
  const children = new Map<CharId | null, RgaNode[]>();
  for (const id in state.nodes) {
    const n = state.nodes[id];
    let list = children.get(n.after);
    if (!list) children.set(n.after, (list = []));
    list.push(n);
  }
  for (const list of children.values()) list.sort(compareSiblings);
  const order: RgaNode[] = [];
  // Iterative pre-order DFS (text can be long chains).
  const stack: RgaNode[] = [];
  const roots = children.get(null) ?? [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]);
  while (stack.length) {
    const n = stack.pop()!;
    order.push(n);
    const kids = children.get(n.id);
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  const visible: RgaNode[] = [];
  const index = new Map<CharId, number>();
  let text = "";
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    index.set(n.id, i);
    if (isCharVisible(n)) {
      visible.push(n);
      text += n.ch;
    }
  }
  const layout = { order, visible, text, index, children };
  layoutCache.set(state, layout);
  return layout;
}

export function rgaText(state: RgaState | undefined): string {
  return state ? rgaLayout(state).text : "";
}

export function rgaRuns(state: RgaState | undefined): TextRun[] {
  if (!state) return [];
  const runs: TextRun[] = [];
  for (const n of rgaLayout(state).visible) {
    const last = runs[runs.length - 1];
    if (last && last.opId === n.opId) last.text += n.ch;
    else runs.push({ text: n.ch, replica: n.replica, opId: n.opId });
  }
  return runs;
}

/** Char id left of visible index (null = start of text). */
export function rgaCharIdAt(state: RgaState | undefined, index: number): CharId | null {
  if (!state || index <= 0) return null;
  const vis = rgaLayout(state).visible;
  const i = Math.min(index, vis.length) - 1;
  return i >= 0 ? vis[i].id : null;
}

/** Visible index right after char `id` (tombstones map to their nearest visible predecessor). */
export function rgaIndexAfter(state: RgaState | undefined, id: CharId | null): number {
  if (!state || id === null) return 0;
  const layout = rgaLayout(state);
  const pos = layout.index.get(id);
  if (pos === undefined) return 0;
  let count = 0;
  for (let i = 0; i <= pos; i++) if (isCharVisible(layout.order[i])) count++;
  return count;
}

/** Visible char ids in [index, index + length). */
export function rgaRange(state: RgaState | undefined, index: number, length: number): CharId[] {
  if (!state || length <= 0) return [];
  return rgaLayout(state)
    .visible.slice(Math.max(0, index), Math.max(0, index) + length)
    .map((n) => n.id);
}

/** Diff visible text against `next`: at most one delete range + one insertion. */
export function rgaDiff(state: RgaState | undefined, next: string): { deleteIds: CharId[]; insertAt: number; insertText: string } {
  const cur = state ? rgaLayout(state).visible : [];
  const a = cur.map((n) => n.ch);
  const b = Array.from(next);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return {
    deleteIds: cur.slice(p, a.length - s).map((n) => n.id),
    insertAt: p,
    insertText: b.slice(p, b.length - s).join(""),
  };
}
