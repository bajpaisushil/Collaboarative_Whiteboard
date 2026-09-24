"use client";
/**
 * Per-pane UI state (tool, selection, camera, focus, time travel…).
 * One store per board pane — /split renders two panes, each with its own store — so this is
 * provided through React context, never a module-level singleton.
 */
import { createContext, createElement, useContext, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { OpId, ShapeId, VectorClock } from "../crdt/types";

export type Tool = "select" | "hand" | "pen" | "rect" | "ellipse" | "arrow" | "sticky" | "text" | "eraser";

/** draw = clean whiteboard; xray = internals revealed (authorship tints, knots, clocks, loom). */
export type ViewMode = "draw" | "xray";

export type LensTab = "why" | "loom" | "log" | "snapshots";

export interface Camera {
  /** World coordinate at the viewport's top-left. */
  x: number;
  y: number;
  zoom: number;
}

export interface StyleState {
  stroke: string;
  fill: string;
  strokeWidth: number;
  fontSize: number;
}

export interface ConflictFocus {
  id: string;
  /** Survives id changes under partial delivery; UI re-resolves by lineageKey when id vanishes. */
  lineageKey: string;
}

export interface UiState {
  tool: Tool;
  style: StyleState;
  selection: ShapeId[];
  camera: Camera;
  mode: ViewMode;
  /** Right-hand "Why" panel open + which lens tab. */
  panelOpen: boolean;
  lensTab: LensTab;
  focus: ConflictFocus | null;
  /** Draw a what-if ghost on the canvas: a conflict side or a counterfactual id. */
  ghost: { conflictId: string; opId?: OpId; counterfactual?: string } | null;
  /** Shape whose provenance card is open ("why does this look like this?"). */
  provenance: ShapeId | null;
  /**
   * Time travel. `atOpId`: canonical prefix ending at that op (null = empty board).
   * `cut`: a causal cut (snapshot preview / "as B saw it"). null = live.
   */
  scrub: { atOpId?: OpId | null; cut?: VectorClock; label?: string } | null;
  /** Shapes to pulse after a merge (reconnect choreography). */
  flash: { shapeIds: ShapeId[]; revived: ShapeId[]; at: number } | null;
  editingText: ShapeId | null;
  /** Hovered op in the loom/log — canvas highlights its shape. */
  hoverOp: OpId | null;
  showShortcuts: boolean;
}

export interface UiActions {
  set: (patch: Partial<UiState>) => void;
  setTool: (tool: Tool) => void;
  setStyle: (patch: Partial<StyleState>) => void;
  select: (ids: ShapeId[]) => void;
  focusConflict: (focus: ConflictFocus | null) => void;
  setCamera: (camera: Camera) => void;
}

export type UiStore = UiState & UiActions;

export const DEFAULT_UI: UiState = {
  tool: "select",
  style: { stroke: "#1d1b16", fill: "#ffe58a", strokeWidth: 4, fontSize: 20 },
  selection: [],
  camera: { x: 0, y: 0, zoom: 1 },
  mode: "draw",
  panelOpen: false,
  lensTab: "why",
  focus: null,
  ghost: null,
  provenance: null,
  scrub: null,
  editingText: null,
  hoverOp: null,
  showShortcuts: false,
  flash: null,
};

export function createUiStore(initial?: Partial<UiState>): StoreApi<UiStore> {
  return createStore<UiStore>()((set) => ({
    ...DEFAULT_UI,
    ...initial,
    set: (patch) => set(patch),
    setTool: (tool) => set({ tool, editingText: null }),
    setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
    select: (ids) => set({ selection: ids }),
    focusConflict: (focus) =>
      set(focus ? { focus, panelOpen: true, lensTab: "why" } : { focus: null, ghost: null }),
    setCamera: (camera) => set({ camera }),
  }));
}

const UiStoreContext = createContext<StoreApi<UiStore> | null>(null);

/** Pass `store` to share a store created outside (e.g. /split syncing focus across panes). */
export function UiStoreProvider({ children, initial, store: external }: { children: ReactNode; initial?: Partial<UiState>; store?: StoreApi<UiStore> }) {
  const [own] = useState(() => external ?? createUiStore(initial));
  return createElement(UiStoreContext.Provider, { value: external ?? own }, children);
}

export function useUiStore(): StoreApi<UiStore> {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error("useUiStore must be used inside <UiStoreProvider>");
  return store;
}

/** Subscribe to a slice of pane UI state. Keep selectors narrow (or use `useShallow`). */
export function useUi<T>(selector: (s: UiStore) => T): T {
  return useStore(useUiStore(), selector);
}
