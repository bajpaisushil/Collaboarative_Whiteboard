// @vitest-environment jsdom
/**
 * Render smoke test for the Why panel: builds real conflicts of every kind between two
 * in-memory replicas, then renders the list, every explainer section (both variants) and the
 * provenance card, failing on any thrown error or React error log.
 */
import { act, useMemo, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Replica } from "@/lib/crdt/replica";
import type { Op, OpId, TransactOptions, Tx } from "@/lib/crdt/types";
import { SessionProvider } from "@/lib/session/react";
import type { SessionState, WhiteboardSessionApi } from "@/lib/session/types";
import { DEFAULT_CONDITIONS } from "@/lib/sync/protocol";
import { PaneProvider, type PaneContextValue } from "@/lib/ui/pane";
import { createUiStore, UiStoreProvider } from "@/lib/ui/store";
import type { StoreApi } from "zustand";
import type { UiStore } from "@/lib/ui/store";
import { ConflictList } from "../ConflictList";
import { Explainer } from "../Explainer";
import { ProvenanceCard } from "../ProvenanceCard";
import { WhyPanel } from "../WhyPanel";

vi.mock("@/components/loom/SnapshotsPanel", () => ({ SnapshotsPanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let t = 1_000_000;
const now = () => (t += 1000);

function sync(...rs: Replica[]) {
  for (const x of rs) for (const y of rs) if (x !== y) y.receive(x.opsSince(y.getView().vc));
}

function fakeSession(r: Replica): WhiteboardSessionApi {
  const state: SessionState = {
    ready: true,
    room: "smoke",
    pane: "main",
    replica: r.id,
    label: r.label,
    color: "var(--thread-a)",
    forkedFrom: null,
    network: DEFAULT_CONDITIONS,
    rtc: { available: false, links: [] },
    peers: [],
    offlineSince: null,
    unsyncedLocalOps: 0,
    stableVc: {},
    lastMerge: null,
    mergeHistory: [],
    traffic: { sent: 0, received: 0, dropped: 0 },
    storage: { bytes: 0, error: null },
  };
  const s: Partial<WhiteboardSessionApi> = {
    replica: r,
    getState: () => state,
    subscribe: () => () => {},
    onEvent: () => () => {},
    transact: (b: (tx: Tx) => void, o?: TransactOptions) => r.transact(b, o),
    undo: () => r.undo(),
    redo: () => r.redo(),
    adoptConflictValue: (id: string, op: OpId) => r.adoptConflictValue(id, op),
    markSnapshot: (n: string): Op => r.markSnapshot(n),
    updatePresence: () => {},
    getPresence: () => new Map(),
    subscribePresence: () => () => {},
  };
  return s as WhiteboardSessionApi;
}

function Pane({ session, store, children }: { session: WhiteboardSessionApi; store: StoreApi<UiStore>; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pane = useMemo<PaneContextValue>(() => ({ paneId: "main", compact: false, rootRef }), []);
  return (
    <SessionProvider session={session}>
      <UiStoreProvider store={store}>
        <PaneProvider value={pane}>
          <div ref={rootRef}>{children}</div>
        </PaneProvider>
      </UiStoreProvider>
    </SessionProvider>
  );
}

let a: Replica, b: Replica;
let container: HTMLDivElement;
let root: Root;
const errors: unknown[] = [];

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));

  a = new Replica({ replica: "ra", label: "A", now });
  b = new Replica({ replica: "rb", label: "B", now });
  let sticky = "",
    rect = "",
    note = "";
  a.transact((tx) => {
    sticky = tx.create({ type: "sticky", props: { x: 10, y: 10, w: 200, h: 160, fill: "#ffe58a" }, text: "Plan" });
    rect = tx.create({ type: "rect", props: { x: 300, y: 0, w: 100, h: 50 } });
    note = tx.create({ type: "sticky", props: { x: 0, y: 300, w: 200, h: 160 }, text: "Hello" });
  });
  sync(a, b);
  a.transact((tx) => tx.update(sticky, { fill: "#ffc2a8" }), { label: "Recolour" });
  a.transact((tx) => tx.update(sticky, { x: 40 }), { label: "Move" });
  b.transact((tx) => tx.update(sticky, { fill: "#b8ecd9" }), { label: "Recolour" });
  a.transact((tx) => tx.delete(rect), { label: "Delete" });
  b.transact((tx) => tx.update(rect, { fill: "#1b998b" }), { label: "Fill" });
  a.transact((tx) => tx.insertText(note, 5, " world"), { label: "Type" });
  b.transact((tx) => tx.insertText(note, 5, " there"), { label: "Type" });
  sync(a, b);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterAll(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

async function openAll() {
  for (let i = 0; i < 3; i++) {
    const closed = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'));
    if (closed.length === 0) break;
    await act(async () => closed.forEach((btn) => btn.click()));
  }
}

describe("why panel smoke", () => {
  it("has all three kinds of knots", () => {
    const kinds = new Set(a.getView().conflicts.map((c) => c.kind));
    expect(kinds).toEqual(new Set(["concurrent-write", "delete-vs-edit", "concurrent-text"]));
  });

  it("renders the list and the panel", async () => {
    const store = createUiStore({ panelOpen: true });
    await render(<Pane session={fakeSession(a)} store={store}><WhyPanel /></Pane>);
    expect(container.textContent).toContain("Contested");
    expect(container.textContent).toContain("Revived");
    expect(container.textContent).toContain("Interleaved");
    await render(<Pane session={fakeSession(a)} store={store}><ConflictList variant="seam" /></Pane>);
    expect(errors).toEqual([]);
  });

  for (const variant of ["panel", "seam"] as const) {
    it(`renders every section of every explainer (${variant})`, async () => {
      for (const c of a.getView().conflicts) {
        const store = createUiStore({ panelOpen: true, focus: { id: c.id, lineageKey: c.lineageKey } });
        await render(
          <Pane session={fakeSession(a)} store={store}>
            <Explainer conflictId={c.id} variant={variant} onClose={() => {}} />
          </Pane>,
        );
        await openAll();
        const text = container.textContent ?? "";
        expect(text).toContain(a.explain(c.id)!.question);
        expect(text).toContain("Same result");
        // step the replay and toggle technical / numbers
        const next = container.querySelector<HTMLButtonElement>('button[aria-label="Next beat"]');
        for (let i = 0; i < 6 && next && !next.disabled; i++) await act(async () => next.click());
        const numbers = Array.from(container.querySelectorAll("button")).find((x) => x.textContent === "Show as numbers");
        if (numbers) await act(async () => numbers.click());
        const sw = container.querySelector<HTMLButtonElement>('button[role="switch"]');
        if (sw) await act(async () => sw.click());
        expect(errors).toEqual([]);
      }
    });
  }

  it("adopts the losing value and shows the knot as resolved", async () => {
    const c = a.getView().conflicts.find((x) => x.kind === "concurrent-write")!;
    const store = createUiStore({ panelOpen: true, focus: { id: c.id, lineageKey: c.lineageKey } });
    await render(<Pane session={fakeSession(a)} store={store}><Explainer conflictId={c.id} /></Pane>);
    const use = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.startsWith("Use "));
    expect(use).toBeTruthy();
    const picked = use!.textContent!.replace(/^Use /, ""); // "A's peach"
    await act(async () => use!.click());
    expect(a.getView().conflicts.find((x) => x.id === c.id)?.status).toBe("superseded");
    expect(container.textContent).toContain("Later,");
    // The explainer now agrees with the board: it asks about the picked value, not the old winner.
    const header = container.querySelector("article header")!;
    const question = header.querySelector("h2")!.textContent!;
    expect(question).not.toBe(a.explain(c.id)!.question);
    expect(question).toContain(`picked ${picked.replace("'", "’")} by hand`);
    expect(header.textContent).toContain("won the merge");
    expect(header.textContent).toContain(`${picked.replace("'", "’")} is on the board now`);
    expect(header.textContent).not.toContain("is kept in history");
    // The picked side's card says it lost the merge and is on the board — not "kept in history".
    expect(container.textContent).toContain("lost the merge");
    expect(errors).toEqual([]);
  });

  it("renders provenance for every shape", async () => {
    const store = createUiStore();
    for (const s of a.getView().shapes) {
      await render(<Pane session={fakeSession(a)} store={store}><ProvenanceCard shapeId={s.id} onClose={() => {}} /></Pane>);
      expect(container.textContent).toContain("Why does this");
    }
    expect(errors).toEqual([]);
  });

  it("shows the gone state for an unknown knot", async () => {
    const store = createUiStore();
    await render(<Pane session={fakeSession(a)} store={store}><Explainer conflictId="nope" /></Pane>);
    expect(container.textContent).toContain("no longer present");
  });
});
