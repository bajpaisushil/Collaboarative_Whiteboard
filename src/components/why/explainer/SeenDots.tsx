"use client";
/**
 * "Were they really at the same time?" — the vector-clock proof without the jargon. For each
 * side, one row of dots per tab: filled = that edit had been seen, hollow = not. The single
 * hollow dot that proves concurrency (the other side's edit) pulses.
 */
import clsx from "clsx";
import { motion, useReducedMotion } from "motion/react";
import { memo, useState } from "react";
import type { ReplicaId } from "@/lib/crdt/types";
import { ThreadChip } from "../bits";
import type { Thread } from "../threads";
import { other, useExplainer, type DisplaySide } from "./model";

const WINDOW = 12;

type Cell = "seen" | "unseen" | "own" | "missing";

interface RowModel {
  replica: ReplicaId;
  thread: Thread;
  /** First counter drawn (earlier ones are collapsed). */
  lo: number;
  hi: number;
  seenUpTo: number;
  /** Counter of this side's own edit on its own row. */
  own: number | null;
  /** Counter of the other side's edit on the other side's row — never seen. */
  missing: number | null;
}

function valueFor(d: DisplaySide, row: { a: number; b: number }): number {
  return d.engineIndex === 0 ? row.a : row.b;
}

function Dot({ kind, color, title, pulse }: { kind: Cell; color: string; title: string; pulse: boolean }) {
  const base = "relative inline-block size-[11px] shrink-0 rounded-full";
  if (kind === "missing") {
    return (
      <span className={base} title={title} style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }}>
        {pulse ? (
          <motion.span
            aria-hidden
            className="absolute -inset-[4px] rounded-full"
            style={{ boxShadow: "0 0 0 2px var(--knot)" }}
            animate={{ scale: [0.85, 1.25, 0.85], opacity: [0.9, 0.2, 0.9] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <span aria-hidden className="absolute -inset-[4px] rounded-full" style={{ boxShadow: "0 0 0 2px var(--knot)" }} />
        )}
      </span>
    );
  }
  if (kind === "own") {
    return (
      <span className={base} title={title} style={{ background: color, boxShadow: `0 0 0 2px var(--panel), 0 0 0 3.5px ${color}` }} />
    );
  }
  if (kind === "seen") return <span className={base} title={title} style={{ background: color }} />;
  return <span className={base} title={title} style={{ boxShadow: `inset 0 0 0 1.25px color-mix(in oklab, ${color} 55%, var(--line-2))` }} />;
}

function SideBlock({ d, rows, pulse }: { d: DisplaySide; rows: RowModel[]; pulse: boolean }) {
  const model = useExplainer();
  const o = other(model, d);
  const seenOther = d.side.vc[o.side.replica] ?? 0;
  const otherCounter = o.side.vc[o.side.replica] ?? 0;
  const missed = seenOther < otherCounter;
  const caption = missed
    ? seenOther === 0
      ? `${d.thread.label} hadn’t seen any of ${o.thread.label}’s edits — ${o.thread.label}’s edit was #${otherCounter}, so ${d.thread.label} never saw it.`
      : `${d.thread.label} had seen ${o.thread.label}’s edits up to #${seenOther}; ${o.thread.label}’s edit was #${otherCounter}, so ${d.thread.label} never saw it.`
    : `${d.thread.label} had already seen ${o.thread.label}’s edit #${otherCounter}.`;
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-panel px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
        <ThreadChip thread={d.thread} size="xs" />
        When {d.thread.label} edited (L{d.side.lamport}), it had seen…
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const count = r.hi - r.lo + 1;
          const label = `${r.thread.label}'s edits: had seen ${r.seenUpTo} of ${r.hi}${r.own ? `; #${r.own} is this edit` : ""}${r.missing ? `; #${r.missing} is ${o.thread.label}'s edit, not seen` : ""}`;
          return (
            <div key={r.replica} className="flex items-center gap-2" role="img" aria-label={label}>
              <ThreadChip thread={r.thread} size="xs" className="opacity-80" />
              <span className="flex min-w-0 flex-wrap items-center gap-[5px]" aria-hidden>
                {r.lo > 1 && (
                  <span
                    className="rounded-full px-1 font-mono text-[9.5px] leading-[13px]"
                    style={
                      r.seenUpTo >= r.lo - 1
                        ? { background: `color-mix(in oklab, ${r.thread.color} 22%, transparent)`, color: "var(--ink-2)" }
                        : { boxShadow: "inset 0 0 0 1px var(--line-2)", color: "var(--muted)" }
                    }
                    title={`#1–${r.lo - 1}`}
                  >
                    1–{r.lo - 1}
                  </span>
                )}
                {Array.from({ length: count }, (_, k) => {
                  const n = r.lo + k;
                  const kind: Cell = n === r.own ? "own" : n === r.missing ? "missing" : n <= r.seenUpTo ? "seen" : "unseen";
                  const title =
                    kind === "own"
                      ? `#${n}: this edit`
                      : kind === "missing"
                        ? `#${n}: ${o.thread.label}'s edit — ${d.thread.label} never saw it`
                        : `${r.thread.label}'s edit #${n}: ${kind === "seen" ? "seen" : "not seen"}`;
                  return <Dot key={n} kind={kind} color={r.thread.color} title={title} pulse={pulse} />;
                })}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-2">{caption}</p>
    </div>
  );
}

export const SeenDots = memo(function SeenDots({ compact }: { compact?: boolean }) {
  const model = useExplainer();
  const reduce = useReducedMotion();
  const [numbers, setNumbers] = useState(false);
  const proof = model.explanation.vcProof;
  const [left, right] = model.sides;
  const rowsSorted = [...proof.rows].sort((x, y) => model.threadOf(x.replica).label.localeCompare(model.threadOf(y.replica).label));

  const rowsFor = (d: DisplaySide): RowModel[] => {
    const o = other(model, d);
    return rowsSorted.map((row) => {
      const hi = Math.max(row.a, row.b, 1);
      const lo = hi > WINDOW ? hi - WINDOW + 1 : 1;
      return {
        replica: row.replica,
        thread: model.threadOf(row.replica),
        lo,
        hi,
        seenUpTo: valueFor(d, row),
        own: row.replica === d.side.replica ? (d.side.vc[d.side.replica] ?? null) : null,
        missing: row.replica === o.side.replica && valueFor(d, row) < (o.side.vc[o.side.replica] ?? 0) ? (o.side.vc[o.side.replica] ?? null) : null,
      };
    });
  };

  const flip = (rel: "<" | "=" | ">") => (left.engineIndex === 0 ? rel : rel === "<" ? ">" : rel === ">" ? "<" : "=");

  return (
    <div className="flex flex-col gap-3">
      <p className={clsx("leading-relaxed text-ink-2", compact ? "text-[12px]" : "text-[12.5px]")}>{proof.summary}</p>

      {!numbers ? (
        <div className={clsx("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1")}>
          <SideBlock d={left} rows={rowsFor(left)} pulse={!reduce} />
          <SideBlock d={right} rows={rowsFor(right)} pulse={!reduce} />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[10.5px] text-muted" aria-hidden>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-ink-2" /> had seen
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full shadow-[inset_0_0_0_1.25px_var(--ink-2)]" /> hadn’t seen
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-ink-2 shadow-[0_0_0_1.5px_var(--panel),0_0_0_3px_var(--ink-2)]" /> this edit
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full shadow-[0_0_0_2px_var(--knot)]" /> the edit it missed
            </span>
          </p>
        </div>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <caption className="sr-only">Vector clocks of the two edits, one row per tab</caption>
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th scope="col" className="border-b border-line py-1.5 font-medium">
                Edits by
              </th>
              <th scope="col" className="border-b border-line py-1.5 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  <ThreadChip thread={left.thread} size="xs" /> had seen
                </span>
              </th>
              <th scope="col" className="border-b border-line py-1.5 text-center font-medium">
                <span className="sr-only">relation</span>
              </th>
              <th scope="col" className="border-b border-line py-1.5 font-medium">
                <span className="inline-flex items-center gap-1">
                  <ThreadChip thread={right.thread} size="xs" /> had seen
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rowsSorted.map((row) => {
              const lv = valueFor(left, row);
              const rv = valueFor(right, row);
              const rel = flip(row.relation);
              return (
                <tr key={row.replica}>
                  <th scope="row" className="border-b border-line py-1.5 text-left font-sans font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      <ThreadChip thread={model.threadOf(row.replica)} size="xs" />
                      <span className="text-[11px] text-muted">{row.replica}</span>
                    </span>
                  </th>
                  <td className={clsx("border-b border-line py-1.5 text-right", rel === ">" && "font-semibold text-ink")}>{lv}</td>
                  <td className={clsx("border-b border-line py-1.5 text-center", rel === "=" ? "text-muted" : "text-knot")}>{rel}</td>
                  <td className={clsx("border-b border-line py-1.5", rel === "<" && "font-semibold text-ink")}>{rv}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-ink">
          {proof.relation === "concurrent"
            ? "Each was missing the other’s edit. Neither knew about the other — that’s what “concurrent” means."
            : "One edit had seen the other, so there was a clear order."}
        </p>
        <button
          type="button"
          aria-pressed={numbers}
          onClick={() => setNumbers((v) => !v)}
          className="rounded-[8px] border border-line px-2 py-1 text-[11.5px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink aria-pressed:bg-panel-2 aria-pressed:text-ink"
        >
          {numbers ? "Show as dots" : "Show as numbers"}
        </button>
      </div>
    </div>
  );
});
