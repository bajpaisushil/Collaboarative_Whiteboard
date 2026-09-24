/**
 * Document state & op application (docs/ARCHITECTURE.md §3).
 *
 * `applyOp` is an idempotent, monotone join: re-applying an op, or applying it on top of a
 * state that already contains causally-later/concurrent ops, yields the same result as any
 * other causally-valid order. ShapeRecords are immutable values: applyOp replaces a record,
 * never mutates it, so records (and their views) can be shared across checkpoints.
 */
import { antichainInsert, dwVisible, orVisible } from "./antichain";
import { hashValue } from "./hash";
import { EMPTY_RGA, rgaDelete, rgaInsert, rgaRuns, rgaText, rgaUndelete } from "./rga";
import type {
  CausalRef,
  DeletePolicy,
  DocState,
  Op,
  Register,
  RegisterKey,
  RegisterValues,
  Registers,
  ShapeId,
  ShapeProps,
  ShapeRecord,
  ShapeView,
  Stamp,
} from "./types";
import { REGISTER_KEYS, TEXT_SHAPES } from "./types";
import { parseOpId, vcNormalize } from "./vector-clock";

export const DEFAULT_PROPS: ShapeProps = {
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  points: [],
  stroke: "#1d1b16",
  fill: "none",
  strokeWidth: 2,
  opacity: 1,
  fontSize: 20,
  z: 0,
};

export function createDoc(): DocState {
  return { shapes: {}, snapshots: {}, vc: {}, maxLamport: 0 };
}

/** Shallow clone: records are immutable, so sharing them is safe. */
export function cloneDoc(doc: DocState): DocState {
  return { shapes: { ...doc.shapes }, snapshots: { ...doc.snapshots }, vc: { ...doc.vc }, maxLamport: doc.maxLamport };
}

/* ------------------------------------------------------------------ stamps */

export function stampOf(op: Op): Stamp {
  return { opId: op.id, lamport: op.lamport, replica: op.replica };
}

/** Canonical order on stamps: (lamport, replica, counter). */
export function compareStamps(a: Stamp, b: Stamp): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.replica !== b.replica) return a.replica < b.replica ? -1 : 1;
  const ca = parseOpId(a.opId).counter,
    cb = parseOpId(b.opId).counter;
  return ca - cb;
}

export function refOf(op: Op): CausalRef {
  return { opId: op.id, lamport: op.lamport, vc: op.vc };
}

/* ------------------------------------------------------------------ registers */

export function registerValuesOf(props: Partial<ShapeProps>): Partial<RegisterValues> {
  const out: Partial<RegisterValues> = {};
  if (props.x !== undefined && props.y !== undefined && props.w !== undefined && props.h !== undefined) {
    out.bounds = { x: props.x, y: props.y, w: props.w, h: props.h };
  }
  if (props.points !== undefined) out.points = props.points;
  if (props.stroke !== undefined) out.stroke = props.stroke;
  if (props.fill !== undefined) out.fill = props.fill;
  if (props.strokeWidth !== undefined) out.strokeWidth = props.strokeWidth;
  if (props.opacity !== undefined) out.opacity = props.opacity;
  if (props.fontSize !== undefined) out.fontSize = props.fontSize;
  if (props.z !== undefined) out.z = props.z;
  return out;
}

/** Flatten register values back into ShapeProps fields. */
export function propsOfRegister<K extends RegisterKey>(key: K, value: RegisterValues[K]): Partial<ShapeProps> {
  if (key === "bounds") {
    const b = value as RegisterValues["bounds"];
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  return { [key]: value } as Partial<ShapeProps>;
}

export function registersWritten(op: Op): RegisterKey[] {
  if (op.kind === "shape.create") return [...REGISTER_KEYS];
  if (op.kind !== "shape.update") return [];
  return Object.keys(registerValuesOf(op.props)) as RegisterKey[];
}

function initialRegisters(props: ShapeProps, stamp: Stamp): Registers {
  const v = registerValuesOf(props) as RegisterValues;
  const regs = {} as Record<RegisterKey, Register<unknown>>;
  for (const k of REGISTER_KEYS) regs[k] = { value: v[k], stamp };
  return regs as Registers;
}

/* ------------------------------------------------------------------ apply */

export interface ApplyEffect {
  shapeId?: ShapeId;
  snapshot?: string;
}

function bumpClock(doc: DocState, op: Op): void {
  if ((doc.vc[op.replica] ?? 0) < op.counter) doc.vc = vcNormalize({ ...doc.vc, [op.replica]: op.counter });
  if (op.lamport > doc.maxLamport) doc.maxLamport = op.lamport;
}

/** Apply one op in place on `doc` (replacing at most one record). */
export function applyOp(doc: DocState, op: Op): ApplyEffect {
  bumpClock(doc, op);
  if (op.kind === "snapshot.mark") {
    if (!doc.snapshots[op.snapshotId]) {
      doc.snapshots = {
        ...doc.snapshots,
        [op.snapshotId]: {
          snapshotId: op.snapshotId,
          name: op.name,
          opId: op.id,
          replica: op.replica,
          author: op.meta.author,
          lamport: op.lamport,
          cut: op.cut,
          wallTime: op.meta.wallTime,
        },
      };
    }
    return { snapshot: op.snapshotId };
  }

  const id = op.shapeId;
  const rec = doc.shapes[id];

  if (op.kind === "shape.create") {
    if (rec) return { shapeId: id }; // idempotent (ids are unique per create op)
    doc.shapes[id] = {
      id,
      type: op.shapeType,
      createdBy: op.id,
      registers: initialRegisters(op.props, stampOf(op)),
      writers: [refOf(op)],
      deletes: [],
      text: TEXT_SHAPES.includes(op.shapeType) ? EMPTY_RGA : undefined,
    };
    return { shapeId: id };
  }

  if (!rec) return {}; // causal delivery guarantees create first; ignore otherwise

  let next: ShapeRecord = rec;
  switch (op.kind) {
    case "shape.update": {
      const vals = registerValuesOf(op.props);
      const stamp = stampOf(op);
      let regs: Registers | null = null;
      for (const k of Object.keys(vals) as RegisterKey[]) {
        const cur = (regs ?? rec.registers)[k];
        if (compareStamps(stamp, cur.stamp) > 0) {
          if (!regs) regs = { ...rec.registers };
          (regs as Record<RegisterKey, Register<unknown>>)[k] = { value: vals[k], stamp };
        }
      }
      const writers = antichainInsert(rec.writers, refOf(op));
      if (regs || writers !== rec.writers) next = { ...rec, registers: regs ?? rec.registers, writers };
      break;
    }
    case "shape.delete": {
      const deletes = antichainInsert(rec.deletes, refOf(op));
      if (deletes !== rec.deletes) next = { ...rec, deletes };
      break;
    }
    case "text.insert": {
      if (!rec.text) break;
      const text = rgaInsert(rec.text, op);
      const writers = antichainInsert(rec.writers, refOf(op));
      if (text !== rec.text || writers !== rec.writers) next = { ...rec, text, writers };
      break;
    }
    case "text.delete": {
      if (!rec.text) break;
      const text = rgaDelete(rec.text, op);
      if (text !== rec.text) next = { ...rec, text }; // not a keep-alive
      break;
    }
    case "text.undelete": {
      if (!rec.text) break;
      const text = rgaUndelete(rec.text, op);
      const writers = antichainInsert(rec.writers, refOf(op));
      if (text !== rec.text || writers !== rec.writers) next = { ...rec, text, writers };
      break;
    }
  }
  if (next !== rec) doc.shapes[id] = next;
  return { shapeId: id };
}

/* ------------------------------------------------------------------ liveness & views */

export function isAlive(rec: ShapeRecord, policy: DeletePolicy = "update-wins"): boolean {
  return policy === "update-wins" ? orVisible(rec.writers, rec.deletes) : dwVisible(rec.writers, rec.deletes);
}

export function flatProps(rec: ShapeRecord): ShapeProps {
  const r = rec.registers;
  return {
    x: r.bounds.value.x,
    y: r.bounds.value.y,
    w: r.bounds.value.w,
    h: r.bounds.value.h,
    points: r.points.value,
    stroke: r.stroke.value,
    fill: r.fill.value,
    strokeWidth: r.strokeWidth.value,
    opacity: r.opacity.value,
    fontSize: r.fontSize.value,
    z: r.z.value,
  };
}

const viewCache = new WeakMap<ShapeRecord, ShapeView>();

/** View of a record; identical object while the record is unchanged (structural sharing). */
export function shapeView(rec: ShapeRecord): ShapeView {
  const hit = viewCache.get(rec);
  if (hit) return hit;
  let last: Stamp = rec.registers.bounds.stamp;
  for (const k of REGISTER_KEYS) if (compareStamps(rec.registers[k].stamp, last) > 0) last = rec.registers[k].stamp;
  const view: ShapeView = {
    ...flatProps(rec),
    id: rec.id,
    type: rec.type,
    text: rgaText(rec.text),
    runs: rec.text ? rgaRuns(rec.text) : undefined,
    createdBy: parseOpId(rec.createdBy).replica,
    lastEditedBy: last.replica,
    alive: isAlive(rec),
  };
  viewCache.set(rec, view);
  return view;
}

export function compareRender(a: ShapeView, b: ShapeView): number {
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Alive shapes in render order. */
export function aliveViews(doc: DocState): ShapeView[] {
  const out: ShapeView[] = [];
  for (const id in doc.shapes) {
    const v = shapeView(doc.shapes[id]);
    if (v.alive) out.push(v);
  }
  return out.sort(compareRender);
}

/* ------------------------------------------------------------------ hashing */

const recordHash = new WeakMap<ShapeRecord, string>();

export function hashRecord(rec: ShapeRecord): string {
  let h = recordHash.get(rec);
  if (!h) {
    h = hashValue(rec);
    recordHash.set(rec, h);
  }
  return h;
}

/** Hash of the canonical document: equal ⇔ same op set (for converged replicas). */
export function hashDoc(doc: DocState): string {
  const ids = Object.keys(doc.shapes).sort();
  let s = "";
  for (const id of ids) s += id + "=" + hashRecord(doc.shapes[id]) + ";";
  const snaps = Object.keys(doc.snapshots).sort();
  for (const id of snaps) s += id + ";";
  return hashValue({ s, vc: doc.vc, m: doc.maxLamport });
}
