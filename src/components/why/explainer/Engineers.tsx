"use client";
/**
 * "For engineers" — the raw evidence: a stamp card per side (op id, Lamport, full vector
 * clock, wall time, cause, values written) and the op JSON exactly as it sits in the log.
 */
import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import { useSession } from "@/lib/session/react";
import { StampRow, ThreadChip } from "../bits";
import { causeWord, clockTime, formatVc, gap } from "../format";
import { copyText } from "./actions";
import { roleWord, useExplainer, type DisplaySide } from "./model";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function SideStamp({ d, wallDelta, vs }: { d: DisplaySide; wallDelta: number | null; vs?: string }) {
  const model = useExplainer();
  const session = useSession();
  const op = session.replica.getOp(d.side.opId);
  const labelOf = (r: string) => model.threadOf(r).label;
  return (
    <div className="min-w-0 rounded-[12px] border border-line bg-panel px-3 py-2">
      <p className="flex items-center gap-1.5 border-b border-dashed border-line pb-1.5 text-[12px] font-semibold text-ink">
        <ThreadChip thread={d.thread} size="xs" />
        {d.thread.label}&rsquo;s op
        <span className="ml-auto text-[10.5px] font-medium text-muted">{roleWord(d.role)}</span>
      </p>
      <dl className="divide-y divide-line/60">
        <StampRow k="Op id">{d.side.opId}</StampRow>
        <StampRow k="Kind">{d.side.kind}</StampRow>
        <StampRow k="Lamport">{d.side.lamport}</StampRow>
        <StampRow k="Vector clock">{formatVc(d.side.vc, labelOf)}</StampRow>
        <StampRow k="Wall time">
          {clockTime(d.side.wallTime)}
          {wallDelta !== null && wallDelta !== 0 && (
            <span className="ml-1 font-sans text-muted">
              ({gap(wallDelta)} {wallDelta > 0 ? "after" : "before"} {vs})
            </span>
          )}
          {d.side.offline && <span className="ml-1 rounded bg-panel-2 px-1 font-sans text-[10.5px] text-ink-2">offline</span>}
        </StampRow>
        <StampRow k="Cause" mono={false}>
          {causeWord(d.side.cause)}
          {op?.meta.label ? ` · “${op.meta.label}”` : ""}
        </StampRow>
        <StampRow k="Txn">{op?.meta.txn ?? "—"}</StampRow>
        {d.side.wrote && <StampRow k="Wrote">{JSON.stringify(d.side.wrote)}</StampRow>}
        {d.side.base && <StampRow k="Base value">{JSON.stringify(d.side.base)}</StampRow>}
      </dl>
    </div>
  );
}

function RawOp({ d }: { d: DisplaySide }) {
  const session = useSession();
  const [copied, setCopied] = useState(false);
  const op = session.replica.getOp(d.side.opId);
  const text = op ? json(op) : "(op not in this tab's log)";
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <ThreadChip thread={d.thread} size="xs" />
        <span className="font-mono">{d.side.opId}</span>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyText(text);
            setCopied(ok);
            if (ok) setTimeout(() => setCopied(false), 1600);
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink"
          aria-label={`Copy ${d.thread.label}'s op as JSON`}
          title="Copy JSON"
        >
          {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        tabIndex={0}
        aria-label={`${d.thread.label}'s op as JSON`}
        className="scrollbar-thin max-h-56 overflow-auto rounded-[10px] border border-line bg-paper px-3 py-2 font-mono text-[11px] leading-[1.55] text-ink-2"
      >
        {text}
      </pre>
    </div>
  );
}

export const Engineers = memo(function Engineers() {
  const model = useExplainer();
  const { conflict, explanation } = model;
  const [left, right] = model.sides;
  const delta = right.side.wallTime - left.side.wallTime;
  const labelOf = (r: string) => model.threadOf(r).label;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2">
        <SideStamp d={left} wallDelta={null} />
        <SideStamp d={right} wallDelta={delta} vs={left.thread.label} />
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">
        Wall times are shown for reference only — clocks on different devices drift, so Weave never orders edits by them.
      </p>
      <dl className="rounded-[12px] border border-line bg-panel px-3 py-1.5">
        <StampRow k="Conflict id">{conflict.id}</StampRow>
        <StampRow k="Lineage">{conflict.lineageKey}</StampRow>
        <StampRow k="Status">
          {conflict.status}
          {conflict.resolvedBy ? ` (by ${conflict.resolvedBy.opId}, ${conflict.resolvedBy.cause})` : ""}
        </StampRow>
        {conflict.props.length > 0 && <StampRow k="Props">{conflict.props.join(", ")}</StampRow>}
        <StampRow k="Common cut">{formatVc(explanation.baseCut, labelOf)}</StampRow>
        <StampRow k="Hash A→B">{explanation.convergence.hashAB}</StampRow>
        <StampRow k="Hash B→A">{explanation.convergence.hashBA}</StampRow>
      </dl>
      <div className="flex flex-col gap-3">
        <RawOp d={left} />
        <RawOp d={right} />
      </div>
    </div>
  );
});
