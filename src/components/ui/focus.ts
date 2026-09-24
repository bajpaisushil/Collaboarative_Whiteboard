"use client";
/**
 * Focus hand-off for transient UI (toasts, cards) that removes itself while focused.
 * Without it focus falls to <body>, and pane hotkeys — bound to the pane root — go dead
 * until the next click. Mark the element that should receive focus with `data-focus-home`.
 */

export const FOCUS_HOME_ATTR = "data-focus-home";

/** If focus is inside `el` (about to disappear), move it to the nearest focus home. */
export function handOffFocus(el: Element | null | undefined): void {
  if (!el || typeof document === "undefined") return;
  const active = document.activeElement;
  if (!active || !el.contains(active)) return;
  const home = el.parentElement?.closest<HTMLElement>(`[${FOCUS_HOME_ATTR}]`);
  home?.focus({ preventScroll: true });
}
