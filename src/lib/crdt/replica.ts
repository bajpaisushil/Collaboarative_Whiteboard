/**
 * Replica: one user's copy of the board — clocks, op log, causal buffer, CRDT document,
 * conflicts, undo/redo, snapshots and time travel behind the `ReplicaApi` contract.
 * Framework-free and deterministic (wall time is injected and informational only).
 */
import { canonicalJson, hashValue } from "./hash";
import { detectShapeConflicts } from "./conflicts";
import {
  DEFAULT_PROPS,
  aliveViews,
  applyOp,
  cloneDoc,
  createDoc,
  hashDoc,
  isAlive,
  registerValuesOf,
  shapeView,
} from "./document";
import { explainConflict, explainShapeProvenance, type ExplainContext } from "./explain";
import { OpLog, compareOps, shapeIdOfOp } from "./oplog";
import { rgaCharIdAt, rgaDiff, rgaIndexAfter, rgaLayout, rgaRange, isCharVisible } from "./rga";
import { isValidOp, jsonClone, sanitizeProps } from "./sanitize";
import type {
  CharId,
  Conflict,
  DocState,
  Explanation,
  IntegrateResult,
  Op,
  OpId,
  OpPayload,
  PersistedReplica,
  PropKey,
  RegisterKey,
  ReplicaApi,
  ReplicaId,
  ReplicaInfo,
  ReplicaOptions,
  ReplicaView,
  ShapeId,
  ShapeInit,
  ShapeProps,
  ShapeProvenance,
  ShapeView,
  TransactOptions,
  Tx,
  TxnId,
  UndoAction,
  UndoEntry,
  UndoResult,
  VectorClock,
} from "./types";
import { REGISTER_OF, TEXT_SHAPES } from "./types";
import { actionsForOp, planUndo, UndoManager } from "./undo";
import { vcGet, vcMeet, vcNormalize } from "./vector-clock";

interface TxnContext {
  txn: TxnId;
  scratch: DocState;
  ops: Op[];
  counter: number;
  lamport: number;
  opts: TransactOptions;
  actions: UndoAction[];
}

function colorIndexOf(label: string): number {
  const ch = (label || "A").toUpperCase().charCodeAt(0);
  return (ch >= 65 && ch <= 90 ? ch - 65 : 0) % 6;
}

export class Replica implements ReplicaApi {
  private _id: ReplicaId;
  label: string;
  private ancestors: ReplicaId[] = [];
  private readonly now: () => number;
  private readonly checkpointEvery: number;

  private doc: DocState = createDoc();
  private readonly log = new OpLog();
  private readonly pending = new Map<OpId, Op>();
  private lamport = 0;
  private txnCounter = 0;
  private readonly undoMgr: UndoManager;
  private txn: TxnContext | null = null;

  private conflictMap = new Map<ShapeId, Conflict[]>();
  private conflictsFlat: Conflict[] = [];
  private conflictsById = new Map<string, Conflict>();
  private conflictsByShapeView: ReadonlyMap<ShapeId, readonly Conflict[]> = new Map();

  private readonly listeners = new Set<() => void>();
  private notifyQueued = false;
  private version = 0;
  private view: ReplicaView | null = null;
  private logCopy: { version: number; ops: readonly Op[] } = { version: -1, ops: [] };
  private directory: { version: number; label: string; map: ReadonlyMap<ReplicaId, ReplicaInfo> } = { version: -1, label: "", map: new Map() };
  private checkpoints: { count: number; doc: DocState }[] = [];
  private cutCache = new Map<string, { version: number; shapes: ShapeView[] }>();
  private explainCache = new Map<string, { key: string; value: Explanation | null }>();

  constructor(opts: ReplicaOptions) {
    this._id = opts.replica;
    this.label = opts.label ?? "A";
    this.now = opts.now ?? (() => Date.now());
    this.checkpointEvery = opts.checkpointEvery ?? 64;
    const p = opts.persisted;
    this.undoMgr = new UndoManager(p?.undo);
    if (p) {
      this.ancestors = [...(p.ancestors ?? [])];
      if (p.replica !== this._id && !this.ancestors.includes(p.replica)) this.ancestors.push(p.replica);
      if (p.label && !opts.label) this.label = p.label;
      this.txnCounter = p.txnCounter ?? 0;
      const ops = [...p.ops].filter(isValidOp).sort(compareOps);
      this.receiveInternal(ops, true);
      if (p.replica !== this._id) this.undoMgr.clear();
    }
  }

  get id(): ReplicaId {
    return this._id;
  }

  /* ================================================================ reactive view */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.version++;
    this.view = null;
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      for (const l of [...this.listeners]) l();
    });
  }

  getView(): ReplicaView {
    if (this.view) return this.view;
    const shapes = aliveViews(this.doc);
    const shapeById = new Map(shapes.map((s) => [s.id, s] as const));
    if (this.logCopy.version !== this.log.version) this.logCopy = { version: this.log.version, ops: this.log.all().slice() };
    const pending = [...this.pending.values()].sort(compareOps);
    this.view = {
      version: this.version,
      replica: this._id,
      lamport: this.lamport,
      vc: this.doc.vc,
      shapes,
      shapeById,
      conflictsByShape: this.conflictsByShapeView,
      replicas: this.replicaDirectory(),
      log: this.logCopy.ops,
      pending,
      conflicts: this.conflictsFlat,
      snapshots: Object.values(this.doc.snapshots).sort((a, b) => a.lamport - b.lamport || (a.opId < b.opId ? -1 : 1)),
      canUndo: this.undoMgr.canUndo,
      canRedo: this.undoMgr.canRedo,
      undoLabel: this.undoMgr.undoLabel,
      redoLabel: this.undoMgr.redoLabel,
      stateHash: hashDoc(this.doc),
    };
    return this.view;
  }

  private replicaDirectory(): ReadonlyMap<ReplicaId, ReplicaInfo> {
    if (this.directory.version === this.log.version && this.directory.label === this.label) return this.directory.map;
    const infos: ReplicaInfo[] = [];
    for (const r of this.log.replicas()) {
      const ops = this.log.forReplica(r).filter(Boolean);
      if (ops.length === 0) continue;
      const base = r === this._id ? this.label : ops[ops.length - 1].meta.author || "?";
      infos.push({
        replica: r,
        label: base,
        colorIndex: colorIndexOf(base),
        opCount: ops.length,
        firstLamport: ops[0].lamport,
        lastLamport: ops[ops.length - 1].lamport,
      });
    }
    // Disambiguate shared letters: self keeps the plain letter, then earliest first.
    const byLabel = new Map<string, ReplicaInfo[]>();
    for (const i of infos) {
      const l = byLabel.get(i.label) ?? [];
      l.push(i);
      byLabel.set(i.label, l);
    }
    for (const [label, list] of byLabel) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.replica === this._id ? -1 : b.replica === this._id ? 1 : a.firstLamport - b.firstLamport || (a.replica < b.replica ? -1 : 1)));
      list.forEach((info, i) => {
        if (i > 0) info.label = `${label}${i + 1}`;
      });
    }
    for (const i of infos) if (this.ancestors.includes(i.replica)) i.forkedFrom = undefined;
    const map = new Map(infos.map((i) => [i.replica, i] as const));
    this.directory = { version: this.log.version, label: this.label, map };
    return map;
  }

  private labelOf = (r: ReplicaId): string => {
    if (r === this._id) return this.label;
    return this.replicaDirectory().get(r)?.label ?? r.slice(0, 4);
  };

  /* ================================================================ integration */

  private isCovered(op: Op): boolean {
    return op.counter <= vcGet(this.doc.vc, op.replica);
  }

  private isReady(op: Op): boolean {
    const vc = this.doc.vc;
    if (vcGet(vc, op.replica) !== op.counter - 1) return false;
    for (const k in op.vc) if (k !== op.replica && vcGet(vc, k) < op.vc[k]) return false;
    return true;
  }

  /** Integrate one causally-ready op into log + doc. */
  private integrate(op: Op, dirty: Set<ShapeId>): void {
    this.log.append(op);
    applyOp(this.doc, op);
    if (op.lamport > this.lamport) this.lamport = op.lamport;
    const sid = shapeIdOfOp(op);
    if (sid) dirty.add(sid);
  }

  receive(ops: readonly Op[]): IntegrateResult {
    return this.receiveInternal(ops, false);
  }

  private receiveInternal(ops: readonly Op[], quiet: boolean): IntegrateResult {
    const dirty = new Set<ShapeId>();
    const aliveBefore = new Map<ShapeId, boolean>();
    const applied: Op[] = [];
    let duplicates = 0;
    const collisions: OpId[] = [];

    const noteBefore = (op: Op) => {
      const sid = shapeIdOfOp(op);
      if (sid && !aliveBefore.has(sid)) {
        const rec = this.doc.shapes[sid];
        aliveBefore.set(sid, rec ? isAlive(rec) : false);
      }
    };

    for (const raw of ops) {
      if (!isValidOp(raw)) continue;
      const op = raw;
      if (this.isCovered(op)) {
        duplicates++;
        const existing = this.log.get(op.id);
        if (existing && existing !== op && hashValue(existing) !== hashValue(op)) collisions.push(op.id);
        continue;
      }
      if (this.pending.has(op.id)) {
        duplicates++;
        continue;
      }
      this.pending.set(op.id, op);
    }

    // Drain the causal buffer to a fixpoint.
    let progress = true;
    while (progress && this.pending.size) {
      progress = false;
      const candidates = [...this.pending.values()].sort(compareOps);
      for (const op of candidates) {
        if (this.isCovered(op)) {
          this.pending.delete(op.id);
          continue;
        }
        if (!this.isReady(op)) continue;
        this.pending.delete(op.id);
        noteBefore(op);
        this.integrate(op, dirty);
        applied.push(op);
        progress = true;
      }
    }

    const before = new Set(this.conflictsById.keys());
    if (applied.length) this.afterIntegrate(dirty);
    const after = new Set(this.conflictsById.keys());
    const newConflicts = [...after].filter((id) => !before.has(id));
    const removedConflicts = [...before].filter((id) => !after.has(id));
    const resurrected: ShapeId[] = [];
    for (const [sid, was] of aliveBefore) {
      const rec = this.doc.shapes[sid];
      // Only shapes that existed (and were dead) before this call.
      if (!was && rec && isAlive(rec) && !applied.some((o) => o.kind === "shape.create" && o.shapeId === sid)) resurrected.push(sid);
    }
    if (!quiet && (applied.length || this.pending.size)) this.changed();
    const result: IntegrateResult & { collisions: OpId[] } = {
      applied,
      duplicates,
      buffered: this.pending.size,
      newConflicts,
      removedConflicts,
      resurrected,
      collisions,
    };
    return result;
  }

  private afterIntegrate(dirty: Set<ShapeId>): void {
    // Time-travel checkpoints after an out-of-order insertion are stale.
    const lw = this.log.takeLowWater();
    if (lw !== Infinity) this.checkpoints = this.checkpoints.filter((c) => c.count <= lw);
    this.cutCache.clear();
    this.recomputeConflicts(dirty);
  }

  private recomputeConflicts(shapeIds: Iterable<ShapeId>): void {
    let changed = false;
    const getOp = (id: string) => this.log.get(id);
    for (const sid of shapeIds) {
      const rec = this.doc.shapes[sid];
      const next = rec ? detectShapeConflicts(rec, this.log.forShape(sid), getOp) : [];
      const prev = this.conflictMap.get(sid) ?? [];
      const sig = (l: Conflict[]) => l.map((c) => `${c.id}/${c.status}/${c.resolvedBy?.opId ?? ""}`).join(",");
      if (sig(prev) === sig(next)) continue;
      changed = true;
      if (next.length) this.conflictMap.set(sid, next);
      else this.conflictMap.delete(sid);
    }
    if (!changed) return;
    const flat: Conflict[] = [];
    for (const l of this.conflictMap.values()) flat.push(...l);
    flat.sort((a, b) => a.lamport - b.lamport || (a.id < b.id ? -1 : 1));
    this.conflictsFlat = flat;
    this.conflictsById = new Map(flat.map((c) => [c.id, c] as const));
    this.conflictsByShapeView = new Map([...this.conflictMap].map(([k, v]) => [k, v as readonly Conflict[]]));
  }

  opsSince(vc: VectorClock): Op[] {
    return this.log.all().filter((op) => op.counter > vcGet(vc, op.replica));
  }

  getOp(id: OpId): Op | undefined {
    return this.log.get(id);
  }

  /* ================================================================ local edits */

  private emit(ctx: TxnContext, payload: OpPayload): Op {
    const counter = ctx.counter + 1;
    const lamport = ctx.lamport + 1;
    const id = `${this._id}:${counter}`;
    const header = {
      id,
      replica: this._id,
      counter,
      lamport,
      vc: vcNormalize({ ...ctx.scratch.vc, [this._id]: counter }),
      meta: {
        txn: ctx.txn,
        author: this.label,
        cause: ctx.opts.cause ?? "user",
        wallTime: Math.round(this.now()),
        offline: ctx.opts.offline ? true : undefined,
        label: ctx.opts.label,
        undoes: ctx.opts.undoes,
      },
    };
    const op = jsonClone({ ...header, ...payload } as Op);
    if (!isValidOp(op)) throw new Error(`Weave: produced an invalid op (${payload.kind})`);
    // Undo capture reads the register *before* this op applies.
    if ((ctx.opts.undoable ?? (ctx.opts.cause ?? "user") === "user") && op.kind !== "snapshot.mark") {
      const scratch = ctx.scratch;
      ctx.actions.push(...actionsForOp(op, (sid, key) => scratch.shapes[sid]?.registers[key].value));
    }
    applyOp(ctx.scratch, op);
    ctx.counter = counter;
    ctx.lamport = lamport;
    ctx.ops.push(op);
    return op;
  }

  private runTxn(opts: TransactOptions, build: (ctx: TxnContext) => void): { txn: TxnId; ops: Op[]; ctx: TxnContext } {
    if (this.txn) throw new Error("Weave: nested transactions are not supported");
    const txn: TxnId = `${this._id}:t${this.txnCounter + 1}`;
    const ctx: TxnContext = {
      txn,
      scratch: cloneDoc(this.doc),
      ops: [],
      counter: vcGet(this.doc.vc, this._id),
      lamport: Math.max(this.lamport, this.doc.maxLamport),
      opts,
      actions: [],
    };
    this.txn = ctx;
    try {
      build(ctx);
    } finally {
      this.txn = null;
    }
    if (ctx.ops.length === 0) return { txn, ops: [], ctx };
    this.txnCounter++;
    const dirty = new Set<ShapeId>();
    for (const op of ctx.ops) this.integrate(op, dirty);
    this.afterIntegrate(dirty);
    this.changed();
    return { txn, ops: ctx.ops, ctx };
  }

  private makeTx(ctx: TxnContext): Tx {
    const rec = (id: ShapeId) => ctx.scratch.shapes[id];
    const maxZ = () => {
      let z = 0;
      for (const id in ctx.scratch.shapes) {
        const r = ctx.scratch.shapes[id];
        if (isAlive(r)) z = Math.max(z, r.registers.z.value);
      }
      return z;
    };
    const tx: Tx = {
      create: (init: ShapeInit) => {
        const props: ShapeProps = { ...DEFAULT_PROPS, ...sanitizeProps(init.props ?? {}) } as ShapeProps;
        if (init.props?.z === undefined) props.z = Math.floor(maxZ()) + 1;
        const shapeId = `sh_${this._id}:${ctx.counter + 1}`;
        this.emit(ctx, { kind: "shape.create", shapeId, shapeType: init.type, props });
        if (init.text && TEXT_SHAPES.includes(init.type)) this.emit(ctx, { kind: "text.insert", shapeId, after: null, text: init.text });
        return shapeId;
      },
      update: (shapeId, props) => {
        const r = rec(shapeId);
        if (!r) return;
        if (Object.keys(props).length === 0) {
          this.emit(ctx, { kind: "shape.update", shapeId, props: {} });
          return;
        }
        const san = sanitizeProps(props) as Partial<ShapeProps>;
        const hasBounds = san.x !== undefined || san.y !== undefined || san.w !== undefined || san.h !== undefined;
        if (hasBounds) {
          const b = r.registers.bounds.value;
          san.x ??= b.x;
          san.y ??= b.y;
          san.w ??= b.w;
          san.h ??= b.h;
        }
        const vals = registerValuesOf(san);
        const out: Partial<ShapeProps> = {};
        for (const k of Object.keys(vals) as RegisterKey[]) {
          if (canonicalJson(vals[k]) === canonicalJson(r.registers[k].value)) continue;
          if (k === "bounds") Object.assign(out, { x: san.x, y: san.y, w: san.w, h: san.h });
          else (out as Record<string, unknown>)[k] = (san as Record<string, unknown>)[k];
        }
        if (Object.keys(out).length === 0) return;
        this.emit(ctx, { kind: "shape.update", shapeId, props: out });
      },
      delete: (shapeId) => {
        const r = rec(shapeId);
        if (r && isAlive(r)) this.emit(ctx, { kind: "shape.delete", shapeId });
      },
      setText: (shapeId, next) => {
        const r = rec(shapeId);
        if (!r?.text) return;
        const d = rgaDiff(r.text, next);
        const anchor = rgaCharIdAt(r.text, d.insertAt);
        if (d.deleteIds.length) this.emit(ctx, { kind: "text.delete", shapeId, chars: d.deleteIds });
        if (d.insertText) this.emit(ctx, { kind: "text.insert", shapeId, after: anchor, text: d.insertText });
      },
      insertText: (shapeId, index, text) => {
        const r = rec(shapeId);
        if (!r?.text || !text) return;
        this.emit(ctx, { kind: "text.insert", shapeId, after: rgaCharIdAt(r.text, index), text });
      },
      deleteText: (shapeId, index, length) => {
        const r = rec(shapeId);
        if (!r?.text) return;
        const chars = rgaRange(r.text, index, length);
        if (chars.length) this.emit(ctx, { kind: "text.delete", shapeId, chars });
      },
    };
    return tx;
  }

  transact(build: (tx: Tx) => void, opts: TransactOptions = {}): { txn: TxnId; ops: Op[] } {
    const { txn, ops, ctx } = this.runTxn(opts, (c) => build(this.makeTx(c)));
    const undoable = opts.undoable ?? (opts.cause ?? "user") === "user";
    if (ops.length && undoable) {
      this.undoMgr.recordUser({ txn, label: opts.label ?? "Edit", actions: ctx.actions });
      this.changed();
    }
    return { txn, ops };
  }

  private compensate(entry: UndoEntry, cause: "undo" | "redo", offline: boolean | undefined): { result: UndoResult; inverse: UndoEntry | null } {
    const plan = planUndo(entry, {
      doc: this.doc,
      log: this.log,
      self: new Set([this._id, ...this.ancestors]),
      labelOf: this.labelOf,
    });
    const inverses: UndoAction[] = [];
    const { txn, ops } = this.runTxn(
      { cause, undoable: false, offline, label: `${cause === "undo" ? "Undo" : "Redo"} ${entry.label}`, undoes: entry.txn },
      (ctx) => {
        for (const step of plan.steps) {
          const op = this.emit(ctx, step.payload);
          inverses.push(...step.inverse(op));
        }
      },
    );
    return {
      result: { txn: ops.length ? txn : null, undone: entry.txn, ops, skipped: plan.skipped, label: entry.label },
      inverse: ops.length ? { txn, label: entry.label, actions: inverses } : null,
    };
  }

  undo(opts: { offline?: boolean } = {}): UndoResult | null {
    const entry = this.undoMgr.undoStack.pop();
    if (!entry) return null;
    const { result, inverse } = this.compensate(entry, "undo", opts.offline);
    if (inverse) this.undoMgr.redoStack.push(inverse);
    this.changed();
    return result;
  }

  redo(opts: { offline?: boolean } = {}): UndoResult | null {
    const entry = this.undoMgr.redoStack.pop();
    if (!entry) return null;
    const { result, inverse } = this.compensate(entry, "redo", opts.offline);
    if (inverse) this.undoMgr.undoStack.push(inverse);
    this.changed();
    return result;
  }

  /* ================================================================ snapshots */

  markSnapshot(name: string, opts: { offline?: boolean } = {}): Op {
    const cut = this.doc.vc;
    const { ops } = this.runTxn({ cause: "system", undoable: false, offline: opts.offline, label: "Snapshot" }, (ctx) => {
      const snapshotId = `snap_${this._id}:${ctx.counter + 1}`;
      this.emit(ctx, { kind: "snapshot.mark", snapshotId, name: name.trim().slice(0, 80) || "Snapshot", cut });
    });
    return ops[0];
  }

  /** Full DocState at a causal cut. */
  private docAtCut(vc: VectorClock): DocState {
    const doc = createDoc();
    for (const op of this.log.all()) if (op.counter <= vcGet(vc, op.replica)) applyOp(doc, op);
    return doc;
  }

  restoreSnapshot(snapshotId: string, opts: { offline?: boolean } = {}): { txn: TxnId; ops: Op[] } | null {
    const info = this.doc.snapshots[snapshotId];
    if (!info) return null;
    const target = this.docAtCut(info.cut);
    const res = this.transact(
      (tx) => {
        const ids = new Set([...Object.keys(target.shapes), ...Object.keys(this.doc.shapes)]);
        for (const id of [...ids].sort()) {
          const cur = this.txn!.scratch.shapes[id];
          const tgt = target.shapes[id];
          const tgtAlive = tgt ? isAlive(tgt) : false;
          if (!cur) continue;
          const curAlive = isAlive(cur);
          if (!tgtAlive) {
            if (curAlive) tx.delete(id);
            continue;
          }
          const tv = shapeView(tgt!);
          const cv = shapeView(cur);
          const props: Partial<ShapeProps> = {};
          for (const k of ["x", "y", "w", "h", "points", "stroke", "fill", "strokeWidth", "opacity", "fontSize", "z"] as PropKey[]) {
            if (canonicalJson(tv[k]) !== canonicalJson(cv[k])) (props as Record<string, unknown>)[k] = tv[k];
          }
          if (Object.keys(props).length) tx.update(id, props);
          else if (!curAlive) tx.update(id, {});
          // Text: re-show / hide exact chars.
          if (cur.text && tgt!.text) {
            const tgtVisible = new Set(rgaLayout(tgt!.text).visible.map((n) => n.id));
            const toHide: CharId[] = [];
            const toShow: CharId[] = [];
            for (const n of rgaLayout(this.txn!.scratch.shapes[id].text!).order) {
              const vis = isCharVisible(n);
              if (vis && !tgtVisible.has(n.id)) toHide.push(n.id);
              if (!vis && tgtVisible.has(n.id)) toShow.push(n.id);
            }
            if (toHide.length) this.emit(this.txn!, { kind: "text.delete", shapeId: id, chars: toHide });
            if (toShow.length) this.emit(this.txn!, { kind: "text.undelete", shapeId: id, chars: toShow });
          }
        }
      },
      { cause: "snapshot-restore", undoable: true, label: `Restore “${info.name}”`, offline: opts.offline },
    );
    return res.ops.length ? res : null;
  }

  adoptConflictValue(conflictId: string, opId: OpId, opts: { offline?: boolean } = {}): { txn: TxnId; ops: Op[] } | null {
    const c = this.conflictsById.get(conflictId);
    if (!c || !c.ops.includes(opId)) return null;
    const op = this.log.get(opId);
    if (!op) return null;
    if (c.kind === "concurrent-write" && op.kind === "shape.update") {
      const regs = new Set(c.props.map((p) => REGISTER_OF[p]));
      const props: Partial<ShapeProps> = {};
      for (const [k, v] of Object.entries(op.props)) if (regs.has(REGISTER_OF[k as PropKey])) (props as Record<string, unknown>)[k] = v;
      const res = this.transact((tx) => tx.update(c.shapeId, props), { cause: "adopt", undoable: true, label: `Use ${this.labelOf(op.replica)}'s value`, offline: opts.offline });
      return res.ops.length ? res : null;
    }
    if (c.kind === "delete-vs-edit" && op.kind === "shape.delete") {
      const res = this.transact((tx) => tx.delete(c.shapeId), { cause: "adopt", undoable: true, label: `Apply ${this.labelOf(op.replica)}'s delete`, offline: opts.offline });
      return res.ops.length ? res : null;
    }
    return null;
  }

  /* ================================================================ inspection */

  getShape(id: ShapeId, opts: { includeDead?: boolean } = {}): ShapeView | null {
    const rec = this.doc.shapes[id];
    if (!rec) return null;
    const v = shapeView(rec);
    return v.alive || opts.includeDead ? v : null;
  }

  private explainCtx(): ExplainContext {
    return {
      log: this.log,
      doc: this.doc,
      labelOf: this.labelOf,
      conflictsForShape: (sid) => this.conflictMap.get(sid) ?? [],
    };
  }

  explain(conflictId: string): Explanation | null {
    const c = this.conflictsById.get(conflictId);
    if (!c) return null;
    const rec = this.doc.shapes[c.shapeId];
    const key = `${this.log.forShape(c.shapeId).length}/${rec ? hashDocRecordKey(rec) : ""}/${c.status}/${this.label}`;
    const hit = this.explainCache.get(conflictId);
    if (hit && hit.key === key) return hit.value;
    const value = explainConflict(c, this.explainCtx());
    this.explainCache.set(conflictId, { key, value });
    return value;
  }

  explainShape(shapeId: ShapeId): ShapeProvenance | null {
    return explainShapeProvenance(shapeId, this.explainCtx());
  }

  ghost(conflictId: string, opId?: OpId): { shape: ShapeView | null; props: PropKey[] } | null {
    const c = this.conflictsById.get(conflictId);
    if (!c) return null;
    const rec = this.doc.shapes[c.shapeId];
    if (!rec) return null;
    const view = shapeView(rec);
    const side = opId ?? (c.winner === c.ops[0] ? c.ops[1] : c.ops[0]);
    const op = this.log.get(side);
    if (!op) return null;
    if (c.kind === "concurrent-write" && op.kind === "shape.update") {
      const regs = new Set(c.props.map((p) => REGISTER_OF[p]));
      const patch: Partial<ShapeProps> = {};
      for (const [k, v] of Object.entries(op.props)) if (regs.has(REGISTER_OF[k as PropKey])) (patch as Record<string, unknown>)[k] = v;
      return { shape: { ...view, ...patch, alive: true }, props: c.props };
    }
    if (c.kind === "delete-vs-edit") {
      return op.kind === "shape.delete" ? { shape: null, props: [] } : { shape: { ...view, alive: true }, props: [] };
    }
    return { shape: view, props: [] };
  }

  private materializePrefix(count: number): DocState {
    const all = this.log.all();
    count = Math.max(0, Math.min(count, all.length));
    let start = 0;
    let doc: DocState | null = null;
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      if (this.checkpoints[i].count <= count) {
        doc = cloneDoc(this.checkpoints[i].doc);
        start = this.checkpoints[i].count;
        break;
      }
    }
    if (!doc) doc = createDoc();
    for (let i = start; i < count; i++) {
      applyOp(doc, all[i]);
      const n = i + 1;
      if (n % this.checkpointEvery === 0 && !this.checkpoints.some((c) => c.count === n)) {
        this.checkpoints.push({ count: n, doc: cloneDoc(doc) });
        this.checkpoints.sort((a, b) => a.count - b.count);
      }
    }
    return doc;
  }

  shapesAtOp(opId: OpId | null): ShapeView[] {
    if (opId === null) return [];
    const idx = this.log.indexOf(opId);
    if (idx < 0) return this.getView().shapes;
    const key = `op:${opId}`;
    const hit = this.cutCache.get(key);
    if (hit && hit.version === this.log.version) return hit.shapes;
    const shapes = aliveViews(this.materializePrefix(idx + 1));
    this.cutCache.set(key, { version: this.log.version, shapes });
    return shapes;
  }

  shapesAtCut(vc: VectorClock): ShapeView[] {
    const key = `cut:${canonicalJson(vcNormalize(vc))}`;
    const hit = this.cutCache.get(key);
    if (hit && hit.version === this.log.version) return hit.shapes;
    const shapes = aliveViews(this.docAtCut(vc));
    if (this.cutCache.size > 64) this.cutCache.clear();
    this.cutCache.set(key, { version: this.log.version, shapes });
    return shapes;
  }

  charIdAt(shapeId: ShapeId, index: number): CharId | null {
    return rgaCharIdAt(this.doc.shapes[shapeId]?.text, index);
  }

  indexAfterChar(shapeId: ShapeId, id: CharId | null): number {
    return rgaIndexAfter(this.doc.shapes[shapeId]?.text, id);
  }

  stableFrontier(peerVcs: readonly VectorClock[]): VectorClock {
    let out: VectorClock = this.doc.vc;
    for (const p of peerVcs) out = vcMeet(out, p);
    return out;
  }

  /* ================================================================ persistence / identity */

  toPersisted(): PersistedReplica {
    return {
      version: 2,
      replica: this._id,
      label: this.label,
      ancestors: [...this.ancestors],
      ops: this.log.all().slice(),
      undo: this.undoMgr.toJSON(),
      txnCounter: this.txnCounter,
    };
  }

  fork(newId: ReplicaId, newLabel: string): void {
    if (newId === this._id) return;
    this.ancestors.push(this._id);
    this._id = newId;
    this.label = newLabel;
    this.undoMgr.clear();
    this.txnCounter = 0;
    this.explainCache.clear();
    this.changed();
  }

  setLabel(label: string): void {
    if (label === this.label) return;
    this.label = label;
    this.explainCache.clear();
    this.changed();
  }

  /** Debug/test: full-rebuild check that incremental state equals a from-scratch replay. */
  verifyIntegrity(): { ok: boolean; incremental: string; replay: string } {
    const doc = createDoc();
    for (const op of this.log.all()) applyOp(doc, op);
    const a = hashDoc(this.doc),
      b = hashDoc(doc);
    return { ok: a === b, incremental: a, replay: b };
  }
}

function hashDocRecordKey(rec: object): string {
  // Records are immutable: identity is a perfect cache key within one process.
  let id = recordIds.get(rec);
  if (!id) {
    id = String(++recordSeq);
    recordIds.set(rec, id);
  }
  return id;
}
const recordIds = new WeakMap<object, string>();
let recordSeq = 0;
