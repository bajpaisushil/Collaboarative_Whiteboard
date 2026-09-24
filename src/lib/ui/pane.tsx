"use client";
/**
 * A "pane" is one board surface (a normal tab has one; /split has two). Keyboard shortcuts
 * are bound to the pane root element (focus-within), never to window, so split panes don't
 * both react to one keypress.
 */
import { createContext, useContext, useEffect, useEffectEvent, type ReactNode, type RefObject } from "react";

export interface PaneContextValue {
  paneId: string;
  /** Compact chrome for /split (floating dock, no side panel). */
  compact: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
}

const PaneContext = createContext<PaneContextValue | null>(null);

export function PaneProvider({ value, children }: { value: PaneContextValue; children: ReactNode }) {
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

export function usePane(): PaneContextValue {
  const v = useContext(PaneContext);
  if (!v) throw new Error("usePane must be used inside <PaneProvider>");
  return v;
}

/** True when the event target is a text input (hotkeys should usually be ignored). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

/**
 * Register a keydown handler on the pane root. Return true from the handler to mark the
 * event handled (preventDefault + stopPropagation). Handlers run in registration order.
 */
export function usePaneKeydown(handler: (e: KeyboardEvent) => boolean | void): void {
  const { rootRef } = usePane();
  const onKey = useEffectEvent(handler);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const listener = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (onKey(e) === true) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("keydown", listener);
    return () => el.removeEventListener("keydown", listener);
  }, [rootRef]);
}
