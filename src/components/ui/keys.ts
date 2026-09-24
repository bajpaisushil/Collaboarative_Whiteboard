"use client";
/**
 * Platform-aware keyboard shortcut labels. Shortcuts are written as token lists, e.g.
 * `["mod", "shift", "z"]`, and rendered as "⌘⇧Z" on Apple platforms and "Ctrl+Shift+Z"
 * elsewhere.
 */
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** True on macOS / iOS. Always false during SSR (hydrates to the real value). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, detectMac, () => false);
}

const MAC_LABELS: Record<string, string> = {
  mod: "⌘",
  meta: "⌘",
  cmd: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  ctrl: "⌃",
  enter: "↵",
  escape: "Esc",
  esc: "Esc",
  backspace: "⌫",
  delete: "⌦",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  space: "Space",
};

const PC_LABELS: Record<string, string> = {
  mod: "Ctrl",
  meta: "Win",
  cmd: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  ctrl: "Ctrl",
  enter: "Enter",
  escape: "Esc",
  esc: "Esc",
  backspace: "Backspace",
  delete: "Del",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  space: "Space",
};

/** Display label for one key token. Single characters are upper-cased. */
export function keyLabel(token: string, isMac: boolean): string {
  const mapped = (isMac ? MAC_LABELS : PC_LABELS)[token.toLowerCase()];
  if (mapped) return mapped;
  return token.length === 1 ? token.toUpperCase() : token;
}

/** "⌘⇧Z" (mac) or "Ctrl+Shift+Z" (others). */
export function formatShortcut(tokens: readonly string[], isMac: boolean): string {
  const labels = tokens.map((t) => keyLabel(t, isMac));
  return isMac ? labels.join("") : labels.join("+");
}

/** Several alternative combos: "\\ or ⌘⇧O". */
export function formatShortcuts(combos: readonly (readonly string[])[], isMac: boolean): string {
  return combos.map((c) => formatShortcut(c, isMac)).join(" or ");
}
