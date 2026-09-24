/**
 * Replica thread colours. A replica's colour derives from its label letter (A → vermilion,
 * B → teal, …). Always render the letter next to the colour; never rely on colour alone.
 */

export const THREAD_VARS = [
  "var(--thread-a)",
  "var(--thread-b)",
  "var(--thread-c)",
  "var(--thread-d)",
  "var(--thread-e)",
  "var(--thread-f)",
] as const;

/** Literal fallbacks (light theme) for places CSS variables can't reach (e.g. exported SVG). */
export const THREAD_HEX = ["#e4572e", "#1b998b", "#d99100", "#4f5ddb", "#c2185b", "#5b8c3a"] as const;

/** SVG dash pattern per thread so identity survives colour blindness / greyscale. */
export const THREAD_DASH = ["", "6 3", "2 3", "10 3 2 3", "1 2", "8 2"] as const;

export function colorIndexForLabel(label: string): number {
  const ch = (label || "A").toUpperCase().charCodeAt(0);
  const idx = ch >= 65 && ch <= 90 ? ch - 65 : 0;
  return idx % THREAD_VARS.length;
}

export function threadColor(label: string): string {
  return THREAD_VARS[colorIndexForLabel(label)];
}

export function threadHex(label: string): string {
  return THREAD_HEX[colorIndexForLabel(label)];
}

export function threadDash(label: string): string {
  return THREAD_DASH[colorIndexForLabel(label)];
}

/** Swatches offered by the style panel (work on both paper and navy). */
export const INK_SWATCHES = [
  "#1d1b16",
  "#e4572e",
  "#d99100",
  "#1b998b",
  "#4f5ddb",
  "#c2185b",
  "#5b8c3a",
  "#8a8475",
] as const;

export const STICKY_SWATCHES = ["#ffe58a", "#ffc2a8", "#b8ecd9", "#bcd4ff", "#f3c1e3", "#e6e0d2"] as const;

export const STROKE_WIDTHS = [2, 4, 8] as const;
