/**
 * Property tests (fast-check): random multi-replica editing with random partial syncs and
 * random causally-valid delivery orders must always converge to byte-identical state and
 * identical conflict lists; every conflict's order-independence check must hold; incremental
 * state must equal a from-scratch replay; the Lamport property must hold for every op.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Replica } from "../replica";
import type { Op } from "../types";
import { happenedBefore } from "../vector-clock";

type Action =
  | { t: "create"; r: number; kind: number; x: number }
  | { t: "move"; r: number; pick: number; x: number; y: number }
  | { t: "resize"; r: number; pick: number; w: number }
  | { t: "color"; r: number; pick: number; c: number }
  | { t: "delete"; r: number; pick: number }
  | { t: "type"; r: number; pick: number; at: number; s: string }
  | { t: "erase"; r: number; pick: number; at: number; n: number }
  | { t: "undo"; r: number }
  | { t: "redo"; r: number }
  | { t: "sync"; from: number; to: number; frac: number };

const R = 3;
const COLORS = ["#e4572e", "#1b998b", "#d99100", "#4f5ddb"];
const KINDS = ["rect", "sticky", "ellipse", "text"] as const;

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ t: fc.constant("create" as const), r: fc.nat(R - 1), kind: fc.nat(3), x: fc.integer({ min: 0, max: 500 }) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant("move" as const), r: fc.nat(R - 1), pick: fc.nat(20), x: fc.integer({ min: -50, max: 500 }), y: fc.integer({ min: -50, max: 500 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("resize" as const), r: fc.nat(R - 1), pick: fc.nat(20), w: fc.integer({ min: 5, max: 300 }) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant("color" as const), r: fc.nat(R - 1), pick: fc.nat(20), c: fc.nat(3) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("delete" as const), r: fc.nat(R - 1), pick: fc.nat(20) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant("type" as const), r: fc.nat(R - 1), pick: fc.nat(20), at: fc.nat(30), s: fc.string({ minLength: 1, maxLength: 4, unit: fc.constantFrom("a", "b", "c", "x", "y", " ", "é", "🙂") }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("erase" as const), r: fc.nat(R - 1), pick: fc.nat(20), at: fc.nat(30), n: fc.integer({ min: 1, max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("undo" as const), r: fc.nat(R - 1) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("redo" as const), r: fc.nat(R - 1) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant("sync" as const), from: fc.nat(R - 1), to: fc.nat(R - 1), frac: fc.double({ min: 0, max: 1, noNaN: true }) }) },
);

function run(actions: Action[], seed: number) {
  let clock = 1_700_000_000_000;
  const replicas = Array.from({ length: R }, (_, i) => new Replica({ replica: `r${i}x`, label: String.fromCharCode(65 + i), now: () => (clock += 7) }));
  // Deterministic shuffle for delivery orders.
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const shuffle = <T,>(xs: T[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };

  for (const a of actions) {
    if (a.t === "sync") {
      if (a.from === a.to) continue;
      const src = replicas[a.from],
        dst = replicas[a.to];
      const missing = src.opsSince(dst.getView().vc);
      // Deliver a random subset in a random order, with duplicates (causal buffer must cope).
      const subset = shuffle(missing.filter(() => rnd() < Math.max(0.2, a.frac)));
      if (subset.length) subset.push(subset[0]);
      dst.receive(JSON.parse(JSON.stringify(subset)) as Op[]);
      continue;
    }
    if (a.t === "undo") {
      replicas[a.r].undo();
      continue;
    }
    if (a.t === "redo") {
      replicas[a.r].redo();
      continue;
    }
    const rep = replicas[a.r];
    const shapes = rep.getView().shapes;
    if (a.t === "create") {
      rep.transact((tx) => {
        tx.create({ type: KINDS[a.kind], props: { x: a.x, y: 10, w: 100, h: 80 }, text: KINDS[a.kind] === "sticky" ? "hi" : undefined });
      }, { label: "Create" });
      continue;
    }
    if (shapes.length === 0) continue;
    const sh = shapes[a.pick % shapes.length];
    rep.transact(
      (tx) => {
        switch (a.t) {
          case "move":
            tx.update(sh.id, { x: a.x, y: a.y });
            break;
          case "resize":
            tx.update(sh.id, { w: a.w, h: a.w / 2 });
            break;
          case "color":
            tx.update(sh.id, { fill: COLORS[a.c] });
            break;
          case "delete":
            tx.delete(sh.id);
            break;
          case "type":
            tx.insertText(sh.id, Math.min(a.at, Array.from(sh.text).length), a.s);
            break;
          case "erase":
            tx.deleteText(sh.id, a.at % Math.max(1, Array.from(sh.text).length), a.n);
            break;
        }
      },
      { label: a.t },
    );
  }

  // Full sync: everyone gets everything, in a random order per receiver.
  for (let round = 0; round < 2; round++) {
    for (const dst of replicas) {
      const all: Op[] = [];
      for (const src of replicas) if (src !== dst) all.push(...src.opsSince(dst.getView().vc));
      dst.receive(shuffle(all));
    }
  }
  return replicas;
}

describe("convergence properties", () => {
  it("all replicas converge to identical state, conflicts, and pass invariants", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 60 }), fc.integer(), (actions, seed) => {
        const reps = run(actions, seed);
        const views = reps.map((r) => r.getView());
        for (const v of views) expect(v.pending).toHaveLength(0);
        const hashes = views.map((v) => v.stateHash);
        expect(new Set(hashes).size).toBe(1);
        const conflictIds = views.map((v) => v.conflicts.map((c) => `${c.id}/${c.status}`).join(","));
        expect(new Set(conflictIds).size).toBe(1);
        const texts = views.map((v) => v.shapes.map((s) => `${s.id}:${s.text}:${s.fill}:${s.x}`).join("|"));
        expect(new Set(texts).size).toBe(1);
        // Incremental state equals a replay from scratch.
        for (const r of reps) expect(r.verifyIntegrity().ok).toBe(true);
        // Lamport property: x → y ⇒ L(x) < L(y).
        const log = views[0].log;
        for (let i = 0; i < log.length; i++)
          for (let j = 0; j < log.length; j++) if (happenedBefore(log[i], log[j])) expect(log[i].lamport).toBeLessThan(log[j].lamport);
        // Every explanation exists and proves order independence.
        for (const c of views[0].conflicts) {
          const ex = reps[0].explain(c.id);
          expect(ex).not.toBeNull();
          expect(ex!.convergence.equal).toBe(true);
          expect(ex!.vcProof.relation).toBe("concurrent");
        }
      }),
      { numRuns: 150 },
    );
  });

  it("persist → restore round-trips exactly (JSON)", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 40 }), fc.integer(), (actions, seed) => {
        const [a] = run(actions, seed);
        const p = JSON.parse(JSON.stringify(a.toPersisted()));
        const b = new Replica({ replica: a.id, persisted: p });
        expect(b.getView().stateHash).toBe(a.getView().stateHash);
        expect(b.getView().conflicts.map((c) => c.id)).toEqual(a.getView().conflicts.map((c) => c.id));
      }),
      { numRuns: 60 },
    );
  });

  it("time travel: the full canonical prefix equals the live state", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 50 }), fc.integer(), (actions, seed) => {
        const [a] = run(actions, seed);
        const v = a.getView();
        if (v.log.length === 0) return;
        const last = v.log[v.log.length - 1].id;
        const at = a.shapesAtOp(last).map((s) => s.id + s.text + s.x);
        expect(at).toEqual(v.shapes.map((s) => s.id + s.text + s.x));
        expect(a.shapesAtCut(v.vc).map((s) => s.id)).toEqual(v.shapes.map((s) => s.id));
      }),
      { numRuns: 60 },
    );
  });
});
