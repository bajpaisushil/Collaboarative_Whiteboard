/**
 * The director's scripted scenes, run for real: two WhiteboardSessions over an in-memory hub,
 * the actual ScenarioRunner and stage. Each scene must end in the conflict (or undo skip) it
 * is meant to demonstrate, with both tabs converged.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MemoryHub } from "@/lib/sync/transport";
import { WhiteboardSession } from "@/lib/session/session";
import { createUiStore } from "@/lib/ui/store";
import { ScenarioRunner } from "../runner";
import { scenarioById, type ScenarioId } from "../scenarios";
import { createStage, findConflict } from "../stage";
import { TourController } from "../tour";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, timeout = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await sleep(10);
  }
}

const live: WhiteboardSession[] = [];

afterEach(() => {
  for (const s of live.splice(0)) s.dispose();
});

async function setup() {
  const hub = new MemoryHub();
  const make = (pane: "A" | "B") => {
    const s = new WhiteboardSession({ room: "split-test", pane, label: pane, transport: hub.connect(), storage: null, useLocks: false, heartbeatMs: 40 });
    s.start();
    live.push(s);
    return s;
  };
  const a = make("A");
  const b = make("B");
  await until(() => a.getState().ready && b.getState().ready);
  const stage = createStage({ a, b, storeA: createUiStore(), storeB: createUiStore(), seam: createUiStore() });
  return { a, b, stage };
}

async function play(id: ScenarioId) {
  const env = await setup();
  const runner = new ScenarioRunner({ gapMs: 20 });
  await runner.run(scenarioById(id)!, env.stage);
  const snap = runner.getSnapshot();
  expect(snap.message).toBeNull();
  expect(snap.phase).toBe("done");
  expect(snap.statuses.every((s) => s === "done")).toBe(true);
  await until(() => env.stage.identical());
  return { ...env, snap };
}

describe("split scenes", () => {
  it("colour clash ends in a live concurrent-write on fill, focused everywhere", async () => {
    const { a, b, stage, snap } = await play("colour-clash");
    expect(snap.verdict?.tone).toBe("knot");
    const c = a.replica.getView().conflicts.find((x) => x.id === snap.verdict?.conflictId);
    expect(c?.kind).toBe("concurrent-write");
    expect(c?.props).toContain("fill");
    expect(stage.seam.getState().focus?.id).toBe(c?.id);
    expect(a.replica.getView().stateHash).toBe(b.replica.getView().stateHash);
  });

  it("offline marathon: A's fifth offline edit beats B's later move by Lamport", async () => {
    const { a, b, snap } = await play("offline-marathon");
    const c = a.replica.getView().conflicts.find((x) => x.id === snap.verdict?.conflictId)!;
    expect(c.kind).toBe("concurrent-write");
    const winner = a.replica.getOp(c.winner!)!;
    const loser = a.replica.getOp(c.ops[1])!;
    expect(winner.replica).toBe(a.replica.id);
    expect(winner.lamport).toBeGreaterThan(loser.lamport);
    // B acted later by the wall clock (and its clock ran fast) — wall-clock LWW would pick B.
    expect(loser.meta.wallTime).toBeGreaterThan(winner.meta.wallTime);
    expect(a.replica.explain(c.id)?.counterfactuals.find((cf) => cf.id === "wall-clock")?.differs).toBe(true);
    // The scene restores B's clock.
    expect(b.getState().network.clockSkewMs).toBe(0);
  });

  it("delete vs edit: the note survives in both tabs", async () => {
    const { a, b, snap } = await play("delete-vs-edit");
    const c = a.replica.getView().conflicts.find((x) => x.id === snap.verdict?.conflictId)!;
    expect(c.kind).toBe("delete-vs-edit");
    expect(a.replica.getShape(c.shapeId)?.alive).toBe(true);
    expect(b.replica.getShape(c.shapeId)?.text).toBe("Draft v2");
  });

  it("typing together keeps both words", async () => {
    const { a, snap } = await play("typing-together");
    const c = a.replica.getView().conflicts.find((x) => x.id === snap.verdict?.conflictId)!;
    expect(c.kind).toBe("concurrent-text");
    const text = a.replica.getShape(c.shapeId)!.text;
    expect(text.startsWith("Hello")).toBe(true);
    expect(text).toContain(" world");
    expect(text).toContain(" there");
  });

  it("move vs resize resolves the bounds register atomically", async () => {
    const { a, snap } = await play("move-vs-resize");
    const c = a.replica.getView().conflicts.find((x) => x.id === snap.verdict?.conflictId)!;
    expect(c.kind).toBe("concurrent-write");
    const shape = a.replica.getShape(c.shapeId)!;
    const moved = shape.w === 200 && shape.h === 120;
    const resized = shape.w === 320 && shape.h === 200;
    expect(moved || resized).toBe(true);
  });

  it("undo after merge is skipped because B changed it after A", async () => {
    const { a, snap } = await play("undo-after-merge");
    expect(snap.verdict?.tone).toBe("undo");
    expect(snap.verdict?.answer).toContain("B changed it after you");
    const idea = a.replica.getView().shapes.find((s) => s.text === "Idea")!;
    expect(idea.fill).toBe("#bcd4ff");
  });

  it("stop() halts a scene and reports it", async () => {
    const { stage } = await setup();
    const runner = new ScenarioRunner({ gapMs: 200 });
    const done = runner.run(scenarioById("colour-clash")!, stage);
    await until(() => runner.getSnapshot().statuses[1] === "done");
    runner.stop();
    await done;
    expect(runner.getSnapshot().phase).toBe("stopped");
  });
});

describe("split tour", () => {
  it("auto-plays all five steps and ends focused on the knot", async () => {
    const { a, stage } = await setup();
    const tour = new TourController();
    const detach = tour.attach(stage);
    tour.start();
    for (let i = 0; i < 5; i++) {
      await until(() => !tour.getSnapshot().busy);
      tour.autoplay();
      await until(() => tour.getSnapshot().step > i, 5000);
    }
    const t = tour.getSnapshot();
    expect(t.step).toBe(5);
    const c = findConflict(a, t.stickyId!);
    expect(c?.kind).toBe("concurrent-write");
    expect(stage.seam.getState().focus?.id).toBe(c?.id);
    detach();
  });
});
