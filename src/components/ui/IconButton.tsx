"use client";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonTone = "default" | "knot" | "ok" | "solid";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "title"> {
  icon: LucideIcon;
  /** Accessible name; also the native tooltip. */
  label: string;
  /** Human-readable shortcut appended to the tooltip, e.g. "⌘Z". */
  shortcut?: string;
  /** Toggle buttons: sets aria-pressed and the pressed style. */
  pressed?: boolean;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  /** Trailing content (a count, a short label). */
  children?: ReactNode;
  iconClassName?: string;
  ref?: Ref<HTMLButtonElement>;
}

const SIZES: Record<IconButtonSize, string> = {
  sm: "h-7 min-w-7 rounded-[8px] px-1.5",
  md: "h-8 min-w-8 rounded-[10px] px-1.5",
  lg: "h-10 min-w-10 rounded-[12px] px-2",
};

const ICON: Record<IconButtonSize, string> = {
  sm: "size-[15px]",
  md: "size-[17px]",
  lg: "size-5",
};

const TONES: Record<IconButtonTone, string> = {
  default: "text-ink-2 hover:bg-panel-2 hover:text-ink",
  knot: "text-knot hover:bg-[var(--knot-soft)]",
  ok: "text-ok hover:bg-panel-2",
  solid: "bg-ink text-paper hover:bg-ink-2",
};

/** Compact icon button with a native title (label + shortcut) and visible focus ring. */
export function IconButton({
  icon: Icon,
  label,
  shortcut,
  pressed,
  size = "md",
  tone = "default",
  className,
  iconClassName,
  children,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      className={clsx(
        "inline-flex shrink-0 select-none items-center justify-center gap-1 text-[12.5px] font-medium transition-[background-color,color,transform] duration-100 active:translate-y-px disabled:pointer-events-none disabled:opacity-35",
        SIZES[size],
        TONES[tone],
        pressed && "bg-panel-2 text-ink shadow-[inset_0_0_0_1px_var(--line-2)]",
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className={clsx(ICON[size], iconClassName)} strokeWidth={1.75} />
      {children}
    </button>
  );
}
