"use client";
/**
 * "Would every tab agree?" — the engine really replays the two edits in both arrival orders
 * on top of their common past; each result gets a woven fingerprint. Same glyph = same state.
 */
import { CircleAlert, CircleCheck } from "lucide-react";
import { memo } from "react";
import { FingerprintGlyph } from "@/components/ui/FingerprintGlyph";
import { useExplainer, type DisplaySide } from "./model";

function Lane({ order, text, hash }: { order: DisplaySide[]; text: string; hash: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-line bg-panel px-3 py-2.5">
      <svg viewBox="0 0 64 20" className="h-5 w-16 shrink-0" aria-hidden fill="none">
        <line x1={2} y1={10} x2={62} y2={10} stroke="var(--line-2)" strokeWidth={1.5} strokeDasharray="2 3" />
        {order.map((d, i) => (
          <g key={d.side.opId} transform={`translate(${14 + i * 22} 10)`}>
            <circle r={7.5} fill={d.thread.color} />
            <text y={3.6} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--panel)" fontFamily="var(--font-geist-sans), system-ui">
              {d.thread.label}
            </text>
          </g>
        ))}
        <path d="M54 6 L60 10 L54 14" stroke="var(--muted)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">{text}</p>
      <span className="flex shrink-0 flex-col items-center gap-0.5">
        <FingerprintGlyph hash={hash} size={30} title={`Resulting state fingerprint ${hash.slice(0, 8)}`} />
        <span className="font-mono text-[9.5px] text-muted">{hash.slice(0, 6)}</span>
      </span>
    </div>
  );
}

export const Convergence = memo(function Convergence() {
  const model = useExplainer();
  const cv = model.explanation.convergence;
  const s = model.explanation.sides;
  const a = model.sides.find((d) => d.side.opId === s[0].opId) ?? model.sides[0];
  const b = model.sides.find((d) => d.side.opId === s[1].opId) ?? model.sides[1];
  return (
    <div className="flex flex-col gap-2.5">
      <Lane order={[a, b]} text={cv.orderAB} hash={cv.hashAB} />
      <Lane order={[b, a]} text={cv.orderBA} hash={cv.hashBA} />
      {cv.equal ? (
        <p className="flex items-center gap-2 pt-1 font-serif text-[24px] leading-none text-ok" role="status">
          <CircleCheck aria-hidden className="size-6" strokeWidth={2} />
          Same result
        </p>
      ) : (
        <p
          className="flex items-center gap-2 rounded-[12px] border px-3 py-2.5 text-[13px] font-semibold text-knot"
          style={{ borderColor: "color-mix(in oklab, var(--knot) 50%, var(--line))", background: "var(--knot-soft)" }}
          role="alert"
        >
          <CircleAlert aria-hidden className="size-5 shrink-0" strokeWidth={2.2} />
          Different results! The merge depended on arrival order — that is a bug, and tabs could drift apart.
        </p>
      )}
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        Weave&rsquo;s merge doesn&rsquo;t depend on who syncs first, so both tabs always end up identical.
      </p>
    </div>
  );
});
