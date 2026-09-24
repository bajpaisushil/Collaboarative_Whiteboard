"use client";
/**
 * The board canvas for one pane: an infinite, pan/zoom SVG with a dot grid.
 *
 * Render budget: this root subscribes only to "is time-travelling?"; the camera is read by
 * <Viewport> (grid + one world transform) and by the small zoom-scaled chrome layers; the
 * shape layer depends on `view.shapes` only. Gestures live in CanvasController (refs, not
 * state) and commit exactly one session transaction each.
 */
import { memo, useEffect, useId, useRef, useState } from "react";
import { useSession } from "@/lib/session/react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { CanvasController } from "./controller";
import { useDockSlotRef } from "./dockSlot";
import { createInteractionStore, InteractionContext } from "./interaction";
import { KnotTooltip } from "./KnotTooltip";
import { EmptyHint, LiveRegion, TimeTravelTint } from "./overlays";
import { displayBounds } from "./shapeUtils";
import { TextEditor } from "./TextEditor";
import { useCanvasShortcuts } from "./useCanvasShortcuts";
import { Viewport } from "./Viewport";
import { FlashLayer } from "./layers/FlashLayer";
import { FocusHalo, GhostLayer } from "./layers/GhostLayer";
import { HoverLayer } from "./layers/HoverLayer";
import { KnotLayer } from "./layers/KnotLayer";
import { PresenceLayer } from "./layers/PresenceLayer";
import { SelectionLayer } from "./layers/SelectionLayer";
import { DraftLayer, EraserLayer, PreviewLayer, ScrubShapeLayer, ShapeLayer } from "./layers/ShapeLayer";
import { XrayLayer } from "./layers/XrayLayer";

export function Canvas() {
  const session = useSession();
  const ui = useUiStore();
  const [ix] = useState(createInteractionStore);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);
  const gridId = `weave-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const scrubbing = useUi((s) => s.scrub !== null);
  const dockSlotRef = useDockSlotRef();

  // Gesture controller (native listeners: non-passive wheel, coalesced pointer events).
  useEffect(() => {
    const svg = svgRef.current,
      container = containerRef.current;
    if (!svg || !container) return;
    const c = new CanvasController({ session, ui, ix, svg, container });
    controllerRef.current = c;
    const detach = c.attach();
    return () => {
      detach();
      controllerRef.current = null;
    };
  }, [session, ui, ix]);

  // Mirror selection / editing into presence; keep UI state consistent with the doc.
  useEffect(() => {
    const s0 = ui.getState();
    session.updatePresence({ selection: s0.selection, editingText: s0.editingText });
    const unsubUi = ui.subscribe((s, p) => {
      if (s.selection !== p.selection) session.updatePresence({ selection: s.selection });
      if (s.editingText !== p.editingText) session.updatePresence({ editingText: s.editingText });
      if (s.tool !== p.tool && s.tool !== "select" && s.tool !== "hand" && s.selection.length) s.select([]);
      if (s.scrub && !p.scrub && s.editingText) s.set({ editingText: null });
      // Bring a newly focused conflict's shape into view.
      if (s.focus && s.focus.id !== p.focus?.id) {
        const c = session.replica.getView().conflicts.find((x) => x.id === s.focus!.id || x.lineageKey === s.focus!.lineageKey);
        const shape = c ? session.replica.getShape(c.shapeId, { includeDead: true }) : null;
        if (shape) controllerRef.current?.reveal(displayBounds(shape));
      }
    });
    const unsubView = session.replica.subscribe(() => {
      const s = ui.getState();
      if (s.selection.length === 0) return;
      const byId = session.replica.getView().shapeById;
      if (s.selection.some((id) => !byId.has(id))) s.select(s.selection.filter((id) => byId.has(id)));
    });
    return () => {
      unsubUi();
      unsubView();
      session.updatePresence({ selection: [], editingText: null });
    };
  }, [session, ui]);

  useCanvasShortcuts(controllerRef, ix);

  return (
    <InteractionContext.Provider value={ix}>
      <div className="absolute inset-0 overflow-hidden bg-paper">
        <div
          ref={containerRef}
          data-canvas-root=""
          tabIndex={0}
          role="application"
          aria-roledescription="whiteboard"
          aria-label="Whiteboard canvas. Tools: V select, H pan, P pen, R rectangle, O ellipse, A arrow, S sticky note, T text, E eraser. Arrow keys nudge the selection, Delete removes it, W explains it."
          className="absolute inset-0 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]"
        >
          <svg
            ref={svgRef}
            className="absolute inset-0 block h-full w-full touch-none select-none"
            style={scrubbing ? { filter: "sepia(0.22) saturate(0.85)" } : undefined}
            role="group"
            aria-label={scrubbing ? "Board as it was (read-only)" : "Board"}
          >
            <Viewport gridId={gridId}>
              {scrubbing ? <ScrubLayers /> : <LiveLayers />}
              <PresenceLayer cursorsOnly={scrubbing} />
            </Viewport>
          </svg>
          <TextEditor />
          <KnotTooltip />
          {scrubbing && <TimeTravelTint />}
          <EmptyHint />
          <LiveRegion />
        </div>
        {/* Compact panes / narrow screens: <ToolDock> portals here (bottom-centre). */}
        <div ref={dockSlotRef} data-canvas-dock-slot="" className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3" />
      </div>
    </InteractionContext.Provider>
  );
}

const LiveLayers = memo(function LiveLayers() {
  const xray = useUi((s) => s.mode === "xray");
  return (
    <>
      <FocusHalo />
      <ShapeLayer />
      {xray && <XrayLayer />}
      <PreviewLayer />
      <DraftLayer />
      <EraserLayer />
      <FlashLayer />
      <HoverLayer />
      <GhostLayer />
      <KnotLayer />
      <SelectionLayer />
    </>
  );
});

const ScrubLayers = memo(function ScrubLayers() {
  return <ScrubShapeLayer />;
});
