/**
 * public/sw.js under a minimal fake Cache/fetch harness (node:vm), for the two service-worker
 * findings of the WebRTC/offline review. (It lives next to the other review regression tests.)
 *
 * - A navigation that falls back to the cached page (slow network) must NOT later store the
 *   fresh HTML: its hashed /_next/static files were never loaded, so an offline start with it
 *   would fail. The cached page and its cached assets must stay a matching pair.
 * - Static trimming must be least-recently-used, so files the running build keeps loading never
 *   age out behind older builds' files.
 *
 * The fake Cache follows the Cache API spec: an ordered list where put() removes the matching
 * entry and appends the new one (Chromium and Firefox both return keys() in that order).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SW = fileURLToPath(new URL("../../../../public/sw.js", import.meta.url));
const ORIGIN = "https://weave.test";
const SPEED = 100; // the worker's timers run 100x faster

type Req = string | { url: string };

function basic(body: string, status = 200, type = "text/html"): Response {
  const r = new Response(body, { status, headers: { "content-type": type } });
  const clone = r.clone.bind(r);
  Object.defineProperty(r, "type", { value: "basic" });
  Object.defineProperty(r, "clone", { value: () => Object.defineProperty(clone(), "type", { value: "basic" }) });
  return r;
}

class FakeCache {
  entries: { url: string; res: Response }[] = [];
  private key = (r: Req) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  async match(r: Req) {
    return this.entries.find((e) => e.url === this.key(r))?.res.clone();
  }
  async put(r: Req, res: Response) {
    const url = this.key(r);
    const copy = basic(await res.clone().text(), res.status, res.headers.get("content-type") ?? "");
    this.entries = this.entries.filter((e) => e.url !== url);
    this.entries.push({ url, res: copy });
  }
  async delete(r: Req) {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.url !== this.key(r));
    return this.entries.length !== n;
  }
  async keys() {
    return this.entries.map((e) => ({ url: e.url }));
  }
  async text(url: string) {
    return (await this.match(url))?.text();
  }
}

function loadWorker(fetchImpl: (req: Req) => Promise<Response>) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, FakeCache>();
  const caches = {
    open: async (n: string) => stores.get(n) ?? (stores.set(n, new FakeCache()), stores.get(n)!),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const ctx = vm.createContext({
    self: {
      addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
      location: { origin: ORIGIN },
      registration: { navigationPreload: null },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
    },
    caches,
    fetch: fetchImpl,
    Response,
    Headers,
    URL,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms / SPEED),
    clearTimeout,
  });
  vm.runInContext(readFileSync(SW, "utf8"), ctx);
  async function request(url: string, mode = "navigate", destination = "document"): Promise<Response | null> {
    const waits: Promise<unknown>[] = [];
    const responded: { p: Promise<Response> | null } = { p: null };
    listeners.fetch({
      request: { url: new URL(url, ORIGIN).href, method: "GET", mode, destination, headers: new Headers() },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (p: Promise<Response>) => (responded.p = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    const res = responded.p ? await responded.p : null;
    await Promise.all(waits);
    return res;
  }
  return { caches, request };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("service worker: page copies", () => {
  it("keeps the cached page when it had to serve it, and stores fresh pages it actually served", async () => {
    let net: "slow" | "fast" | "down" | "502" = "slow";
    const { caches, request } = loadWorker(async () => {
      if (net === "down") throw new TypeError("Failed to fetch");
      if (net === "502") return basic("bad gateway", 502);
      if (net === "slow") await sleep(80); // 8 s of worker time, past NAV_TIMEOUT_MS
      return basic(net === "slow" ? "build-2 (late)" : "build-3");
    });
    const pages = await caches.open("weave-pages-v1");
    await pages.put(`${ORIGIN}/`, basic("build-1"));

    expect(await (await request("/?room=x"))!.text()).toBe("build-1");
    await sleep(120); // the late response has arrived by now
    expect(await pages.text(`${ORIGIN}/`)).toBe("build-1");

    net = "fast";
    expect(await (await request("/?room=y"))!.text()).toBe("build-3");
    expect(await pages.text(`${ORIGIN}/`)).toBe("build-3");

    net = "down";
    expect(await (await request("/"))!.text()).toBe("build-3");
    net = "502";
    expect(await (await request("/"))!.text()).toBe("build-3");
    expect(await pages.text(`${ORIGIN}/`)).toBe("build-3");

    net = "down";
    expect((await request("/split"))!.status).toBe(503); // never opened here: the offline page
  });
});

describe("service worker: static trimming", () => {
  it("evicts the least recently used file, never one the running build still loads", async () => {
    const { caches, request } = loadWorker(async (r) => basic(`js ${typeof r === "string" ? r : r.url}`, 200, "application/javascript"));
    const stat = await caches.open("weave-static-v1");
    const js = (name: string) => `${ORIGIN}/_next/static/chunks/${name}.js`;
    const current = Array.from({ length: 10 }, (_, i) => js(`current-${i}`));
    // The running build was cached first, long ago; 590 files from older builds came after.
    for (const u of current) await stat.put(u, basic("x", 200, "application/javascript"));
    for (let i = 0; i < 590; i++) await stat.put(js(`old-${i}`), basic("x", 200, "application/javascript"));
    for (const u of current) await request(u, "no-cors", "script"); // this page load: cache hits
    await request(js("new"), "no-cors", "script"); // one miss → put → trim scheduled (5 s)
    await sleep(5000 / SPEED + 100);
    const urls = stat.entries.map((e) => e.url);
    expect(urls).toHaveLength(600);
    for (const u of current) expect(urls).toContain(u);
    expect(urls).toContain(js("new"));
    expect(urls).not.toContain(js("old-0"));
  });
});
