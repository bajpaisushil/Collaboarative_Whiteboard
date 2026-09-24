import { describe, expect, it } from "vitest";
import { Replica } from "../replica";

let t = 1_000_000;
const now = () => (t += 1000);

function pair() {
  const a = new Replica({ replica: "ra", label: "A", now });
  const b = new Replica({ replica: "rb", label: "B", now });
  return { a, b };
}

function sync(...rs: Replica[]) {
  for (const x of rs) for (const y of rs) if (x !== y) y.receive(x.opsSince(y.getView().vc));
}

describe("replica smoke", () => {
  it("converges and detects a concurrent colour write", () => {
    const { a, b } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "sticky", props: { x: 10, y: 10, w: 200, h: 160, fill: "#ffe58a" }, text: "Plan" });
    });
    sync(a, b);
    expect(b.getView().shapes).toHaveLength(1);
    a.transact((tx) => tx.update(id, { fill: "#ffc2a8" }), { label: "Recolour" });
    b.transact((tx) => tx.update(id, { fill: "#b8ecd9" }), { label: "Recolour" });
    sync(a, b);
    const va = a.getView(),
      vb = b.getView();
    expect(va.stateHash).toBe(vb.stateHash);
    expect(va.conflicts).toHaveLength(1);
    expect(va.conflicts[0].id).toBe(vb.conflicts[0].id);
    expect(va.conflicts[0].kind).toBe("concurrent-write");
    const ex = a.explain(va.conflicts[0].id)!;
    expect(ex).not.toBeNull();
    expect(ex.vcProof.relation).toBe("concurrent");
    expect(ex.convergence.equal).toBe(true);
    // equal lamport → tie-break by replica id: "rb" > "ra" → B wins
    expect(va.shapes[0].fill).toBe("#b8ecd9");
    expect(ex.steps.find((s) => s.id === "tiebreak")!.outcome).toBe("decisive");
  });

  it("update-wins resurrects a concurrently edited shape", () => {
    const { a, b } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "rect", props: { x: 0, y: 0, w: 100, h: 50 } });
    });
    sync(a, b);
    a.transact((tx) => tx.delete(id));
    b.transact((tx) => tx.update(id, { fill: "#1b998b" }));
    sync(a, b);
    expect(a.getView().shapes).toHaveLength(1);
    expect(b.getView().shapes).toHaveLength(1);
    const c = a.getView().conflicts.find((x) => x.kind === "delete-vs-edit");
    expect(c).toBeTruthy();
    expect(a.explain(c!.id)!.counterfactuals.find((x) => x.id === "delete-wins")!.result!.alive).toBe(false);
  });

  it("merges concurrent typing and reports an anchor conflict", () => {
    const { a, b } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "sticky", props: { w: 200, h: 100 }, text: "Hello" });
    });
    sync(a, b);
    a.transact((tx) => tx.insertText(id, 5, " world"));
    b.transact((tx) => tx.insertText(id, 5, " there"));
    sync(a, b);
    const ta = a.getView().shapes[0].text;
    expect(ta).toBe(b.getView().shapes[0].text);
    expect(ta.length).toBe(17);
    expect(a.getView().conflicts.filter((c) => c.kind === "concurrent-text")).toHaveLength(1);
  });

  it("undo never clobbers a later remote edit; redo restores", () => {
    const { a, b } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "rect", props: { w: 10, h: 10, fill: "#ffffff" } });
    });
    sync(a, b);
    a.transact((tx) => tx.update(id, { fill: "#e4572e" }), { label: "Recolour" }); // t1
    sync(a, b);
    b.transact((tx) => tx.update(id, { fill: "#d99100" })); // causally after t1
    sync(a, b);
    a.transact((tx) => tx.update(id, { fill: "#1b998b" }), { label: "Recolour" }); // t2
    const u2 = a.undo()!; // restores B's amber
    expect(u2.ops).toHaveLength(1);
    expect(a.getView().shapes[0].fill).toBe("#d99100");
    const u1 = a.undo()!; // t1 no longer holds the register → skipped
    expect(u1.ops).toHaveLength(0);
    expect(u1.skipped[0].reason).toMatch(/changed it after you/);
    expect(a.getView().shapes[0].fill).toBe("#d99100");
    a.redo(); // redo of u2 → teal again
    expect(a.getView().shapes[0].fill).toBe("#1b998b");
  });

  it("undo of delete revives, redo deletes again", () => {
    const { a } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "ellipse", props: { w: 10, h: 10 } });
    });
    a.transact((tx) => tx.delete(id), { label: "Delete" });
    expect(a.getView().shapes).toHaveLength(0);
    a.undo();
    expect(a.getView().shapes).toHaveLength(1);
    a.redo();
    expect(a.getView().shapes).toHaveLength(0);
    a.undo();
    expect(a.getView().shapes).toHaveLength(1);
  });

  it("text undo re-shows exact chars", () => {
    const { a } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "sticky", props: { w: 10, h: 10 }, text: "abcde" });
    });
    a.transact((tx) => tx.deleteText(id, 1, 3), { label: "Erase" });
    expect(a.getView().shapes[0].text).toBe("ae");
    a.undo();
    expect(a.getView().shapes[0].text).toBe("abcde");
  });

  it("buffers out-of-order ops until causally ready", () => {
    const { a, b } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "rect", props: { w: 10, h: 10 } });
    });
    a.transact((tx) => tx.update(id, { x: 50, y: 50 }));
    const ops = a.opsSince({});
    const r1 = b.receive([ops[1]]);
    expect(r1.applied).toHaveLength(0);
    expect(r1.buffered).toBe(1);
    const r2 = b.receive([ops[0], ops[0]]);
    expect(r2.applied).toHaveLength(2);
    expect(b.getView().stateHash).toBe(a.getView().stateHash);
  });

  it("snapshots restore as ordinary ops", () => {
    const { a } = pair();
    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "sticky", props: { w: 10, h: 10, fill: "#ffe58a" }, text: "v1" });
    });
    const snap = a.markSnapshot("before");
    a.transact((tx) => tx.update(id, { fill: "#bcd4ff" }));
    a.transact((tx) => tx.setText(id, "v2!"));
    a.transact((tx) => tx.create({ type: "rect", props: { w: 5, h: 5 } }));
    const sid = (snap as { snapshotId: string }).snapshotId;
    expect(a.restoreSnapshot(sid)).not.toBeNull();
    const v = a.getView();
    expect(v.shapes).toHaveLength(1);
    expect(v.shapes[0].fill).toBe("#ffe58a");
    expect(v.shapes[0].text).toBe("v1");
    expect(a.shapesAtCut(v.snapshots[0].cut)).toHaveLength(1);
  });

  it("persists and restores", () => {
    const { a } = pair();
    a.transact((tx) => {
      tx.create({ type: "sticky", props: { w: 10, h: 10 }, text: "keep" });
    });
    const p = JSON.parse(JSON.stringify(a.toPersisted()));
    const a2 = new Replica({ replica: "ra", persisted: p, now });
    expect(a2.getView().stateHash).toBe(a.getView().stateHash);
    expect(a2.getView().canUndo).toBe(true);
    expect(a2.verifyIntegrity().ok).toBe(true);
  });
});
