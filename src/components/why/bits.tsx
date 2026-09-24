"use client";
/**
 * Small visual primitives shared by the Why panel: inline thread chips (letter + colour, never
 * colour alone), status chips, thumbnails with tombstones, and the hairline "stamp" rows.
 */
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import type { ShapeView } from "@/lib/crdt/types";
import type { Rect } from "@/lib/ui/geometry";
import { ShapesThumb } from "@/components/canvas/ShapeSvg";
import type { Thread } from "./threads";

/** Inline chip for a replica inside running text: "[B]'s teal beat [A]'s vermilion". */
export function ThreadChip({
  thread,
  size = "sm",
  solid,
  className,
  title,
}: {
  thread: Pick<Thread, "label" | "color" | "self">;
  size?: "xs" | "sm" | "md";
  solid?: boolean;
  className?: string;
  title?: string;
}) {
  const dims = size === "xs" ? "h-[16px] min-w-[16px] text-[10px]" : size === "md" ? "h-[22px] min-w-[22px] text-[12.5px]" : "h-[18px] min-w-[18px] text-[11px]";
  const style: CSSProperties = solid
    ? { background: thread.color, color: "var(--panel)" }
    : {
        color: thread.color,
        background: `color-mix(in oklab, ${thread.color} 14%, var(--panel))`,
        boxShadow: `inset 0 0 0 1.25px ${thread.color}`,
      };
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full px-[5px] align-[0.08em] font-semibold leading-none tracking-tight",
        dims,
        className,
      )}
      style={style}
      title={title ?? (thread.self ? `Tab ${thread.label} (you)` : `Tab ${thread.label}`)}
    >
      {thread.label}
    </span>
  );
}

export type ChipTone = "knot" | "ok" | "muted" | "warn" | "focus";

const TONE_VAR: Record<ChipTone, string> = {
  knot: "var(--knot)",
  ok: "var(--ok)",
  muted: "var(--muted)",
  warn: "var(--warn)",
  focus: "var(--focus)",
};

/** Pill with a leading shape-coded dot (colour is never the only signal). */
export function StatusChip({ tone, children, className, hollow }: { tone: ChipTone; children: ReactNode; className?: string; hollow?: boolean }) {
  const c = TONE_VAR[tone];
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-medium leading-none", className)}
      style={{ color: c, background: `color-mix(in oklab, ${c} 11%, transparent)` }}
    >
      <span
        aria-hidden
        className={clsx("inline-block size-[7px] rounded-full", hollow && "bg-transparent")}
        style={hollow ? { boxShadow: `inset 0 0 0 1.5px ${c}` } : { background: c }}
      />
      {children}
    </span>
  );
}

/** Small uppercase label above a block. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx("font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted", className)}>{children}</p>;
}

/** Dashed outline with a cross: "this shape is deleted in this frame". */
function TombstoneMark({ label }: { label: string }) {
  return (
    <span className="absolute inset-0 grid place-items-center" aria-hidden>
      <svg viewBox="0 0 40 30" className="h-[62%] max-h-12 w-auto">
        <rect x="3" y="3" width="34" height="24" rx="4" fill="none" stroke="var(--muted)" strokeWidth="1.4" strokeDasharray="3.5 3" />
        <path d="M11 9 L29 21 M29 9 L11 21" stroke="var(--muted)" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
      </svg>
      <span className="absolute bottom-1 left-0 right-0 text-center font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">{label}</span>
    </span>
  );
}

/**
 * Thumbnail of one shape (or a tombstone). `focus` lines several thumbnails up on the same
 * world rectangle so a filmstrip reads as one camera.
 */
export function ShapeThumb({
  shape,
  width,
  height,
  focus,
  padding = 18,
  dead,
  deadLabel = "deleted",
  authorship,
  colorOf,
  className,
  background = "var(--paper)",
}: {
  shape: ShapeView | null | undefined;
  width: number | string;
  height: number | string;
  focus?: Rect | null;
  padding?: number;
  dead?: boolean;
  deadLabel?: string;
  authorship?: boolean;
  colorOf?: (replica: string) => string;
  className?: string;
  background?: string;
}) {
  const showTomb = dead || !shape;
  return (
    <span className={clsx("relative block overflow-hidden", className)} style={{ width, height, background }}>
      {shape && (
        <span className={clsx("block h-full w-full", showTomb && "opacity-25 grayscale")}>
          <ShapesThumb
            shapes={[shape]}
            width="100%"
            height="100%"
            focus={focus}
            padding={padding}
            authorship={authorship}
            colorOf={colorOf}
            background="transparent"
          />
        </span>
      )}
      {showTomb && <TombstoneMark label={shape ? deadLabel : "not there"} />}
    </span>
  );
}

/** Key/value row for stamp cards. */
export function StampRow({ k, children, mono = true }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-baseline gap-2 py-[5px]">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className={clsx("min-w-0 break-words text-[12px] text-ink", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}

/** Colour swatch dot for a stored colour value. */
export function Swatch({ color, className }: { color: string; className?: string }) {
  const none = color === "none" || color === "transparent" || color === "";
  return (
    <span
      aria-hidden
      className={clsx("inline-block size-3 shrink-0 rounded-[4px] align-[-0.1em]", className)}
      style={
        none
          ? { background: "repeating-linear-gradient(45deg, var(--line-2) 0 2px, transparent 2px 4px)", boxShadow: "inset 0 0 0 1px var(--line-2)" }
          : { background: color.toLowerCase() === "#1d1b16" ? "var(--ink)" : color, boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--ink) 18%, transparent)" }
      }
    />
  );
}
