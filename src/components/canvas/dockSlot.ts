"use client";
/**
 * Where the horizontal tool dock mounts. In compact panes (/split) and on narrow screens the
 * dock sits bottom-centre *over the canvas*, so <Canvas> exposes a slot element and
 * <ToolDock> portals into it. The two are siblings, so the slot is looked up per pane
 * (keyed by the pane's root ref object — never a module-wide singleton, /split has two panes).
 */
import { useCallback, useSyncExternalStore } from "react";
import { usePane } from "@/lib/ui/pane";

interface SlotEntry {
  el: HTMLElement | null;
  listeners: Set<() => void>;
}

const slots = new WeakMap<object, SlotEntry>();

function entryFor(key: object): SlotEntry {
  let e = slots.get(key);
  if (!e) {
    e = { el: null, listeners: new Set() };
    slots.set(key, e);
  }
  return e;
}

/** Ref callback for the slot element rendered by <Canvas>. */
export function useDockSlotRef(): (el: HTMLElement | null) => void {
  const { rootRef } = usePane();
  return useCallback(
    (el: HTMLElement | null) => {
      const e = entryFor(rootRef);
      if (e.el === el) return;
      e.el = el;
      for (const l of [...e.listeners]) l();
    },
    [rootRef],
  );
}

/** The slot element of this pane's canvas (null until the canvas has mounted). */
export function useDockSlot(): HTMLElement | null {
  const { rootRef } = usePane();
  const subscribe = useCallback(
    (listener: () => void) => {
      const e = entryFor(rootRef);
      e.listeners.add(listener);
      return () => {
        e.listeners.delete(listener);
      };
    },
    [rootRef],
  );
  const get = useCallback(() => slots.get(rootRef)?.el ?? null, [rootRef]);
  return useSyncExternalStore(subscribe, get, () => null);
}
