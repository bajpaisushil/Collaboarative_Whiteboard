/**
 * The "stage": both panes as the director sees them — each pane's session, its UI store and
 * its on-screen canvas — plus the seam's own store. Scripts (scenarios, tour) and the store
 * bridge act through this object; it never touches replica mutators, only session APIs and
 * pane UI stores.
 *
 * Canvas geometry is read lazily from the DOM (`[data-split-pane]` wrappers rendered by
 * PaneFrame), so hidden panes on narrow screens fall back to their last known size.
 */
import type { StoreApi } from "zustand";
import type { Conflict, ConflictKind, ShapeId, ShapeView } from "@/lib/crdt/types";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { rectsIntersect, shapeBounds, type Rect } from "@/lib/ui/geometry";
import type { Camera, UiStore } from "@/lib/ui/store";

export type PaneId = "A" | "B";
export const PANE_IDS: readonly PaneId[] = ["A", "B"];

export interface PaneHandle {
  id: PaneId;
  session: WhiteboardSessionApi;
  store: StoreApi<UiStore>;
}

export interface Stage {
  readonly panes: Readonly<Record<PaneId, PaneHandle>>;
  /** The seam's own UI store (focus here is mirrored into both panes by the bridge). */
  readonly seam: StoreApi<UiStore>;
  pane(id: PaneId): PaneHandle;
  /** Both panes ready to author ops. */
  ready(): boolean;
  /** Top-left for a new shape of `size`: near the middle of Tab A's view, clear of other shapes. */
  place(size: { w: number; h: number }): { x: number; y: number };
  /** Pan each pane (keeping zoom where possible) so the shape is fully visible. */
  reveal(shapeId: ShapeId): void;
  /** Select the shape in every pane that has it. */
  select(shapeId: ShapeId): void;
  focusConflict(c: Pick<Conflict, "id" | "lineageKey">): void;
  clearFocus(): void;
  /** Both panes hold byte-identical documents. */
  identical(): boolean;
}

/** Screen area of a compact pane covered by floating chrome (top bar, tool dock). */
const CHROME = { left: 60, top: 62, right: 16, bottom: 72 };
const FALLBACK_SIZE = { width: 720, height: 520 };
const GAP = 48;

function canvasElement(pane: PaneId): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const wrap = document.querySelector<HTMLElement>(`[data-split-pane="${pane}"]`);
  if (!wrap) return null;
  return wrap.querySelector<HTMLElement>("[data-canvas-root]") ?? wrap;
}

export function findConflict(session: WhiteboardSessionApi, shapeId: ShapeId, kind?: ConflictKind): Conflict | null {
  let best: Conflict | null = null;
  for (const c of session.replica.getView().conflicts) {
    if (c.shapeId !== shapeId || (kind && c.kind !== kind)) continue;
    const better =
      !best ||
      (c.status === "live" && best.status !== "live") ||
      (c.status === best.status && (c.valuesEqual === best.valuesEqual ? c.lamport > best.lamport : !c.valuesEqual));
    if (better) best = c;
  }
  return best;
}

export function createStage(opts: {
  a: WhiteboardSessionApi;
  b: WhiteboardSessionApi;
  storeA: StoreApi<UiStore>;
  storeB: StoreApi<UiStore>;
  seam: StoreApi<UiStore>;
}): Stage {
  const panes: Record<PaneId, PaneHandle> = {
    A: { id: "A", session: opts.a, store: opts.storeA },
    B: { id: "B", session: opts.b, store: opts.storeB },
  };
  const lastSize: Record<PaneId, { width: number; height: number } | null> = { A: null, B: null };

  const sizeOf = (id: PaneId) => {
    const el = canvasElement(id);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) {
        lastSize[id] = { width: r.width, height: r.height };
        return lastSize[id]!;
      }
    }
    return lastSize[id] ?? lastSize[id === "A" ? "B" : "A"] ?? FALLBACK_SIZE;
  };

  /** Unobstructed screen rect of a pane's canvas, in CSS px. */
  const clearArea = (id: PaneId) => {
    const { width, height } = sizeOf(id);
    const w = Math.max(80, width - CHROME.left - CHROME.right);
    const h = Math.max(80, height - CHROME.top - CHROME.bottom);
    return { sx: CHROME.left, sy: CHROME.top, w, h };
  };

  const visibleWorld = (id: PaneId): Rect => {
    const cam = panes[id].store.getState().camera;
    const a = clearArea(id);
    return { x: cam.x + a.sx / cam.zoom, y: cam.y + a.sy / cam.zoom, w: a.w / cam.zoom, h: a.h / cam.zoom };
  };

  const shapeOf = (shapeId: ShapeId): ShapeView | null =>
    panes.A.session.replica.getShape(shapeId) ?? panes.B.session.replica.getShape(shapeId);

  const revealIn = (id: PaneId, r: Rect) => {
    const store = panes[id].store;
    const cam = store.getState().camera;
    const vis = visibleWorld(id);
    if (r.x >= vis.x && r.y >= vis.y && r.x + r.w <= vis.x + vis.w && r.y + r.h <= vis.y + vis.h) return;
    const area = clearArea(id);
    const fit = Math.min((area.w - 48) / Math.max(1, r.w), (area.h - 48) / Math.max(1, r.h));
    const zoom = Math.max(0.1, Math.min(cam.zoom, fit, 8));
    const next: Camera = {
      zoom,
      x: r.x + r.w / 2 - (area.sx + area.w / 2) / zoom,
      y: r.y + r.h / 2 - (area.sy + area.h / 2) / zoom,
    };
    store.getState().setCamera(next);
  };

  return {
    panes,
    seam: opts.seam,
    pane: (id) => panes[id],
    ready: () => panes.A.session.getState().ready && panes.B.session.getState().ready,

    place(size) {
      const vis = visibleWorld("A");
      const cx = vis.x + vis.w / 2 - size.w / 2;
      const cy = vis.y + vis.h / 2 - size.h / 2;
      const occupied: Rect[] = [];
      for (const p of PANE_IDS) for (const s of panes[p].session.replica.getView().shapes) occupied.push(shapeBounds(s));
      const stepX = size.w + GAP;
      const stepY = size.h + GAP;
      const candidates: { x: number; y: number; d: number }[] = [];
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) candidates.push({ x: cx + i * stepX, y: cy + j * stepY, d: i * i * 1.2 + j * j });
      }
      candidates.sort((p, q) => p.d - q.d);
      for (const c of candidates) {
        const box = { x: c.x - GAP / 2, y: c.y - GAP / 2, w: size.w + GAP, h: size.h + GAP };
        if (!occupied.some((r) => rectsIntersect(r, box))) return { x: Math.round(c.x), y: Math.round(c.y) };
      }
      return { x: Math.round(cx), y: Math.round(cy) };
    },

    reveal(shapeId) {
      const s = shapeOf(shapeId);
      if (!s) return;
      const r = shapeBounds(s);
      for (const p of PANE_IDS) revealIn(p, r);
    },

    select(shapeId) {
      for (const p of PANE_IDS) {
        const { session, store } = panes[p];
        if (!session.replica.getShape(shapeId)) continue;
        const ui = store.getState();
        if (ui.selection.length !== 1 || ui.selection[0] !== shapeId) ui.select([shapeId]);
      }
    },

    focusConflict(c) {
      opts.seam.getState().focusConflict({ id: c.id, lineageKey: c.lineageKey });
    },

    clearFocus() {
      if (opts.seam.getState().focus) opts.seam.getState().focusConflict(null);
    },

    identical() {
      const va = panes.A.session.replica.getView();
      const vb = panes.B.session.replica.getView();
      return va.stateHash === vb.stateHash && va.pending.length === 0 && vb.pending.length === 0;
    },
  };
}
