"use client";
/**
 * Pane-level shortcuts, bound to the pane root (never window) so /split's panes don't both
 * react. Rendered as the pane's first child so it registers before the canvas/panels: it
 * only claims Escape when it actually has something to close. While a modal sheet (shortcuts,
 * "Connect another computer") is open, board shortcuts stay behind it.
 */
import { useSession } from "@/lib/session/react";
import { isTypingTarget, usePaneKeydown } from "@/lib/ui/pane";
import { useUiStore } from "@/lib/ui/store";
import { useToast } from "@/components/ui/Toast";
import { usePairingStore } from "./pairing/PairingProvider";

export function PaneHotkeys() {
  const session = useSession();
  const store = useUiStore();
  const toast = useToast();
  const pairing = usePairingStore();

  usePaneKeydown((e) => {
    const ui = store.getState();
    const pairingOpen = pairing?.getState().open ?? false;
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
      const result = redo ? session.redo() : session.undo();
      if (!result) {
        toast.push({
          id: "undo",
          title: redo ? "Nothing to redo" : "Nothing of yours to undo",
          detail: redo ? undefined : "Undo only reverses this tab’s own edits — other tabs undo theirs.",
          durationMs: 2600,
        });
      }
    };

    // Cable switch: works even while typing (it's a modifier chord, never text).
    if (mod && e.shiftKey && !e.altKey && key === "o") {
      session.setOnline(!session.getState().network.online);
      return true;
    }
    if (mod && !e.altKey && key === "z") {
      if (typing || pairingOpen) return false;
      history(e.shiftKey);
      return true;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === "y") {
      if (typing || pairingOpen) return false;
      history(true);
      return true;
    }

    if (typing || mod || e.altKey) return false;

    if (pairingOpen) {
      // The dialog handles Escape itself while focus is inside it; this covers the rest.
      if (key === "Escape") {
        pairing?.getState().closeDialog();
        return true;
      }
      // Swallow tool keys (Space still presses buttons; arrows/Delete are left alone via
      // the dialog's data-own-keys).
      return e.key.length === 1 && e.key !== " ";
    }

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
