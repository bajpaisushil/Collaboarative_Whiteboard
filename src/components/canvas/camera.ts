/**
 * Camera math. `camera.{x,y}` is the world point at the viewport's top-left; world → screen
 * is `(w - camera) * zoom`.
 */
import type { Camera } from "@/lib/ui/store";
import type { Rect } from "@/lib/ui/geometry";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

/** Zoom to `zoom` keeping the world point under screen point (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, zoom: number): Camera {
  const z = clampZoom(zoom);
  const w = screenToWorld(cam, sx, sy);
  return { x: w.x - sx / z, y: w.y - sy / z, zoom: z };
}

/** Normalise a wheel delta to pixels. */
export function wheelPixels(e: WheelEvent, pageHeight: number): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/** Camera that fits `r` into a viewport of `vw × vh` with screen padding. */
export function fitCamera(r: Rect, vw: number, vh: number, padding = 64, maxZoom = 1.5): Camera {
  const w = Math.max(1, r.w),
    h = Math.max(1, r.h);
  const zoom = clampZoom(Math.min(maxZoom, (vw - padding * 2) / w, (vh - padding * 2) / h));
  return { x: r.x + w / 2 - vw / zoom / 2, y: r.y + h / 2 - vh / zoom / 2, zoom };
}

/** Grid step (world units) keeping dot spacing between 12 and 48 screen px. */
export function gridStep(zoom: number): number {
  let step = 24;
  while (step * zoom < 12) step *= 2;
  while (step * zoom > 48) step /= 2;
  return step;
}

export function cameraTransform(cam: Camera): string {
  return `matrix(${cam.zoom} 0 0 ${cam.zoom} ${-cam.x * cam.zoom} ${-cam.y * cam.zoom})`;
}
