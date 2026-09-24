"use client";
/**
 * Loading splash: the Weave wordmark over three threads (A, B, C) that stitch along while
 * the tab claims its identity. Static under prefers-reduced-motion.
 */
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const W = 176;
const H = 64;

function wave(phase: number, amp: number): string {
  const steps = 44;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    const y = H / 2 + amp * Math.sin((x / W) * Math.PI * 4 + phase);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

const THREADS = [
  { d: wave(0, 18), color: "var(--thread-a)" },
  { d: wave((Math.PI * 2) / 3, 18), color: "var(--thread-b)" },
  { d: wave((Math.PI * 4) / 3, 18), color: "var(--thread-c)" },
] as const;

function Threads() {
  const reduce = useReducedMotion();
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden className="overflow-visible">
      {THREADS.map((t, i) =>
        reduce ? (
          <path key={i} d={t.d} stroke={t.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <motion.path
            key={i}
            d={t.d}
            stroke={t.color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="16 7"
            initial={{ opacity: 0, y: (i - 1) * 6 }}
            animate={{ opacity: 1, y: 0, strokeDashoffset: i % 2 === 0 ? [0, -46] : [0, 46] }}
            transition={{
              opacity: { duration: 0.4, delay: i * 0.12 },
              y: { duration: 0.7, delay: i * 0.12, ease: [0.2, 0.8, 0.2, 1] },
              strokeDashoffset: { duration: 1.6, repeat: Infinity, ease: "linear" },
            }}
          />
        ),
      )}
    </svg>
  );
}

export function Splash({ message = "Threading this tab…", hint }: { message?: ReactNode; hint?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="grid h-full w-full place-items-center bg-paper px-6 text-ink">
      <div className="flex flex-col items-center">
        <Threads />
        <p className="mt-5 font-serif text-[52px] italic leading-none tracking-[-0.02em] text-ink">Weave</p>
        <p className="mt-2 text-[12.5px] tracking-wide text-muted">the whiteboard that explains its merges</p>
        <p className="mt-8 text-[13px] text-ink-2">{message}</p>
        {hint && <p className="mt-2 max-w-sm text-center text-[12px] leading-snug text-muted">{hint}</p>}
      </div>
    </div>
  );
}
