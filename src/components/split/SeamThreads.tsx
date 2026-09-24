"use client";
/**
 * The seam's backdrop: thread A enters from Tab A's side (left), thread B from Tab B's side
 * (right). They run down the desk, cross in the middle — where the knots are — and leave on
 * the opposite sides. Purely decorative.
 */
const A = "M 3 0 L 3 300 C 3 420, 97 460, 97 580 L 97 1000";
const B = "M 97 0 L 97 300 C 97 420, 3 460, 3 580 L 3 1000";

export function SeamThreads() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 1000" preserveAspectRatio="none" fill="none">
      <path d={B} stroke="var(--thread-b)" strokeOpacity={0.3} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="7 5" />
      {/* A crosses over B: a halo in the panel colour cuts B where they meet. */}
      <path d={A} stroke="var(--panel)" strokeWidth={7} vectorEffect="non-scaling-stroke" strokeOpacity={0.9} />
      <path d={A} stroke="var(--thread-a)" strokeOpacity={0.3} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="7 5" />
    </svg>
  );
}
