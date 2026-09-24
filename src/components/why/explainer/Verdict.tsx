"use client";
/**
 * L1 of the explainer: the question as a big serif headline, the plain answer, and the verdict
 * in thread colours — who prevailed, what is kept, and whether someone has since moved on.
 */
import clsx from "clsx";
import type { Ref } from "react";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { StatusChip, ThreadChip } from "../bits";
import { CATEGORY_COPY, categoryOf, statusFor } from "../conflictModel";
import { propsTitle, valueWord } from "../format";
import { replicaOfOp } from "../threads";
import { useExplainer, type WhyVariant } from "./model";

function VerdictLine() {
  const model = useExplainer();
  const { conflict } = model;
  const [a, b] = model.sides;
  if (conflict.kind === "concurrent-text") {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">
        <ThreadChip thread={a.thread} />
        <span>+</span>
        <ThreadChip thread={b.thread} />
        <span>both kept, woven together</span>
      </p>
    );
  }
  const win = model.lead;
  const lose = win === a ? b : a;
  if (conflict.kind === "delete-vs-edit") {
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <ThreadChip thread={win.thread} solid />
          <span>
            <span className="font-medium text-ink">{win.thread.label}&rsquo;s edit</span> kept it
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ThreadChip thread={lose.thread} />
          <span>
            {lose.thread.label}&rsquo;s delete was overridden
          </span>
        </span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <ThreadChip thread={win.thread} solid />
        <span>
          <span className="font-medium text-ink">
            {win.thread.label}&rsquo;s {valueWord(win.side.wrote, conflict.props)}
          </span>{" "}
          won
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ThreadChip thread={lose.thread} />
        <span>
          {lose.thread.label}&rsquo;s {valueWord(lose.side.wrote, conflict.props)} is kept in history
        </span>
      </span>
    </p>
  );
}

function LaterNote() {
  const model = useExplainer();
  const { conflict, explanation, threadOf, noun } = model;
  if (conflict.status !== "superseded") return null;
  const sup = explanation.supersededBy;
  const byId = sup?.opId ?? conflict.resolvedBy?.opId;
  if (!byId) return null;
  const by = threadOf(replicaOfOp(byId));
  let text: string;
  if (conflict.kind === "delete-vs-edit") text = `deleted the ${noun} again after seeing the edit — so it's gone now.`;
  else if (conflict.resolvedBy?.cause === "adopt") text = `picked a value by hand in the explainer. What's on the board now is that pick.`;
  else if (conflict.resolvedBy?.cause === "undo") text = `undid an edit here, so the board now shows the undo's result.`;
  else text = `changed it again after seeing both edits — what's on the board now is ${by.label}'s.`;
  return (
    <p className="flex items-start gap-2 rounded-[10px] border border-dashed border-line-2 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
      <ThreadChip thread={by} size="xs" className="mt-[2px]" />
      <span>
        <span className="font-medium text-ink">Later, {by.label}</span> {text}
      </span>
    </p>
  );
}

export function Verdict({ variant, headingId, ref }: { variant: WhyVariant; headingId: string; ref?: Ref<HTMLHeadingElement> }) {
  const model = useExplainer();
  const { conflict, explanation, threadOf } = model;
  const compact = variant === "seam";
  const category = CATEGORY_COPY[categoryOf(conflict)];
  const status = statusFor(conflict, threadOf);
  const topic = conflict.kind === "concurrent-write" ? propsTitle(conflict.props) : conflict.kind === "delete-vs-edit" ? "Delete vs edit" : "Text";
  return (
    <header className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
        <KnotIcon size={15} className={status.live && !conflict.valuesEqual ? "text-knot" : "text-muted"} />
        <span className="font-medium text-ink-2">
          {category.title} · {topic}
        </span>
        {status.live ? (
          <StatusChip tone={conflict.valuesEqual ? "ok" : "knot"} hollow={conflict.valuesEqual}>
            {status.text}
          </StatusChip>
        ) : (
          <StatusChip tone="muted" hollow>
            {status.text}
            {status.thread && <ThreadChip thread={status.thread} size="xs" className="-my-1 ml-0.5" />}
          </StatusChip>
        )}
        <span className="ml-auto font-mono text-[10.5px] tabular-nums" title="Lamport position of this knot in history">
          L{conflict.lamport}
        </span>
      </p>
      <h2
        ref={ref}
        id={headingId}
        tabIndex={-1}
        className={clsx("text-balance font-serif leading-[1.05] tracking-[-0.01em] text-ink outline-none", compact ? "text-[23px]" : "text-[30px]")}
      >
        {explanation.question}
      </h2>
      <p className={clsx("leading-relaxed text-ink-2", compact ? "text-[12.5px]" : "text-[13.5px]")}>{explanation.answer}</p>
      <VerdictLine />
      <LaterNote />
    </header>
  );
}
