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
 */
import { useEffect } from "react";

export const SW_URL = "/sw.js";
const WARM_MESSAGE = "weave:warm";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      void unregisterLeftovers();
      return;
    }
    if (!canUseServiceWorker()) return;

    let cancelled = false;
    const onControllerChange = () => warmUp();
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
          if (!cancelled) warmUp();
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

function warmUp(): void {
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage({ type: WARM_MESSAGE, page: window.location.href, assets: loadedAssets() });
    })
    .catch(() => undefined);
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
