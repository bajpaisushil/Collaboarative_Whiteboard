"use client";
/**
 * X-ray clock tag, hanging under the top bar: this tab's Lamport clock, its vector clock
 * (edits seen from each tab), and how many received edits are waiting on their causes.
 */
import { Hourglass } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { useReplicaView } from "@/lib/session/react";
import { useReplicaDirectory } from "@/lib/ui/hooks";
import { useUi } from "@/lib/ui/store";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { selectLamport, selectPendingCount, selectVc } from "../selectors";

export function ClockTag() {
  const xray = useUi((s) => s.mode === "xray");
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {xray && (
        <motion.div
          key="clocks"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="absolute left-3 top-[calc(100%+6px)] z-10"
        >
          <ClockChips />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ClockChips() {
  const lamport = useReplicaView(selectLamport);
  const vc = useReplicaView(selectVc);
  const pending = useReplicaView(selectPendingCount);
  const directory = useReplicaDirectory();

  const entries = useMemo(
    () =>
      Object.entries(vc)
        .filter(([, n]) => n > 0)
        .map(([replica, n]) => ({ replica, n, ...directory(replica) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [vc, directory],
  );

  return (
    <div className="flex items-center gap-1 rounded-[11px] border border-line bg-panel px-1.5 py-1 font-mono text-[11.5px] shadow-sheet">
      <Tooltip
        align="start"
        wide
        content={
          <TipBody title={`Lamport clock: ${lamport}`}>
            A counter every tab bumps per edit and fast-forwards when it hears from others. It gives all edits one agreed
            order — but can’t tell whether two edits saw each other.
          </TipBody>
        }
      >
        <span
          tabIndex={0}
          role="img"
          aria-label={`Lamport clock ${lamport}`}
          className="flex items-center gap-1 rounded-[7px] bg-panel-2 px-1.5 py-0.5 tabular-nums text-ink"
        >
          <span className="text-muted">L</span>
          {lamport}
        </span>
      </Tooltip>

      <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />

      <Tooltip
        align="start"
        wide
        content={
          <TipBody title="Vector clock">
            How many edits from each tab this tab has seen. Comparing two of these is how Weave proves two edits happened
            “at the same time” — each had seen something the other hadn’t.
          </TipBody>
        }
      >
        <span
          tabIndex={0}
          role="img"
          aria-label={`Vector clock: ${entries.map((e) => `${e.label} ${e.n}`).join(", ") || "empty"}`}
          className="flex items-center gap-0.5 rounded-[7px] px-0.5 py-0.5 tabular-nums"
        >
          {entries.length === 0 && <span className="px-1 text-muted">no edits yet</span>}
          {entries.map((e, i) => (
            <span key={e.replica} className="flex items-center">
              {i > 0 && <span className="px-0.5 text-line-2">·</span>}
              <span
                className="flex items-center gap-1 rounded-[6px] px-1 py-px"
                style={{ background: `color-mix(in oklab, ${e.color} ${e.self ? 18 : 10}%, transparent)` }}
              >
                <span className="font-semibold" style={{ color: e.color }}>
                  {e.label}
                </span>
                <span className="text-ink">{e.n}</span>
              </span>
            </span>
          ))}
        </span>
      </Tooltip>

      {pending > 0 && (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />
          <Tooltip
            align="start"
            wide
            content={
              <TipBody title={`${pending} waiting`}>
                Edits that arrived before the edits they build on. They’re held back until the gap is filled, so nobody ever
                sees an effect before its cause.
              </TipBody>
            }
          >
            <span
              tabIndex={0}
              role="img"
              aria-label={`${pending} edits waiting for their causes`}
              className="flex items-center gap-1 rounded-[7px] px-1.5 py-0.5 text-warn"
            >
              <Hourglass aria-hidden className="size-3" />
              {pending}
            </span>
          </Tooltip>
        </>
      )}
    </div>
  );
}
