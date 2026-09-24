"use client";
/**
 * Pane-level time-travel keys, active only while scrubbing: ← / → step one edit (Shift: 10),
 * Esc returns to live. Bound to the pane root (never window) so /split panes stay independent.
 */
import { isTypingTarget, usePaneKeydown } from "@/lib/ui/pane";
import { useUiStore } from "@/lib/ui/store";
import type { LoomModel } from "./model";
import { stepScrub } from "./scrub";

/** Widgets that use arrow keys themselves (outside the Loom) keep them. */
const OWNS_ARROWS =
  '[role="slider"],[role="tab"],[role="tablist"],[role="listbox"],[role="option"],[role="menu"],[role="menuitem"],[role="grid"],[role="radiogroup"],[role="radio"],[role="tree"],[role="spinbutton"],[data-own-keys]';

export function useScrubKeys(model: LoomModel): void {
  const store = useUiStore();
  usePaneKeydown((e) => {
    const s = store.getState();
    if (!s.scrub || isTypingTarget(e.target)) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key === "Escape") {
      s.set({ scrub: null });
      return true;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    const t = e.target instanceof Element ? e.target : null;
    if (t && !t.closest("[data-loom]") && t.closest(OWNS_ARROWS)) return false;
    const delta = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1);
    s.set({ scrub: stepScrub(s.scrub, delta, model.log, model.indexOf) });
    return true;
  });
}
