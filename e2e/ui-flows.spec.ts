import { expect, test, type Page } from "@playwright/test";

/** UI-driven flows: real clicks on the cable switch, merge card, explainer and split-view scenes. */

interface DebugSession {
  getState(): { ready: boolean };
  replica: { getView(): { conflicts: unknown[]; stateHash: string } };
  transact(build: (tx: { create(i: unknown): string; update(id: string, p: unknown): void }) => void, opts?: unknown): unknown;
}

function session(page: Page, room: string) {
  return {
    ready: () =>
      page.evaluate((key) => {
        const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: DebugSession }> }).__weaveSessions;
        return reg?.get(key)?.session.getState().ready ?? false;
      }, `${room}:main`),
    eval: <T,>(body: string) =>
      page.evaluate(
        ([key, b]) => {
          const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: DebugSession }> }).__weaveSessions;
          return new Function("session", b)(reg?.get(key)?.session) as T;
        },
        [`${room}:main`, body] as const,
      ),
  };
}

test("unplug with the cable switch, edit both tabs, plug back in, explain the knot", async ({ context }) => {
  const room = `ui-${Date.now().toString(36)}`;
  const a = await context.newPage();
  const b = await context.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(String(e)));
  await a.goto(`/?room=${room}`);
  await expect.poll(() => session(a, room).ready(), { timeout: 20_000 }).toBe(true);
  await b.goto(`/?room=${room}`);
  await expect.poll(() => session(b, room).ready(), { timeout: 20_000 }).toBe(true);

  // A sticky created in A shows up in B.
  const id = await session(a, room).eval<string>(
    `let id=""; session.transact(tx=>{ id = tx.create({type:"sticky", props:{x:420,y:260,w:220,h:170,fill:"#ffe58a"}, text:"Plan"}) }, {label:"Add sticky"}); return id;`,
  );
  await expect(b.getByText("Plan").first()).toBeVisible();

  // Unplug B with the real switch.
  await b.bringToFront();
  const cableB = b.getByRole("switch", { name: "Online" });
  await cableB.click();
  await expect(cableB).toHaveAttribute("aria-checked", "false");
  await expect(b.getByText(/diverging/i).first()).toBeVisible();

  await session(a, room).eval(`session.transact(tx=>tx.update(${JSON.stringify(id)}, {fill:"#ffc2a8"}), {label:"Recolour"})`);
  await session(b, room).eval(`session.transact(tx=>tx.update(${JSON.stringify(id)}, {fill:"#b8ecd9"}), {label:"Recolour"})`);

  // Plug back in → merge card with Explain → explainer answers "Why…?"
  await cableB.click();
  await expect(cableB).toHaveAttribute("aria-checked", "true");
  const explain = b.getByRole("button", { name: /^Explain/ }).first();
  await expect(explain).toBeVisible({ timeout: 15_000 });
  await explain.click();
  await expect(b.getByText(/^Why is this sticky note/).first()).toBeVisible();
  await expect(b.getByText(/Would every tab agree/).first()).toBeVisible();

  // Both tabs converged to the same state.
  await expect
    .poll(async () => (await session(a, room).eval<string>(`return session.replica.getView().stateHash`)) === (await session(b, room).eval<string>(`return session.replica.getView().stateHash`)))
    .toBe(true);
  expect(errors).toEqual([]);
});

test("split view: a scripted scene ends with its explained knot in the seam", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/split");
  const clash = page.getByRole("button", { name: /Colour clash/i }).first();
  await expect(clash).toBeEnabled({ timeout: 20_000 });
  await clash.click();
  await expect(page.getByText(/^Why is this sticky note/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Same result/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
