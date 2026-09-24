"use client";
/**
 * Hover state for the Loom's op card. Lives in a tiny external store (not React state on the
 * Loom) so hovering thousands of ticks re-renders only the card — never the diagram.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { Op } from "@/lib/crdt/types";
import { useUiStore } from "@/lib/ui/store";

export interface HoverTarget {
  op: Op;
  /** Still waiting in the causal buffer (not in the log yet). */
  pending: boolean;
  /** Anchor (the tick / dot centre) in coordinates local to the Loom root. */
  x: number;
  y: number;
  rootWidth: number;
}

interface HoverStore {
  get(): HoverTarget | null;
  set(t: HoverTarget | null): void;
  subscribe(l: () => void): () => void;
}

function createHoverStore(): HoverStore {
  let value: HoverTarget | null = null;
  const ls = new Set<() => void>();
  return {
    get: () => value,
    set: (t) => {
      if (t === value || (t && value && t.op === value.op && t.x === value.x && t.y === value.y)) return;
      value = t;
      for (const l of ls) l();
    },
    subscribe: (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
}

interface LoomHoverContextValue {
  store: HoverStore;
  rootRef: RefObject<HTMLElement | null>;
}

const LoomHoverContext = createContext<LoomHoverContextValue | null>(null);

export function LoomHoverProvider({ rootRef, children }: { rootRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const store = useMemo(() => createHoverStore(), []);
  const value = useMemo(() => ({ store, rootRef }), [store, rootRef]);
  return <LoomHoverContext.Provider value={value}>{children}</LoomHoverContext.Provider>;
}

const NULL_STORE: HoverStore = { get: () => null, set: () => {}, subscribe: () => () => {} };

export function useHoverTarget(): HoverTarget | null {
  const ctx = useContext(LoomHoverContext);
  const store = ctx?.store ?? NULL_STORE;
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export interface OpHoverApi {
  /** Show the card for `op`, anchored at a client (viewport) point. Also sets ui.hoverOp. */
  show: (op: Op, clientX: number, clientY: number, pending?: boolean) => void;
  /** Hide the card and clear ui.hoverOp (only if it still points at something we set). */
  clear: () => void;
}

/** Hover helpers for anything inside the Loom (outside it the card is simply not shown). */
export function useOpHover(): OpHoverApi {
  const ctx = useContext(LoomHoverContext);
  const ui = useUiStore();
  const show = useCallback(
    (op: Op, clientX: number, clientY: number, pending = false) => {
      const root = ctx?.rootRef.current;
      if (ctx && root) {
        const r = root.getBoundingClientRect();
        ctx.store.set({ op, pending, x: clientX - r.left, y: clientY - r.top, rootWidth: r.width });
      }
      const s = ui.getState();
      const next = pending ? null : op.id;
      if (s.hoverOp !== next) s.set({ hoverOp: next });
    },
    [ctx, ui],
  );
  const clear = useCallback(() => {
    const cur = ctx?.store.get();
    ctx?.store.set(null);
    const s = ui.getState();
    if (s.hoverOp && (!cur || cur.op.id === s.hoverOp)) s.set({ hoverOp: null });
  }, [ctx, ui]);
  return useMemo(() => ({ show, clear }), [show, clear]);
}
