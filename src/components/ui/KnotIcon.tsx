"use client";
/**
 * The Weave "knot" glyph: two threads looping through each other. Used wherever a conflict
 * is counted or referenced. Inherits `currentColor`.
 */
import type { SVGProps } from "react";

export interface KnotIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  /** Accessible name; omit for decorative use (aria-hidden). */
  title?: string;
}

export function KnotIcon({ size = 18, title, strokeWidth = 1.9, ...rest }: KnotIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      {/* left tail → right loop */}
      <path d="M2.5 16h4.3c2.2 0 3.5-1.3 4.6-3.4l1.3-2.5C13.8 7.7 15.1 6.5 17 6.5a3.5 3.5 0 0 1 0 7h-1.4" />
      {/* right tail → crossing (gap = under) */}
      <path d="M21.5 16h-4.3c-2.1 0-3.4-1.2-4.4-3.1" />
      {/* left loop */}
      <path d="M10.6 9.4C9.6 7.6 8.5 6.5 7 6.5a3.5 3.5 0 0 0 0 7h1.4" />
    </svg>
  );
}
