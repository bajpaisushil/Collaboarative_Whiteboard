"use client";
/**
 * Theme choice (system / light / dark), document-wide: `<html data-theme>` + localStorage
 * "weave:theme". Kept in sync across tabs through the `storage` event.
 */
import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "./themeScript";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];

const listeners = new Set<() => void>();
let current: ThemeChoice | null = null;

function readStored(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage blocked: fall back to system */
  }
  return "system";
}

function applyToDocument(theme: ThemeChoice): void {
  const el = document.documentElement;
  if (theme === "system") delete el.dataset.theme;
  else el.dataset.theme = theme;
}

function notify(): void {
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
  current = readStored();
  applyToDocument(current);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getTheme(): ThemeChoice {
  if (current === null) current = typeof window === "undefined" ? "system" : readStored();
  return current;
}

export function setTheme(theme: ThemeChoice): void {
  current = theme;
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* not persisted; still applied for this document */
  }
  applyToDocument(theme);
  notify();
}

/** Re-apply the stored choice (for routes that didn't run the boot script). */
export function applyStoredTheme(): void {
  applyToDocument(getTheme());
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, getTheme, () => "system");
}
