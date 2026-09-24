"use client";
/**
 * Text knots: nothing was lost, so instead of a winner we show the woven result — every run
 * tinted by its author, the two clashing inserts emphasised — and, per anchor, which insert
 * went first and why.
 */
import { memo } from "react";
import { useSession } from "@/lib/session/react";
import { ThreadChip } from "../bits";
import { quoted } from "../format";
import { useExplainer } from "./model";

export const TextMerge = memo(function TextMerge({ compact }: { compact?: boolean }) {
  const session = useSession();
  const model = useExplainer();
  const { explanation, threadOf } = model;
  const runs = explanation.outcome.text ?? [];
  const hot = new Set(explanation.conflict.ops);
  const typed = (opId: string) => {
    const op = session.replica.getOp(opId);
    return op && op.kind === "text.insert" ? op.text : "";
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted">The merged text — every character kept, tinted by who typed it</p>
        <p
          className={
            "whitespace-pre-wrap break-words rounded-[10px] border border-line bg-paper px-3 py-2.5 leading-[1.7] text-ink " +
            (compact ? "text-[13px]" : "text-[14.5px]")
          }
        >
          {runs.length === 0 && <span className="italic text-muted">(empty)</span>}
          {runs.map((r, i) => {
            const t = threadOf(r.replica);
            const isHot = hot.has(r.opId);
            return (
              <span
                key={`${r.opId}-${i}`}
                title={`${t.label} typed this${isHot ? " — part of this knot" : ""}`}
                style={{
                  background: `color-mix(in oklab, ${t.color} ${isHot ? 26 : 10}%, transparent)`,
                  boxShadow: `inset 0 ${isHot ? -2.5 : -1}px 0 ${t.color}`,
                  borderRadius: 3,
                  fontWeight: isHot ? 600 : undefined,
                }}
              >
                {r.text}
              </span>
            );
          })}
        </p>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
        {model.sides.map((d) => (
          <li key={d.side.opId} className="inline-flex items-center gap-1.5">
            <ThreadChip thread={d.thread} size="xs" />
            typed <span className="font-medium text-ink">{quoted(typed(d.side.opId), 24)}</span>
            <span className="font-mono text-[10.5px] text-muted">L{d.side.lamport}</span>
          </li>
        ))}
      </ul>

      {explanation.textAnchors?.map((a, i) => (
        <div key={`${a.anchor ?? "^"}-${i}`} className="rounded-[10px] border border-dashed border-line-2 px-3 py-2.5">
          <p className="text-[12px] text-ink-2">
            At{" "}
            <span className="font-mono text-[11.5px] text-ink">
              “{a.context ? `…${a.context.slice(-10)}` : ""}
              <span className="text-knot">|</span>”
            </span>{" "}
            {a.context ? "" : "(the very start) "}both typed:
          </p>
          <ol className="mt-1.5 flex flex-col gap-1">
            {a.order.map((o, k) => {
              const t = threadOf(o.replica);
              return (
                <li key={o.opId} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-4 font-mono text-[10.5px] text-muted">{k + 1}.</span>
                  <ThreadChip thread={t} size="xs" />
                  <span className="font-medium text-ink">{quoted(o.text, 22)}</span>
                  <span className="font-mono text-[10.5px] text-muted">L{o.lamport}</span>
                  {k === 0 && (
                    <span className="rounded-full px-1.5 py-[2px] text-[10.5px] font-semibold leading-none" style={{ background: t.color, color: "var(--panel)" }}>
                      goes first
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{a.rule}</p>
        </div>
      ))}
    </div>
  );
});
