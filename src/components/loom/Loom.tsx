"use client";
/**
 * The Loom — history along the bottom of the board.
 *
 * Collapsed (default in Draw mode): a slim ribbon where every tab is a braided thread and every
 * edit a tick; drag it to time-travel. Expanded (toggle, or automatically in X-ray mode): the
 * ribbon becomes a minimap above a space-time diagram (one lane per tab, curved threads for
 * "had already seen", knots, snapshot flags) — or the operation log as a table.
 */
import clsx from "clsx";
import { ChevronDown, ChevronUp, Hourglass, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ReplicaView } from "@/lib/crdt/types";
import { useReplicaView } from "@/lib/session/react";
import { usePane } from "@/lib/ui/pane";
import { useUi, useUiStore, type ViewMode } from "@/lib/ui/store";
import { IconButton } from "@/components/ui/IconButton";
import { plural } from "./format";
import { useLoomData } from "./hooks";
import { LoomHoverProvider } from "./hover";
import { LoomLegend } from "./Legend";
import { LogTable } from "./LogTable";
import { OpHoverCard } from "./OpCard";
import { Ribbon, type RibbonViewport } from "./Ribbon";
import { ScrubAnnouncer } from "./ScrubAnnouncer";
import { SpaceTime } from "./SpaceTime";
import { useScrubKeys } from "./useScrubKeys";

type LoomView = "threads" | "table";

const BODY_H: Record<LoomView, number> = { threads: 184, table: 236 };
const BODY_H_COMPACT: Record<LoomView, number> = { threads: 156, table: 196 };

const selectLogLength = (v: ReplicaView) => v.log.length;

export function Loom() {
  const rootRef = useRef<HTMLElement | null>(null);
  const mode = useUi((s) => s.mode);
  const { compact } = usePane();
  // A manual toggle holds until the view mode changes; then X-ray expands / Draw collapses again.
  const [pref, setPref] = useState<{ mode: ViewMode; expanded: boolean } | null>(null);
  const expanded = pref && pref.mode === mode ? pref.expanded : mode === "xray";
  const [view, setView] = useState<LoomView>("threads");
  const [viewport, setViewport] = useState<RibbonViewport | null>(null);
  const data = useLoomData();
  useScrubKeys(data.model);

  const bodyH = (compact ? BODY_H_COMPACT : BODY_H)[view];

  return (
    <LoomHoverProvider rootRef={rootRef}>
      <section
        ref={rootRef}
        aria-label="Loom: edit history and time travel"
        data-loom
        className={clsx("sheet relative", compact ? "mx-2 mb-2" : "mx-[10px] mb-[10px]")}
      >
        <div className="flex h-[40px] items-center gap-1.5 pl-1.5 pr-2">
          <IconButton
            icon={expanded ? ChevronDown : ChevronUp}
            size="sm"
            label={expanded ? "Collapse the loom" : "Expand the loom — threads, causality and the op log"}
            aria-expanded={expanded}
            onClick={() => setPref({ mode, expanded: !expanded })}
          />
          <span aria-hidden className="hidden select-none pr-1 font-serif text-[16px] italic leading-none text-ink-2 sm:inline">
            Loom
          </span>
          <div className="min-w-0 flex-1">
            <Ribbon data={data} viewport={expanded && view === "threads" ? viewport : null} />
          </div>
          <LoomStatus pending={data.pending.length} />
          {expanded && (
            <>
              <div role="group" aria-label="Loom view" className="ml-1 flex items-center rounded-[9px] border border-line p-0.5">
                {(["threads", "table"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    title={v === "threads" ? "Space-time diagram: who had seen what" : "Every operation as a row"}
                    className={clsx(
                      "h-6 rounded-[7px] px-2 text-[11.5px] font-medium transition-colors",
                      view === v ? "bg-ink text-paper" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    {v === "threads" ? "Threads" : "Table"}
                  </button>
                ))}
              </div>
              <LoomLegend />
            </>
          )}
        </div>

        {expanded && (
          <div className="overflow-hidden rounded-b-[14px] border-t border-line" style={{ height: bodyH }}>
            {view === "threads" ? <SpaceTime data={data} height={bodyH} onViewport={setViewport} /> : <LogTable />}
          </div>
        )}

        <OpHoverCard />
        <ScrubAnnouncer data={data} />
      </section>
    </LoomHoverProvider>
  );
}

function LoomStatus({ pending }: { pending: number }) {
  const store = useUiStore();
  const scrubbing = useUi((s) => s.scrub !== null);
  const count = useReplicaView(selectLogLength);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {pending > 0 && (
        <span
          title="Edits that arrived before the edits they depend on. Weave applies them automatically as soon as the missing ones arrive."
          className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-line-2 px-2 text-[11px] text-ink-2"
        >
          <Hourglass aria-hidden className="size-3 text-warn" strokeWidth={2} />
          {pending} waiting
        </span>
      )}
      {scrubbing ? (
        <button
          type="button"
          onClick={() => store.getState().set({ scrub: null })}
          title="Return to live (Esc)"
          className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--focus)] px-2.5 text-[11.5px] font-semibold text-[var(--panel)] hover:brightness-110"
        >
          <Undo2 aria-hidden className="size-3" strokeWidth={2.4} />
          Live
        </button>
      ) : (
        <span className="hidden items-center gap-1.5 text-[11px] tabular-nums text-muted md:inline-flex" title="The board is live — you're seeing every edit this tab has">
          <span aria-hidden className="size-1.5 rounded-full bg-ok" />
          {plural(count, "edit")}
        </span>
      )}
    </div>
  );
}
