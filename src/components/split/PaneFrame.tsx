"use client";
/**
 * One stage of the split view: a browser-tab "ear" naming the pane ("Tab A — user 1") in its
 * thread colour, a live status line, and the full compact board below. The board mounts once
 * the pane's session is ready (identity lease + label settled).
 */
import clsx from "clsx";
import type { StoreApi } from "zustand";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { threadColor } from "@/lib/ui/colors";
import type { UiStore } from "@/lib/ui/store";
import { BoardSurface } from "@/components/app/BoardSurface";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { selectOnline, selectReady, selectUnsynced, useSessionSelect } from "./hooks";
import { TwoThreads } from "./SplitSplash";
import type { PaneId } from "./stage";

export const USER_NO: Record<PaneId, number> = { A: 1, B: 2 };

export function PaneFrame({
  pane,
  session,
  store,
  className,
}: {
  pane: PaneId;
  session: WhiteboardSessionApi;
  store: StoreApi<UiStore>;
  className?: string;
}) {
  const ready = useSessionSelect(session, selectReady, false);
  const color = threadColor(pane);
  const edge = `color-mix(in oklab, ${color} 42%, var(--line))`;
  return (
    <section aria-label={`Tab ${pane}, user ${USER_NO[pane]}`} className={clsx("flex min-h-0 min-w-0 flex-col", className)}>
      <div className="flex h-8 shrink-0 items-end gap-2 pl-3 pr-1.5">
        <div
          className="relative z-10 -mb-px flex h-8 items-center gap-1.5 rounded-t-[10px] border border-b-0 bg-paper pl-2 pr-3 text-[12.5px]"
          style={{ borderColor: edge, boxShadow: `inset 0 2.5px 0 ${color}` }}
        >
          <ThreadBadge label={pane} size="xs" solid />
          <span className="font-semibold tracking-tight" style={{ color }}>
            Tab {pane}
          </span>
          <span className="text-muted">— user {USER_NO[pane]}</span>
        </div>
        <PaneStatus pane={pane} session={session} />
      </div>
      <div data-split-pane={pane} className="relative min-h-0 flex-1 overflow-hidden rounded-[14px] border bg-paper shadow-sheet" style={{ borderColor: edge }}>
        {ready ? <BoardSurface session={session} compact uiStore={store} paneId={pane} /> : <PanePlaceholder pane={pane} />}
      </div>
    </section>
  );
}

function PaneStatus({ pane, session }: { pane: PaneId; session: WhiteboardSessionApi }) {
  const online = useSessionSelect(session, selectOnline, true);
  const unsynced = useSessionSelect(session, selectUnsynced, 0);
  const color = threadColor(pane);
  return (
    <p className="mb-1.5 ml-auto flex min-w-0 items-center gap-1.5 truncate text-[11.5px] text-ink-2">
      {online ? (
        <>
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-ok" />
          <span className="font-medium text-ink">online</span>
          <span className="text-muted">· {unsynced > 0 ? `sending ${unsynced}` : "in sync"}</span>
        </>
      ) : (
        <>
          <span aria-hidden className="hatch h-2.5 w-4 shrink-0 rounded-[3px]" style={{ color }} />
          <span className="font-medium" style={{ color }}>
            offline
          </span>
          <span className="font-mono tabular-nums text-muted">· +{unsynced} unsynced</span>
        </>
      )}
    </p>
  );
}

function PanePlaceholder({ pane }: { pane: PaneId }) {
  return (
    <div className="grid h-full place-items-center bg-paper p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <TwoThreads width={120} />
        <p role="status" className="text-[12.5px] text-ink-2">
          Tab {pane} is claiming its identity…
        </p>
      </div>
    </div>
  );
}
