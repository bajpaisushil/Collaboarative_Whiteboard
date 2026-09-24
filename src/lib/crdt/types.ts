/**
 * Core type contracts for the Weave CRDT engine.
 * See docs/ARCHITECTURE.md §2–§8 for semantics. Everything here is JSON-serialisable.
 */

/* ------------------------------------------------------------------ identity */

export type ReplicaId = string;
/** `${replica}:${counter}` */
export type OpId = string;
/** `sh_${opId of the creating op}` */
export type ShapeId = string;
/** `${opId}.${index}` */
export type CharId = string;
/** `${replica}:t${n}` */
export type TxnId = string;

/** Missing entry means 0. Treat as immutable. */
export type VectorClock = Readonly<Record<ReplicaId, number>>;

export type VcRelation = "equal" | "before" | "after" | "concurrent";

/** Register stamp; ordered by (lamport, replica). */
export interface Stamp {
  opId: OpId;
  lamport: number;
  replica: ReplicaId;
}

/* ------------------------------------------------------------------ shapes */

export type ShapeType = "stroke" | "rect" | "ellipse" | "arrow" | "sticky" | "text";

/** A point relative to the shape origin (x, y). Third element: pressure 0..1 (strokes). */
export type Point = readonly [number, number] | readonly [number, number, number];

/**
 * Every shape carries every prop (unused ones keep their defaults) so that registers are
 * uniform. Semantics per type:
 * - stroke:  x,y origin; points = freehand path relative to origin; w,h = bbox size.
 * - arrow:   x,y origin; points = [start, end] relative to origin; w,h = bbox size.
 * - rect/ellipse/sticky: x,y top-left; w,h size.
 * - text:    x,y top-left; w = wrap width; h = measured height (informational).
 */
export interface ShapeProps {
  x: number;
  y: number;
  w: number;
  h: number;
  points: readonly Point[];
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  z: number;
}

export type PropKey = keyof ShapeProps;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Registers are per *group*: x,y,w,h are coupled geometry and live in one `bounds`
 * register so a concurrent move and resize resolve atomically (no shape neither user made).
 * Everything else is one register per prop.
 */
export type RegisterKey = "bounds" | "points" | "stroke" | "fill" | "strokeWidth" | "opacity" | "fontSize" | "z";

export const REGISTER_KEYS: readonly RegisterKey[] = [
  "bounds",
  "points",
  "stroke",
  "fill",
  "strokeWidth",
  "opacity",
  "fontSize",
  "z",
] as const;

export const REGISTER_OF: Readonly<Record<PropKey, RegisterKey>> = {
  x: "bounds",
  y: "bounds",
  w: "bounds",
  h: "bounds",
  points: "points",
  stroke: "stroke",
  fill: "fill",
  strokeWidth: "strokeWidth",
  opacity: "opacity",
  fontSize: "fontSize",
  z: "z",
};

export const PROPS_OF: Readonly<Record<RegisterKey, readonly PropKey[]>> = {
  bounds: ["x", "y", "w", "h"],
  points: ["points"],
  stroke: ["stroke"],
  fill: ["fill"],
  strokeWidth: ["strokeWidth"],
  opacity: ["opacity"],
  fontSize: ["fontSize"],
  z: ["z"],
};

export const PROP_KEYS: readonly PropKey[] = [
  "x",
  "y",
  "w",
  "h",
  "points",
  "stroke",
  "fill",
  "strokeWidth",
  "opacity",
  "fontSize",
  "z",
] as const;

export const TEXT_SHAPES: readonly ShapeType[] = ["sticky", "text"];

/* ------------------------------------------------------------------ operations */

export type OpCause =
  | "user"
  | "undo"
  | "redo"
  | "snapshot-restore"
  | "adopt"
  | "system";

export interface OpMeta {
  txn: TxnId;
  /** Display label of the author at authoring time (history stays self-describing). */
  author: string;
  cause: OpCause;
  /** Informational only. NEVER used for ordering. */
  wallTime: number;
  /** Authoring tab was offline when this op was created. */
  offline?: boolean;
  /** Human label of the user action, e.g. "Move 2 shapes". */
  label?: string;
  /** For undo/redo ops: the txn being compensated. */
  undoes?: TxnId;
}

export interface OpHeader {
  id: OpId;
  replica: ReplicaId;
  /** 1-based per-replica sequence number; equals vc[replica]. */
  counter: number;
  lamport: number;
  /** Causal context including this op itself. */
  vc: VectorClock;
  meta: OpMeta;
}

export interface CreatePayload {
  kind: "shape.create";
  shapeId: ShapeId;
  shapeType: ShapeType;
  props: ShapeProps;
}

export interface UpdatePayload {
  kind: "shape.update";
  shapeId: ShapeId;
  /** `{}` is a legal keep-alive / restore write. */
  props: Partial<ShapeProps>;
}

export interface DeletePayload {
  kind: "shape.delete";
  shapeId: ShapeId;
}

export interface TextInsertPayload {
  kind: "text.insert";
  shapeId: ShapeId;
  /** Anchor char (may be a tombstone); null = beginning of text. */
  after: CharId | null;
  text: string;
}

export interface TextDeletePayload {
  kind: "text.delete";
  shapeId: ShapeId;
  chars: CharId[];
}

/** Re-show exact chars hidden by earlier deletes (undo of text.delete, snapshot restore). */
export interface TextUndeletePayload {
  kind: "text.undelete";
  shapeId: ShapeId;
  chars: CharId[];
}

export interface SnapshotMarkPayload {
  kind: "snapshot.mark";
  /** `snap_${opId}` */
  snapshotId: string;
  name: string;
  /** Causal cut = this op's vc minus itself. State is materialised on demand. */
  cut: VectorClock;
}

export type OpPayload =
  | CreatePayload
  | UpdatePayload
  | DeletePayload
  | TextInsertPayload
  | TextDeletePayload
  | TextUndeletePayload
  | SnapshotMarkPayload;

export type OpKind = OpPayload["kind"];

export type Op = OpHeader & OpPayload;

export type ShapeOp = Exclude<Op, OpHeader & SnapshotMarkPayload>;

/* ------------------------------------------------------------------ document state */

export interface Register<T> {
  value: T;
  stamp: Stamp;
}

export interface RegisterValues {
  bounds: Bounds;
  points: readonly Point[];
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  z: number;
}

export type Registers = { [K in RegisterKey]: Register<RegisterValues[K]> };

/** An element of an antichain under happened-before. */
export interface CausalRef {
  opId: OpId;
  lamport: number;
  vc: VectorClock;
}

/**
 * RGA character. Visibility is observed-remove, exactly like shapes:
 * visible ⇔ ∃ s ∈ shows such that no h ∈ hides has s.vc ≤ h.vc.
 * `shows` starts with the inserting op; `text.undelete` adds to it; `text.delete` adds to `hides`.
 */
export interface RgaNode {
  id: CharId;
  ch: string;
  after: CharId | null;
  lamport: number;
  replica: ReplicaId;
  opId: OpId;
  shows: CausalRef[];
  hides: CausalRef[];
}

export interface RgaState {
  nodes: Record<CharId, RgaNode>;
}

export interface ShapeRecord {
  id: ShapeId;
  type: ShapeType;
  createdBy: OpId;
  registers: Registers;
  /** Antichain of keep-alive ops (create / update / text.insert / text.undelete — NOT text.delete). */
  writers: CausalRef[];
  /** Antichain of delete ops. */
  deletes: CausalRef[];
  /** Present for sticky/text. */
  text?: RgaState;
}

export interface SnapshotInfo {
  snapshotId: string;
  name: string;
  opId: OpId;
  replica: ReplicaId;
  author: string;
  lamport: number;
  /** Causal cut the snapshot was taken at (vc of the mark op minus itself). */
  cut: VectorClock;
  wallTime: number;
}

export interface DocState {
  shapes: Record<ShapeId, ShapeRecord>;
  snapshots: Record<string, SnapshotInfo>;
  /** Every op folded into this state. */
  vc: VectorClock;
  /** Max lamport of any op folded in (Lamport high-water mark). */
  maxLamport: number;
}

/* ------------------------------------------------------------------ views (for UI) */

export interface TextRun {
  text: string;
  replica: ReplicaId;
  opId: OpId;
}

export interface ShapeView extends ShapeProps {
  id: ShapeId;
  type: ShapeType;
  text: string;
  /** Present for text shapes: consecutive chars grouped by authoring op. */
  runs?: TextRun[];
  createdBy: ReplicaId;
  /** Replica of the highest-stamped register write. */
  lastEditedBy: ReplicaId;
  alive: boolean;
}

export interface ReplicaInfo {
  replica: ReplicaId;
  /** Display label (disambiguated, e.g. "A" or "A2" when two replicas share a letter). */
  label: string;
  /** Palette index derived from the label letter. */
  colorIndex: number;
  opCount: number;
  firstLamport: number;
  lastLamport: number;
  forkedFrom?: ReplicaId;
}

export type DeletePolicy = "update-wins" | "delete-wins";

/* ------------------------------------------------------------------ conflicts */

export type ConflictKind = "concurrent-write" | "delete-vs-edit" | "concurrent-text";

export type ConflictStatus = "live" | "superseded";

export interface Conflict {
  /** Deterministic: `${kind}:${shapeId}:${ids}` — identical on every converged replica. */
  id: string;
  kind: ConflictKind;
  shapeId: ShapeId;
  shapeType: ShapeType;
  /** concurrent-write: props written by both ops. Empty otherwise. */
  props: PropKey[];
  /**
   * concurrent-write / delete-vs-edit: exactly two ops [winner, loser].
   * concurrent-text: every op in the concurrency component (canonical order).
   */
  ops: OpId[];
  /** Op whose effect prevailed (null for concurrent-text: both are merged). */
  winner: OpId | null;
  replicas: ReplicaId[];
  /** Txns of the ops, same order as `ops` (UI groups "A's Move 10 shapes vs B's Recolour"). */
  txns: TxnId[];
  status: ConflictStatus;
  /** Both sides wrote identical values — no visible effect ("benign"). */
  valuesEqual: boolean;
  /** concurrent-text only: the anchor both inserted after. */
  anchor?: CharId | null;
  /** Stable across partial delivery: `${kind}:${shapeId}:${replica pair}:${register|anchor}`. */
  lineageKey: string;
  /** When superseded: the op that now holds the value. */
  resolvedBy?: { opId: OpId; cause: OpCause };
  /** Max lamport among the ops — for sorting / timeline placement. */
  lamport: number;
}

/* ------------------------------------------------------------------ explanations */

export type StepOutcome = "pass" | "fail" | "decisive" | "skipped" | "info";

export interface DecisionStep {
  id: string;
  title: string;
  /** For newcomers: no jargon. */
  plain: string;
  /** For engineers: clocks, stamps, ids. */
  technical: string;
  outcome: StepOutcome;
  refs?: { ops?: OpId[]; replicas?: ReplicaId[]; props?: PropKey[] };
  highlight?: "vc" | "lamport" | "replica" | "policy" | "anchor";
}

export interface VcProofRow {
  replica: ReplicaId;
  a: number;
  b: number;
  relation: "<" | "=" | ">";
}

export interface VcProof {
  rows: VcProofRow[];
  relation: VcRelation;
  /** Replicas whose events A had seen but B had not (and vice versa). */
  aAhead: ReplicaId[];
  bAhead: ReplicaId[];
  summary: string;
}

export interface ExplainSide {
  opId: OpId;
  replica: ReplicaId;
  /** Author label (from the replica directory). */
  label: string;
  kind: OpKind;
  lamport: number;
  vc: VectorClock;
  wallTime: number;
  offline: boolean;
  cause: OpCause;
  /** Values this op wrote (concurrent-write), or null. */
  wrote: Partial<ShapeProps> | null;
  /** Value of the same props at the common base (before either edit). */
  base: Partial<ShapeProps> | null;
  /** Human summary, e.g. "moved to (340, 120)", "deleted the shape", "typed “hello”". */
  summary: string;
}

export interface ConvergenceCheck {
  /** Human description of the two orders, e.g. "A's edits, then B's". */
  orderAB: string;
  orderBA: string;
  hashAB: string;
  hashBA: string;
  equal: boolean;
}

export interface Counterfactual {
  id: "wall-clock" | "delete-wins" | "reverse-tiebreak" | "other-order" | string;
  title: string;
  detail: string;
  /** Would this alternative produce a different result than what actually happened? */
  differs: boolean;
  /** Resulting shape state under the alternative (for drawing a ghost). */
  result: { props?: Partial<ShapeProps>; alive?: boolean; text?: string } | null;
}

export interface TextAnchorDecision {
  anchor: CharId | null;
  /** Visible text right before the anchor, for display. */
  context: string;
  /** Sibling inserts at this anchor, in the order they appear in the merged text. */
  order: { opId: OpId; replica: ReplicaId; lamport: number; text: string }[];
  rule: string;
}

export interface Explanation {
  conflict: Conflict;
  /** e.g. "Why is this sticky note teal, not vermilion?" */
  question: string;
  /** 1–2 sentence plain-language answer. */
  answer: string;
  /** The common causal cut both sides started from (meet of their pasts). */
  baseCut: VectorClock;
  sides: ExplainSide[];
  /** For two-op conflicts; for text, between the two replicas' latest ops in the component. */
  vcProof: VcProof;
  steps: DecisionStep[];
  outcome: {
    winner: OpId | null;
    result: Partial<ShapeProps> | null;
    discarded: Partial<ShapeProps> | null;
    alive: boolean;
    text?: TextRun[];
  };
  convergence: ConvergenceCheck;
  counterfactuals: Counterfactual[];
  textAnchors?: TextAnchorDecision[];
  /** Op ids in each side's causal past (for highlighting). Keyed by side opId. */
  causalPast: Record<OpId, OpId[]>;
  /** The current register holder is a third op (the pair's result was later overwritten). */
  supersededBy?: { opId: OpId; label: string };
}

/** Per-property provenance for any shape ("why does this look like this?"). */
export interface ShapeProvenance {
  shapeId: ShapeId;
  alive: boolean;
  registers: {
    key: RegisterKey;
    props: PropKey[];
    value: unknown;
    setBy: { opId: OpId; replica: ReplicaId; label: string; lamport: number; cause: OpCause };
    /** Earlier writes this one replaced, and whether the writer had seen them. */
    overwrote: { opId: OpId; label: string; lamport: number; observed: boolean }[];
    conflictIds: string[];
  }[];
  text?: { replica: ReplicaId; label: string; chars: number }[];
  conflictIds: string[];
}

/* ------------------------------------------------------------------ undo */

export interface UndoSkip {
  shapeId: ShapeId;
  prop: PropKey | "text" | "shape";
  byReplica: ReplicaId;
  reason: string;
}

/** Semantic inverse recorded per local txn (never raw ops). */
export type UndoAction =
  | { kind: "props"; shapeId: ShapeId; register: RegisterKey; opId: OpId; value: unknown; prev: unknown }
  | { kind: "kill"; shapeId: ShapeId }
  | { kind: "revive"; shapeId: ShapeId }
  | { kind: "text-hide"; shapeId: ShapeId; chars: CharId[] }
  | { kind: "text-show"; shapeId: ShapeId; chars: CharId[]; hiddenBy: OpId };

export interface UndoEntry {
  /** The txn this entry would compensate. */
  txn: TxnId;
  label: string;
  actions: UndoAction[];
}

export interface UndoStacks {
  undo: UndoEntry[];
  redo: UndoEntry[];
}

export interface UndoResult {
  txn: TxnId | null;
  undone: TxnId;
  ops: Op[];
  skipped: UndoSkip[];
  label: string;
}

/* ------------------------------------------------------------------ replica API */

export interface ShapeInit {
  type: ShapeType;
  props?: Partial<ShapeProps>;
  text?: string;
}

/** Builder handed to `Replica.transact`. Every call produces ≥0 ops in one txn. */
export interface Tx {
  create(init: ShapeInit): ShapeId;
  update(shapeId: ShapeId, props: Partial<ShapeProps>): void;
  delete(shapeId: ShapeId): void;
  /** Replace the visible text with `next`, diffed into ≤1 delete + ≤1 insert. */
  setText(shapeId: ShapeId, next: string): void;
  insertText(shapeId: ShapeId, index: number, text: string): void;
  deleteText(shapeId: ShapeId, index: number, length: number): void;
}

export interface TransactOptions {
  cause?: OpCause;
  label?: string;
  offline?: boolean;
  /** Record in the undo stack (default: cause === 'user'). */
  undoable?: boolean;
  undoes?: TxnId;
}

export interface IntegrateResult {
  /** Newly integrated ops, in integration order. */
  applied: Op[];
  /** Ops that were duplicates / already known. */
  duplicates: number;
  /** Ops now waiting in the causal buffer. */
  buffered: number;
  /** Conflict ids that did not exist before this call. */
  newConflicts: string[];
  /** Conflict ids that existed before and no longer do (e.g. replaced by a later pair). */
  removedConflicts: string[];
  /** Shapes that went from dead to alive because of this call. */
  resurrected: ShapeId[];
}

export interface ReplicaView {
  /** Monotonic; changes on every state change. */
  version: number;
  replica: ReplicaId;
  lamport: number;
  vc: VectorClock;
  /** Alive shapes, render order (z, id). Structurally shared: unchanged shapes keep identity. */
  shapes: ShapeView[];
  shapeById: ReadonlyMap<ShapeId, ShapeView>;
  conflictsByShape: ReadonlyMap<ShapeId, readonly Conflict[]>;
  /** Every replica that ever authored an op (label directory for history). */
  replicas: ReadonlyMap<ReplicaId, ReplicaInfo>;
  /** All integrated ops in canonical (lamport, replica) order. */
  log: readonly Op[];
  /** Ops waiting for causal dependencies. */
  pending: readonly Op[];
  conflicts: readonly Conflict[];
  snapshots: readonly SnapshotInfo[];
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  stateHash: string;
}

export interface PersistedReplica {
  version: 2;
  replica: ReplicaId;
  label: string;
  /** Ancestor ids this instance authored under before forking. */
  ancestors: ReplicaId[];
  ops: Op[];
  undo: UndoStacks;
  txnCounter: number;
}

export interface ReplicaOptions {
  replica: ReplicaId;
  /** Display label stamped into op meta (`author`). */
  label?: string;
  /** Injected for determinism in tests. Default Date.now. */
  now?: () => number;
  /** Restore from persisted state. */
  persisted?: PersistedReplica;
  /** Canonical-order ops between internal time-travel checkpoints. Default 64. */
  checkpointEvery?: number;
}

/**
 * Public API of `Replica` (src/lib/crdt/replica.ts).
 *
 * Tx semantics: ops are staged against a scratch view that sees the txn's own earlier
 * writes; nothing is integrated and no counter/lamport is consumed unless `build` returns
 * normally. An empty txn returns `{ops: []}` and records no undo entry. The whole txn is
 * integrated and subscribers are notified once.
 *
 * All numbers in ops are sanitised (finite, -0 → 0, coordinates rounded to 2 decimals);
 * undefined keys are stripped, so JSON and structured-clone transports agree.
 */
export interface ReplicaApi extends ReplicaReadApi {
  label: string;

  /* local edits — ops are integrated locally before returning */
  transact(build: (tx: Tx) => void, opts?: TransactOptions): { txn: TxnId; ops: Op[] };
  undo(opts?: { offline?: boolean }): UndoResult | null;
  redo(opts?: { offline?: boolean }): UndoResult | null;
  /** Emit a snapshot.mark op for the current causal cut. */
  markSnapshot(name: string, opts?: { offline?: boolean }): Op;
  /** Emit one txn that turns the current doc into the snapshot's state (undoable). */
  restoreSnapshot(snapshotId: string, opts?: { offline?: boolean }): { txn: TxnId; ops: Op[] } | null;
  /** Manual resolution: re-write the chosen op's values (cause 'adopt'). null for text conflicts. */
  adoptConflictValue(conflictId: string, opId: OpId, opts?: { offline?: boolean }): { txn: TxnId; ops: Op[] } | null;

  /* remote integration (buffers causally-unready ops; dedupes by counter ≤ vc) */
  receive(ops: readonly Op[]): IntegrateResult;
  /** Ops a peer with clock `vc` lacks, canonical order (always causally safe). */
  opsSince(vc: VectorClock): Op[];

  /* persistence / identity */
  toPersisted(): PersistedReplica;
  /** Continue under a new replica id (duplicate-tab fork). Log kept; undo/redo cleared. */
  fork(newId: ReplicaId, newLabel: string): void;
}

/** Read-only surface handed to the UI (edits go through the session so they're broadcast). */
export interface ReplicaReadApi {
  readonly id: ReplicaId;
  getView(): ReplicaView;
  subscribe(listener: () => void): () => void;
  getOp(id: OpId): Op | undefined;
  getShape(id: ShapeId, opts?: { includeDead?: boolean }): ShapeView | null;
  explain(conflictId: string): Explanation | null;
  explainShape(shapeId: ShapeId): ShapeProvenance | null;
  /** Current shape with the chosen side's values applied (null shape = that side deletes it). */
  ghost(conflictId: string, opId?: OpId): { shape: ShapeView | null; props: PropKey[] } | null;
  /** Visible shapes after the canonical prefix ending at `opId` (null = empty board). */
  shapesAtOp(opId: OpId | null): ShapeView[];
  /** Visible shapes at a causal cut (what a replica with clock `vc` saw). */
  shapesAtCut(vc: VectorClock): ShapeView[];
  /** Char id left of visible index (null = start). */
  charIdAt(shapeId: ShapeId, index: number): CharId | null;
  /** Visible index right after char `id` (tombstones map to their nearest visible predecessor). */
  indexAfterChar(shapeId: ShapeId, id: CharId | null): number;
  /** Clock covered by every clock in `peerVcs` and ours. */
  stableFrontier(peerVcs: readonly VectorClock[]): VectorClock;
}
