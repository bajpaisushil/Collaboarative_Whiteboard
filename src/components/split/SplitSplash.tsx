"use client";
/**
 * Loading state for /split: thread A and thread B run in from either side and cross in the
 * middle — two tabs about to meet. Static under prefers-reduced-motion.
 */
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const PATH_A = "M4 14 C 40 14, 56 46, 92 46 S 144 14, 180 14";
const PATH_B = "M4 46 C 40 46, 56 14, 92 14 S 144 46, 180 46";

export function TwoThreads({ width = 184, animate = true }: { width?: number; animate?: boolean }) {
  const reduce = useReducedMotion();
  const still = reduce || !animate;
  const common = { strokeWidth: 3, strokeLinecap: "round" as const, fill: "none" };
  return (
    <svg width={width} height={(width * 60) / 184} viewBox="0 0 184 60" aria-hidden className="overflow-visible">
      {still ? (
        <>
          <path d={PATH_B} stroke="var(--thread-b)" {...common} />
          <path d={PATH_A} stroke="var(--thread-a)" {...common} />
        </>
      ) : (
        [
          { d: PATH_B, color: "var(--thread-b)", dir: 1 },
          { d: PATH_A, color: "var(--thread-a)", dir: -1 },
        ].map((t, i) => (
          <motion.path
            key={t.d}
            d={t.d}
            stroke={t.color}
            {...common}
            strokeDasharray="18 7"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, strokeDashoffset: [0, 50 * t.dir] }}
            transition={{
              opacity: { duration: 0.35, delay: i * 0.1 },
              strokeDashoffset: { duration: 1.5, repeat: Infinity, ease: "linear" },
            }}
          />
        ))
      )}
    </svg>
  );
}

export function SplitSplash({ message = "Opening two tabs side by side…", hint }: { message?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid h-dvh place-items-center bg-paper-2 px-6 text-ink">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <TwoThreads />
        <p className="font-serif text-[30px] italic leading-none tracking-tight">
          Weave <span className="align-middle font-sans text-[12px] not-italic uppercase tracking-[0.14em] text-muted">split view</span>
        </p>
        <p role="status" className="text-[13px] text-ink-2">
          {message}
        </p>
        {hint && <p className="text-[12px] leading-snug text-muted">{hint}</p>}
      </div>
    </div>
  );
}
