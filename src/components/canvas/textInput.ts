/**
 * Turn a native `beforeinput` into a precise text edit against the selection *before* the
 * change: delete `deleteLen` chars at `start`, then insert `insert` at `start`. Doing this
 * ourselves (instead of diffing after the fact) means each keystroke becomes exactly the
 * RGA ops the user meant, anchored to the right characters even under concurrent edits.
 *
 * Indices are UTF-16 code units (JS string indices), matching textarea selection offsets.
 */

export interface TextEdit {
  start: number;
  deleteLen: number;
  insert: string;
}

export type InputDecision =
  | { kind: "edit"; edit: TextEdit }
  /** Nothing to do (e.g. Backspace at the start), but still block the native change. */
  | { kind: "noop" }
  | { kind: "undo" }
  | { kind: "redo" }
  /** Let the browser apply it; the `input` handler reconciles by diff. */
  | { kind: "native" };

const segmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Start of the grapheme cluster that ends at `i`. */
export function prevBoundary(text: string, i: number): number {
  if (i <= 0) return 0;
  if (segmenter) {
    let last = 0;
    for (const seg of segmenter.segment(text.slice(0, i))) last = seg.index;
    return last;
  }
  const c = text.charCodeAt(i - 1);
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return i - 2;
  }
  return i - 1;
}

/** End of the grapheme cluster that starts at `i`. */
export function nextBoundary(text: string, i: number): number {
  if (i >= text.length) return text.length;
  if (segmenter) {
    for (const seg of segmenter.segment(text.slice(i))) return i + seg.segment.length;
    return text.length;
  }
  const c = text.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
    const l = text.charCodeAt(i + 1);
    if (l >= 0xdc00 && l <= 0xdfff) return i + 2;
  }
  return i + 1;
}

const WORD = new RegExp("[\\p{L}\\p{N}_]", "u");
const SPACE = /\s/;

export function wordStartBefore(text: string, i: number): number {
  let j = i;
  while (j > 0 && SPACE.test(text[j - 1]) && text[j - 1] !== "\n") j--;
  if (j > 0 && text[j - 1] === "\n" && j === i) return j - 1;
  if (j > 0 && WORD.test(text[j - 1])) {
    while (j > 0 && WORD.test(text[j - 1])) j--;
  } else if (j > 0 && !SPACE.test(text[j - 1])) {
    while (j > 0 && !WORD.test(text[j - 1]) && !SPACE.test(text[j - 1])) j--;
  }
  return j;
}

export function wordEndAfter(text: string, i: number): number {
  let j = i;
  const n = text.length;
  while (j < n && SPACE.test(text[j]) && text[j] !== "\n") j++;
  if (j < n && text[j] === "\n" && j === i) return j + 1;
  if (j < n && WORD.test(text[j])) {
    while (j < n && WORD.test(text[j])) j++;
  } else if (j < n && !SPACE.test(text[j])) {
    while (j < n && !WORD.test(text[j]) && !SPACE.test(text[j])) j++;
  }
  return j;
}

function lineStart(text: string, i: number): number {
  const k = text.lastIndexOf("\n", i - 1);
  return k === -1 ? 0 : k + 1;
}

function lineEnd(text: string, i: number): number {
  const k = text.indexOf("\n", i);
  return k === -1 ? text.length : k;
}

export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

function range(start: number, end: number, insert = ""): InputDecision {
  if (end <= start && insert === "") return { kind: "noop" };
  return { kind: "edit", edit: { start, deleteLen: Math.max(0, end - start), insert } };
}

export function decideInput(inputType: string, value: string, selStart: number, selEnd: number, data: string | null): InputDecision {
  const a = Math.min(selStart, selEnd),
    b = Math.max(selStart, selEnd);
  const collapsed = a === b;
  switch (inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertFromPaste":
    case "insertFromPasteAsQuotation":
    case "insertFromYank":
    case "insertTranspose": {
      if (data === null) return { kind: "native" };
      return range(a, b, normalizeNewlines(data));
    }
    case "insertLineBreak":
    case "insertParagraph":
      return range(a, b, "\n");
    case "deleteContentBackward":
      return collapsed ? range(prevBoundary(value, a), a) : range(a, b);
    case "deleteContentForward":
      return collapsed ? range(a, nextBoundary(value, a)) : range(a, b);
    case "deleteWordBackward":
      return collapsed ? range(wordStartBefore(value, a), a) : range(a, b);
    case "deleteWordForward":
      return collapsed ? range(a, wordEndAfter(value, a)) : range(a, b);
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward":
      return collapsed ? range(a === lineStart(value, a) ? Math.max(0, a - 1) : lineStart(value, a), a) : range(a, b);
    case "deleteSoftLineForward":
    case "deleteHardLineForward":
      return collapsed ? range(a, a === lineEnd(value, a) ? Math.min(value.length, a + 1) : lineEnd(value, a)) : range(a, b);
    case "deleteByCut":
    case "deleteContent":
      return range(a, b);
    case "historyUndo":
      return { kind: "undo" };
    case "historyRedo":
      return { kind: "redo" };
    case "formatBold":
    case "formatItalic":
    case "formatUnderline":
    case "formatStrikeThrough":
      return { kind: "noop" };
    default:
      // insertFromDrop / deleteByDrag / insertCompositionText / anything new: native + diff.
      return { kind: "native" };
  }
}

/** Minimal single-span diff (common prefix / suffix) between two strings. */
export function diffSpan(prev: string, next: string): TextEdit | null {
  if (prev === next) return null;
  let p = 0;
  const max = Math.min(prev.length, next.length);
  while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && prev.charCodeAt(prev.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
  return { start: p, deleteLen: prev.length - p - s, insert: next.slice(p, next.length - s) };
}
