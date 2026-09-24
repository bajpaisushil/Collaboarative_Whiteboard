"use client";
/**
 * First-run coach. When this tab has been alone for >2 s on an empty board, explain that
 * merges need a second tab and walk through the three-step demo. Once shown it stays (docked
 * in the corner, ticking off steps) until another tab shows up or it is dismissed.
 */
import clsx from "clsx";
import { Check, Columns2, SquareArrowOutUpRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useReplicaView, useSessionState } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { Kbd } from "@/components/ui/Kbd";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { openPeerTab, SPLIT_HREF } from "./links";
import { selectBoardEmpty, selectHasLivePeer, selectLabel, selectNextLabel, selectRoom } from "./selectors";

const DISMISS_KEY = "weave:coach-dismissed";
const ALONE_AFTER_MS = 2000;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function Coach() {
  const hasPeer = useSessionState(selectHasLivePeer);
  const empty = useReplicaView(selectBoardEmpty);
  const scrubbing = useUi((s) => s.scrub !== null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [alone, setAlone] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [prevHasPeer, setPrevHasPeer] = useState(hasPeer);

  // A peer arriving resets the "alone for 2 s" clock (adjusting state during render).
  if (prevHasPeer !== hasPeer) {
    setPrevHasPeer(hasPeer);
    if (hasPeer) setAlone(false);
  }

  useEffect(() => {
    if (hasPeer) return;
    const t = setTimeout(() => setAlone(true), ALONE_AFTER_MS);
    return () => clearTimeout(t);
  }, [hasPeer]);

  const eligible = !dismissed && alone && !hasPeer;
  if (eligible && empty && !engaged) setEngaged(true);
  const visible = eligible && (empty || engaged) && !scrubbing;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* dismissal just won't persist */
    }
  };

  return (
    <AnimatePresence>
      {visible && <CoachCard key={empty ? "center" : "docked"} docked={!empty} onDismiss={dismiss} />}
    </AnimatePresence>
  );
}

function CoachCard({ docked, onDismiss }: { docked: boolean; onDismiss: () => void }) {
  const reduce = useReducedMotion();
  const label = useSessionState(selectLabel);
  const next = useSessionState(selectNextLabel);
  const room = useSessionState(selectRoom);
  const empty = useReplicaView(selectBoardEmpty);
  const titleId = useId();

  return (
    <div
      className={clsx(
        "pointer-events-none absolute z-10 flex",
        docked ? "bottom-4 right-4 justify-end" : "inset-0 items-center justify-center p-6",
      )}
    >
      <motion.section
        aria-labelledby={titleId}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        className={clsx("sheet stitch pointer-events-auto relative", docked ? "w-[320px] p-4" : "w-[min(440px,100%)] p-6")}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the getting-started guide"
          title="Dismiss"
          className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-[8px] text-muted hover:bg-panel-2 hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>

        <div className="flex items-center gap-3 pr-8">
          <ThreadBadge label={label} size={docked ? "md" : "lg"} />
          <div className="min-w-0">
            <h2 id={titleId} className={clsx("font-semibold tracking-tight text-ink", docked ? "text-[13.5px]" : "text-[16px]")}>
              You’re Tab {label}.
            </h2>
            <p className={clsx("text-ink-2", docked ? "text-[12px]" : "text-[13px]")}>Weave needs a second tab to show merges.</p>
          </div>
        </div>

        <ol className={clsx("space-y-2.5", docked ? "mt-3" : "mt-5")}>
          <Step n={1} done={!empty}>
            Draw something on this board.
          </Step>
          <Step n={2}>
            Unplug one tab (<Kbd>\</Kbd> or the cable switch) and edit the same shape in both.
          </Step>
          <Step n={3}>
            Plug back in and click the knot <KnotIcon size={14} className="inline -mt-0.5 text-knot" /> to see exactly why it merged
            that way.
          </Step>
        </ol>

        <div className={clsx("flex flex-wrap gap-2", docked ? "mt-3" : "mt-5")}>
          <button
            type="button"
            onClick={() => openPeerTab(room)}
            className="flex items-center gap-1.5 rounded-[10px] bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper hover:bg-ink-2"
          >
            <SquareArrowOutUpRight aria-hidden className="size-3.5" />
            Open Tab {next}
          </button>
          <a
            href={SPLIT_HREF}
            className="flex items-center gap-1.5 rounded-[10px] border border-line-2 px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-panel-2"
          >
            <Columns2 aria-hidden className="size-3.5" />
            Try split view
          </a>
        </div>
      </motion.section>
    </div>
  );
}

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[12.5px] leading-snug text-ink-2">
      <span
        aria-hidden
        className={clsx(
          "mt-px grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10.5px] font-semibold",
          done ? "bg-ok text-paper" : "border border-line-2 text-ink-2",
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : n}
      </span>
      <span className={clsx(done && "text-muted line-through decoration-line-2")}>
        <span className="sr-only">{done ? "Done: " : `Step ${n}: `}</span>
        {children}
      </span>
    </li>
  );
}
