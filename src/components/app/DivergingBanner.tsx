"use client";
/**
 * "Offline — diverging" banner shown under the top bar while this tab is unplugged, plus a
 * polite live region that announces every plug/unplug (including via hotkey).
 */
import { Plug, Unplug } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSession, useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { formatDuration, plural } from "./format";
import { selectLabel, selectOfflineSince, selectOnline, selectUnsynced } from "./selectors";
import { useNow } from "./useNow";

export function DivergingBanner() {
  const online = useSessionState(selectOnline);
  const reduce = useReducedMotion();
  return (
    <>
      <p className="sr-only" aria-live="polite">
        {online
          ? "Online. Tabs are linked and edits sync."
          : "Offline. Edits keep working in this tab and will merge when you reconnect."}
      </p>
      <AnimatePresence initial={false}>
        {!online && (
          <motion.div
            key="diverging"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto"
          >
            <BannerBody />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function BannerBody() {
  const session = useSession();
  const label = useSessionState(selectLabel);
  const unsynced = useSessionState(selectUnsynced);
  const since = useSessionState(selectOfflineSince);
  const now = useNow(since !== null);
  const color = threadColor(label);
  const elapsed = since !== null && now > 0 ? formatDuration(now - since) : null;
  return (
    <div
      className="flex max-w-full items-stretch overflow-hidden rounded-full border bg-panel text-[12.5px] shadow-sheet"
      style={{ borderColor: `color-mix(in oklab, ${color} 55%, var(--line))` }}
    >
      <span aria-hidden className="hatch hatch-animate w-5 shrink-0" style={{ color }} />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 pl-2.5 pr-2">
        <Unplug aria-hidden className="size-3.5 shrink-0" style={{ color }} strokeWidth={2} />
        <span className="font-semibold text-ink">Offline — diverging</span>
        <Dot />
        <span className="text-ink-2">
          you: <span className="font-mono font-medium tabular-nums text-ink">+{unsynced}</span> {unsynced === 1 ? "edit" : "edits"}
        </span>
        <Dot />
        <span className="text-ink-2">others: unknown until you reconnect</span>
        {elapsed && (
          <span className="font-mono text-[11px] tabular-nums text-muted" title={`Offline for ${elapsed}`}>
            · {elapsed}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => session.setOnline(true)}
        className="m-1 flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-semibold text-paper hover:bg-ink-2"
        title={`Plug back in and merge ${plural(unsynced, "edit")} (\\)`}
      >
        <Plug aria-hidden className="size-3.5" strokeWidth={2} />
        Reconnect
      </button>
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-line-2">
      ·
    </span>
  );
}
