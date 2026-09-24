import { expect, test, type Page } from "@playwright/test";

/**
 * Two tabs = two users. Pages share one browser context (so BroadcastChannel connects them)
 * and each has its own sessionStorage (so each is its own replica).
 */

interface DebugSession {
  getState(): { ready: boolean; label: string; network: { online: boolean } };
  replica: { getView(): { shapes: unknown[]; conflicts: { status: string; valuesEqual: boolean }[]; stateHash: string; pending: unknown[] } };
}

type Snap = { ready: boolean; label: string; shapes: number; conflicts: number; live: number; hash: string; online: boolean; pending: number };

async function snap(page: Page, room: string): Promise<Snap | null> {
  return page.evaluate((key) => {
    const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: DebugSession }> }).__weaveSessions;
    const s = reg?.get(key)?.session;
    if (!s) return null;
    const st = s.getState();
    const v = s.replica.getView();
    return {
      ready: st.ready,
      label: st.label,
      shapes: v.shapes.length,
      conflicts: v.conflicts.length,
      live: v.conflicts.filter((c) => c.status === "live" && !c.valuesEqual).length,
      hash: v.stateHash,
      online: st.network.online,
      pending: v.pending.length,
    };
  }, `${room}:main`);
}

async function run<T>(page: Page, room: string, fn: string): Promise<T> {
  return page.evaluate(
    ([key, body]) => {
      const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: unknown }> }).__weaveSessions;
      const session = reg?.get(key)?.session;
      return new Function("session", body)(session);
    },
    [`${room}:main`, fn] as const,
  ) as Promise<T>;
}

async function openTab(page: Page, room: string) {
  await page.goto(`/?room=${room}`);
  await expect.poll(async () => (await snap(page, room))?.ready ?? false, { timeout: 20_000 }).toBe(true);
}

test.describe("offline-first collaboration", () => {
  test("draw in A appears in B; offline edits in both merge with an explained conflict", async ({ context }) => {
    const room = `e2e-${Date.now().toString(36)}`;
    const a = await context.newPage();
    const b = await context.newPage();
    const errors: string[] = [];
    for (const p of [a, b]) p.on("pageerror", (e) => errors.push(String(e)));

    await openTab(a, room);
    await openTab(b, room);
    const la = (await snap(a, room))!.label;
    const lb = (await snap(b, room))!.label;
    expect(la).not.toBe(lb);

    // Real input: pen tool + drag on the canvas in tab A.
    await a.bringToFront();
    await a.mouse.click(700, 450);
    await a.keyboard.press("p");
    await a.mouse.move(600, 400);
    await a.mouse.down();
    for (let i = 0; i < 12; i++) await a.mouse.move(600 + i * 12, 400 + Math.sin(i / 2) * 30);
    await a.mouse.up();
    await expect.poll(async () => (await snap(a, room))!.shapes).toBe(1);
    await expect.poll(async () => (await snap(b, room))!.shapes).toBe(1);

    // A sticky both will fight over.
    const id = await run<string>(a, room, `let id=""; session.transact(tx=>{ id = tx.create({type:"sticky", props:{x:200,y:200,w:200,h:160,fill:"#ffe58a"}, text:"Plan"}) }, {label:"Add sticky"}); return id;`);
    await expect.poll(async () => (await snap(b, room))!.shapes).toBe(2);

    // B unplugs; both edit the same property.
    await run(b, room, `session.setOnline(false)`);
    await run(a, room, `session.transact(tx=>tx.update(${JSON.stringify(id)}, {fill:"#ffc2a8"}), {label:"Recolour"})`);
    await run(b, room, `session.transact(tx=>tx.update(${JSON.stringify(id)}, {fill:"#b8ecd9"}), {label:"Recolour"})`);
    await b.waitForTimeout(300);
    expect((await snap(a, room))!.hash).not.toBe((await snap(b, room))!.hash);

    // Plug back in → converge with one live, explained conflict on both sides.
    await run(b, room, `session.setOnline(true)`);
    await expect.poll(async () => {
      const [sa, sb] = [await snap(a, room), await snap(b, room)];
      return sa!.hash === sb!.hash && sa!.live === 1 && sb!.live === 1 && sa!.pending === 0;
    }, { timeout: 15_000 }).toBe(true);
    const explained = await run<{ equal: boolean; relation: string; steps: number }>(
      a,
      room,
      `const c = session.replica.getView().conflicts[0]; const e = session.replica.explain(c.id); return { equal: e.convergence.equal, relation: e.vcProof.relation, steps: e.steps.length };`,
    );
    expect(explained).toEqual({ equal: true, relation: "concurrent", steps: expect.any(Number) });

    // Reload keeps identity and history (sessionStorage), and stays converged.
    const before = (await snap(b, room))!;
    await b.reload();
    await expect.poll(async () => (await snap(b, room))?.ready ?? false, { timeout: 20_000 }).toBe(true);
    const after = (await snap(b, room))!;
    expect(after.label).toBe(before.label);
    await expect.poll(async () => (await snap(b, room))!.hash).toBe((await snap(a, room))!.hash);

    expect(errors).toEqual([]);
  });

  test("delete vs offline edit: the edit keeps the shape alive (update-wins)", async ({ context }) => {
    const room = `e2e-d-${Date.now().toString(36)}`;
    const a = await context.newPage();
    const b = await context.newPage();
    await openTab(a, room);
    await openTab(b, room);
    const id = await run<string>(a, room, `let id=""; session.transact(tx=>{ id = tx.create({type:"rect", props:{x:100,y:100,w:120,h:80}}) }); return id;`);
    await expect.poll(async () => (await snap(b, room))!.shapes).toBe(1);
    await run(b, room, `session.setOnline(false)`);
    await run(a, room, `session.transact(tx=>tx.delete(${JSON.stringify(id)}), {label:"Delete"})`);
    await run(b, room, `session.transact(tx=>tx.update(${JSON.stringify(id)}, {fill:"#1b998b"}), {label:"Recolour"})`);
    await run(b, room, `session.setOnline(true)`);
    await expect.poll(async () => {
      const [sa, sb] = [await snap(a, room), await snap(b, room)];
      return sa!.hash === sb!.hash && sa!.shapes === 1 && sa!.conflicts >= 1;
    }, { timeout: 15_000 }).toBe(true);
  });

  test("a duplicated identity forks instead of colliding", async ({ context }) => {
    const room = `e2e-f-${Date.now().toString(36)}`;
    const a = await context.newPage();
    await openTab(a, room);
    await run(a, room, `session.transact(tx=>{ tx.create({type:"ellipse", props:{x:10,y:10,w:50,h:50}}) })`);
    // Simulate "Duplicate tab": copy A's sessionStorage into a new page before it boots.
    const storage = await a.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage))));
    const b = await context.newPage();
    await b.addInitScript((data) => {
      if (sessionStorage.getItem("__dup_done")) return;
      const entries = JSON.parse(data) as Record<string, string>;
      for (const [k, v] of Object.entries(entries)) sessionStorage.setItem(k, v);
      sessionStorage.setItem("__dup_done", "1");
    }, storage);
    await openTab(b, room);
    const ida = await run<string>(a, room, `return session.getState().replica`);
    const idb = await run<string>(b, room, `return session.getState().replica`);
    expect(idb).not.toBe(ida);
    await run(b, room, `session.transact(tx=>{ tx.create({type:"rect", props:{x:90,y:10,w:50,h:50}}) })`);
    await expect.poll(async () => {
      const [sa, sb] = [await snap(a, room), await snap(b, room)];
      return sa!.hash === sb!.hash && sa!.shapes === 2;
    }, { timeout: 15_000 }).toBe(true);
  });
});
