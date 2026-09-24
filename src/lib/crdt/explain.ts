/**
 * Explanations: "why were these two concurrent edits resolved this way?" (§6).
 * Everything here is derived from the log — no UI strings are assembled in components beyond
 * formatting. Plain text is written for newcomers; `technical` for engineers.
 */
import { colorName, describeOp, describeProps, propsNoun, shapeNoun } from "./describe";
import { applyOp, createDoc, flatProps, hashRecord, isAlive, propsOfRegister, registerValuesOf, registersWritten, compareStamps } from "./document";
import type { OpLog } from "./oplog";
import { compareOps } from "./oplog";
import { compareSiblings, isCharVisible, rgaLayout, rgaRuns } from "./rga";
import type {
  Conflict,
  Counterfactual,
  DecisionStep,
  DocState,
  ExplainSide,
  Explanation,
  Op,
  OpId,
  PropKey,
  RegisterKey,
  ReplicaId,
  ShapeProps,
  ShapeProvenance,
  ShapeRecord,
  TextAnchorDecision,
  VcProof,
  VcProofRow,
} from "./types";
import { REGISTER_KEYS, REGISTER_OF } from "./types";
import { happenedBefore, vcGet, vcMeet, vcReplicas } from "./vector-clock";

export interface ExplainContext {
  log: OpLog;
  doc: DocState;
  labelOf: (replica: ReplicaId) => string;
  conflictsForShape: (shapeId: string) => readonly Conflict[];
}

/* ------------------------------------------------------------ helpers */

function pick(props: Partial<ShapeProps>, keys: readonly PropKey[]): Partial<ShapeProps> {
  const out: Partial<ShapeProps> = {};
  for (const k of keys) if (props[k] !== undefined) (out as Record<string, unknown>)[k] = props[k];
  return out;
}

/** Materialise one shape from a list of ops (applied in the given order). */
export function materializeShape(ops: readonly Op[], shapeId: string): ShapeRecord | undefined {
  const doc = createDoc();
  for (const op of ops) applyOp(doc, op);
  return doc.shapes[shapeId];
}

function shapeOpsInCut(log: OpLog, shapeId: string, vc: Readonly<Record<string, number>>): Op[] {
  return log.forShape(shapeId).filter((o) => o.counter <= vcGet(vc, o.replica));
}

function fmtVc(vc: Readonly<Record<string, number>>, labelOf: (r: ReplicaId) => string): string {
  const keys = Object.keys(vc).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  return "{" + keys.map((k) => `${labelOf(k)}:${vc[k]}`).join(", ") + "}";
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function buildVcProof(a: Op, b: Op, labelOf: (r: ReplicaId) => string): VcProof {
  const rows: VcProofRow[] = vcReplicas(a.vc, b.vc).map((r) => {
    const av = vcGet(a.vc, r),
      bv = vcGet(b.vc, r);
    return { replica: r, a: av, b: bv, relation: av < bv ? "<" : av > bv ? ">" : "=" };
  });
  const aAhead = rows.filter((r) => r.relation === ">").map((r) => r.replica);
  const bAhead = rows.filter((r) => r.relation === "<").map((r) => r.replica);
  const relation = happenedBefore(a, b) ? "before" : happenedBefore(b, a) ? "after" : aAhead.length || bAhead.length ? "concurrent" : "equal";
  const la = labelOf(a.replica),
    lb = labelOf(b.replica);
  const seen = (op: Op, other: Op) =>
    `When ${labelOf(op.replica)} made its edit it had seen ${vcGet(op.vc, other.replica)} of ${labelOf(other.replica)}'s edits — but ${labelOf(other.replica)}'s edit was #${other.counter}.`;
  const summary =
    relation === "concurrent"
      ? `${seen(a, b)} ${seen(b, a)} Each had seen something the other hadn't, so neither came first: they are concurrent (${la} ∥ ${lb}).`
      : relation === "before"
        ? `${lb} had already seen ${la}'s edit, so ${la}'s came first.`
        : `${la} had already seen ${lb}'s edit, so ${lb}'s came first.`;
  return { rows, relation, aAhead, bAhead, summary };
}

function sideOf(op: Op, ctx: ExplainContext, shapeType: ShapeRecord["type"], keys: readonly PropKey[] | null, base: ShapeRecord | undefined): ExplainSide {
  const wrote = keys && op.kind === "shape.update" ? pick(op.props, keys) : null;
  const baseProps = keys && base ? pick(flatProps(base), keys) : null;
  return {
    opId: op.id,
    replica: op.replica,
    label: ctx.labelOf(op.replica),
    kind: op.kind,
    lamport: op.lamport,
    vc: op.vc,
    wallTime: op.meta.wallTime,
    offline: !!op.meta.offline,
    cause: op.meta.cause,
    wrote,
    base: baseProps,
    summary: describeOp(op, shapeType),
  };
}

/** Base for the order-independence check: (↓a ∪ ↓b) \ {a, b}, restricted to the shape. */
function convergence(ctx: ExplainContext, shapeId: string, a: Op, b: Op) {
  const shapeOps = ctx.log.forShape(shapeId);
  const base = shapeOps.filter(
    (o) => o.id !== a.id && o.id !== b.id && (o.counter <= vcGet(a.vc, o.replica) || o.counter <= vcGet(b.vc, o.replica)),
  );
  const ab = materializeShape([...base, a, b], shapeId);
  const ba = materializeShape([...base, b, a], shapeId);
  const hashAB = ab ? hashRecord(ab) : "0";
  const hashBA = ba ? hashRecord(ba) : "0";
  const la = ctx.labelOf(a.replica),
    lb = ctx.labelOf(b.replica);
  return {
    orderAB: `${la}'s edit arrives first, then ${lb}'s`,
    orderBA: `${lb}'s edit arrives first, then ${la}'s`,
    hashAB,
    hashBA,
    equal: hashAB === hashBA,
  };
}

function valueText(key: PropKey | RegisterKey, props: Partial<ShapeProps> | null): string {
  if (!props) return "—";
  if (key === "fill" || key === "stroke") return colorName(String(props[key]));
  if (key === "bounds" || key === "x" || key === "y") return `(${Math.round(props.x ?? 0)}, ${Math.round(props.y ?? 0)})`;
  return String(props[key as PropKey]);
}

function questionFor(conflict: Conflict, noun: string, win: Partial<ShapeProps> | null, lose: Partial<ShapeProps> | null): string {
  const p = new Set(conflict.props);
  if (p.has("fill") && win && lose) return `Why is this ${noun} ${colorName(String(win.fill))}, not ${colorName(String(lose.fill))}?`;
  if (p.has("stroke") && win && lose) return `Why is this ${noun} ${colorName(String(win.stroke))}, not ${colorName(String(lose.stroke))}?`;
  if ((p.has("x") || p.has("y")) && win) return `Why did the ${noun} end up at (${Math.round(win.x ?? 0)}, ${Math.round(win.y ?? 0)})?`;
  if ((p.has("w") || p.has("h")) && win) return `Why is the ${noun} ${Math.round(Math.abs(win.w ?? 0))}×${Math.round(Math.abs(win.h ?? 0))}?`;
  return `Why does the ${noun} have this ${propsNoun(conflict.props)}?`;
}

function causalPast(ctx: ExplainContext, ops: Op[]): Record<OpId, OpId[]> {
  const out: Record<OpId, OpId[]> = {};
  for (const op of ops) out[op.id] = ctx.log.pastOf(op.vc, op.id);
  return out;
}

/* ------------------------------------------------------------ concurrent-write */

function explainWrite(conflict: Conflict, ctx: ExplainContext, rec: ShapeRecord): Explanation | null {
  const win = ctx.log.get(conflict.ops[0]);
  const lose = ctx.log.get(conflict.ops[1]);
  if (!win || !lose || win.kind !== "shape.update" || lose.kind !== "shape.update") return null;
  const noun = shapeNoun(rec.type);
  const baseCut = vcMeet(win.vc, lose.vc);
  const base = materializeShape(shapeOpsInCut(ctx.log, rec.id, baseCut), rec.id);
  const keys = conflict.props;
  const sW = sideOf(win, ctx, rec.type, keys, base);
  const sL = sideOf(lose, ctx, rec.type, keys, base);
  const lw = sW.label,
    ll = sL.label;
  const proof = buildVcProof(win, lose, ctx.labelOf);
  const what = propsNoun(keys);
  const firstKey = keys[0] ?? "x";

  const steps: DecisionStep[] = [];
  steps.push({
    id: "same-prop",
    title: "They changed the same thing",
    plain: `Both edits changed the ${noun}'s ${what}: ${lw} → ${valueText(firstKey, sW.wrote)}, ${ll} → ${valueText(firstKey, sL.wrote)}. Only one value can win.`,
    technical: `Both ops write register ${[...new Set(keys.map((k) => REGISTER_OF[k]))].join(", ")} of ${rec.id}.`,
    outcome: "info",
    refs: { ops: [win.id, lose.id], props: keys },
  });
  steps.push({
    id: "causal",
    title: "Did either edit see the other?",
    plain: `No. When ${lw} edited, it hadn't seen ${ll}'s edit, and ${ll} hadn't seen ${lw}'s. As far as anyone can know, they happened at the same time — so "who was last" has no answer.`,
    technical: `vc(${win.id}) = ${fmtVc(win.vc, ctx.labelOf)} and vc(${lose.id}) = ${fmtVc(lose.vc, ctx.labelOf)} are incomparable: ${win.id} ∥ ${lose.id}.`,
    outcome: "fail",
    refs: { ops: [win.id, lose.id] },
    highlight: "vc",
  });
  const lamportDecides = win.lamport !== lose.lamport;
  steps.push({
    id: "lamport",
    title: "Higher Lamport timestamp wins",
    plain: lamportDecides
      ? `${lw}'s edit sits on more history: its counter reached ${win.lamport}, ${ll}'s only ${lose.lamport}. Every tab picks the edit with the higher count.`
      : `Both edits have the same counter (${win.lamport}), so this rule can't decide.`,
    technical: lamportDecides ? `L(${win.id}) = ${win.lamport} > L(${lose.id}) = ${lose.lamport} → ${lw} wins.` : `L = ${win.lamport} on both sides → tie.`,
    outcome: lamportDecides ? "decisive" : "pass",
    refs: { ops: [win.id, lose.id] },
    highlight: "lamport",
  });
  steps.push({
    id: "tiebreak",
    title: "Exact tie → fixed coin toss",
    plain: lamportDecides
      ? "Not needed."
      : `A tie is settled by a coin toss fixed when the tabs were created (the tabs' ids): ${lw} beats ${ll} — and every tab computes the same answer.`,
    technical: lamportDecides ? "Skipped." : `replica "${win.replica}" > "${lose.replica}" (string order) → ${lw} wins.`,
    outcome: lamportDecides ? "skipped" : "decisive",
    refs: { replicas: [win.replica, lose.replica] },
    highlight: "replica",
  });
  const superseded = conflict.status === "superseded" && conflict.resolvedBy ? conflict.resolvedBy : null;
  steps.push({
    id: "result",
    title: "Result",
    plain: `The ${noun}'s ${what} is ${lw}'s (${valueText(firstKey, sW.wrote)}). ${ll}'s value (${valueText(firstKey, sL.wrote)}) isn't lost — it stays in the history and you can switch to it.`,
    technical: `Register holder = ${win.id}; ${lose.id} retained in the op log.`,
    outcome: "info",
  });

  const cvg = convergence(ctx, rec.id, win, lose);

  const cfs: Counterfactual[] = [];
  const wallWinner = win.meta.wallTime === lose.meta.wallTime ? win : win.meta.wallTime > lose.meta.wallTime ? win : lose;
  const wallDiffers = wallWinner !== win;
  cfs.push({
    id: "wall-clock",
    title: "Trust wall clocks?",
    detail: `${lw}'s clock said ${fmtTime(win.meta.wallTime)}, ${ll}'s ${fmtTime(lose.meta.wallTime)}. ` +
      (wallDiffers
        ? `"Latest wall-clock time wins" would pick ${ll}'s value — but clocks on different devices drift (use the clock-drift slider to see it), so Weave never uses them.`
        : `Here wall clocks happen to agree with Weave — but clocks on different devices drift, so Weave can't rely on them.`),
    differs: wallDiffers,
    result: wallDiffers ? { props: sL.wrote ?? undefined } : null,
  });
  cfs.push({
    id: "reverse-tiebreak",
    title: "If ties went the other way",
    detail: lamportDecides
      ? `Same result: the Lamport counter decided before any tie-break was needed.`
      : `${ll} would win. The direction is arbitrary — what matters is that every tab uses the same one.`,
    differs: !lamportDecides,
    result: !lamportDecides ? { props: sL.wrote ?? undefined } : null,
  });
  cfs.push({
    id: "other-order",
    title: `If ${ll}'s edit had synced first`,
    detail: `Same result. Weave's merge doesn't depend on arrival order — check the fingerprints: ${cvg.equal ? "identical" : "DIFFERENT (bug!)"}.`,
    differs: !cvg.equal,
    result: null,
  });

  const answer = `${lw} and ${ll} changed the ${noun}'s ${what} at the same time — neither had seen the other's edit. ` +
    (lamportDecides
      ? `${lw}'s edit carried the higher Lamport counter (${win.lamport} vs ${lose.lamport}), and every tab applies that same rule, so they all agree on ${lw}'s ${what}.`
      : `Their counters tied (${win.lamport}), so a fixed tie-break every tab agrees on picked ${lw}.`);

  return {
    conflict,
    question: questionFor(conflict, noun, sW.wrote, sL.wrote),
    answer,
    baseCut,
    sides: [sW, sL],
    vcProof: proof,
    steps,
    outcome: {
      winner: win.id,
      result: sW.wrote,
      discarded: sL.wrote,
      alive: isAlive(rec),
    },
    convergence: cvg,
    counterfactuals: cfs,
    causalPast: causalPast(ctx, [win, lose]),
    supersededBy: superseded ? { opId: superseded.opId, label: ctx.labelOf(superseded.opId.slice(0, superseded.opId.lastIndexOf(":"))) } : undefined,
  };
}

/* ------------------------------------------------------------ delete-vs-edit */

function explainDelete(conflict: Conflict, ctx: ExplainContext, rec: ShapeRecord): Explanation | null {
  const edit = ctx.log.get(conflict.ops[0]);
  const del = ctx.log.get(conflict.ops[1]);
  if (!edit || !del) return null;
  const noun = shapeNoun(rec.type);
  const baseCut = vcMeet(edit.vc, del.vc);
  const base = materializeShape(shapeOpsInCut(ctx.log, rec.id, baseCut), rec.id);
  const sE = sideOf(edit, ctx, rec.type, null, base);
  const sD = sideOf(del, ctx, rec.type, null, base);
  const le = sE.label,
    ld = sD.label;
  const alive = isAlive(rec);
  const steps: DecisionStep[] = [
    {
      id: "observed",
      title: "Had the delete seen the edit?",
      plain: `No. ${ld} deleted the ${noun} without having seen ${le}'s edit (${sE.summary}).`,
      technical: `${edit.id}.counter = ${edit.counter} > vc(${del.id})[${le}] = ${vcGet(del.vc, edit.replica)} → the delete did not observe the edit.`,
      outcome: "fail",
      refs: { ops: [edit.id, del.id] },
      highlight: "vc",
    },
    {
      id: "policy",
      title: "Policy: an unseen edit keeps the shape",
      plain: `Weave only deletes what the deleter had actually seen. ${le}'s edit was news to ${ld}, so it brings the ${noun} back — offline work is never silently thrown away.`,
      technical: `Observed-remove (update-wins): alive ⇔ ∃ writer w with no delete d such that w.vc ≤ d.vc. ${edit.id} is such a writer.`,
      outcome: "decisive",
      highlight: "policy",
    },
    {
      id: "result",
      title: "Result",
      plain: alive
        ? `The ${noun} is still on the board, with ${le}'s edit applied. ${ld} can delete it again now that they've seen the edit.`
        : `The ${noun} was later deleted again by someone who had seen ${le}'s edit.`,
      technical: alive ? `isAlive(${rec.id}) = true` : `Superseded: a later delete observed ${edit.id}.`,
      outcome: "info",
    },
  ];
  const cvg = convergence(ctx, rec.id, edit, del);
  const wallLater = del.meta.wallTime > edit.meta.wallTime;
  const cfs: Counterfactual[] = [
    {
      id: "delete-wins",
      title: "If deletes always won",
      detail: `The ${noun} would be gone — and ${le}'s edit with it, without ${le} ever being told.`,
      differs: true,
      result: { alive: false },
    },
    {
      id: "wall-clock",
      title: "Trust wall clocks?",
      detail: wallLater
        ? `The delete happened later by the clock (${fmtTime(del.meta.wallTime)} vs ${fmtTime(edit.meta.wallTime)}), so "latest wins" would delete it. Clocks drift across devices; Weave doesn't use them.`
        : `The edit was later by the clock, so here "latest wins" agrees — by luck.`,
      differs: wallLater,
      result: wallLater ? { alive: false } : null,
    },
    {
      id: "other-order",
      title: `If ${ld}'s delete had synced first`,
      detail: `Same result — the outcome doesn't depend on arrival order (${cvg.equal ? "fingerprints match" : "MISMATCH"}).`,
      differs: !cvg.equal,
      result: null,
    },
  ];
  return {
    conflict,
    question: alive ? `Why is this ${noun} still here? ${ld} deleted it.` : `Why didn't ${ld}'s delete remove this ${noun} at first?`,
    answer: alive
      ? `${le} edited the ${noun} while ${ld}'s delete was happening elsewhere — ${ld} never saw that edit. Weave only removes what the deleter had seen, so ${le}'s edit keeps the ${noun} alive ("update wins").`
      : `${le} edited the ${noun} while ${ld}'s delete was happening elsewhere, so the edit kept it alive ("update wins"). Later, someone who had seen ${le}'s edit deleted it again — so now it's gone.`,
    baseCut,
    sides: [sE, sD],
    vcProof: buildVcProof(edit, del, ctx.labelOf),
    steps,
    outcome: { winner: edit.id, result: null, discarded: null, alive },
    convergence: cvg,
    counterfactuals: cfs,
    causalPast: causalPast(ctx, [edit, del]),
    supersededBy:
      conflict.status === "superseded" && conflict.resolvedBy
        ? { opId: conflict.resolvedBy.opId, label: ctx.labelOf(conflict.resolvedBy.opId.slice(0, conflict.resolvedBy.opId.lastIndexOf(":"))) }
        : undefined,
  };
}

/* ------------------------------------------------------------ concurrent-text */

/** Visible text with the subtrees of two sibling inserts swapped (the reversed-rule what-if). */
function swappedText(state: NonNullable<ShapeRecord["text"]>, opA: OpId, opB: OpId): string | null {
  const layout = rgaLayout(state);
  const range = (opId: OpId): [number, number] | null => {
    const root = `${opId}.0`;
    const start = layout.index.get(root);
    if (start === undefined) return null;
    let size = 0;
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      size++;
      for (const k of layout.children.get(id) ?? []) stack.push(k.id);
    }
    return [start, start + size];
  };
  const ra = range(opA),
    rb = range(opB);
  if (!ra || !rb) return null;
  const [first, second] = ra[0] < rb[0] ? [ra, rb] : [rb, ra];
  const vis = (from: number, to: number) =>
    layout.order
      .slice(from, to)
      .filter((n) => isCharVisible(n))
      .map((n) => n.ch)
      .join("");
  return (
    vis(0, first[0]) + vis(second[0], second[1]) + vis(first[1], second[0]) + vis(first[0], first[1]) + vis(second[1], layout.order.length)
  );
}

function explainText(conflict: Conflict, ctx: ExplainContext, rec: ShapeRecord): Explanation | null {
  const first = ctx.log.get(conflict.ops[0]);
  const second = ctx.log.get(conflict.ops[1]);
  if (!first || !second || first.kind !== "text.insert" || second.kind !== "text.insert" || !rec.text) return null;
  const noun = shapeNoun(rec.type);
  const l1 = ctx.labelOf(first.replica),
    l2 = ctx.labelOf(second.replica);
  const layout = rgaLayout(rec.text);
  const anchor = conflict.anchor ?? null;
  let context = "";
  if (anchor) {
    const pos = layout.index.get(anchor);
    if (pos !== undefined) {
      const vis = layout.order.slice(0, pos + 1).filter((n) => layout.visible.includes(n));
      context = vis.slice(-12).map((n) => n.ch).join("");
    }
  }
  const lamportDecides = first.lamport !== second.lamport;
  const decision: TextAnchorDecision = {
    anchor,
    context,
    order: [first, second]
      .sort((x, y) => compareSiblings(x, y))
      .map((o) => ({ opId: o.id, replica: o.replica, lamport: o.lamport, text: (o as Op & { kind: "text.insert" }).text })),
    rule: lamportDecides
      ? `Both typed right after “${context || "the start"}”. The insert with the higher Lamport counter sits closer to that spot, so ${l1}'s text (L${first.lamport}) comes before ${l2}'s (L${second.lamport}).`
      : `Both typed right after “${context || "the start"}” with the same counter (L${first.lamport}); the fixed tie-break (tab id) puts ${l1}'s text first.`,
  };
  const t1 = first.text,
    t2 = second.text;
  const baseCut = vcMeet(first.vc, second.vc);
  const steps: DecisionStep[] = [
    {
      id: "same-spot",
      title: "They typed at the same spot",
      plain: `${l1} typed “${t1}” and ${l2} typed “${t2}”, both right after “${context || "the start"}”.`,
      technical: `Both ${first.id} and ${second.id} are RGA children of ${anchor ?? "the root"}.`,
      outcome: "info",
      highlight: "anchor",
    },
    {
      id: "causal",
      title: "Did either see the other?",
      plain: `No — each typed without having seen the other's text.`,
      technical: `${first.id} ∥ ${second.id}: ${fmtVc(first.vc, ctx.labelOf)} vs ${fmtVc(second.vc, ctx.labelOf)}.`,
      outcome: "fail",
      highlight: "vc",
    },
    {
      id: "keep-both",
      title: "Text is never overwritten",
      plain: `Unlike a colour, text can hold both edits — so Weave keeps every character from both. The only question is the order.`,
      technical: "RGA: inserts commute; only sibling order at the anchor is decided.",
      outcome: "pass",
    },
    {
      id: "order",
      title: lamportDecides ? "Newer insert goes first" : "Tie → fixed coin toss",
      plain: decision.rule,
      technical: lamportDecides
        ? `Siblings ordered by descending (lamport, replica): (${first.lamport}, ${first.replica}) > (${second.lamport}, ${second.replica}).`
        : `Equal lamport ${first.lamport}; replica "${first.replica}" > "${second.replica}".`,
      outcome: "decisive",
      highlight: lamportDecides ? "lamport" : "replica",
    },
  ];
  const cvg = convergence(ctx, rec.id, first, second);
  return {
    conflict,
    question: `Why does the ${noun} read “${layout.text.length > 40 ? layout.text.slice(0, 39) + "…" : layout.text}”?`,
    answer: `${l1} and ${l2} typed at the same spot at the same time. Weave kept both — nothing is lost — and put ${l1}'s “${t1}” first because ${lamportDecides ? "it carried the higher Lamport counter" : "of the fixed tie-break every tab agrees on"}.`,
    baseCut,
    sides: [sideOf(first, ctx, rec.type, null, undefined), sideOf(second, ctx, rec.type, null, undefined)],
    vcProof: buildVcProof(first, second, ctx.labelOf),
    steps,
    outcome: { winner: null, result: null, discarded: null, alive: isAlive(rec), text: rgaRuns(rec.text) },
    convergence: cvg,
    counterfactuals: [
      {
        id: "reverse-tiebreak",
        title: "If the order rule were reversed",
        detail: `${l2}'s “${t2}” would come first. Either rule works as long as every tab uses the same one.`,
        differs: true,
        result: { text: swappedText(rec.text, first.id, second.id) ?? undefined },
      },
      {
        id: "other-order",
        title: `If ${l2}'s typing had synced first`,
        detail: `Same text — the merge is order-independent (${cvg.equal ? "fingerprints match" : "MISMATCH"}).`,
        differs: !cvg.equal,
        result: null,
      },
    ],
    textAnchors: [decision],
    causalPast: causalPast(ctx, [first, second]),
  };
}

export function explainConflict(conflict: Conflict, ctx: ExplainContext): Explanation | null {
  const rec = ctx.doc.shapes[conflict.shapeId];
  if (!rec) return null;
  switch (conflict.kind) {
    case "concurrent-write":
      return explainWrite(conflict, ctx, rec);
    case "delete-vs-edit":
      return explainDelete(conflict, ctx, rec);
    case "concurrent-text":
      return explainText(conflict, ctx, rec);
  }
}

/* ------------------------------------------------------------ provenance */

export function explainShapeProvenance(shapeId: string, ctx: ExplainContext): ShapeProvenance | null {
  const rec = ctx.doc.shapes[shapeId];
  if (!rec) return null;
  const ops = ctx.log.forShape(shapeId);
  const conflicts = ctx.conflictsForShape(shapeId);
  const registers: ShapeProvenance["registers"] = [];
  for (const key of REGISTER_KEYS) {
    const reg = rec.registers[key];
    const holder = ctx.log.get(reg.stamp.opId);
    const writes = ops.filter((o) => registersWritten(o).includes(key) && o.id !== reg.stamp.opId);
    // Show only writes that actually changed this register at some point, newest first.
    const meaningful = writes.filter((o) => o.kind === "shape.update");
    if (key !== "bounds" && key !== "fill" && key !== "stroke" && key !== "points" && meaningful.length === 0 && holder?.kind === "shape.create") continue;
    const overwrote = meaningful
      .filter((o) => compareStamps({ opId: o.id, lamport: o.lamport, replica: o.replica }, reg.stamp) < 0)
      .sort((x, y) => compareOps(y, x))
      .slice(0, 5)
      .map((o) => ({ opId: o.id, label: ctx.labelOf(o.replica), lamport: o.lamport, observed: holder ? happenedBefore(o, holder) : true }));
    const props = propsOfRegister(key, reg.value as never);
    registers.push({
      key,
      props: Object.keys(props) as PropKey[],
      value: reg.value,
      setBy: {
        opId: reg.stamp.opId,
        replica: reg.stamp.replica,
        label: ctx.labelOf(reg.stamp.replica),
        lamport: reg.stamp.lamport,
        cause: holder?.meta.cause ?? "user",
      },
      overwrote,
      conflictIds: conflicts
        .filter((c) => c.kind === "concurrent-write" && c.props.some((p) => REGISTER_OF[p] === key))
        .map((c) => c.id),
    });
  }
  let text: ShapeProvenance["text"];
  if (rec.text) {
    const counts = new Map<ReplicaId, number>();
    for (const n of rgaLayout(rec.text).visible) counts.set(n.replica, (counts.get(n.replica) ?? 0) + 1);
    text = [...counts].map(([replica, chars]) => ({ replica, label: ctx.labelOf(replica), chars }));
  }
  return { shapeId, alive: isAlive(rec), registers, text, conflictIds: conflicts.map((c) => c.id) };
}

export { describeProps, registerValuesOf };
