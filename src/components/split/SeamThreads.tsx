"use client";
/**
 * The seam's backdrop: thread A runs down Tab A's side (left edge), thread B down Tab B's side
 * (right edge). They stay in the gutters so they never cross the desk's text. Purely decorative.
 */
export function SeamThreads() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 1000" preserveAspectRatio="none" fill="none">
      <path d="M 1.5 0 L 1.5 1000" stroke="var(--thread-a)" strokeOpacity={0.3} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="7 5" />
      <path d="M 98.5 0 L 98.5 1000" stroke="var(--thread-b)" strokeOpacity={0.3} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="7 5" />
    </svg>
  );
}
