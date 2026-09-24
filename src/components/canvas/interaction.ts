"use client";
/**
 * Transient, per-canvas interaction state (drafts, drag previews, marquee, eraser marks).
 * Kept out of the pane UI store so that 60 Hz gesture updates only re-render the tiny
 * layers that draw them — never the shape layer.
 */
import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { ShapeId, ShapeProps, ShapeView } from "@/lib/crdt/types";
import type { Rect } from "@/lib/ui/geometry";

export interface KnotHover {
  shapeId: ShapeId;
  conflictIds: string[];
  /** World anchor (badge centre). */
  x: number;
  y: number;
  /** Pinned by keyboard focus (stays until blur). */
  pinned: boolean;
}

export interface InteractionState {
  /** Shapes the shape layer skips because the preview layer draws them. */
  hidden: ReadonlySet<ShapeId>;
  /** Live, uncommitted props for dragged / resized shapes. */
  preview: ReadonlyMap<ShapeId, Partial<ShapeProps>> | null;
  /** In-progress shape (world coordinates). */
  draft: ShapeView | null;
  marquee: Rect | null;
  /** Shapes the eraser has passed over (deleted on pointerup). */
  erasing: ReadonlySet<ShapeId>;
  eraserTrail: readonly (readonly [number, number])[] | null;
  knotHover: KnotHover | null;
  /** Latest polite announcement for screen readers. */
  announcement: { text: string; n: number } | null;
}

export const EMPTY_SET: ReadonlySet<ShapeId> = new Set();

export function createInteractionStore(): StoreApi<InteractionState> {
  return createStore<InteractionState>()(() => ({
    hidden: EMPTY_SET,
    preview: null,
    draft: null,
    marquee: null,
    erasing: EMPTY_SET,
    eraserTrail: null,
    knotHover: null,
    announcement: null,
  }));
}

export const InteractionContext = createContext<StoreApi<InteractionState> | null>(null);

export function useInteractionStore(): StoreApi<InteractionState> {
  const s = useContext(InteractionContext);
  if (!s) throw new Error("useInteraction must be used inside <Canvas>");
  return s;
}

export function useInteraction<T>(selector: (s: InteractionState) => T): T {
  return useStore(useInteractionStore(), selector);
}

export function announce(store: StoreApi<InteractionState>, text: string): void {
  const prev = store.getState().announcement;
  store.setState({ announcement: { text, n: (prev?.n ?? 0) + 1 } });
}
