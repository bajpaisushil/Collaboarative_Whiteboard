/*
 * Weave service worker: lets the app itself load with no network, so "work offline on
 * separate computers" survives a reload. Registered only by production builds
 * (src/components/pwa/ServiceWorkerRegistrar.tsx); never in `next dev`.
 *
 * Strategy (nothing is precached, so an install can never fail on a missing file):
 *   - page navigations (/, /split, any query string): network-first, cached by pathname,
 *     falling back to the cached copy and then to a tiny inline offline page;
 *   - /_next/static/**: cache-first (content-hashed, immutable; includes next/font files);
 *   - other same-origin fonts and images (icons, favicon): cache-first, refreshed in the
 *     background;
 *   - the web app manifest: network-first with cache fallback;
 *   - everything else, including RSC flight requests, non-GET requests and every
 *     cross-origin request, is left alone (no respondWith), exactly as without a worker.
 *
 * Pages loaded before this worker controlled them (the very first visit) send a
 * "weave:warm" message listing what they already loaded, so the first visit is cached too.
 * Only the board's application shell is cached here; board data stays in sessionStorage.
 */

const VERSION = "v1";
const PREFIX = "weave-";
const PAGES = `${PREFIX}pages-${VERSION}`;
const STATIC = `${PREFIX}static-${VERSION}`;
const CURRENT = [PAGES, STATIC];

/** With a cached copy on hand, stop waiting on a hanging network after this long. */
const NAV_TIMEOUT_MS = 4000;
/** Old builds' hashed files pile up across deploys; keep the newest this many. */
const STATIC_MAX_ENTRIES = 600;
const WARM_MAX_URLS = 300;

const ASSET_EXT = /\.(?:woff2?|ttf|otf|eot|ico|svg|png|webp|avif|jpe?g|gif)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(PREFIX) && !CURRENT.includes(n)).map((n) => caches.delete(n)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          /* optional speed-up only */
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event, url));
    return;
  }
  // RSC flight data (soft navigations, prefetches) depends on request headers; never cache it.
  // Offline, the router falls back to a full navigation, which the branch above serves.
  if (request.headers.get("rsc") === "1" || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, request, false));
    return;
  }
  if (isFontOrImage(request, url)) {
    event.respondWith(cacheFirst(event, request, true));
    return;
  }
  if (request.destination === "manifest" || url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirstAsset(event, request));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "weave:warm") return;
  event.waitUntil(warm(data).catch(() => undefined));
});

/* ---------------------------------------------------------------- navigations */

/** Cache key for a page: pathname only, so /?room=a and /?room=b share one entry. */
function pageKey(url) {
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "") || "/";
  return `${self.location.origin}${path}`;
}

function isCacheablePage(response) {
  return (
    !!response &&
    response.ok &&
    response.type === "basic" &&
    !response.redirected &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}

function networkFirstPage(event, url) {
  const key = pageKey(url);
  const network = (async () => {
    let response;
    try {
      response = await event.preloadResponse;
    } catch {
      response = undefined;
    }
    if (!response) response = await fetch(event.request);
    if (isCacheablePage(response)) {
      const copy = response.clone();
      const cache = await caches.open(PAGES);
      await cache.put(key, copy);
    }
    return response;
  })();
  // Keep the worker alive until the fresh copy is stored, even if the cached copy won.
  event.waitUntil(network.then(noop, noop));

  return (async () => {
    const cache = await caches.open(PAGES);
    const cached = await cache.match(key);
    try {
      const response = cached ? await withTimeout(network, NAV_TIMEOUT_MS) : await network;
      // A proxy or tunnel in front of a stopped server answers 502/503/504; prefer our copy.
      return cached && response.status >= 500 ? cached : response;
    } catch {
      return cached || (await cache.match(key)) || offlinePage(url, cache);
    }
  })();
}

/* ---------------------------------------------------------------- static assets */

function isFontOrImage(request, url) {
  return request.destination === "font" || request.destination === "image" || ASSET_EXT.test(url.pathname);
}

function isCacheableAsset(response) {
  return !!response && response.status === 200 && response.type === "basic";
}

async function cacheFirst(event, request, revalidate) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) {
    if (revalidate) event.waitUntil(refresh(cache, request).catch(noop));
    return hit;
  }
  const response = await fetch(request);
  if (isCacheableAsset(response)) {
    const copy = response.clone();
    event.waitUntil(cache.put(request, copy).then(scheduleTrim).catch(noop));
  }
  return response;
}

async function refresh(cache, request) {
  const response = await fetch(request, { cache: "no-cache" });
  if (isCacheableAsset(response)) await cache.put(request, response);
}

async function networkFirstAsset(event, request) {
  const cache = await caches.open(STATIC);
  try {
    const response = await fetch(request);
    if (isCacheableAsset(response)) {
      const copy = response.clone();
      event.waitUntil(cache.put(request, copy).catch(noop));
    }
    return response;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

let trimTimer = 0;
/** Trim the static cache once things go quiet, not after every single put. */
function scheduleTrim() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(() => {
    caches.open(STATIC).then((cache) => trim(cache, STATIC_MAX_ENTRIES)).catch(noop);
  }, 5000);
}

/** Drop the oldest entries (Cache keys come back in insertion order). */
async function trim(cache, max) {
  const keys = await cache.keys();
  const excess = keys.length - max;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

/* ---------------------------------------------------------------- first-visit warm-up */

/**
 * `{ type: "weave:warm", page, assets }` from a page: `page` is its own URL, `assets` the
 * same-origin resources it has loaded (Resource Timing). Only what this worker would have
 * cached anyway is accepted; anything already cached is skipped.
 */
async function warm(data) {
  const jobs = [];
  if (typeof data.page === "string") {
    const url = safeUrl(data.page);
    if (url && url.origin === self.location.origin) jobs.push(warmPage(url));
  }
  if (Array.isArray(data.assets)) {
    const cache = await caches.open(STATIC);
    const seen = new Set();
    for (const raw of data.assets.slice(0, WARM_MAX_URLS)) {
      if (typeof raw !== "string") continue;
      const url = safeUrl(raw);
      if (!url || url.origin !== self.location.origin || seen.has(url.href)) continue;
      if (url.searchParams.has("_rsc")) continue;
      if (!url.pathname.startsWith("/_next/static/") && !ASSET_EXT.test(url.pathname)) continue;
      seen.add(url.href);
      jobs.push(warmAsset(cache, url.href));
    }
  }
  await Promise.all(jobs);
  const cache = await caches.open(STATIC);
  await trim(cache, STATIC_MAX_ENTRIES);
}

async function warmPage(url) {
  const cache = await caches.open(PAGES);
  const key = pageKey(url);
  if (await cache.match(key)) return;
  try {
    const response = await fetch(url.href, { headers: { accept: "text/html" }, credentials: "same-origin" });
    if (isCacheablePage(response)) await cache.put(key, response);
  } catch {
    /* offline right now; the next online navigation caches it */
  }
}

async function warmAsset(cache, href) {
  if (await cache.match(href, { ignoreVary: true })) return;
  try {
    const response = await fetch(href, { credentials: "same-origin" });
    if (isCacheableAsset(response)) await cache.put(href, response);
  } catch {
    /* best effort */
  }
}

/* ---------------------------------------------------------------- helpers */

function noop() {}

function safeUrl(raw) {
  try {
    return new URL(raw, self.location.origin);
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const PAGE_NAMES = { "/": "The board", "/split": "Split view" };

/** Shown only when a page was never opened online on this device, so nothing is cached. */
async function offlinePage(url, cache) {
  const cachedPaths = (await cache.keys()).map((req) => new URL(req.url).pathname);
  const links = cachedPaths
    .filter((p) => p !== url.pathname)
    .map((p) => `<li><a href="${escapeHtml(p)}">${escapeHtml(PAGE_NAMES[p] || p)}</a></li>`)
    .join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Weave — offline</title>
<style>
  :root { --paper:#f7f3ea; --panel:#fffdf8; --ink:#1d1b16; --ink-2:#4a463d; --muted:#8a8475; --line:#ddd5c4; --focus:#2f6fed; }
  @media (prefers-color-scheme: dark) {
    :root { --paper:#0f1726; --panel:#172136; --ink:#ece7dc; --ink-2:#b9b3a6; --muted:#7d8699; --line:#273452; --focus:#7aa2ff; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px;
         background:var(--paper); color:var(--ink); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:420px; width:100%; background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:28px 24px; }
  h1 { margin:0 0 4px; font:italic 400 40px/1 "Instrument Serif", Georgia, serif; letter-spacing:-0.02em; }
  p { margin:12px 0 0; color:var(--ink-2); }
  .muted { color:var(--muted); font-size:13px; }
  ul { margin:10px 0 0; padding-left:20px; }
  a { color:var(--focus); }
  button { margin-top:20px; font:inherit; font-weight:500; color:var(--ink); background:transparent;
           border:1px solid var(--line); border-radius:10px; padding:8px 14px; cursor:pointer; }
  button:focus-visible, a:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
</style>
</head>
<body>
<main>
  <h1>Weave</h1>
  <p><strong>You’re offline, and this page hasn’t been opened on this device yet.</strong></p>
  <p>Weave keeps a copy of each page the first time you open it online. Connect once, open it, and from then on it loads without a network.</p>
  ${links ? `<p>Available offline on this device:</p><ul>${links}</ul>` : ""}
  <button type="button" onclick="location.reload()">Try again</button>
  <p class="muted">${escapeHtml(url.pathname)}</p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    statusText: "Offline",
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
