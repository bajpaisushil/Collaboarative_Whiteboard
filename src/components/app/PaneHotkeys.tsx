"use client";
/**
 * Pane-level shortcuts, bound to the pane root (never window) so /split's panes don't both
 * react. Rendered as the pane's first child so it registers before the canvas/panels: it
 * only claims Escape when it actually has something to close.
 */
import { useSession } from "@/lib/session/react";
import { isTypingTarget, usePaneKeydown } from "@/lib/ui/pane";
import { useUiStore } from "@/lib/ui/store";
import { useToast } from "@/components/ui/Toast";

export function PaneHotkeys() {
  const session = useSession();
  const store = useUiStore();
  const toast = useToast();

  usePaneKeydown((e) => {
    const ui = store.getState();
    const mod = e.metaKey || e.ctrlKey;
    const typing = isTypingTarget(e.target);
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    const history = (redo: boolean) => {
      if (ui.scrub) {
        toast.push({
          id: "time-travel-readonly",
          title: "Time travel is read-only",
          detail: "Press Esc to return to now, then undo.",
          tone: "warn",
          durationMs: 3000,
        });
        return;
      }
      if (redo) session.redo();
      else session.undo();
    };

    // Cable switch: works even while typing (it's a modifier chord, never text).
    if (mod && e.shiftKey && !e.altKey && key === "o") {
      session.setOnline(!session.getState().network.online);
      return true;
    }
    if (mod && !e.altKey && key === "z") {
      if (typing) return false;
      history(e.shiftKey);
      return true;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === "y") {
      if (typing) return false;
      history(true);
      return true;
    }

    if (typing || mod || e.altKey) return false;

    if (ui.showShortcuts) {
      if (key === "Escape" || key === "?") {
        ui.set({ showShortcuts: false });
        return true;
      }
      // Swallow tool keys while the sheet is open (Tab/arrows still move focus).
      return e.key.length === 1;
    }

    switch (key) {
      case "\\":
        session.setOnline(!session.getState().network.online);
        return true;
      case "x":
        ui.set({ mode: ui.mode === "xray" ? "draw" : "xray" });
        return true;
      case "?":
        ui.set({ showShortcuts: true });
        return true;
      case "Escape":
        if (ui.scrub) {
          ui.set({ scrub: null });
          return true;
        }
        if (ui.focus || ui.ghost || ui.provenance) {
          ui.focusConflict(null);
          ui.set({ provenance: null });
          return true;
        }
        return false;
      default:
        return false;
    }
  });

  return null;
}
