// @vitest-environment jsdom
/**
 * The service worker must only ever be registered by production builds on secure origins:
 * a worker controlling `next dev` would serve stale chunks and break HMR.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistrar, SW_URL } from "../ServiceWorkerRegistrar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeRegistration {
  active: { scriptURL: string } | null;
  waiting: null;
  installing: null;
  unregister: ReturnType<typeof vi.fn>;
}

function fakeContainer(existing: FakeRegistration[] = []) {
  const postMessage = vi.fn();
  return {
    postMessage,
    container: {
      controller: null,
      ready: Promise.resolve({ active: { postMessage } }),
      register: vi.fn(async () => ({})),
      getRegistrations: vi.fn(async () => existing),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ServiceWorkerRegistrar />);
  });
  // Let the async register / ready / getRegistrations chains settle.
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function install(container: unknown, secure = true) {
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ServiceWorkerRegistrar", () => {
  it.each(["development", "test"])("never registers when NODE_ENV=%s", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    const { container } = fakeContainer();
    install(container);
    await mount();
    expect(container.register).not.toHaveBeenCalled();
  });

  it("in development, removes a Weave worker left by a production run on this origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const ours: FakeRegistration = { active: { scriptURL: `${location.origin}${SW_URL}` }, waiting: null, installing: null, unregister: vi.fn(async () => true) };
    const other: FakeRegistration = { active: { scriptURL: `${location.origin}/other-worker.js` }, waiting: null, installing: null, unregister: vi.fn(async () => true) };
    const { container } = fakeContainer([ours, other]);
    install(container);
    await mount();
    expect(container.register).not.toHaveBeenCalled();
    expect(ours.unregister).toHaveBeenCalledTimes(1);
    expect(other.unregister).not.toHaveBeenCalled();
  });

  it("in production on a secure origin, registers /sw.js and warms the first visit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container, postMessage } = fakeContainer();
    install(container);
    await mount();
    expect(container.register).toHaveBeenCalledWith(SW_URL, { scope: "/", updateViaCache: "none" });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "weave:warm", page: location.href, assets: expect.any(Array) }));
  });

  it("keeps sending files that finish loading after the first warm-up (in flight when the worker took over)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let deliver: ((entries: { name: string; workerStart: number }[]) => void) | null = null;
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(cb: (list: { getEntries(): unknown[] }) => void) {
        deliver = (entries) => cb({ getEntries: () => entries });
      }
      observe() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    const { container, postMessage } = fakeContainer();
    install(container);
    await mount();
    expect(postMessage).toHaveBeenCalledTimes(1); // the page + what had loaded so far
    const late = `${location.origin}/_next/static/chunks/board-app.js`;
    await act(async () => {
      deliver!([
        { name: late, workerStart: 0 }, // finished after the list was sent: never cached otherwise
        { name: `${location.origin}/_next/static/chunks/seen-by-worker.js`, workerStart: 12 }, // went through the worker
        { name: "https://cdn.example.com/x.js", workerStart: 0 }, // not ours
      ]);
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith({ type: "weave:warm", assets: [late] });
    // …and only for a while: unmounting stops watching.
    act(() => root?.unmount());
    root = null;
    expect(disconnect).toHaveBeenCalled();
  });

  it("in production on an insecure origin, does nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container } = fakeContainer();
    install(container, false);
    await mount();
    expect(container.register).not.toHaveBeenCalled();
  });
});
