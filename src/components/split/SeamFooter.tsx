"use client";
/**
 * Bottom of the desk: how to do the same thing with real browser tabs, and a clean slate.
 */
import { Copy, ExternalLink, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { absoluteBoardUrl, boardUrl, goToFreshRoom } from "./room";

const CONFIRM_MS = 4000;

export function SeamFooter({ room }: { room: string }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  const copy = async () => {
    const url = absoluteBoardUrl(room);
    try {
      await navigator.clipboard.writeText(url);
      toast.push({ id: "split-copy", tone: "ok", title: "Link copied", detail: "Open it in two browser tabs — each becomes its own replica.", durationMs: 3500 });
    } catch {
      toast.push({ id: "split-copy", tone: "warn", title: "Couldn’t copy automatically", detail: url, durationMs: 8000 });
    }
  };

  return (
    <footer className="relative px-4 pt-6">
      <div className="rounded-[14px] border border-dashed border-line-2 bg-panel-2/70 px-3.5 py-3">
        <h2 className="text-[12.5px] font-semibold text-ink">Open these as real tabs</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
          Nothing here is simulated: the two panes are two independent replicas talking over <span className="font-mono text-[11.5px]">BroadcastChannel</span>,
          exactly like browser tabs. Open this room in real tabs and they join as Tab C, D…
        </p>
        <p className="mt-2 truncate rounded-[8px] border border-line bg-panel px-2 py-1 font-mono text-[11px] text-ink-2" title={boardUrl(room)}>
          {boardUrl(room)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <a
            href={boardUrl(room)}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2"
          >
            <ExternalLink aria-hidden className="size-3.5" strokeWidth={2} />
            Open a real tab
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-panel px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2"
          >
            <Copy aria-hidden className="size-3.5" strokeWidth={2} />
            Copy link
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 px-0.5">
        <p className="min-w-0 truncate text-[11px] text-muted">
          room <span className="font-mono text-ink-2">{room}</span>
        </p>
        <button
          type="button"
          onClick={() => (confirming ? goToFreshRoom() : setConfirming(true))}
          aria-live="polite"
          className={
            confirming
              ? "inline-flex shrink-0 items-center gap-1.5 rounded-[9px] bg-knot px-2.5 py-1.5 text-[12px] font-semibold text-paper"
              : "inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink"
          }
        >
          <RotateCcw aria-hidden className="size-3.5" strokeWidth={2} />
          {confirming ? "Click again to start fresh" : "Reset room"}
        </button>
      </div>
    </footer>
  );
}
