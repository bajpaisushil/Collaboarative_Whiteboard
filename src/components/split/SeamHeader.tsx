"use client";
/**
 * "Director's view — the tabs can't see this": one monitor per tab (fingerprint of its
 * document, edits the other tab hasn't seen, its cable) and, between them, whether the two
 * documents are identical right now.
 */
import clsx from "clsx";
import { ArrowLeft, Plug, Unplug, X } from "lucide-react";
import Link from "next/link";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { threadColor } from "@/lib/ui/colors";
import { FingerprintGlyph } from "@/components/ui/FingerprintGlyph";
import { IconButton } from "@/components/ui/IconButton";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { ThreadMark } from "@/components/ui/ThreadMark";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { selectOnline, selectPendingCount, selectStateHash, selectUnsynced, useSessionSelect, useViewSelect } from "./hooks";
import type { PaneId, Stage } from "./stage";

export function SeamHeader({ stage, onClose }: { stage: Stage; onClose?: () => void }) {
  const a = stage.panes.A.session;
  const b = stage.panes.B.session;
  const hashA = useViewSelect(a, selectStateHash, "");
  const hashB = useViewSelect(b, selectStateHash, "");
  const pending = useViewSelect(a, selectPendingCount, 0) + useViewSelect(b, selectPendingCount, 0);
  const onlineA = useSessionSelect(a, selectOnline, true);
  const onlineB = useSessionSelect(b, selectOnline, true);
  const unA = useSessionSelect(a, selectUnsynced, 0);
  const unB = useSessionSelect(b, selectUnsynced, 0);
  const identical = hashA !== "" && hashA === hashB && pending === 0;
  const apart = !onlineA || !onlineB;

  return (
    <header className="relative z-10 flex-none border-b border-line bg-panel px-4 pb-3 pt-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">Director’s view</p>
          <p className="font-serif text-[21px] italic leading-[1.05] tracking-tight text-ink">the tabs can’t see this</p>
        </div>
        <Tooltip content={<TipBody title="Back to the board">Leave split view for your normal Weave board.</TipBody>} align="end">
          <Link
            href="/"
            aria-label="Weave — back to the board"
            className="flex h-8 items-center gap-1 rounded-[10px] px-1.5 text-[12px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
            <ThreadMark size={20} />
          </Link>
        </Tooltip>
        {onClose && <IconButton icon={X} label="Close the director’s view" shortcut="Esc" onClick={onClose} />}
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-stretch">
        <Monitor pane="A" session={a} hash={hashA} online={onlineA} unsynced={unA} side="left" />
        <Comparator identical={identical} apart={apart} />
        <Monitor pane="B" session={b} hash={hashB} online={onlineB} unsynced={unB} side="right" />
      </div>

      <p className="mt-2.5 text-center text-[11.5px] text-ink-2">
        {identical ? (
          <>Both tabs hold exactly the same board.</>
        ) : (
          <>
            <span className="font-mono font-semibold tabular-nums" style={{ color: threadColor("A") }}>
              A +{unA}
            </span>
            <span className="mx-1.5 text-muted">·</span>
            <span className="font-mono font-semibold tabular-nums" style={{ color: threadColor("B") }}>
              B +{unB}
            </span>
            <span className="ml-1.5 text-muted">{apart ? "edits the other tab hasn’t seen" : "— catching up"}</span>
          </>
        )}
      </p>
    </header>
  );
}

function Monitor({
  pane,
  session,
  hash,
  online,
  unsynced,
  side,
}: {
  pane: PaneId;
  session: WhiteboardSessionApi;
  hash: string;
  online: boolean;
  unsynced: number;
  side: "left" | "right";
}) {
  const color = threadColor(pane);
  const flip = side === "right";
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-[12px] border bg-panel-2 p-2"
      style={{ borderColor: `color-mix(in oklab, ${color} 38%, var(--line))` }}
    >
      <div className={clsx("flex items-center gap-1.5", flip && "flex-row-reverse")}>
        <ThreadBadge label={pane} size="sm" solid />
        <span className="truncate text-[12.5px] font-semibold tracking-tight" style={{ color }}>
          Tab {pane}
        </span>
      </div>
      <div className={clsx("flex items-center gap-2", flip && "flex-row-reverse")}>
        <FingerprintGlyph hash={hash} size={30} title={`Tab ${pane}’s board fingerprint ${hash.slice(0, 8)} — same picture means same state`} />
        <div className={clsx("min-w-0 leading-none", flip && "text-right")}>
          <p className="font-mono text-[19px] font-semibold tabular-nums" style={{ color: unsynced > 0 ? color : "var(--muted)" }}>
            +{unsynced}
          </p>
          <p className="mt-1 truncate text-[10.5px] text-muted">{unsynced === 1 ? "unsynced edit" : "unsynced edits"}</p>
        </div>
      </div>
      <CableToggle pane={pane} session={session} online={online} />
    </div>
  );
}

function CableToggle({ pane, session, online }: { pane: PaneId; session: WhiteboardSessionApi; online: boolean }) {
  const color = threadColor(pane);
  const Icon = online ? Plug : Unplug;
  const label = online ? `Tab ${pane} is online — pull its cable` : `Tab ${pane} is offline — plug it back in`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      aria-label={label}
      title={label}
      onClick={() => {
        session.setOnline(!online);
        if (!online) session.syncNow();
      }}
      className={clsx(
        "relative flex h-7 items-center justify-center gap-1.5 overflow-hidden rounded-full border text-[12px] font-semibold transition-colors",
        online ? "border-solid text-ok" : "border-dashed",
      )}
      style={
        online
          ? { borderColor: "color-mix(in oklab, var(--ok) 45%, var(--line))", background: "color-mix(in oklab, var(--ok) 9%, var(--panel))" }
          : { borderColor: color, color, background: `color-mix(in oklab, ${color} 7%, var(--panel))` }
      }
    >
      {!online && <span aria-hidden className="hatch absolute inset-0 opacity-[0.18]" style={{ color }} />}
      <Icon aria-hidden className="relative size-3.5" strokeWidth={2} />
      <span className="relative">{online ? "Online" : "Offline"}</span>
    </button>
  );
}

/** Two threads reaching toward each other: joined (identical) or held apart (different). */
function Comparator({ identical, apart }: { identical: boolean; apart: boolean }) {
  const status = identical ? "identical" : "different";
  const detail = identical ? "The two documents are byte-for-byte identical." : apart ? "The tabs have diverged." : "The tabs are exchanging edits.";
  return (
    <div className="flex flex-col items-center justify-center gap-1" role="status" aria-live="polite" aria-label={`${status}. ${detail}`}>
      <svg width="64" height="26" viewBox="0 0 64 26" aria-hidden fill="none">
        <path d={identical ? "M0 13 H32" : "M0 13 H22"} stroke="var(--thread-a)" strokeWidth={2.5} strokeLinecap="round" />
        <path d={identical ? "M64 13 H32" : "M64 13 H42"} stroke="var(--thread-b)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={identical ? undefined : "4 3"} />
        {identical ? (
          <circle cx={32} cy={13} r={5} fill="var(--ok)" stroke="var(--panel)" strokeWidth={2} />
        ) : (
          <text x={32} y={17.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--warn)">
            ≠
          </text>
        )}
      </svg>
      <span
        className={clsx("rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em]", identical ? "text-ok" : "text-warn")}
        style={{ background: `color-mix(in oklab, ${identical ? "var(--ok)" : "var(--warn)"} 12%, transparent)` }}
      >
        {status}
      </span>
      {!identical && !apart && <span className="text-[10px] text-muted">syncing…</span>}
    </div>
  );
}
