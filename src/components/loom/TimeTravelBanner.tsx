"use client";
/**
 * Floating blueprint pill shown over the canvas while time travelling (ui.scrub != null):
 * what you're looking at, why it's trustworthy (a consistent / causal cut), step controls
 * and the way back to live (Esc).
 */
import { ChevronLeft, ChevronRight, History, Undo2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import type { ReplicaId, ReplicaView } from "@/lib/crdt/types";
import { useReplicaView } from "@/lib/session/react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { IconButton } from "@/components/ui/IconButton";
import { Kbd } from "@/components/ui/Kbd";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { useLoomThreads, useSnapshots } from "./hooks";
import { describeScrub, stepScrub } from "./scrub";

const selectLog = (v: ReplicaView) => v.log;

const BLUEPRINT = {
  background: [
    "linear-gradient(color-mix(in oklab, var(--focus) 9%, transparent) 1px, transparent 1px)",
    "linear-gradient(90deg, color-mix(in oklab, var(--focus) 9%, transparent) 1px, transparent 1px)",
    "color-mix(in oklab, var(--focus) 7%, var(--panel))",
  ].join(", "),
  backgroundSize: "12px 12px, 12px 12px, auto",
  borderColor: "color-mix(in oklab, var(--focus) 38%, var(--line))",
} as const;

export function TimeTravelBanner() {
  const scrub = useUi((s) => s.scrub);
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {scrub && (
        <motion.div
          key="time-travel"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.14 } }}
          transition={reduce ? { duration: 0.1 } : { type: "spring", stiffness: 520, damping: 40 }}
        >
          <BannerBody />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BannerBody() {
  const store = useUiStore();
  const scrub = useUi((s) => s.scrub);
  const log = useReplicaView(selectLog);
  const snapshots = useSnapshots();
  const threads = useLoomThreads();
  const indexOf = useMemo(() => new Map(log.map((o, i) => [o.id, i] as const)), [log]);
  const labelOf = (r: ReplicaId, fallback?: string) => threads(r, fallback).label;
  const d = describeScrub(scrub, log, indexOf, labelOf, snapshots);
  const n = log.length;
  const step = (delta: number) => store.getState().set({ scrub: stepScrub(store.getState().scrub, delta, log, indexOf) });
  const back = () => store.getState().set({ scrub: null });
  const who = d.op ? threads(d.op.replica, d.op.meta.author).label : d.snapshot ? threads(d.snapshot.replica, d.snapshot.author).label : null;
  const prefix = d.kind === "op" || d.kind === "start";

  return (
    <div
      role="region"
      aria-label="Time travel"
      className="flex max-w-[min(760px,calc(100vw-40px))] items-center gap-3 rounded-[16px] border py-2 pl-2.5 pr-2 text-ink shadow-sheet"
      style={BLUEPRINT}
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full border text-[var(--focus)]"
        style={{ borderColor: "color-mix(in oklab, var(--focus) 45%, transparent)", background: "var(--panel)" }}
      >
        <History className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight">
          {who && <ThreadBadge label={who} size="xs" solid />}
          <span className="truncate">{d.title}</span>
        </p>
        <p className="mt-0.5 truncate text-[11.5px] leading-snug text-ink-2">
          {d.detail}{" "}
          <span className="font-mono text-[10.5px] text-muted">
            {prefix ? `${Math.min(d.slot, n)} / ${n}` : `${d.covered ?? 0} of ${n} edits`} · read-only
          </span>
        </p>
      </div>
      {prefix && (
        <div className="flex shrink-0 items-center">
          <IconButton icon={ChevronLeft} size="sm" label="Previous edit" shortcut="←" onClick={() => step(-1)} disabled={d.slot <= 0} />
          <IconButton icon={ChevronRight} size="sm" label="Next edit" shortcut="→" onClick={() => step(1)} disabled={n === 0} />
        </div>
      )}
      <button
        type="button"
        onClick={back}
        title="Return to live (Esc)"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--focus)] px-2.5 text-[12px] font-semibold text-[var(--panel)] transition-[filter] hover:brightness-110 active:translate-y-px"
      >
        <Undo2 aria-hidden className="size-3.5" strokeWidth={2.2} />
        Return to live
        <Kbd className="ml-0.5 border-transparent bg-[color-mix(in_oklab,var(--panel)_22%,transparent)] text-[var(--panel)]">Esc</Kbd>
      </button>
    </div>
  );
}
