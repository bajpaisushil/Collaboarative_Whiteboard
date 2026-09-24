"use client";
/**
 * CSS-only rich tooltip: shows on hover (after a short delay) and on keyboard focus
 * (`:focus-visible`), never on a mouse click's focus. The trigger gets `aria-describedby`
 * pointing at the tooltip so screen readers announce the same text.
 *
 * Plain icon buttons use a native `title` instead (see IconButton); use this for controls
 * whose explanation is longer than a label.
 */
import clsx from "clsx";
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

export type TooltipSide = "top" | "bottom";
export type TooltipAlign = "start" | "center" | "end";

export interface TooltipProps {
  content: ReactNode;
  /** A single element; it receives `aria-describedby`. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: TooltipSide;
  align?: TooltipAlign;
  /** Wider max width for multi-line explanations. */
  wide?: boolean;
  disabled?: boolean;
  className?: string;
  tipClassName?: string;
}

const SIDE: Record<TooltipSide, string> = {
  bottom: "top-[calc(100%+8px)] origin-top group-hover/tt:translate-y-0 -translate-y-0.5",
  top: "bottom-[calc(100%+8px)] origin-bottom group-hover/tt:translate-y-0 translate-y-0.5",
};

const ALIGN: Record<TooltipAlign, string> = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};

export function Tooltip({ content, children, side = "bottom", align = "center", wide, disabled, className, tipClassName }: TooltipProps) {
  const id = useId();
  if (disabled || content === null || content === undefined || content === false) return children;
  const existing = isValidElement(children) ? children.props["aria-describedby"] : undefined;
  const trigger = isValidElement(children)
    ? cloneElement(children, { "aria-describedby": existing ? `${existing} ${id}` : id })
    : children;
  return (
    <span className={clsx("group/tt relative inline-flex", className)}>
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={clsx(
          "pointer-events-none invisible absolute z-50 w-max rounded-[10px] border border-line bg-panel px-2.5 py-2 text-left text-[12px] font-normal leading-snug text-ink-2 opacity-0 shadow-sheet",
          "transition-[opacity,visibility,translate] duration-150 motion-reduce:transition-none",
          "group-hover/tt:visible group-hover/tt:opacity-100 group-hover/tt:delay-300",
          "group-has-[:focus-visible]/tt:visible group-has-[:focus-visible]/tt:translate-y-0 group-has-[:focus-visible]/tt:opacity-100",
          wide ? "max-w-[320px]" : "max-w-[260px]",
          SIDE[side],
          ALIGN[align],
          tipClassName,
        )}
      >
        {content}
      </span>
    </span>
  );
}

/** Standard tooltip body: bold title, optional body text and a shortcut row. */
export function TipBody({ title, children, shortcut }: { title?: ReactNode; children?: ReactNode; shortcut?: ReactNode }) {
  return (
    <span className="flex flex-col gap-1">
      {title && <span className="text-[12.5px] font-semibold text-ink">{title}</span>}
      {children && <span className="block">{children}</span>}
      {shortcut && <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">{shortcut}</span>}
    </span>
  );
}
