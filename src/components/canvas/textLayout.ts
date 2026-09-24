/**
 * Text metrics for `text` / `sticky` shapes. The SVG renderer, the hit-tester, the selection
 * chrome and the textarea overlay must all agree on line height and padding, so they live here.
 *
 * A `text` shape's stored `h` is informational (it is part of the `bounds` register, and we
 * never rewrite geometry just because someone typed — that would turn typing into a bounds
 * conflict with a concurrent move). Instead the displayed height is max(h, measured height).
 */

export const TEXT_LINE_HEIGHT = 1.3;
export const STICKY_PADDING = 14;
export const TEXT_PADDING = 2;
export const TEXT_FONT_STACK = "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif";

let ctx: CanvasRenderingContext2D | null | undefined;
let resolvedFamily: string | null = null;

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  if (typeof document === "undefined") return null;
  ctx = document.createElement("canvas").getContext("2d");
  return ctx;
}

function fontFamily(): string {
  if (resolvedFamily) return resolvedFamily;
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
  resolvedFamily = v ? `${v}, ui-sans-serif, system-ui, sans-serif` : "ui-sans-serif, system-ui, sans-serif";
  return resolvedFamily;
}

const cache = new Map<string, number>();
const CACHE_LIMIT = 800;

/** Number of wrapped lines `text` occupies at `fontSize` within `width` (pre-wrap + break-word). */
export function countLines(text: string, fontSize: number, width: number): number {
  const key = `${fontSize}|${Math.round(width)}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const c = context();
  let lines: number;
  if (!c || width <= 0) {
    // Rough fallback: average glyph ≈ 0.55em.
    const perLine = Math.max(1, Math.floor(width / (fontSize * 0.55)));
    lines = text.split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
  } else {
    c.font = `${fontSize}px ${fontFamily()}`;
    lines = 0;
    for (const para of text.split("\n")) lines += wrapParagraph(c, para, width);
  }
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, lines);
  return lines;
}

function wrapParagraph(c: CanvasRenderingContext2D, para: string, width: number): number {
  if (para.length === 0) return 1;
  // Tokens keep their trailing whitespace, like the browser's pre-wrap line breaking.
  const tokens = para.match(/\S+\s*|\s+/g) ?? [para];
  let lines = 1;
  let line = 0;
  for (const tok of tokens) {
    const w = c.measureText(tok).width;
    const visible = c.measureText(tok.trimEnd()).width;
    if (line + visible <= width) {
      line += w;
      continue;
    }
    if (line > 0) {
      lines++;
      line = 0;
    }
    if (visible <= width) {
      line = w;
      continue;
    }
    // A single word longer than the line: break-word splits it by characters.
    for (const ch of tok) {
      const cw = c.measureText(ch).width;
      if (line + cw > width && line > 0) {
        lines++;
        line = 0;
      }
      line += cw;
    }
  }
  return lines;
}

/** Height a text block needs (including padding) to show all of its lines. */
export function measuredTextHeight(text: string, fontSize: number, width: number, padding: number): number {
  const inner = Math.max(1, width - padding * 2);
  const lines = countLines(text, fontSize, inner);
  return lines * fontSize * TEXT_LINE_HEIGHT + padding * 2;
}
