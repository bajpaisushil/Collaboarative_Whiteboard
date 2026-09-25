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

test("narrow windows: the top bar fits without overlaps, and the dock's style chip stays reachable", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const [w, h] of [
    [420, 820],
    [390, 800],
    [375, 740],
    [360, 640],
  ] as const) {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const room = `narrow-${w}-${Date.now().toString(36)}`;
    try {
      await page.goto(`/?room=${room}`);
      await expect.poll(() => session(page, room).ready(), { timeout: 20_000 }).toBe(true);
      const box = async (sel: string) => {
        const b = await page.locator(sel).first().boundingBox();
        if (!b) throw new Error(`${w}px: ${sel} is not visible`);
        return { left: b.x, right: b.x + b.width };
      };
      const measure = async () => ({
        header: await box('header[aria-label="Board controls"]'),
        network: await box('button[aria-label^="Network lab"]'),
        peers: await box('[aria-label="No other tabs in this room"]'),
        knots: await box('button[aria-label$=". Why panel"]'),
        connect: await box("[data-connect-button]"),
        style: await box('button[aria-label^="Style:"]'),
      });
      const m = await measure();
      const where = `${w}px: ${JSON.stringify(m)}`;
      // Everything inside the bar, the bar inside the window, nothing on top of its neighbour.
      expect(m.header.left, where).toBeGreaterThanOrEqual(0);
      expect(m.header.right, where).toBeLessThanOrEqual(w);
      expect(m.connect.right, where).toBeLessThanOrEqual(m.header.right);
      expect(m.network.right, where).toBeLessThanOrEqual(m.peers.left);
      expect(m.peers.right, where).toBeLessThanOrEqual(m.knots.left);
      expect(m.knots.right, where).toBeLessThanOrEqual(m.connect.left);
      // The style chip (colours) is always on screen, whatever the tools do.
      expect(m.style.left, where).toBeGreaterThanOrEqual(0);
      expect(m.style.right, where).toBeLessThanOrEqual(w);

      // Opening the pairing dialog moves focus around; the board must not shift sideways.
      await page.locator("[data-connect-button]").click();
      await page.getByRole("dialog").getByRole("button", { name: "Create invite" }).click();
      await expect(page.getByRole("dialog").getByLabel("Invite link")).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      expect((await box('header[aria-label="Board controls"]')).left, `${w}px after the dialog`).toBe(m.header.left);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
