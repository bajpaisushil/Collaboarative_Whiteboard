"use client";
/**
 * A replica's identity token: its LETTER in its thread colour (never colour alone), with an
 * optional presence dot whose *shape* also encodes the status (solid / hollow / diamond / dash).
 */
import clsx from "clsx";
import { threadColor } from "@/lib/ui/colors";

export type ThreadStatus = "online" | "idle" | "unreachable" | "left";

export type ThreadBadgeSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<ThreadBadgeSize, string> = {
  xs: "size-[18px] text-[10px]",
  sm: "size-6 text-[11.5px]",
  md: "size-7 text-[13px]",
  lg: "size-9 text-[16px]",
  xl: "size-12 text-[22px]",
};

export const STATUS_WORD: Record<ThreadStatus, string> = {
  online: "online",
  idle: "idle (background tab)",
  unreachable: "unreachable",
  left: "left",
};

export function StatusDot({ status, className }: { status: ThreadStatus; className?: string }) {
  const base = "absolute -bottom-0.5 -right-0.5 block ring-2 ring-panel";
  switch (status) {
    case "online":
      return <span aria-hidden className={clsx(base, "size-2.5 rounded-full bg-ok", className)} />;
    case "idle":
      return <span aria-hidden className={clsx(base, "size-2.5 rounded-full border-2 border-warn bg-panel", className)} />;
    case "unreachable":
      return <span aria-hidden className={clsx(base, "size-2 rotate-45 rounded-[2px] bg-knot", className)} />;
    case "left":
      return <span aria-hidden className={clsx(base, "h-[3px] w-2.5 rounded-full bg-muted", className)} />;
  }
}

export interface ThreadBadgeProps {
  label: string;
  size?: ThreadBadgeSize;
  status?: ThreadStatus;
  /** Filled (solid thread colour, paper letter) instead of tinted. */
  solid?: boolean;
  dimmed?: boolean;
  className?: string;
}

export function ThreadBadge({ label, size = "md", status, solid, dimmed, className }: ThreadBadgeProps) {
  const color = threadColor(label);
  return (
    <span
      aria-hidden
      className={clsx(
        "relative inline-grid shrink-0 select-none place-items-center rounded-full font-semibold leading-none tracking-tight",
        SIZE[size],
        label.length > 1 && "tracking-tighter",
        dimmed && "opacity-45 grayscale-[0.4]",
        className,
      )}
      style={
        solid
          ? { background: color, color: "var(--panel)" }
          : {
              color,
              background: `color-mix(in oklab, ${color} 15%, var(--panel))`,
              boxShadow: `inset 0 0 0 1.5px ${color}`,
            }
      }
    >
      <span className={label.length > 1 ? "text-[0.8em]" : undefined}>{label}</span>
      {status && <StatusDot status={status} />}
    </span>
  );
}
