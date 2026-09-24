"use client";
/** "Open Tab B" (spawns another replica of this room) and the split-view link. */
import { Columns2, SquareArrowOutUpRight } from "lucide-react";
import { useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { openPeerTab, SPLIT_HREF } from "../links";
import { selectRoom } from "../selectors";
import { useNextLabel } from "../useNextLabel";

export function TabLinks() {
  const room = useSessionState(selectRoom);
  const next = useNextLabel();
  const color = threadColor(next);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip
        align="end"
        wide
        content={
          <TipBody title={`Open Tab ${next}`}>
            Opens a new browser tab in room <span className="font-mono text-ink">{room}</span>. It becomes Tab {next} — a separate
            person with its own copy of the board. Tabs sync directly inside your browser; there’s no server.
          </TipBody>
        }
      >
        <button
          type="button"
          onClick={() => openPeerTab(room)}
          aria-label={`Open Tab ${next} in a new browser tab`}
          className="flex h-8 items-center gap-1.5 rounded-[10px] border border-line-2 pl-1.5 pr-2.5 text-[12.5px] font-medium text-ink hover:bg-panel-2"
        >
          <span
            aria-hidden
            className="grid size-5 place-items-center rounded-full text-[10.5px] font-semibold"
            style={{ color, boxShadow: `inset 0 0 0 1.5px ${color}` }}
          >
            {next}
          </span>
          <span className="whitespace-nowrap @max-[1380px]:sr-only">Open Tab {next}</span>
          <SquareArrowOutUpRight aria-hidden className="size-3.5 text-muted" />
        </button>
      </Tooltip>
      <a
        href={SPLIT_HREF}
        aria-label="Split view: two tabs side by side"
        title="Split view — two tabs side by side, with scripted conflict scenarios"
        className="flex h-8 items-center gap-1.5 rounded-[10px] px-2 text-[12.5px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink"
      >
        <Columns2 aria-hidden className="size-[17px]" strokeWidth={1.75} />
        <span className="whitespace-nowrap @max-[1500px]:hidden">Split view</span>
      </a>
    </div>
  );
}
