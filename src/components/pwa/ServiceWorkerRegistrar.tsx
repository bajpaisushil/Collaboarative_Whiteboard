"use client";
/**
 * Registers the offline service worker (public/sw.js) so a reload with no network still
 * opens the board. Renders nothing.
 *
 * - Production builds only: `process.env.NODE_ENV` is inlined at build time, so the dev
 *   bundle never contains the register call. A worker controlling `next dev` would serve
 *   stale chunks and break HMR, so in dev we instead remove one left behind by an earlier
 *   `next start` on the same origin.
 * - Secure contexts only (https, or http://localhost): browsers refuse workers elsewhere.
 * - The first visit loads before the worker exists, so the worker never sees those
 *   requests. Once it is active we send it this page's URL and the same-origin files the
 *   page already loaded; it caches whatever it is missing.
 * - Files still downloading when the worker takes over slip through both nets: they don't
 *   pass through its fetch handler, and their Resource Timing entry only appears once they
 *   finish — after that first list was sent. (The board's biggest chunk, the ssr:false
 *   BoardApp import, is requested right at `load`, exactly when registration starts.) So for a
 *   while after each warm-up we keep watching Resource Timing and send late arrivals too.
 */
import { useEffect } from "react";

export const SW_URL = "/sw.js";
const WARM_MESSAGE = "weave:warm";
/** Keep reporting late-finishing files this long after a warm-up. */
export const WARM_WATCH_MS = 30_000;
/** Batch late arrivals (a burst of chunks → one message). */
const WARM_BATCH_MS = 250;

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      void unregisterLeftovers();
      return;
    }
    if (!canUseServiceWorker()) return;

    let cancelled = false;
    let stopWatching: (() => void) | null = null;
    const warm = () => {
      if (cancelled) return;
      stopWatching?.();
      stopWatching = warmUp();
    };
    const onControllerChange = () => warm();
    const start = () => {
      if (cancelled) return;
      void registerWorker();
    };

    async function registerWorker() {
      try {
        const controlledAtStart = navigator.serviceWorker.controller !== null;
        await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
        if (cancelled) return;
        // A newly activated worker claims this page; hand it what loaded before it existed.
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
        if (!controlledAtStart) {
          await navigator.serviceWorker.ready;
          warm();
        }
      } catch (err) {
        console.warn("[weave] offline support unavailable:", err);
      }
    }

    // Don't compete with the page's own first loads.
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    return () => {
      cancelled = true;
      stopWatching?.();
      window.removeEventListener("load", start);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}

export default ServiceWorkerRegistrar;

function canUseServiceWorker(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator;
}

/** Same-origin files this page has loaded so far, for the worker to cache. */
function loadedAssets(): string[] {
  try {
    const origin = window.location.origin;
    return performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((name) => name.startsWith(`${origin}/`));
  } catch {
    return [];
  }
}

function postWarm(message: { page?: string; assets: string[] }): void {
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage({ type: WARM_MESSAGE, ...message });
    })
    .catch(() => undefined);
}

/**
 * Hand the active worker this page and everything it loaded so far, then keep sending files
 * that finish loading over the next WARM_WATCH_MS (see the file comment). Returns a stop
 * function (idempotent).
 */
function warmUp(): () => void {
  const origin = window.location.origin;
  const initial = loadedAssets();
  const sent = new Set(initial);
  postWarm({ page: window.location.href, assets: initial });

  let pending: string[] = [];
  let batch: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    batch = null;
    if (pending.length === 0) return;
    const assets = pending;
    pending = [];
    postWarm({ assets });
  };

  let observer: PerformanceObserver | null = null;
  if (typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const name = e.name;
          if (!name.startsWith(`${origin}/`) || sent.has(name)) continue;
          // workerStart > 0: it went through the worker's fetch handler, which cached it.
          if ((e as PerformanceResourceTiming).workerStart > 0) continue;
          sent.add(name);
          pending.push(name);
        }
        if (pending.length > 0 && batch === null) batch = setTimeout(flush, WARM_BATCH_MS);
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      observer = null; // no Resource Timing observer here: the first list is all we can send
    }
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    observer?.disconnect();
    if (batch !== null) {
      clearTimeout(batch);
      flush();
    }
  };
  const deadline = setTimeout(stop, WARM_WATCH_MS);
  return stop;
}

/** Dev only: drop a Weave worker (and its caches) left by a production run on this origin. */
async function unregisterLeftovers(): Promise<void> {
  if (!canUseServiceWorker()) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    const ours = regs.filter((r) => [r.active, r.waiting, r.installing].some((w) => w && new URL(w.scriptURL).pathname === SW_URL));
    if (ours.length === 0) return;
    await Promise.all(ours.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("weave-")).map((n) => caches.delete(n)));
    }
    console.info("[weave] removed the production service worker so it can't interfere with next dev; reload once.");
  } catch {
    /* nothing to clean */
  }
}
