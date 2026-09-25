import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Offline app loading (public/sw.js, production builds only): once a page has been opened
 * online, a reload with no network still opens it — and the board comes back from
 * sessionStorage. Playwright gives every test its own context, so each test starts with no
 * service worker and empty caches.
 */

interface DebugSession {
  getState(): { ready: boolean };
  replica: { getView(): { shapes: unknown[] } };
}

function boardReady(page: Page, room: string) {
  return page.evaluate((key) => {
    const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: DebugSession }> }).__weaveSessions;
    return reg?.get(key)?.session.getState().ready ?? false;
  }, `${room}:main`);
}

function shapeCount(page: Page, room: string) {
  return page.evaluate((key) => {
    const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: DebugSession }> }).__weaveSessions;
    return reg?.get(key)?.session.replica.getView().shapes.length ?? -1;
  }, `${room}:main`);
}

async function run<T>(page: Page, room: string, body: string): Promise<T> {
  return page.evaluate(
    ([key, b]) => {
      const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: unknown }> }).__weaveSessions;
      return new Function("session", b)(reg?.get(key)?.session);
    },
    [`${room}:main`, body] as const,
  ) as Promise<T>;
}

/** The worker controls this page. */
async function waitForController(page: Page) {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 30_000 }).toBe(true);
}

/** The worker has stored this page's HTML (it does so in the background). */
async function waitForPageCached(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => !!(await caches.match(new URL(location.pathname, location.origin).href))), { timeout: 30_000 })
    .toBe(true);
}

/** Same-origin /_next/static files this page loaded that are NOT in the worker's caches. */
function uncachedAssets(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const assets = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => u.startsWith(`${location.origin}/_next/static/`));
    const missing: string[] = [];
    for (const u of assets) if (!(await caches.match(u, { ignoreVary: true }))) missing.push(u.replace(location.origin, ""));
    return missing;
  });
}

/** Every static file the page loaded is in the worker's caches (they're stored in the background). */
async function waitForAssetsCached(page: Page, timeout = 30_000) {
  await expect.poll(() => uncachedAssets(page), { timeout }).toEqual([]);
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
}

test.describe("offline app loading (service worker)", () => {
  test.afterEach(async ({ context }) => {
    await context.setOffline(false);
  });

  test("the board reloads with no network, sticky and all", async ({ context, page }) => {
    const room = `e2e-sw-${Date.now().toString(36)}`;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`/?room=${room}`);
    await expect.poll(() => boardReady(page, room), { timeout: 20_000 }).toBe(true);
    await waitForController(page);
    await waitForPageCached(page);

    await run(page, room, `session.transact(tx=>{ tx.create({type:"sticky", props:{x:420,y:260,w:220,h:170,fill:"#ffe58a"}, text:"Offline plan"}) }, {label:"Add sticky"})`);
    await expect(page.getByText("Offline plan").first()).toBeVisible();

    await goOffline(context, page);
    const response = await page.reload();
    // Served by the worker from its cache, not the (unreachable) server.
    expect(response?.fromServiceWorker()).toBe(true);
    expect(response?.status()).toBe(200);

    await expect.poll(() => boardReady(page, room), { timeout: 20_000 }).toBe(true);
    await expect(page.getByText("Weave", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("switch", { name: "Online" })).toBeVisible();
    await expect(page.getByText("Offline plan").first()).toBeVisible();
    expect(await shapeCount(page, room)).toBe(1);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // Still editable offline.
    await run(page, room, `session.transact(tx=>{ tx.create({type:"rect", props:{x:100,y:100,w:120,h:80}}) }, {label:"Offline rect"})`);
    await expect.poll(() => shapeCount(page, room)).toBe(2);

    expect(errors).toEqual([]);
  });

  test("/split reloads offline after one online visit", async ({ context, page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // Install the worker from the board, then open /split online once (now under the worker,
    // so every file it loads passes through it).
    await page.goto(`/?room=e2e-sw-split-${Date.now().toString(36)}`);
    await waitForController(page);
    await page.goto("/split");
    await expect(page.getByRole("button", { name: /Colour clash/i }).first()).toBeEnabled({ timeout: 20_000 });
    await waitForController(page);
    await waitForPageCached(page);
    await waitForAssetsCached(page);

    await goOffline(context, page);
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("button", { name: /Colour clash/i }).first()).toBeEnabled({ timeout: 20_000 });
    // Both panes came up (the seam has a cable toggle per tab).
    await expect(page.getByRole("switch", { name: /^Tab A is online/ })).toBeVisible();
    await expect(page.getByRole("switch", { name: /^Tab B is online/ })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("a page never opened online shows the offline notice instead of a browser error", async ({ context, page }) => {
    await page.goto(`/?room=e2e-sw-none-${Date.now().toString(36)}`);
    await waitForController(page);
    await waitForPageCached(page);

    await goOffline(context, page);
    const response = await page.goto("/split");
    expect(response?.status()).toBe(503);
    await expect(page.getByText(/You’re offline, and this page hasn’t been opened on this device yet/)).toBeVisible();
    // It points at what this device does have.
    await expect(page.getByRole("link", { name: "The board" })).toHaveAttribute("href", "/");
  });

  /*
   * Regression (src/components/pwa/ServiceWorkerRegistrar.tsx): on the very first visit the
   * board's biggest chunk (the ssr:false BoardApp import) is requested right at `load` — the
   * moment registration starts — so it is usually still in flight when the worker claims the
   * page: it neither passes through the worker's fetch handler nor appears in the first warm-up
   * list. The registrar keeps watching Resource Timing after warming and sends late arrivals,
   * so the worker's caches alone (no HTTP cache) can start the board offline.
   */
  test("first visit: every file the board loaded is cached, so it reloads offline without the HTTP cache", async ({ context, page }) => {
    const room = `e2e-sw-cold-${Date.now().toString(36)}`;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`/?room=${room}`);
    await expect.poll(() => boardReady(page, room), { timeout: 20_000 }).toBe(true);
    await waitForController(page);
    await waitForPageCached(page);
    await waitForAssetsCached(page, 15_000);

    // An evicted/cleared HTTP cache: only the worker's own caches can serve the app now.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.clearBrowserCache");
    await cdp.detach();

    await goOffline(context, page);
    await page.reload();
    await expect.poll(() => boardReady(page, room), { timeout: 20_000 }).toBe(true);
    await expect(page.getByText("Weave", { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
