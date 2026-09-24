"use client";
/**
 * Canvas keyboard shortcuts, bound to the PANE root (never window) so the two /split
 * panes never both react. Ignored while typing.
 */
import { useEffect, type RefObject } from "react";
import { useSession } from "@/lib/session/react";
import { isTypingTarget, usePane, usePaneKeydown } from "@/lib/ui/pane";
import { useUiStore } from "@/lib/ui/store";
import type { CanvasController } from "./controller";
import { deleteShapes, duplicateShapes, nudgeShapes, reorderShapes, selectedShapes } from "./commands";
import { announce, useInteractionStore } from "./interaction";
import { TOOL_BY_KEY } from "./tools";

/** Widgets that use arrows / Delete themselves (sliders, tabs, radio groups, lists…). */
const OWN_KEYS = '[role="slider"],[role="tab"],[role="tablist"],[role="listbox"],[role="option"],[role="menu"],[role="menuitem"],[role="grid"],[role="radiogroup"],[role="radio"],[role="tree"],[role="spinbutton"],[data-own-keys]';

function ownsKeys(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest(OWN_KEYS) !== null;
}

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function useCanvasShortcuts(controllerRef: RefObject<CanvasController | null>): void {
  const session = useSession();
  const ui = useUiStore();
  const ix = useInteractionStore();
  const { rootRef } = usePane();

  usePaneKeydown((e) => {
    if (isTypingTarget(e.target)) return false;
    const c = controllerRef.current;
    const s = ui.getState();
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const readOnly = s.scrub !== null;

    if (key === " " && !mod) {
      // Hold Space to pan — unless a button/widget has focus (Space activates it).
      if (e.target instanceof HTMLButtonElement || ownsKeys(e.target)) return false;
      c?.setSpace(true);
      return true;
    }

    if (key === "Escape") {
      if (c?.cancel()) return true;
      if (s.selection.length && !ownsKeys(e.target)) {
        s.select([]);
        return true;
      }
      return false;
    }

    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (k === "a" && !e.shiftKey) {
        if (readOnly || ownsKeys(e.target)) return false;
        const all = session.replica.getView().shapes.map((x) => x.id);
        s.set({ tool: "select", selection: all });
        announce(ix, `Selected all ${all.length} shape${all.length === 1 ? "" : "s"}`);
        return true;
      }
      if (k === "d" && !e.shiftKey) {
        if (readOnly || s.selection.length === 0) return false;
        const ids = duplicateShapes(session, s.selection);
        if (ids.length) {
          s.select(ids);
          announce(ix, `Duplicated ${ids.length} shape${ids.length === 1 ? "" : "s"}`);
        }
        return true;
      }
      return false;
    }
    if (e.altKey) return false;

    // View
    if (e.shiftKey && e.code === "Digit1") {
      c?.zoomToFit();
      return true;
    }
    if (e.shiftKey && e.code === "Digit0") {
      c?.resetZoom();
      return true;
    }
    if (!e.shiftKey && (key === "=" || key === "+")) {
      c?.zoomBy(1.25);
      return true;
    }
    if (!e.shiftKey && key === "-") {
      c?.zoomBy(0.8);
      return true;
    }

    // Tools
    const meta = !e.shiftKey && key.length === 1 ? TOOL_BY_KEY.get(key.toLowerCase()) : undefined;
    if (meta) {
      if (readOnly && !meta.readOnlyOk) return false;
      s.setTool(meta.tool);
      announce(ix, `${meta.label} tool`);
      return true;
    }

    if (readOnly || ownsKeys(e.target)) return false;
    const sel = s.selection;

    if ((key === "Delete" || key === "Backspace") && sel.length) {
      const n = deleteShapes(session, sel);
      s.select([]);
      if (n) announce(ix, `Deleted ${n} shape${n === 1 ? "" : "s"}`);
      return true;
    }
    const nudge = NUDGE[key];
    if (nudge && sel.length) {
      const step = e.shiftKey ? 10 : 1;
      nudgeShapes(session, sel, nudge[0] * step, nudge[1] * step);
      return true;
    }
    if (key === "]" && sel.length) {
      reorderShapes(session, sel, "front");
      return true;
    }
    if (key === "[" && sel.length) {
      reorderShapes(session, sel, "back");
      return true;
    }
    if ((key === "w" || key === "W") && !e.shiftKey && sel.length) {
      s.set({ provenance: sel[sel.length - 1], panelOpen: true });
      return true;
    }
    if (key === "Enter" && sel.length === 1) {
      const [shape] = selectedShapes(session, sel);
      if (shape && (shape.type === "sticky" || shape.type === "text")) {
        s.set({ tool: "select", editingText: shape.id });
        return true;
      }
    }
    return false;
  });

  // Space release (keyup) — also on the pane root.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") controllerRef.current?.setSpace(false);
    };
    el.addEventListener("keyup", onUp);
    return () => el.removeEventListener("keyup", onUp);
  }, [rootRef, controllerRef]);
}
