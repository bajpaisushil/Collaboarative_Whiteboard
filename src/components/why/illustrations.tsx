"use client";
/**
 * Hand-drawn-feeling SVG illustrations for the Why panel's empty and "gone" states. Both are
 * decorative (aria-hidden); the adjacent copy carries the meaning.
 */
import { motion, useReducedMotion } from "motion/react";

// Each thread is split at the middle so the two crossings can weave: A over B, then B over A.
const A1 = "M18 70 C 64 70, 74 22, 120 22";
const A2 = "M120 22 C 166 22, 176 70, 222 70";
const B1 = "M18 22 C 64 22, 74 70, 120 70";
const B2 = "M120 70 C 166 70, 176 22, 222 22";

/** Two threads crossing cleanly — over, then under — with no knot. */
export function ThreadsCrossing({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const draw = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { pathLength: 0 },
          animate: { pathLength: 1 },
          transition: { duration: 0.7, delay, ease: [0.3, 0.7, 0.2, 1] as const },
        };
  return (
    <svg viewBox="0 0 240 92" className={className} aria-hidden fill="none" strokeLinecap="round">
      {/* warp threads of the loom */}
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1={25 + i * 19} y1={8} x2={25 + i * 19} y2={84} stroke="var(--line)" strokeWidth={1} strokeDasharray="2 4" />
      ))}
      {/* crossing 1: A over B */}
      <motion.path d={B1} stroke="var(--thread-b)" strokeWidth={3.2} strokeDasharray="7 3.5" {...draw(0)} />
      <motion.path d={A1} stroke="var(--panel)" strokeWidth={9} {...draw(0.05)} />
      <motion.path d={A1} stroke="var(--thread-a)" strokeWidth={3.2} {...draw(0.05)} />
      {/* crossing 2: B over A */}
      <motion.path d={A2} stroke="var(--thread-a)" strokeWidth={3.2} {...draw(0.6)} />
      <motion.path d={B2} stroke="var(--panel)" strokeWidth={9} {...draw(0.65)} />
      <motion.path d={B2} stroke="var(--thread-b)" strokeWidth={3.2} strokeDasharray="7 3.5" {...draw(0.65)} />
      {/* letters so colour is never the only cue */}
      <g fontFamily="var(--font-geist-mono), monospace" fontSize={10} fontWeight={700}>
        <circle cx={12} cy={70} r={8.5} fill="var(--panel)" stroke="var(--thread-a)" strokeWidth={1.5} />
        <text x={12} y={73.5} textAnchor="middle" fill="var(--thread-a)">
          A
        </text>
        <circle cx={12} cy={22} r={8.5} fill="var(--panel)" stroke="var(--thread-b)" strokeWidth={1.5} />
        <text x={12} y={25.5} textAnchor="middle" fill="var(--thread-b)">
          B
        </text>
      </g>
    </svg>
  );
}

/** A loose thread end curling away — the knot that used to be here has come undone. */
export function LooseThread({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 60" className={className} aria-hidden fill="none" strokeLinecap="round">
      <path
        d="M6 44 C 30 44, 40 16, 62 16 C 84 16, 80 40, 66 40 C 54 40, 58 24, 76 22 C 92 20, 104 30, 114 26"
        stroke="var(--muted)"
        strokeWidth={2.4}
        strokeDasharray="5 4"
      />
      <circle cx={6} cy={44} r={3} fill="var(--muted)" />
    </svg>
  );
}
