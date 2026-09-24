/**
 * Local, selective undo/redo via compensating ops (docs/ARCHITECTURE.md §7).
 *
 * Entries record *semantic inverses* (props / kill / revive / text-hide / text-show), never raw
 * ops. The restore rule is keyed on op identity: a register is restored only if the op being
 * undone still holds it; the restored value is what the register would hold without that op
 * (the max-stamp write among the other ops), so concurrent/later edits by others are never
 * clobbered.
 */
import { compareStamps, isAlive, registerValuesOf, stampOf } from "./document";
import type { OpLog } from "./oplog";
import type {
  CharId,
  DocState,
  Op,
  OpId,
  OpPayload,
  RegisterKey,
  RegisterValues,
  ReplicaId,
  ShapeId,
  UndoAction,
  UndoEntry,
  UndoSkip,
  UndoStacks,
} from "./types";
import { isCharVisible } from "./rga";
import { happenedBefore } from "./vector-clock";

const MAX_ENTRIES = 200;

export class UndoManager {
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];

  constructor(stacks?: UndoStacks) {
    if (stacks) {
      this.undoStack = [...stacks.undo];
      this.redoStack = [...stacks.redo];
    }
  }

  toJSON(): UndoStacks {
    return { undo: this.undoStack, redo: this.redoStack };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** A new user edit: push its inverse and clear redo. */
  recordUser(entry: UndoEntry): void {
    if (entry.actions.length === 0) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }
}

/** Build the undo actions for an op the user just made. `prev` = register value before it. */
export function actionsForOp(op: Op, prevValue: (shapeId: ShapeId, key: RegisterKey) => unknown): UndoAction[] {
  switch (op.kind) {
    case "shape.create":
      return [{ kind: "kill", shapeId: op.shapeId }];
    case "shape.update": {
      const vals = registerValuesOf(op.props);
      const keys = Object.keys(vals) as RegisterKey[];
      if (keys.length === 0) return [{ kind: "kill", shapeId: op.shapeId }]; // a revive
      return keys.map((k) => ({
        kind: "props" as const,
        shapeId: op.shapeId,
        register: k,
        opId: op.id,
        value: vals[k],
        prev: prevValue(op.shapeId, k),
      }));
    }
    case "shape.delete":
      return [{ kind: "revive", shapeId: op.shapeId }];
    case "text.insert":
      return [{ kind: "text-hide", shapeId: op.shapeId, chars: Array.from(op.text).map((_, i) => `${op.id}.${i}`) }];
    case "text.delete":
      return [{ kind: "text-show", shapeId: op.shapeId, chars: op.chars, hiddenBy: op.id }];
    case "text.undelete":
      return [{ kind: "text-hide", shapeId: op.shapeId, chars: op.chars }];
    case "snapshot.mark":
      return [];
  }
}

export interface UndoContext {
  doc: DocState;
  log: OpLog;
  self: ReadonlySet<ReplicaId>;
  labelOf: (r: ReplicaId) => string;
}

/** One planned compensating payload, plus how to invert it once emitted. */
export interface PlannedStep {
  payload: OpPayload;
  /** Build the inverse actions given the emitted op. */
  inverse: (op: Op) => UndoAction[];
}

function valueWithout(ctx: UndoContext, shapeId: ShapeId, key: RegisterKey, without: OpId): { found: boolean; value: unknown } {
  let best: { value: unknown; stamp: ReturnType<typeof stampOf> } | null = null;
  for (const o of ctx.log.forShape(shapeId)) {
    if (o.id === without) continue;
    let v: unknown;
    if (o.kind === "shape.create") v = registerValuesOf(o.props)[key];
    else if (o.kind === "shape.update") v = registerValuesOf(o.props)[key];
    else continue;
    if (v === undefined) continue;
    const s = stampOf(o);
    if (!best || compareStamps(s, best.stamp) > 0) best = { value: v, stamp: s };
  }
  return best ? { found: true, value: best.value } : { found: false, value: undefined };
}

function propsForRegister(key: RegisterKey, value: unknown): Record<string, unknown> {
  if (key === "bounds") {
    const b = value as RegisterValues["bounds"];
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  return { [key]: value };
}

/** Plan the compensation for an entry (actions processed in reverse). */
export function planUndo(entry: UndoEntry, ctx: UndoContext): { steps: PlannedStep[]; skipped: UndoSkip[] } {
  const steps: PlannedStep[] = [];
  const skipped: UndoSkip[] = [];
  // Merge per-register restores into one update op per shape.
  const perShape = new Map<ShapeId, { props: Record<string, unknown>; actions: { key: RegisterKey; value: unknown; prevHeld: unknown }[] }>();

  for (let i = entry.actions.length - 1; i >= 0; i--) {
    const a = entry.actions[i];
    const rec = ctx.doc.shapes[a.shapeId];
    if (!rec) continue;
    switch (a.kind) {
      case "props": {
        const reg = rec.registers[a.register];
        if (reg.stamp.opId !== a.opId) {
          const holder = ctx.log.get(reg.stamp.opId);
          const mine = ctx.log.get(a.opId);
          // Credit the *other* user whose later edit we'd clobber, even if the current holder
          // is one of our own undo ops that restored their value.
          const later = mine
            ? ctx.log
                .forShape(a.shapeId)
                .filter((o) => o.id !== a.opId && !ctx.self.has(o.replica) && registerValuesOf(o.kind === "shape.update" ? o.props : {})[a.register] !== undefined)
                .find((o) => happenedBefore(mine, o))
            : undefined;
          let reason: string;
          let by = reg.stamp.replica;
          if (later) {
            reason = `${ctx.labelOf(later.replica)} changed it after you`;
            by = later.replica;
          } else if (holder && mine && !ctx.self.has(holder.replica) && !happenedBefore(mine, holder)) {
            reason = `${ctx.labelOf(holder.replica)}'s concurrent edit won`;
          } else reason = `you changed it again since`;
          skipped.push({ shapeId: a.shapeId, prop: a.register === "bounds" ? "x" : (a.register as never), byReplica: by, reason });
          break;
        }
        const w = valueWithout(ctx, a.shapeId, a.register, a.opId);
        const value = w.found ? w.value : a.prev;
        let e = perShape.get(a.shapeId);
        if (!e) perShape.set(a.shapeId, (e = { props: {}, actions: [] }));
        Object.assign(e.props, propsForRegister(a.register, value));
        e.actions.push({ key: a.register, value, prevHeld: a.value });
        break;
      }
      case "kill": {
        if (!isAlive(rec)) {
          skipped.push({ shapeId: a.shapeId, prop: "shape", byReplica: "", reason: "it was already deleted" });
          break;
        }
        steps.push({ payload: { kind: "shape.delete", shapeId: a.shapeId }, inverse: () => [{ kind: "revive", shapeId: a.shapeId }] });
        break;
      }
      case "revive": {
        if (isAlive(rec)) {
          skipped.push({ shapeId: a.shapeId, prop: "shape", byReplica: "", reason: "it was already back" });
          break;
        }
        steps.push({ payload: { kind: "shape.update", shapeId: a.shapeId, props: {} }, inverse: () => [{ kind: "kill", shapeId: a.shapeId }] });
        break;
      }
      case "text-hide": {
        if (!rec.text) break;
        const nodes = rec.text.nodes;
        const visible = a.chars.filter((c) => nodes[c] && isCharVisible(nodes[c]));
        if (visible.length === 0) break;
        steps.push({
          payload: { kind: "text.delete", shapeId: a.shapeId, chars: visible },
          inverse: (op) => [{ kind: "text-show", shapeId: a.shapeId, chars: visible, hiddenBy: op.id }],
        });
        break;
      }
      case "text-show": {
        if (!rec.text) break;
        const ok: CharId[] = [];
        let other: ReplicaId | null = null;
        for (const c of a.chars) {
          const n = rec.text.nodes[c];
          if (!n) continue;
          const foreign = n.hides.find((h) => h.opId !== a.hiddenBy && !ctx.self.has(h.opId.slice(0, h.opId.lastIndexOf(":"))));
          if (foreign) other = foreign.opId.slice(0, foreign.opId.lastIndexOf(":"));
          else ok.push(c);
        }
        if (other) skipped.push({ shapeId: a.shapeId, prop: "text", byReplica: other, reason: `${ctx.labelOf(other)} also deleted some of that text` });
        if (ok.length === 0) break;
        steps.push({
          payload: { kind: "text.undelete", shapeId: a.shapeId, chars: ok },
          inverse: () => [{ kind: "text-hide", shapeId: a.shapeId, chars: ok }],
        });
        break;
      }
    }
  }

  for (const [shapeId, e] of perShape) {
    steps.push({
      payload: { kind: "shape.update", shapeId, props: e.props },
      // The emitted op now holds these registers: one props action per register.
      inverse: (op) =>
        e.actions.map((act) => ({ kind: "props" as const, shapeId, register: act.key, opId: op.id, value: act.value, prev: act.prevHeld })),
    });
  }
  return { steps, skipped };
}

