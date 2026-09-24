"use client";
/**
 * The Weave mark: thread A and thread B crossing over and under each other.
 * The "under" crossings are cut with a halo in the surface colour so the weave reads.
 */
export function ThreadMark({ size = 22, surface = "var(--panel)", className }: { size?: number; surface?: string; className?: string }) {
  const b = "M2 12c2.5 7 7 7 10 0s7.5-7 10 0";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* B under A on the left crossing, A under B on the right: draw B, halo A-left, A-left, halo B-right, B-right. */}
      <path d={b} stroke="var(--thread-b)" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M2 12c2.5-7 7-7 10 0" stroke={surface} strokeWidth={5} strokeLinecap="round" />
      <path d="M2 12c2.5-7 7-7 10 0" stroke="var(--thread-a)" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M12 12c3 7 7.5 7 10 0" stroke="var(--thread-a)" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M12 12c3-7 7.5-7 10 0" stroke={surface} strokeWidth={5} strokeLinecap="round" />
      <path d="M12 12c3-7 7.5-7 10 0" stroke="var(--thread-b)" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}
