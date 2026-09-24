/**
 * Imperative DOM/cache helpers kept outside components: scroll positions of elements that are
 * held in React state, and per-render lookup caches.
 */
import type { ReplicaId } from "@/lib/crdt/types";
import { threadColor, threadDash } from "@/lib/ui/colors";

export function assignScrollLeft(el: HTMLElement, left: number): void {
  el.scrollLeft = left;
}

/** Scroll horizontally (smoothly when allowed); falls back to assignment where scrollTo is missing. */
export function scrollToLeft(el: HTMLElement, left: number, smooth = false): void {
  const target = Math.max(0, left);
  if (typeof el.scrollTo === "function") el.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
  else el.scrollLeft = target;
}

export function assignScrollTop(el: HTMLElement, top: number): void {
  el.scrollTop = top;
}

/** Scroll the minimum amount so the band [top, top + h) is visible. */
export function revealRow(el: HTMLElement, top: number, h: number): void {
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight;
}

export interface ThreadInfo {
  label: string;
  color: string;
  dash: string;
  self: boolean;
}

/** Replica → thread lookup from a directory signature (`id=label;…`), memoised per replica. */
export function createThreadLookup(sig: string, self: ReplicaId, selfLabel: string): (replica: ReplicaId, fallbackLabel?: string) => ThreadInfo {
  const labels = new Map<string, string>();
  for (const part of sig.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    labels.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const make = (label: string, isSelf: boolean): ThreadInfo => ({ label, color: threadColor(label), dash: threadDash(label), self: isSelf });
  const cache = new Map<ReplicaId, ThreadInfo>();
  return (replica, fallbackLabel) => {
    const hit = cache.get(replica);
    if (hit) return hit;
    const isSelf = replica === self;
    const known = isSelf ? selfLabel : labels.get(replica);
    const t = make(known ?? fallbackLabel ?? "?", isSelf);
    if (known) cache.set(replica, t);
    return t;
  };
}
