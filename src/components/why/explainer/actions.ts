"use client";
/**
 * Explainer side effects: canvas ghosts, "show on canvas", and shareable links.
 */
import { useCallback, useRef } from "react";
import type { StoreApi } from "zustand";
import type { OpId, ShapeView } from "@/lib/crdt/types";
import { shapeBounds } from "@/lib/ui/geometry";
import type { UiState, UiStore } from "@/lib/ui/store";
import { useUi, useUiStore } from "@/lib/ui/store";

type Ghost = UiState["ghost"];

/**
 * Hovering (or focusing) a side previews it as a ghost on the canvas; leaving restores
 * whatever ghost was there before (e.g. a pinned "What if…" counterfactual).
 */
export function useSideGhost(conflictId: string) {
  const ui = useUiStore();
  const saved = useRef<{ ghost: Ghost } | null>(null);
  const enter = useCallback(
    (opId: OpId) => {
      const s = ui.getState();
      if (!saved.current) saved.current = { ghost: s.ghost };
      if (s.ghost?.conflictId === conflictId && s.ghost.opId === opId) return;
      s.set({ ghost: { conflictId, opId } });
    },
    [ui, conflictId],
  );
  const leave = useCallback(() => {
    const s = ui.getState();
    const prev = saved.current?.ghost ?? null;
    saved.current = null;
    if (s.ghost?.conflictId === conflictId && s.ghost.opId) {
      s.set({ ghost: prev && prev.conflictId === conflictId && !prev.opId ? prev : null });
    }
  }, [ui, conflictId]);
  return { enter, leave };
}

/** The counterfactual currently pinned on the canvas for this conflict (or null). */
export function usePinnedCounterfactual(conflictId: string): string | null {
  return useUi((s) => (s.ghost && s.ghost.conflictId === conflictId && !s.ghost.opId ? (s.ghost.counterfactual ?? null) : null));
}

export function toggleCounterfactual(ui: StoreApi<UiStore>, conflictId: string, cfId: string): boolean {
  const s = ui.getState();
  const on = s.ghost?.conflictId === conflictId && s.ghost.counterfactual === cfId && !s.ghost.opId;
  s.set({ ghost: on ? null : { conflictId, counterfactual: cfId } });
  return !on;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Select the shape and centre it in the part of the canvas not covered by the Why sheet
 * (zooming out only if it wouldn't fit). Returns false when this pane has no canvas.
 */
export function revealShape(ui: StoreApi<UiStore>, paneRoot: HTMLElement | null, from: HTMLElement | null, shape: ShapeView): boolean {
  const s = ui.getState();
  if (shape.alive) s.select([shape.id]);
  const canvas = paneRoot?.querySelector<HTMLElement>("[data-canvas-root]");
  if (!canvas) return false;
  const cr = canvas.getBoundingClientRect();
  if (cr.width < 40 || cr.height < 40) return false;

  // Visible region: left of the Why sheet (if it covers the right part of the canvas), below the top chrome.
  let visW = cr.width;
  const sheet = from?.closest("aside");
  if (sheet) {
    const sr = sheet.getBoundingClientRect();
    if (sr.left > cr.left + cr.width * 0.35 && sr.left < cr.right) visW = sr.left - cr.left;
  }
  const chromeTop = paneRoot ? parseFloat(getComputedStyle(paneRoot).getPropertyValue("--chrome-top")) || 0 : 0;
  const top = clamp(chromeTop, 0, cr.height / 3);
  const visH = cr.height - top;

  const b = shapeBounds(shape);
  const pad = 72;
  const fit = Math.min((visW - pad * 2) / Math.max(1, b.w), (visH - pad * 2) / Math.max(1, b.h));
  let zoom = s.camera.zoom;
  if (fit < zoom) zoom = clamp(fit, 0.1, 8);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  s.setCamera({ x: cx - visW / 2 / zoom, y: cy - (top + visH / 2) / zoom, zoom });
  return true;
}

/** Link that reopens this explanation in the same room (`?explain=<id>`). */
export function explainLink(conflictId: string, room: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("fresh");
  if (!url.searchParams.has("room") && room) url.searchParams.set("room", room);
  url.searchParams.set("explain", conflictId);
  url.hash = "";
  return url.toString();
}

/** Clipboard write with a textarea fallback for insecure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
