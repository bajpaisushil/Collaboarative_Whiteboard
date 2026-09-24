import { describe, expect, it } from "vitest";
import { MemoryHub } from "../../sync/transport";
import { WhiteboardSession } from "../session";
import type { MergeReport, SessionOptions } from "../types";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, timeout = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await sleep(10);
  }
}

function make(hub: MemoryHub, id: string, extra: Partial<SessionOptions> = {}) {
  const s = new WhiteboardSession({
    room: "t",
    pane: id,
    replicaId: `r${id}`,
    transport: hub.connect(),
    storage: null,
    useLocks: false,
    heartbeatMs: 40,
    ...extra,
  });
  s.start();
  return s;
}

describe("WhiteboardSession over MemoryHub", () => {
  it("picks distinct labels, syncs, diverges offline, merges on reconnect", async () => {
    const hub = new MemoryHub();
    const a = make(hub, "a");
    await until(() => a.getState().ready);
    const b = make(hub, "b");
    await until(() => b.getState().ready);
    expect(a.getState().label).toBe("A");
    expect(b.getState().label).toBe("B");

    let id = "";
    a.transact((tx) => {
      id = tx.create({ type: "sticky", props: { x: 0, y: 0, w: 200, h: 150, fill: "#ffe58a" }, text: "Plan" });
    });
    await until(() => b.replica.getView().shapes.length === 1);

    const merges: MergeReport[] = [];
    a.onEvent((e) => e.type === "merge" && merges.push(e.report));
    b.onEvent((e) => e.type === "merge" && merges.push(e.report));

    b.setOnline(false);
    a.transact((tx) => tx.update(id, { fill: "#ffc2a8" }), { label: "Recolour" });
    b.transact((tx) => tx.update(id, { fill: "#b8ecd9" }), { label: "Recolour" });
    b.transact((tx) => tx.insertText(id, 4, "!"), { label: "Type" });
    await sleep(120);
    expect(b.getState().unsyncedLocalOps).toBeGreaterThan(0);
    expect(a.replica.getView().stateHash).not.toBe(b.replica.getView().stateHash);
    const offlineOp = b.replica.getView().log.find((o) => o.meta.offline);
    expect(offlineOp).toBeTruthy();

    b.setOnline(true);
    await until(() => a.replica.getView().stateHash === b.replica.getView().stateHash && a.replica.getView().conflicts.length > 0);
    await b.whenConverged(3000);
    expect(a.replica.getView().conflicts.map((c) => c.id)).toEqual(b.replica.getView().conflicts.map((c) => c.id));
    await until(() => merges.some((m) => m.direction === "rejoined") && merges.some((m) => m.direction === "peer-returned"));
    const rejoin = merges.find((m) => m.direction === "rejoined");
    expect(rejoin).toBeTruthy();
    expect(rejoin!.newConflicts.length).toBeGreaterThan(0);
    a.dispose();
    b.dispose();
  });

  it("converges under chaos (drops, duplicates, jitter)", async () => {
    const hub = new MemoryHub();
    const rnd = mulberry32(42);
    const chaos = { dropRate: 0.3, duplicateRate: 0.3, latencyMs: 5, jitterMs: 30 };
    const a = make(hub, "a", { random: rnd, conditions: chaos });
    const b = make(hub, "b", { random: rnd, conditions: chaos });
    const c = make(hub, "c", { random: rnd, conditions: chaos });
    await until(() => a.getState().ready && b.getState().ready && c.getState().ready);
    const sessions = [a, b, c];
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const s = sessions[i % 3];
      const v = s.replica.getView();
      if (v.shapes.length === 0 || i % 5 === 0) {
        s.transact((tx) => {
          ids.push(tx.create({ type: "rect", props: { x: i, y: i, w: 20, h: 20 } }));
        });
      } else {
        const target = v.shapes[i % v.shapes.length].id;
        if (i % 7 === 0) s.transact((tx) => tx.delete(target));
        else s.transact((tx) => tx.update(target, { x: i * 3, fill: i % 2 ? "#e4572e" : "#1b998b" }));
      }
      await sleep(8);
    }
    // Calm the network, then everything must converge through anti-entropy.
    for (const s of sessions) s.setConditions({ dropRate: 0, duplicateRate: 0, jitterMs: 0, latencyMs: 0 });
    await until(() => {
      const h = sessions.map((s) => s.replica.getView().stateHash);
      return h[0] === h[1] && h[1] === h[2] && sessions.every((s) => s.replica.getView().pending.length === 0);
    }, 8000);
    const conflicts = sessions.map((s) => s.replica.getView().conflicts.map((x) => x.id).join(","));
    expect(conflicts[0]).toBe(conflicts[1]);
    expect(conflicts[1]).toBe(conflicts[2]);
    for (const s of sessions) s.dispose();
  });
});
