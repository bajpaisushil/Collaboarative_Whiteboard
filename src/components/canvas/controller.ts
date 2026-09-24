/**
 * Pointer/wheel state machine for one canvas. Gesture state lives here (never in React
 * state); visual feedback is pushed to the interaction store at most once per animation
 * frame, and everything is committed as ONE session transaction on pointerup.
 */
import type { StoreApi } from "zustand";
import type { Point, ShapeId, ShapeProps, ShapeType, ShapeView } from "@/lib/crdt/types";
import type { PresenceDrawing, PresenceState } from "@/lib/sync/protocol";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import type { Camera, UiStore } from "@/lib/ui/store";
import { rectsIntersect, simplifyPoints, unionRects, type Rect } from "@/lib/ui/geometry";
import { clampZoom, fitCamera, screenToWorld, wheelPixels, zoomAt } from "./camera";
import { deleteShapes, moveShapes } from "./commands";
import { EMPTY_SET, announce, type InteractionState } from "./interaction";
import {
  countNoun,
  displayBounds,
  draftView,
  hasFill,
  hitShape,
  INK,
  maxZ,
  rectFrom,
  relativePoints,
  RESIZABLE,
  round2,
  topmostAt,
} from "./shapeUtils";
import { shapeNoun } from "@/lib/crdt/describe";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "a0" | "a1";

interface XY {
  x: number;
  y: number;
}

type Gesture =
  | { kind: "pan"; pointerId: number; sx: number; sy: number; cam: Camera }
  | { kind: "pinch"; a: number; b: number; dist: number; mid: XY; cam: Camera }
  | { kind: "stroke"; pointerId: number; points: Point[]; pressure: boolean; last: XY }
  | { kind: "box"; pointerId: number; type: "rect" | "ellipse"; start: XY; end: XY; shift: boolean }
  | { kind: "arrow"; pointerId: number; start: XY; end: XY; shift: boolean }
  | { kind: "place"; pointerId: number; type: "sticky" | "text"; at: XY }
  | {
      kind: "move";
      pointerId: number;
      ids: ShapeId[];
      origin: Map<ShapeId, XY>;
      start: XY;
      screen: XY;
      dx: number;
      dy: number;
      active: boolean;
      /** Click without drag on one of a multi-selection collapses to it. */
      collapseTo: ShapeId | null;
    }
  | { kind: "resize"; pointerId: number; id: ShapeId; handle: Handle; start: Rect; offset: XY; next: Rect; ratio: number }
  | { kind: "endpoint"; pointerId: number; id: ShapeId; which: 0 | 1; a: XY; b: XY; offset: XY }
  | { kind: "marquee"; pointerId: number; start: XY; end: XY; screen: XY; base: ShapeId[]; additive: boolean; active: boolean }
  | { kind: "erase"; pointerId: number; last: XY; hits: Set<ShapeId>; trail: [number, number][] };

export interface ControllerDeps {
  session: WhiteboardSessionApi;
  ui: StoreApi<UiStore>;
  ix: StoreApi<InteractionState>;
  svg: SVGSVGElement;
  container: HTMLElement;
}

const DRAG_THRESHOLD = 3;
const HIT_TOL = 6;

export class CanvasController {
  private gesture: Gesture | null = null;
  private touches = new Map<number, XY>();
  private rect: DOMRect | null = null;
  private raf = 0;
  private dirty = false;
  private cursor: XY | null = null;
  private cursorDirty = false;
  private hover: XY | null = null;
  private hoverDirty = false;
  private hoverShape: ShapeId | null = null;
  private spaceHeld = false;
  private lastCursorCss = "";
  private detachFns: (() => void)[] = [];

  constructor(private readonly d: ControllerDeps) {}

  /* ------------------------------------------------------------------ lifecycle */

  attach(): () => void {
    const { svg } = this.d;
    const on = <K extends keyof SVGElementEventMap>(type: K, fn: (e: SVGElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      svg.addEventListener(type, fn as EventListener, opts);
      this.detachFns.push(() => svg.removeEventListener(type, fn as EventListener, opts));
    };
    on("pointerdown", this.onPointerDown);
    on("pointermove", this.onPointerMove);
    on("pointerup", this.onPointerUp);
    on("pointercancel", this.onPointerCancel);
    on("pointerleave", this.onPointerLeave);
    on("dblclick", this.onDoubleClick);
    on("contextmenu", this.onContextMenu);
    on("wheel", this.onWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      this.rect = null;
    });
    ro.observe(svg);
    this.detachFns.push(() => ro.disconnect());

    const onBlur = () => this.setSpace(false);
    window.addEventListener("blur", onBlur);
    this.detachFns.push(() => window.removeEventListener("blur", onBlur));

    // Cursor follows tool / style / zoom / time travel.
    this.detachFns.push(
      this.d.ui.subscribe((s, p) => {
        if (s.tool !== p.tool || s.style !== p.style || s.camera.zoom !== p.camera.zoom || s.scrub !== p.scrub) {
          if (s.tool !== p.tool || (s.scrub && !p.scrub)) this.cancel();
          this.updateCursor();
        }
      }),
    );
    this.updateCursor();

    return () => {
      this.cancel();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      for (const f of this.detachFns.splice(0)) f();
      this.d.session.updatePresence({ cursor: null, drawing: null, preview: null });
    };
  }

  /* ------------------------------------------------------------------ public API */

  get busy(): boolean {
    return this.gesture !== null;
  }

  /** Abort the in-progress gesture without committing anything. */
  cancel(): boolean {
    const g = this.gesture;
    if (!g) return false;
    this.gesture = null;
    this.dirty = false;
    if (g.kind === "marquee" && g.active) this.d.ui.getState().select(g.base);
    if ("pointerId" in g) this.release(g.pointerId);
    this.clearTransient();
    this.updateCursor();
    return true;
  }

  setSpace(held: boolean): void {
    if (this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.updateCursor();
  }

  viewportSize(): { w: number; h: number } {
    const r = this.bounds();
    return { w: r.width, h: r.height };
  }

  zoomBy(factor: number): void {
    const { w, h } = this.viewportSize();
    const cam = this.d.ui.getState().camera;
    this.d.ui.getState().setCamera(zoomAt(cam, w / 2, h / 2, cam.zoom * factor));
  }

  resetZoom(): void {
    const { w, h } = this.viewportSize();
    const cam = this.d.ui.getState().camera;
    this.d.ui.getState().setCamera(zoomAt(cam, w / 2, h / 2, 1));
  }

  zoomToFit(ids?: readonly ShapeId[]): void {
    const view = this.d.session.replica.getView();
    const set = ids && ids.length ? new Set(ids) : null;
    const shapes = set ? view.shapes.filter((s) => set.has(s.id)) : view.shapes;
    const box = unionRects(shapes.map(displayBounds));
    const { w, h } = this.viewportSize();
    if (!box || w <= 0 || h <= 0) return;
    this.d.ui.getState().setCamera(fitCamera(box, w, h));
  }

  /** Centre the camera on a world rect without changing zoom (unless it doesn't fit). */
  reveal(r: Rect): void {
    const { w, h } = this.viewportSize();
    if (w <= 0 || h <= 0) return; // not laid out (hidden pane)
    const cam = this.d.ui.getState().camera;
    const vx0 = cam.x,
      vy0 = cam.y,
      vx1 = cam.x + w / cam.zoom,
      vy1 = cam.y + h / cam.zoom;
    if (r.x >= vx0 && r.y >= vy0 && r.x + r.w <= vx1 && r.y + r.h <= vy1) return;
    const pad = Math.min(96, w * 0.25, h * 0.25);
    const zoom = Math.min(cam.zoom, clampZoom(Math.min((w - pad) / Math.max(1, r.w), (h - pad) / Math.max(1, r.h))));
    this.d.ui.getState().setCamera({ zoom, x: r.x + r.w / 2 - w / zoom / 2, y: r.y + r.h / 2 - h / zoom / 2 });
  }

  /* ------------------------------------------------------------------ coordinates */

  private bounds(): DOMRect {
    if (!this.rect) this.rect = this.d.svg.getBoundingClientRect();
    return this.rect;
  }

  private screen(e: { clientX: number; clientY: number }): XY {
    const r = this.bounds();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private world(e: { clientX: number; clientY: number }): XY {
    const s = this.screen(e);
    return screenToWorld(this.d.ui.getState().camera, s.x, s.y);
  }

  private get zoom(): number {
    return this.d.ui.getState().camera.zoom;
  }

  /* ------------------------------------------------------------------ pointer events */

  private onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    if (target?.closest?.("[data-canvas-ignore]")) return;
    this.rect = null;
    this.focusCanvas();
    if (e.button === 2) return; // context menu handles provenance

    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, this.screen(e));
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
    }
    if (this.gesture) return;
    e.preventDefault();

    const ui = this.d.ui.getState();
    const s = this.screen(e);
    const w = screenToWorld(ui.camera, s.x, s.y);
    const readOnly = ui.scrub !== null;

    if (e.button === 1 || this.spaceHeld || ui.tool === "hand" || readOnly) {
      if (e.button !== 0 && e.button !== 1) return;
      this.begin({ kind: "pan", pointerId: e.pointerId, sx: s.x, sy: s.y, cam: ui.camera }, e);
      return;
    }
    if (e.button !== 0) return;

    switch (ui.tool) {
      case "select":
        this.beginSelect(e, w, s);
        return;
      case "pen": {
        const pressure = e.pointerType === "pen";
        const pt: Point = pressure ? [w.x, w.y, e.pressure || 0.5] : [w.x, w.y];
        this.begin({ kind: "stroke", pointerId: e.pointerId, points: [pt], pressure, last: w }, e);
        return;
      }
      case "rect":
      case "ellipse":
        this.begin({ kind: "box", pointerId: e.pointerId, type: ui.tool, start: w, end: w, shift: e.shiftKey }, e);
        return;
      case "arrow":
        this.begin({ kind: "arrow", pointerId: e.pointerId, start: w, end: w, shift: e.shiftKey }, e);
        return;
      case "sticky":
      case "text":
        this.begin({ kind: "place", pointerId: e.pointerId, type: ui.tool, at: w }, e);
        return;
      case "eraser": {
        const g: Gesture = { kind: "erase", pointerId: e.pointerId, last: w, hits: new Set(), trail: [[w.x, w.y]] };
        this.eraseAlong(g, w, w);
        this.begin(g, e);
        return;
      }
    }
  };

  private beginSelect(e: PointerEvent, w: XY, s: XY) {
    const ui = this.d.ui.getState();
    const view = this.d.session.replica.getView();
    const target = e.target as Element | null;
    const handleEl = target?.closest?.("[data-handle]");
    if (handleEl) {
      const handle = handleEl.getAttribute("data-handle") as Handle;
      const id = handleEl.getAttribute("data-shape") ?? "";
      const shape = view.shapeById.get(id);
      if (shape) {
        this.beginHandle(e, shape, handle, w);
        return;
      }
    }

    const hit = topmostAt(view.shapes, w.x, w.y, HIT_TOL / this.zoom);
    let sel = ui.selection.filter((id) => view.shapeById.has(id));
    if (hit) {
      let collapseTo: ShapeId | null = null;
      if (e.shiftKey) {
        sel = sel.includes(hit.id) ? sel.filter((id) => id !== hit.id) : [...sel, hit.id];
        ui.select(sel);
        if (!sel.includes(hit.id)) return;
      } else if (!sel.includes(hit.id)) {
        sel = [hit.id];
        ui.select(sel);
      } else if (sel.length > 1) {
        collapseTo = hit.id;
      }
      this.beginMove(e, sel, w, s, collapseTo);
      return;
    }
    // Inside the bounds of a multi-selection → drag the group.
    if (sel.length > 1 && !e.shiftKey) {
      const box = unionRects(sel.map((id) => displayBounds(view.shapeById.get(id)!)));
      if (box && w.x >= box.x && w.x <= box.x + box.w && w.y >= box.y && w.y <= box.y + box.h) {
        this.beginMove(e, sel, w, s, null);
        return;
      }
    }
    const base = e.shiftKey ? sel : [];
    if (!e.shiftKey && ui.selection.length) ui.select([]);
    this.begin({ kind: "marquee", pointerId: e.pointerId, start: w, end: w, screen: s, base, additive: e.shiftKey, active: false }, e);
  }

  private beginMove(e: PointerEvent, ids: ShapeId[], w: XY, s: XY, collapseTo: ShapeId | null) {
    const byId = this.d.session.replica.getView().shapeById;
    const origin = new Map<ShapeId, XY>();
    for (const id of ids) {
      const sh = byId.get(id);
      if (sh) origin.set(id, { x: sh.x, y: sh.y });
    }
    this.begin({ kind: "move", pointerId: e.pointerId, ids: [...origin.keys()], origin, start: w, screen: s, dx: 0, dy: 0, active: false, collapseTo }, e);
  }

  private beginHandle(e: PointerEvent, shape: ShapeView, handle: Handle, w: XY) {
    if (handle === "a0" || handle === "a1") {
      if (shape.type !== "arrow") return;
      const p0 = shape.points[0] ?? [0, 0];
      const p1 = shape.points[shape.points.length - 1] ?? [0, 0];
      const a = { x: shape.x + p0[0], y: shape.y + p0[1] };
      const b = { x: shape.x + p1[0], y: shape.y + p1[1] };
      const which = handle === "a0" ? 0 : 1;
      const at = which === 0 ? a : b;
      this.begin({ kind: "endpoint", pointerId: e.pointerId, id: shape.id, which, a, b, offset: { x: at.x - w.x, y: at.y - w.y } }, e);
      return;
    }
    if (!RESIZABLE.has(shape.type)) return;
    const start = displayBounds(shape);
    const hx = handle.includes("w") ? start.x : handle.includes("e") ? start.x + start.w : start.x + start.w / 2;
    const hy = handle.includes("n") ? start.y : handle.includes("s") ? start.y + start.h : start.y + start.h / 2;
    this.begin(
      {
        kind: "resize",
        pointerId: e.pointerId,
        id: shape.id,
        handle,
        start,
        offset: { x: hx - w.x, y: hy - w.y },
        next: start,
        ratio: start.h === 0 ? 1 : start.w / start.h,
      },
      e,
    );
  }

  private begin(g: Gesture, e: PointerEvent) {
    this.gesture = g;
    try {
      this.d.svg.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    this.dirty = true;
    this.schedule();
    this.updateCursor();
  }

  private onPointerMove = (e: PointerEvent) => {
    const w = this.world(e);
    this.cursor = w;
    this.cursorDirty = true;

    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, this.screen(e));
    const g = this.gesture;
    if (!g) {
      this.hover = w;
      this.hoverDirty = true;
      this.schedule();
      return;
    }
    if (g.kind === "pinch") {
      this.movePinch(g);
      return;
    }
    if (g.pointerId !== e.pointerId) return;

    switch (g.kind) {
      case "pan": {
        const s = this.screen(e);
        const z = g.cam.zoom;
        this.d.ui.getState().setCamera({ x: g.cam.x - (s.x - g.sx) / z, y: g.cam.y - (s.y - g.sy) / z, zoom: z });
        break;
      }
      case "stroke": {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        const list = events.length ? events : [e];
        const minStep = 0.5 / this.zoom;
        for (const ce of list) {
          const p = this.world(ce);
          if (Math.hypot(p.x - g.last.x, p.y - g.last.y) < minStep) continue;
          g.points.push(g.pressure ? [p.x, p.y, ce.pressure || 0.5] : [p.x, p.y]);
          g.last = p;
        }
        break;
      }
      case "box":
      case "arrow":
        g.end = w;
        g.shift = e.shiftKey;
        break;
      case "place":
        g.at = w;
        break;
      case "move": {
        const s = this.screen(e);
        if (!g.active && Math.hypot(s.x - g.screen.x, s.y - g.screen.y) < DRAG_THRESHOLD) return;
        if (!g.active) {
          g.active = true;
          this.d.ix.setState({ hidden: new Set(g.ids) });
        }
        let dx = w.x - g.start.x,
          dy = w.y - g.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        g.dx = dx;
        g.dy = dy;
        break;
      }
      case "resize":
        g.next = resizeRect(g.start, g.handle, { x: w.x + g.offset.x, y: w.y + g.offset.y }, e.shiftKey, g.ratio, 4 / this.zoom);
        if (!this.d.ix.getState().hidden.has(g.id)) this.d.ix.setState({ hidden: new Set([g.id]) });
        break;
      case "endpoint": {
        let p = { x: w.x + g.offset.x, y: w.y + g.offset.y };
        const fixed = g.which === 0 ? g.b : g.a;
        if (e.shiftKey) p = snapAngle(fixed, p);
        if (g.which === 0) g.a = p;
        else g.b = p;
        if (!this.d.ix.getState().hidden.has(g.id)) this.d.ix.setState({ hidden: new Set([g.id]) });
        break;
      }
      case "marquee": {
        const s = this.screen(e);
        if (!g.active && Math.hypot(s.x - g.screen.x, s.y - g.screen.y) < DRAG_THRESHOLD) return;
        g.active = true;
        g.end = w;
        break;
      }
      case "erase": {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        const list = events.length ? events : [e];
        for (const ce of list) {
          const p = this.world(ce);
          this.eraseAlong(g, g.last, p);
          g.last = p;
          g.trail.push([p.x, p.y]);
        }
        if (g.trail.length > 28) g.trail.splice(0, g.trail.length - 28);
        break;
      }
    }
    this.dirty = true;
    this.schedule();
  };

  private onPointerUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === "pinch") {
      if (e.pointerId === g.a || e.pointerId === g.b) {
        this.gesture = null;
        this.updateCursor();
      }
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    this.gesture = null;
    this.dirty = false;
    this.release(e.pointerId);
    this.commit(g);
    this.updateCursor();
    // Released outside the board (pointer capture kept us informed until now): hide our
    // cursor for peers, as a plain pointerleave would have.
    const s = this.screen(e);
    const r = this.bounds();
    if (s.x < 0 || s.y < 0 || s.x > r.width || s.y > r.height) {
      this.cursor = null;
      this.cursorDirty = true;
      this.schedule();
    }
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === "pinch" || g.pointerId === e.pointerId) this.cancel();
  };

  private onPointerLeave = () => {
    if (this.gesture) return;
    this.cursor = null;
    this.cursorDirty = true;
    this.hover = null;
    this.hoverDirty = true;
    this.schedule();
  };

  private onDoubleClick = (e: MouseEvent) => {
    const ui = this.d.ui.getState();
    if (ui.scrub || ui.tool !== "select") return;
    if ((e.target as Element | null)?.closest?.("[data-canvas-ignore]")) return;
    const w = this.world(e);
    const view = this.d.session.replica.getView();
    const hit = topmostAt(view.shapes, w.x, w.y, HIT_TOL / this.zoom);
    if (hit && (hit.type === "sticky" || hit.type === "text")) {
      e.preventDefault();
      ui.set({ selection: [hit.id], editingText: hit.id });
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    const ui = this.d.ui.getState();
    if (ui.scrub) return;
    const w = this.world(e);
    const view = this.d.session.replica.getView();
    const hit = topmostAt(view.shapes, w.x, w.y, HIT_TOL / this.zoom);
    if (!hit) return;
    e.preventDefault();
    ui.set({ selection: [hit.id], provenance: hit.id, panelOpen: true });
    announce(this.d.ix, `Showing why this ${shapeNoun(hit.type)} looks the way it does`);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.rect = null;
    const ui = this.d.ui.getState();
    const cam = ui.camera;
    const { dx, dy } = wheelPixels(e, this.bounds().height);
    if (e.ctrlKey || e.metaKey) {
      const s = this.screen(e);
      const step = Math.max(-12, Math.min(12, dy));
      ui.setCamera(zoomAt(cam, s.x, s.y, cam.zoom * Math.exp(-step * 0.01)));
      return;
    }
    const px = e.shiftKey && dx === 0 ? dy : dx;
    const py = e.shiftKey && dx === 0 ? 0 : dy;
    ui.setCamera({ x: cam.x + px / cam.zoom, y: cam.y + py / cam.zoom, zoom: cam.zoom });
  };

  /* ------------------------------------------------------------------ pinch */

  private startPinch() {
    if (this.gesture && this.gesture.kind !== "pinch") this.cancel();
    const [[a, pa], [b, pb]] = [...this.touches.entries()];
    this.gesture = {
      kind: "pinch",
      a,
      b,
      dist: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
      mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      cam: this.d.ui.getState().camera,
    };
    this.updateCursor();
  }

  private movePinch(g: Extract<Gesture, { kind: "pinch" }>) {
    const pa = this.touches.get(g.a),
      pb = this.touches.get(g.b);
    if (!pa || !pb) return;
    const dist = Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y));
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const zoom = clampZoom(g.cam.zoom * (dist / g.dist));
    const anchor = screenToWorld(g.cam, g.mid.x, g.mid.y);
    this.d.ui.getState().setCamera({ zoom, x: anchor.x - mid.x / zoom, y: anchor.y - mid.y / zoom });
  }

  /* ------------------------------------------------------------------ eraser */

  private eraseAlong(g: Extract<Gesture, { kind: "erase" }>, from: XY, to: XY) {
    const shapes = this.d.session.replica.getView().shapes;
    const tol = (HIT_TOL + 4) / this.zoom;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(len / (4 / this.zoom)));
    let changed = false;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t,
        y = from.y + (to.y - from.y) * t;
      for (let j = shapes.length - 1; j >= 0; j--) {
        const s = shapes[j];
        if (g.hits.has(s.id)) continue;
        if (hitShape(s, x, y, tol)) {
          g.hits.add(s.id);
          changed = true;
        }
      }
    }
    if (changed) this.dirty = true;
  }

  /* ------------------------------------------------------------------ frame flush */

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.flush);
  }

  private flush = () => {
    this.raf = 0;
    const presence: Partial<Omit<PresenceState, "label" | "color">> = {};
    if (this.cursorDirty) {
      presence.cursor = this.cursor ? { x: round2(this.cursor.x), y: round2(this.cursor.y) } : null;
      this.cursorDirty = false;
    }
    const g = this.gesture;
    if (g && this.dirty) {
      this.dirty = false;
      this.render(g, presence);
    }
    if (!g && this.hoverDirty) {
      this.hoverDirty = false;
      this.updateHover();
    }
    if (Object.keys(presence).length) this.d.session.updatePresence(presence);
  };

  /** Push gesture feedback to the interaction store + presence. */
  private render(g: Gesture, presence: Partial<Omit<PresenceState, "label" | "color">>) {
    const ui = this.d.ui.getState();
    const style = ui.style;
    const ix = this.d.ix;
    switch (g.kind) {
      case "stroke": {
        const points = g.points.slice();
        ix.setState({ draft: draftView("draft", "stroke", { points, stroke: style.stroke, strokeWidth: style.strokeWidth }) });
        presence.drawing = { tool: "stroke", points, stroke: style.stroke, fill: "none", strokeWidth: style.strokeWidth };
        break;
      }
      case "box": {
        const r = boxRect(g.start, g.end, g.shift);
        ix.setState({ draft: draftView("draft", g.type, { ...r, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth }) });
        presence.drawing = drawingOf(g.type, [
          [r.x, r.y],
          [r.x + r.w, r.y + r.h],
        ], style);
        break;
      }
      case "arrow": {
        const end = g.shift ? snapAngle(g.start, g.end) : g.end;
        const rel = relativePoints([
          [g.start.x, g.start.y],
          [end.x, end.y],
        ]);
        const pts: Point[] = [
          [round2(g.start.x - rel.x), round2(g.start.y - rel.y)],
          [round2(end.x - rel.x), round2(end.y - rel.y)],
        ];
        ix.setState({ draft: draftView("draft", "arrow", { ...rel, points: pts, stroke: style.stroke, strokeWidth: style.strokeWidth }) });
        presence.drawing = drawingOf("arrow", [
          [g.start.x, g.start.y],
          [end.x, end.y],
        ], style);
        break;
      }
      case "move": {
        if (!g.active) break;
        const preview = new Map<ShapeId, Partial<ShapeProps>>();
        for (const [id, o] of g.origin) preview.set(id, { x: round2(o.x + g.dx), y: round2(o.y + g.dy) });
        ix.setState({ preview });
        presence.preview = [...preview].map(([shapeId, props]) => ({ shapeId, props }));
        break;
      }
      case "resize": {
        const props = { x: round2(g.next.x), y: round2(g.next.y), w: round2(g.next.w), h: round2(g.next.h) };
        ix.setState({ preview: new Map([[g.id, props]]) });
        presence.preview = [{ shapeId: g.id, props }];
        break;
      }
      case "endpoint": {
        const props = arrowProps(g.a, g.b);
        ix.setState({ preview: new Map([[g.id, props]]) });
        presence.preview = [{ shapeId: g.id, props }];
        break;
      }
      case "marquee": {
        if (!g.active) break;
        const r = rectFrom(g.start.x, g.start.y, g.end.x, g.end.y);
        ix.setState({ marquee: r });
        const hits = marqueeHits(this.d.session.replica.getView().shapes, r);
        const next = g.additive ? [...new Set([...g.base, ...hits])] : hits;
        if (!sameIds(next, ui.selection)) ui.select(next);
        break;
      }
      case "erase":
        ix.setState({ erasing: new Set(g.hits), eraserTrail: g.trail.slice() });
        break;
      case "pan":
      case "pinch":
      case "place":
        break;
    }
  }

  /* ------------------------------------------------------------------ commit */

  private commit(g: Gesture) {
    const { session } = this.d;
    const ui = this.d.ui.getState();
    const style = ui.style;
    const view = session.replica.getView();
    const z = maxZ(view.shapes) + 1;
    const minSize = 4 / this.zoom;

    switch (g.kind) {
      case "stroke": {
        const simplified = simplifyPoints(g.points, 0.6 / this.zoom);
        const rel = relativePoints(simplified);
        session.transact(
          (tx) => {
            tx.create({
              type: "stroke",
              props: { x: rel.x, y: rel.y, w: rel.w, h: rel.h, points: rel.points, stroke: style.stroke, strokeWidth: style.strokeWidth, fill: "none", z },
            });
          },
          { label: "Draw" },
        );
        break;
      }
      case "box": {
        let r = boxRect(g.start, g.end, g.shift);
        if (r.w < minSize || r.h < minSize) r = { x: g.start.x - 80, y: g.start.y - 50, w: 160, h: 100 };
        const id = this.create(g.type, { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h), stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth, z }, `Draw ${shapeNoun(g.type)}`);
        if (id) ui.set({ tool: "select", selection: [id], editingText: null });
        break;
      }
      case "arrow": {
        let end = g.shift ? snapAngle(g.start, g.end) : g.end;
        if (Math.hypot(end.x - g.start.x, end.y - g.start.y) < minSize) end = { x: g.start.x + 120, y: g.start.y };
        const id = this.create("arrow", { ...arrowProps(g.start, end), stroke: style.stroke, strokeWidth: style.strokeWidth, fill: "none", z }, "Draw arrow");
        if (id) ui.set({ tool: "select", selection: [id], editingText: null });
        break;
      }
      case "place": {
        const id =
          g.type === "sticky"
            ? this.create(
                "sticky",
                { x: round2(g.at.x - 100), y: round2(g.at.y - 80), w: 200, h: 160, fill: hasFill(style.fill) ? style.fill : "#ffe58a", stroke: INK, fontSize: style.fontSize, z },
                "Add sticky note",
              )
            : this.create(
                "text",
                {
                  x: round2(g.at.x - 2),
                  y: round2(g.at.y - style.fontSize * 0.8),
                  w: 240,
                  h: round2(style.fontSize * 1.6),
                  stroke: style.stroke,
                  fill: "none",
                  fontSize: style.fontSize,
                  z,
                },
                "Add text",
              );
        if (id) ui.set({ tool: "select", selection: [id], editingText: id });
        break;
      }
      case "move": {
        if (g.active) {
          const moves = new Map<ShapeId, XY>();
          for (const [id, o] of g.origin) moves.set(id, { x: o.x + g.dx, y: o.y + g.dy });
          moveShapes(session, moves);
          announce(this.d.ix, `Moved ${countNoun(g.ids.map((id) => view.shapeById.get(id)).filter((s): s is ShapeView => !!s))}`);
        } else if (g.collapseTo) {
          ui.select([g.collapseTo]);
        }
        break;
      }
      case "resize": {
        const shape = view.shapeById.get(g.id);
        const r = g.next;
        if (shape && (r.x !== g.start.x || r.y !== g.start.y || r.w !== g.start.w || r.h !== g.start.h)) {
          session.transact((tx) => tx.update(g.id, { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) }), {
            label: `Resize ${shapeNoun(shape.type)}`,
          });
        }
        break;
      }
      case "endpoint": {
        const shape = view.shapeById.get(g.id);
        if (shape) {
          const props = arrowProps(g.a, g.b);
          const same = props.x === shape.x && props.y === shape.y && JSON.stringify(props.points) === JSON.stringify(shape.points);
          if (!same) session.transact((tx) => tx.update(g.id, props), { label: "Re-aim arrow" });
        }
        break;
      }
      case "marquee": {
        if (!g.active && !g.additive) ui.select([]);
        const n = this.d.ui.getState().selection.length;
        if (g.active) announce(this.d.ix, n ? `Selected ${n} shape${n === 1 ? "" : "s"}` : "Nothing selected");
        break;
      }
      case "erase": {
        const n = deleteShapes(session, [...g.hits], "Erase");
        if (n) announce(this.d.ix, `Erased ${n} shape${n === 1 ? "" : "s"}`);
        break;
      }
      case "pan":
      case "pinch":
        break;
    }
    this.clearTransient();
  }

  private create(type: ShapeType, props: Partial<ShapeProps>, label: string): ShapeId | null {
    let id: ShapeId | null = null;
    const res = this.d.session.transact(
      (tx) => {
        id = tx.create({ type, props });
      },
      { label },
    );
    if (res.ops.length === 0) return null;
    announce(this.d.ix, label);
    return id;
  }

  private clearTransient() {
    const ix = this.d.ix.getState();
    if (ix.draft || ix.preview || ix.marquee || ix.hidden.size || ix.erasing.size || ix.eraserTrail) {
      this.d.ix.setState({ draft: null, preview: null, marquee: null, hidden: EMPTY_SET, erasing: EMPTY_SET, eraserTrail: null });
    }
    this.d.session.updatePresence({ drawing: null, preview: null });
  }

  private release(pointerId: number) {
    try {
      if (this.d.svg.hasPointerCapture(pointerId)) this.d.svg.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  }

  private focusCanvas() {
    const c = this.d.container;
    if (document.activeElement !== c) c.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ cursor */

  private updateHover() {
    const ui = this.d.ui.getState();
    let next: ShapeId | null = null;
    if (this.hover && ui.tool === "select" && !ui.scrub && !this.spaceHeld) {
      const hit = topmostAt(this.d.session.replica.getView().shapes, this.hover.x, this.hover.y, HIT_TOL / this.zoom);
      next = hit?.id ?? null;
    }
    if (next !== this.hoverShape) {
      this.hoverShape = next;
      this.updateCursor();
    }
  }

  updateCursor() {
    const ui = this.d.ui.getState();
    const g = this.gesture;
    let css: string;
    if (g?.kind === "pan" || g?.kind === "pinch") css = "grabbing";
    else if (this.spaceHeld || ui.tool === "hand" || ui.scrub) css = "grab";
    else if (g?.kind === "move" && g.active) css = "grabbing";
    else {
      switch (ui.tool) {
        case "select":
          css = this.hoverShape ? "move" : "default";
          break;
        case "pen":
          css = dotCursor(this.resolveColor(ui.style.stroke), ui.style.strokeWidth * ui.camera.zoom);
          break;
        case "eraser":
          css = ringCursor(this.resolveColor("var(--knot)"));
          break;
        case "text":
          css = "text";
          break;
        default:
          css = "crosshair";
      }
    }
    if (css !== this.lastCursorCss) {
      this.lastCursorCss = css;
      this.d.svg.style.cursor = css;
    }
  }

  private resolveColor(c: string): string {
    const m = /^var\((--[\w-]+)\)$/.exec(c);
    const name = m ? m[1] : c.toLowerCase() === INK ? "--ink" : null;
    if (!name) return c;
    const v = getComputedStyle(this.d.container).getPropertyValue(name).trim();
    return v || "#1d1b16";
  }
}

/* ------------------------------------------------------------------ pure helpers */

function drawingOf(tool: ShapeType, points: Point[], style: UiStore["style"]): PresenceDrawing {
  return { tool, points, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth };
}

function boxRect(a: XY, b: XY, square: boolean): Rect {
  if (!square) return rectFrom(a.x, a.y, b.x, b.y);
  const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return rectFrom(a.x, a.y, a.x + Math.sign(b.x - a.x || 1) * d, a.y + Math.sign(b.y - a.y || 1) * d);
}

/** Arrow props with the origin at the start point. */
export function arrowProps(a: XY, b: XY): Pick<ShapeProps, "x" | "y" | "w" | "h" | "points"> {
  const x = round2(a.x),
    y = round2(a.y);
  const dx = round2(b.x - x),
    dy = round2(b.y - y);
  return {
    x,
    y,
    w: Math.abs(dx),
    h: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ],
  };
}

function snapAngle(from: XY, to: XY): XY {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}

export function resizeRect(start: Rect, handle: Handle, p: XY, keepRatio: boolean, ratio: number, min: number): Rect {
  let x0 = start.x,
    y0 = start.y,
    x1 = start.x + start.w,
    y1 = start.y + start.h;
  if (handle.includes("w")) x0 = p.x;
  if (handle.includes("e")) x1 = p.x;
  if (handle.includes("n")) y0 = p.y;
  if (handle.includes("s")) y1 = p.y;
  const corner = handle.length === 2;
  if (keepRatio && corner && ratio > 0) {
    const w = Math.abs(x1 - x0),
      h = Math.abs(y1 - y0);
    if (w / ratio > h) {
      const nh = w / ratio;
      if (handle.includes("n")) y0 = y1 - Math.sign(y1 - y0 || 1) * nh;
      else y1 = y0 + Math.sign(y1 - y0 || 1) * nh;
    } else {
      const nw = h * ratio;
      if (handle.includes("w")) x0 = x1 - Math.sign(x1 - x0 || 1) * nw;
      else x1 = x0 + Math.sign(x1 - x0 || 1) * nw;
    }
  }
  const r = rectFrom(x0, y0, x1, y1);
  return { x: r.x, y: r.y, w: Math.max(min, r.w), h: Math.max(min, r.h) };
}

/** Shapes a marquee picks up: bounds intersect, and for paths at least one vertex inside. */
export function marqueeHits(shapes: readonly ShapeView[], r: Rect): ShapeId[] {
  const out: ShapeId[] = [];
  for (const s of shapes) {
    const b = displayBounds(s);
    if (!rectsIntersect(b, r)) continue;
    if (s.type === "stroke" || s.type === "arrow") {
      const contained = b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
      const touches = contained || s.points.some((p) => {
        const x = s.x + p[0],
          y = s.y + p[1];
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
      });
      if (!touches) continue;
    }
    out.push(s.id);
  }
  return out;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function svgCursor(svg: string, hot: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot} ${hot}, ${fallback}`;
}

function dotCursor(color: string, screenWidth: number): string {
  const d = Math.max(4, Math.min(28, screenWidth * 1.3));
  const size = Math.ceil(d + 6);
  const c = size / 2;
  return svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${d / 2 + 1.5}" fill="none" stroke="white" stroke-opacity="0.9" stroke-width="1.5"/><circle cx="${c}" cy="${c}" r="${d / 2}" fill="${color}"/></svg>`,
    Math.round(c),
    "crosshair",
  );
}

function ringCursor(color: string): string {
  const size = 22,
    c = 11;
  return svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="8" fill="white" fill-opacity="0.55" stroke="${color}" stroke-width="2"/><circle cx="${c}" cy="${c}" r="1.5" fill="${color}"/></svg>`,
    c,
    "cell",
  );
}
