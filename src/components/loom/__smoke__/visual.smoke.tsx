import { describe, it } from "vitest";
import fs from "node:fs";
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

const OUT = process.env.LOOM_OUT!;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class RO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    const e = el as HTMLElement;
    const w = e.dataset?.loomScrubber !== undefined ? 820 : e.getAttribute("role") === "listbox" ? 1100 : 1060;
    const h = e.dataset?.loomScrubber !== undefined ? 30 : 180;
    setTimeout(() => this.cb([{ contentRect: { width: w, height: h } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver), 0);
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

function dump(name: string, container: HTMLElement, theme = "light", width = 1100) {
  const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"><style>body{padding:24px;background:var(--paper)} .stage{width:${width}px} .canvas{height:260px;border-radius:12px;background-image:radial-gradient(var(--grid-dot) 1px,transparent 1px);background-size:20px 20px;display:flex;justify-content:center;align-items:flex-start;padding-top:16px;position:relative}</style></head><body><div class="stage">${container.innerHTML}</div></body></html>`;
  fs.writeFileSync(`${OUT}/${name}.html`, html);
}

describe("loom visual", () => {
  it("dumps html snapshots", async () => {
    const hub = new MemoryHub();
    const a = make(hub, "a");
    await until(() => a.getState().ready);
    const b = make(hub, "b");
    await until(() => b.getState().ready);
    const c = make(hub, "c");
    await until(() => c.getState().ready);
    const ids: string[] = [];
    a.transact((tx) => { ids.push(tx.create({ type: "sticky", props: { x: 0, y: 0, w: 200, h: 150, fill: "#ffe58a" }, text: "Plan" })); }, { label: "Add sticky" });
    await until(() => b.replica.getView().shapes.length === 1 && c.replica.getView().shapes.length === 1);
    b.transact((tx) => { ids.push(tx.create({ type: "rect", props: { x: 260, y: 20, w: 160, h: 100, stroke: "#1b998b", fill: "none" } })); }, { label: "Draw rectangle" });
    c.transact((tx) => { ids.push(tx.create({ type: "ellipse", props: { x: 60, y: 200, w: 120, h: 80, stroke: "#4f5ddb", fill: "#bcd4ff" } })); }, { label: "Draw ellipse" });
    await until(() => a.replica.getView().shapes.length === 3 && b.replica.getView().shapes.length === 3 && c.replica.getView().shapes.length === 3);
    for (let i = 0; i < 6; i++) {
      a.transact((tx) => tx.update(ids[0], { x: i * 10 }), { label: "Move" });
      b.transact((tx) => tx.update(ids[1], { y: 20 + i * 5 }), { label: "Move" });
      await sleep(30);
    }
    await until(() => a.replica.getView().log.length === c.replica.getView().log.length && b.replica.getView().log.length === c.replica.getView().log.length);
    a.markSnapshot("Before offline");
    await until(() => b.replica.getView().snapshots.length === 1);
    a.setOnline(false);
    a.transact((tx) => tx.update(ids[0], { fill: "#ffc2a8" }), { label: "Recolour" });
    a.transact((tx) => tx.update(ids[0], { x: 120 }), { label: "Move" });
    a.transact((tx) => tx.setText(ids[0], "Plan A"), { label: "Type" });
    b.transact((tx) => tx.update(ids[0], { fill: "#b8ecd9" }), { label: "Recolour" });
    c.transact((tx) => tx.delete(ids[2]), { label: "Delete" });
    await sleep(60);
    a.setOnline(true);
    await until(() => a.replica.getView().conflicts.length > 0 && a.replica.getView().log.length === b.replica.getView().log.length);
    for (let i = 0; i < 5; i++) {
      c.transact((tx) => tx.update(ids[1], { x: 260 + i * 7 }), { label: "Move" });
      await sleep(20);
    }
    await sleep(300);
    console.log("ops", a.replica.getView().log.length, "conflicts", a.replica.getView().conflicts.map((k) => `${k.kind}/${k.status}`));

    const store = createUiStore({ mode: "draw" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          Pane,
          { session: a, store },
          createElement("div", { className: "canvas" }, createElement(TimeTravelBanner)),
          createElement("div", { style: { marginTop: 8 } }, createElement(Loom)),
        ),
      );
    });
    await act(async () => { await sleep(80); });
    dump("1-collapsed", container);

    const log = a.replica.getView().log;
    await act(async () => { store.getState().set({ scrub: { atOpId: log[14].id, label: "x" } }); });
    await act(async () => { await sleep(30); });
    dump("2-collapsed-scrub", container);
    await act(async () => { store.getState().set({ scrub: null, mode: "xray" }); });
    await act(async () => { await sleep(80); });
    // hover an op in the diagram
    dump("3-expanded", container);
    const conflict = a.replica.getView().conflicts.find((k) => k.status === "live")!;
    await act(async () => { store.getState().focusConflict({ id: conflict.id, lineageKey: conflict.lineageKey }); });
    await act(async () => { await sleep(50); });
    dump("4-expanded-focus", container);
    dump("4b-expanded-focus-dark", container, "dark");
    await act(async () => { store.getState().focusConflict(null); });
    const snap = a.replica.getView().snapshots[0];
    await act(async () => { store.getState().set({ scrub: { cut: snap.cut, label: snap.name } }); });
    await act(async () => { await sleep(50); });
    dump("5-expanded-cut", container);
    await act(async () => { store.getState().set({ scrub: { atOpId: log[20].id, label: "x" } }); });
    await act(async () => { await sleep(50); });
    // hover card via ribbon
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    const PE = (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent;
    const ev = PE ? new PE("pointermove", { clientX: 400, clientY: 10, bubbles: true, pointerType: "mouse" }) : new MouseEvent("pointermove", { clientX: 400, clientY: 10, bubbles: true });
    await act(async () => { slider.dispatchEvent(ev); });
    await act(async () => { await sleep(50); });
    dump("6-expanded-scrub-hover", container);
    await act(async () => { store.getState().set({ scrub: null }); });
    const tableBtn = [...container.querySelectorAll("button")].find((x) => x.textContent === "Table")!;
    await act(async () => { tableBtn.click(); });
    await act(async () => { await sleep(80); });
    dump("7-table", container);
    await act(async () => root.unmount());

    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const root2 = createRoot(c2);
    const store2 = createUiStore({});
    a.markSnapshot("After merge");
    await act(async () => {
      root2.render(createElement(Pane, { session: a, store: store2 }, createElement("div", { className: "sheet", style: { width: 420, height: 520, display: "flex", flexDirection: "column" } }, createElement(SnapshotsPanel))));
    });
    await act(async () => { await sleep(80); });
    dump("8-snapshots", c2, "light", 460);
    const restoreBtn = [...c2.querySelectorAll("button")].find((x) => x.textContent?.includes("Restore…"))!;
    await act(async () => { restoreBtn.click(); });
    dump("9-snapshots-confirm-dark", c2, "dark", 460);
    await act(async () => root2.unmount());
    a.dispose();
    b.dispose();
    c.dispose();
  });
});
