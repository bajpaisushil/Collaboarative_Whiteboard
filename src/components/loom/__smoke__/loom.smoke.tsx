import { describe, expect, it } from "vitest";
import { act, createElement, useMemo, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryHub } from "@/lib/sync/transport";
import { WhiteboardSession } from "@/lib/session/session";
import { SessionProvider } from "@/lib/session/react";
import { PaneProvider, type PaneContextValue } from "@/lib/ui/pane";
import { UiStoreProvider, createUiStore } from "@/lib/ui/store";
import { Loom } from "@/components/loom/Loom";
import { TimeTravelBanner } from "@/components/loom/TimeTravelBanner";
import { SnapshotsPanel } from "@/components/loom/SnapshotsPanel";
import { LogTable } from "@/components/loom/LogTable";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class RO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    const h = (el as HTMLElement).dataset?.loomScrubber !== undefined ? 30 : 300;
    setTimeout(() => this.cb([{ contentRect: { width: 900, height: h } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver), 0);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
if (!window.matchMedia) (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await sleep(10);
  }
}
function make(hub: MemoryHub, id: string) {
  const s = new WhiteboardSession({ room: "t", pane: id, replicaId: `r${id}`, transport: hub.connect(), storage: null, useLocks: false, heartbeatMs: 40 });
  s.start();
  return s;
}

function Pane({ session, store, children }: { session: WhiteboardSession; store: ReturnType<typeof createUiStore>; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pane = useMemo<PaneContextValue>(() => ({ paneId: "main", compact: false, rootRef }), []);
  return createElement(SessionProvider, { session }, createElement(UiStoreProvider, { store }, createElement(PaneProvider, { value: pane }, createElement("div", { ref: rootRef, tabIndex: -1, id: "pane" }, children))));
}

describe("loom smoke", () => {
  it("renders ribbon, diagram, table, banner and snapshots without crashing", async () => {
    const hub = new MemoryHub();
    const a = make(hub, "a");
    await until(() => a.getState().ready);
    const b = make(hub, "b");
    await until(() => b.getState().ready);
    let id = "";
    a.transact((tx) => { id = tx.create({ type: "sticky", props: { x: 0, y: 0, w: 200, h: 150, fill: "#ffe58a" }, text: "Plan" }); }, { label: "Add sticky" });
    await until(() => b.replica.getView().shapes.length === 1);
    a.markSnapshot("Before offline");
    await until(() => b.replica.getView().snapshots.length === 1);
    a.setOnline(false);
    a.transact((tx) => tx.update(id, { fill: "#ffc2a8" }), { label: "Recolour" });
    a.transact((tx) => tx.update(id, { x: 40 }), { label: "Move" });
    b.transact((tx) => tx.update(id, { fill: "#b8ecd9" }), { label: "Recolour" });
    a.setOnline(true);
    await until(() => a.replica.getView().conflicts.length > 0 && b.replica.getView().conflicts.length > 0);
    for (let i = 0; i < 200; i++) b.transact((tx) => tx.update(id, { y: i }), { label: "Nudge" });
    await until(() => a.replica.getView().log.length === b.replica.getView().log.length);

    const store = createUiStore({ mode: "xray" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); origError(...args); };
    await act(async () => {
      root.render(createElement(Pane, { session: a, store }, createElement(TimeTravelBanner), createElement(Loom), createElement("div", { style: { height: 400 } }, createElement(SnapshotsPanel))));
    });
    await act(async () => { await sleep(50); });
    const html = container.innerHTML;
    expect(html).toContain('role="slider"');
    expect(html).toContain("Space-time diagram");
    expect(container.textContent).toContain("Before offline");
    console.log("log length", a.replica.getView().log.length, "conflicts", a.replica.getView().conflicts.length);
    console.log("bundles:", (html.match(/quieter edits folded/g) ?? []).length, "knots:", (html.match(/Knot:/g) ?? []).length, "paths:", (html.match(/<path/g) ?? []).length);

    // time travel
    const log = a.replica.getView().log;
    await act(async () => { store.getState().set({ scrub: { atOpId: log[1].id, label: `L${log[1].lamport}` } }); });
    await act(async () => { await sleep(20); });
    expect(container.textContent).toContain("Viewing the board as of");
    console.log("banner:", container.querySelector('[aria-label="Time travel"]')?.textContent);
    // step via pane keys
    const pane = container.querySelector("#pane") as HTMLElement;
    await act(async () => { pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(store.getState().scrub?.atOpId).toBe(log[2].id);
    // slider keys
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    await act(async () => { slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
    expect(store.getState().scrub?.atOpId).toBe(null);
    console.log("banner start:", container.querySelector('[aria-label="Time travel"]')?.textContent);
    await act(async () => { slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    expect(store.getState().scrub).toBe(null);
    // snapshot preview
    const snap = a.replica.getView().snapshots[0];
    await act(async () => { store.getState().set({ scrub: { cut: snap.cut, label: snap.name } }); });
    await act(async () => { await sleep(20); });
    console.log("banner cut:", container.querySelector('[aria-label="Time travel"]')?.textContent);
    expect(container.textContent).toContain("Viewing snapshot");
    await act(async () => { pane.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(store.getState().scrub).toBe(null);
    // focus conflict
    const c = a.replica.getView().conflicts[0];
    await act(async () => { store.getState().focusConflict({ id: c.id, lineageKey: c.lineageKey }); });
    await act(async () => { await sleep(20); });
    // table view
    const tableBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Table")!;
    await act(async () => { tableBtn.click(); });
    await act(async () => { await sleep(50); });
    const options = container.querySelectorAll('[role="option"]');
    console.log("table rows rendered:", options.length, "first:", options[0]?.getAttribute("aria-label"));
    expect(options.length).toBeGreaterThan(0);
    const lb = container.querySelector('[role="listbox"]') as HTMLElement;
    await act(async () => { lb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    console.log("hoverOp after ArrowDown:", store.getState().hoverOp);
    await act(async () => { lb.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    console.log("selection after Enter:", store.getState().selection);
    // collapse
    const collapse = container.querySelector('[aria-label="Collapse the loom"]') as HTMLElement;
    await act(async () => { collapse.click(); });
    expect(container.querySelector('[role="listbox"]')).toBe(null);
    // take snapshot through panel
    const input = container.querySelector('input[placeholder^="Snapshot"]') as HTMLInputElement;
    const form = input.closest("form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await sleep(20); });
    expect(a.replica.getView().snapshots.length).toBe(2);
    console.log("snapshot names:", a.replica.getView().snapshots.map((s) => s.name));
    // restore flow
    const restoreBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Restore…"))!;
    await act(async () => { restoreBtn.click(); });
    const confirm = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Restore")!;
    await act(async () => { confirm.click(); });
    await act(async () => { await sleep(20); });
    console.log("status:", container.querySelector('[role="status"]')?.textContent, [...container.querySelectorAll('[role="status"]')].map((e) => e.textContent));
    console.log("errors:", errors.length);
    expect(errors.length).toBe(0);
    await act(async () => root.unmount());
    console.error = origError;
    a.dispose();
    b.dispose();
  });
});
