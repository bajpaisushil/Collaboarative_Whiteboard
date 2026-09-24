"use client";
/**
 * The style sheet that unfolds from the tool dock: ink (stroke), fill and line width.
 * With shapes selected, a click restyles the selection as ONE transaction ("Recolour 3
 * shapes") and also becomes the style for new shapes; otherwise it only sets the style.
 * The swatch that matches the selection (or the current style) is ringed and ticked, so
 * the state never relies on colour alone.
 */
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ShapeView } from "@/lib/crdt/types";
import { colorName } from "@/lib/crdt/describe";
import { useReplicaView, useSession } from "@/lib/session/react";
import { INK_SWATCHES, STICKY_SWATCHES, STROKE_WIDTHS } from "@/lib/ui/colors";
import { useUi, useUiStore } from "@/lib/ui/store";
import { applyStyle, type StyleTarget } from "./commands";
import { FILLABLE, hasFill, INK, paint, STROKED, WIDTHED } from "./shapeUtils";

/** Keep focus where it is (canvas, text editor) when a dock control is clicked. */
export const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

const WIDTH_NAMES: Record<number, string> = { 2: "thin", 4: "medium", 8: "thick" };

const norm = (c: string) => c.toLowerCase();
const normFill = (c: string) => (hasFill(c) ? c.toLowerCase() : "none");

/** Value shared by every shape (or the fallback when none apply); null = mixed. */
function current<T>(values: readonly T[], fallback: T): T | null {
  if (values.length === 0) return fallback;
  return values.every((v) => v === values[0]) ? values[0] : null;
}

/** Relative luminance of a #rrggbb colour (0 dark … 1 light). */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Tick colour that reads on top of a swatch (ink follows the theme, so use paper on it). */
function tickOn(color: string): string {
  if (norm(color) === INK) return "var(--paper)";
  return luminance(color) > 0.45 ? INK : "#ffffff";
}

export function StylePanel({ id, orientation, onClose }: { id: string; orientation: "vertical" | "horizontal"; onClose: () => void }) {
  const session = useSession();
  const ui = useUiStore();
  const style = useUi((s) => s.style);
  const selection = useUi((s) => s.selection);
  const readOnly = useUi((s) => s.scrub !== null);
  const selected = useReplicaView(
    useShallow((v) => selection.map((sid) => v.shapeById.get(sid)).filter((s): s is ShapeView => s !== undefined)),
  );
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ text: string; n: number } | null>(null);
  const vertical = orientation === "vertical";

  // Escape closes; arrows walk a swatch row. Native listener so the pane-root shortcuts
  // (clear focus, nudge selection) never see these keys.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const group = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-swatch-group]");
      if (!group || !el.contains(group)) return;
      const items = [...group.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      const cols = Number(group.dataset.cols) || items.length;
      let j = -1;
      if (e.key === "ArrowRight") j = Math.min(items.length - 1, i + 1);
      else if (e.key === "ArrowLeft") j = Math.max(0, i - 1);
      else if (e.key === "ArrowDown") j = Math.min(items.length - 1, i + cols);
      else if (e.key === "ArrowUp") j = Math.max(0, i - cols);
      if (j < 0) return;
      e.preventDefault();
      e.stopPropagation();
      items[j].focus();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [onClose]);

  const strokeTargets = selected.filter((s) => STROKED.has(s.type));
  const fillTargets = selected.filter((s) => FILLABLE.has(s.type));
  const widthTargets = selected.filter((s) => WIDTHED.has(s.type));
  const activeStroke = current(strokeTargets.map((s) => norm(s.stroke)), norm(style.stroke));
  const activeFill = current(fillTargets.map((s) => normFill(s.fill)), normFill(style.fill));
  const activeWidth = current(widthTargets.map((s) => s.strokeWidth), style.strokeWidth);

  const apply = (t: StyleTarget, what: string) => {
    if (readOnly) return;
    const n = applyStyle(session, ui, t);
    const text = n ? `${t.kind === "strokeWidth" ? "Restyled" : "Recoloured"} ${n} shape${n === 1 ? "" : "s"} — ${what}` : `New shapes: ${what}`;
    setStatus((p) => ({ text, n: (p?.n ?? 0) + 1 }));
  };

  const scope = readOnly
    ? "Read-only while viewing history"
    : selected.length
      ? `Applies to ${selected.length} selected`
      : "For new shapes";

  return (
    <motion.div
      ref={ref}
      id={id}
      role="group"
      aria-label="Style"
      data-own-keys=""
      className={clsx(
        "sheet pointer-events-auto absolute z-10 w-[212px] p-3 text-ink",
        vertical ? "bottom-0 left-full ml-2" : "bottom-full right-0 mb-2",
      )}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: vertical ? -6 : 0, y: vertical ? 0 : 6, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: vertical ? -4 : 0, y: vertical ? 0 : 4, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 520, damping: 36 }}
      style={{ transformOrigin: vertical ? "0% 100%" : "100% 100%" }}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Style</p>
          <p className={clsx("truncate text-[12px]", readOnly ? "text-warn" : "text-ink-2")}>{scope}</p>
        </div>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={onClose}
          aria-label="Close style sheet"
          title="Close (Esc)"
          className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-panel-2 hover:text-ink"
        >
          <X aria-hidden className="size-[15px]" strokeWidth={1.75} />
        </button>
      </div>

      <Section title="Ink" note={activeStroke === null ? "mixed" : colorName(activeStroke)}>
        <div data-swatch-group="" data-cols={4} role="group" aria-label="Ink colour" className="grid grid-cols-4 gap-1.5">
          {INK_SWATCHES.map((c) => (
            <Swatch
              key={c}
              color={c}
              group="Ink"
              active={activeStroke === norm(c)}
              disabled={readOnly}
              onPick={() => apply({ kind: "stroke", value: c }, `${colorName(c)} ink`)}
            />
          ))}
        </div>
      </Section>

      <Section title="Fill" note={activeFill === null ? "mixed" : activeFill === "none" ? "no fill" : colorName(activeFill)}>
        <div data-swatch-group="" data-cols={4} role="group" aria-label="Fill colour" className="grid grid-cols-4 gap-1.5">
          <NoFillSwatch active={activeFill === "none"} disabled={readOnly} onPick={() => apply({ kind: "fill", value: "none" }, "no fill")} />
          {STICKY_SWATCHES.map((c) => (
            <Swatch
              key={c}
              color={c}
              group="Fill"
              active={activeFill === norm(c)}
              disabled={readOnly}
              onPick={() => apply({ kind: "fill", value: c }, `${colorName(c)} fill`)}
            />
          ))}
        </div>
      </Section>

      <Section title="Line" note={activeWidth === null ? "mixed" : `${activeWidth}px`} last>
        <div data-swatch-group="" data-cols={3} role="group" aria-label="Line width" className="grid grid-cols-3 gap-1.5">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={activeWidth === w}
              aria-label={`Line width ${w}px (${WIDTH_NAMES[w] ?? "custom"})`}
              title={`${WIDTH_NAMES[w] ?? ""} · ${w}px`.trim()}
              disabled={readOnly}
              onMouseDown={keepFocus}
              onClick={() => apply({ kind: "strokeWidth", value: w }, `${w}px line`)}
              className={clsx(
                "grid h-8 place-items-center rounded-[8px] transition-colors disabled:opacity-40",
                activeWidth === w ? "bg-panel-2 shadow-[inset_0_0_0_1.5px_var(--ink-2)]" : "hover:bg-panel-2",
              )}
            >
              <span aria-hidden className="block w-7 rounded-full bg-ink" style={{ height: Math.max(1.5, w * 0.75) }} />
            </button>
          ))}
        </div>
      </Section>

      <p aria-live="polite" className="sr-only">
        {status && <span key={status.n}>{status.text}</span>}
      </p>
    </motion.div>
  );
}

function Section({ title, note, last, children }: { title: string; note: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={clsx(!last && "mb-3")}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-medium text-ink-2">{title}</span>
        <span className="truncate font-mono text-[10.5px] text-muted">{note}</span>
      </div>
      {children}
    </div>
  );
}

function Swatch({ color, group, active, disabled, onPick }: { color: string; group: string; active: boolean; disabled: boolean; onPick: () => void }) {
  const name = colorName(color);
  const fill = paint(color);
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${group}: ${name}`}
      title={name.charAt(0).toUpperCase() + name.slice(1)}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onPick}
      className="group relative grid h-8 place-items-center rounded-full disabled:opacity-40"
    >
      <span
        aria-hidden
        className="block size-[22px] rounded-full transition-transform duration-100 group-hover:scale-110 group-disabled:scale-100"
        style={{
          background: fill,
          boxShadow: active
            ? `0 0 0 2px var(--panel), 0 0 0 3.5px ${fill}`
            : "inset 0 0 0 1px color-mix(in oklab, var(--ink) 16%, transparent)",
        }}
      />
      {active && <Check aria-hidden className="absolute size-3" strokeWidth={3} style={{ color: tickOn(color) }} />}
    </button>
  );
}

function NoFillSwatch({ active, disabled, onPick }: { active: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label="Fill: no fill"
      title="No fill (sticky notes keep their paper)"
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onPick}
      className="group relative grid h-8 place-items-center rounded-full disabled:opacity-40"
    >
      <span
        aria-hidden
        className="relative block size-[22px] overflow-hidden rounded-full bg-panel transition-transform duration-100 group-hover:scale-110 group-disabled:scale-100"
        style={{
          boxShadow: active ? "0 0 0 2px var(--panel), 0 0 0 3.5px var(--ink-2)" : "inset 0 0 0 1px var(--line-2)",
        }}
      >
        <span className="absolute left-1/2 top-[-2px] h-[26px] w-[1.5px] -translate-x-1/2 rotate-45 bg-knot" />
      </span>
      {active && <Check aria-hidden className="absolute size-3 text-ink" strokeWidth={3} />}
    </button>
  );
}
