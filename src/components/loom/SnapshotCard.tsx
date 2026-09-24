"use client";
/** One snapshot in the Snapshots panel: thumbnail, author, age, what changed since, actions. */
import clsx from "clsx";
import { CloudOff, Eye, EyeOff, RotateCcw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { ShapeView, SnapshotInfo } from "@/lib/crdt/types";
import { useSession } from "@/lib/session/react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { ShapesThumb } from "@/components/canvas/ShapeSvg";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { relativeTime } from "./format";
import type { LoomThread } from "./hooks";

export interface SnapshotDiff {
  added: number;
  removed: number;
  changed: number;
}

const PROPS = ["x", "y", "w", "h", "stroke", "fill", "strokeWidth", "opacity", "fontSize", "z"] as const;

function samePoints(a: ShapeView["points"], b: ShapeView["points"]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p[0] !== q[0] || p[1] !== q[1]) return false;
  }
  return true;
}

/** How the board now differs from the snapshot (shape-level counts). */
export function diffShapes(then: readonly ShapeView[], now: readonly ShapeView[]): SnapshotDiff {
  const before = new Map(then.map((s) => [s.id, s] as const));
  let added = 0;
  let changed = 0;
  let kept = 0;
  for (const s of now) {
    const old = before.get(s.id);
    if (!old) {
      added++;
      continue;
    }
    kept++;
    if (old.text !== s.text || !samePoints(old.points, s.points) || PROPS.some((k) => old[k] !== s[k])) changed++;
  }
  return { added, removed: before.size - kept, changed };
}

function DiffLine({ diff }: { diff: SnapshotDiff }) {
  const { added, removed, changed } = diff;
  if (!added && !removed && !changed) return <p className="text-[11px] text-ok">Matches the board right now</p>;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (changed) parts.push(`${changed} changed`);
  return (
    <p className="text-[11px] text-muted" title="Compared with the board right now">
      Since then: <span className="text-ink-2">{parts.join(" · ")}</span>
    </p>
  );
}

export const SnapshotCard = memo(function SnapshotCard({
  snap,
  thread,
  current,
  offline,
  now,
  onRestored,
}: {
  snap: SnapshotInfo;
  thread: LoomThread;
  current: readonly ShapeView[];
  offline: boolean;
  now: number;
  onRestored: (message: string) => void;
}) {
  const session = useSession();
  const store = useUiStore();
  const previewing = useUi((s) => !!s.scrub && s.scrub.cut === snap.cut);
  const [confirming, setConfirming] = useState(false);
  // A snapshot's cut is immutable (its causes always arrive before it), so this never goes stale.
  const shapes = useMemo(() => session.replica.shapesAtCut(snap.cut), [session, snap.cut]);
  const diff = useMemo(() => diffShapes(shapes, current), [shapes, current]);

  const togglePreview = () => store.getState().set({ scrub: previewing ? null : { cut: snap.cut, label: snap.name } });
  const restore = () => {
    setConfirming(false);
    store.getState().set({ scrub: null });
    const res = session.restoreSnapshot(snap.snapshotId);
    onRestored(
      res
        ? `Restored “${snap.name}” with ${res.ops.length} ordinary edit${res.ops.length === 1 ? "" : "s"} — undo brings the board back.`
        : `The board already matches “${snap.name}” — nothing to restore.`,
    );
  };

  return (
    <li
      className={clsx(
        "rounded-[12px] border bg-panel p-2 transition-colors",
        previewing ? "border-[color-mix(in_oklab,var(--focus)_55%,var(--line))] shadow-[0_0_0_3px_color-mix(in_oklab,var(--focus)_14%,transparent)]" : "border-line",
      )}
    >
      <div className="flex gap-3">
        <button
          type="button"
          onClick={togglePreview}
          aria-label={previewing ? `Stop previewing “${snap.name}”` : `Preview “${snap.name}” on the canvas`}
          className="relative shrink-0 overflow-hidden rounded-[8px] border border-line"
        >
          {shapes.length ? (
            <ShapesThumb shapes={shapes} width={104} height={70} padding={18} />
          ) : (
            <span className="grid h-[70px] w-[104px] place-items-center bg-paper text-[10.5px] text-muted">Empty board</span>
          )}
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: thread.color }} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink" title={snap.name}>
            {snap.name}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
            <ThreadBadge label={thread.label} size="xs" />
            <span className="text-ink-2">
              Tab {thread.label}
              {thread.self ? " (you)" : ""}
            </span>
            <span aria-hidden>·</span>
            <time dateTime={new Date(snap.wallTime).toISOString()} title={new Date(snap.wallTime).toLocaleString()}>
              {relativeTime(snap.wallTime, now)}
            </time>
            <span aria-hidden>·</span>
            <span className="font-mono text-[10.5px]" title="Lamport clock of the snapshot">
              L{snap.lamport}
            </span>
            {offline && (
              <span className="inline-flex items-center gap-0.5" title="Taken while that tab was offline">
                <CloudOff aria-hidden className="size-3" strokeWidth={2} /> offline
              </span>
            )}
          </p>
          <div className="mt-1">
            <DiffLine diff={diff} />
          </div>
          {!confirming ? (
            <div className="mt-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={togglePreview}
                aria-pressed={previewing}
                className={clsx(
                  "inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-medium transition-colors",
                  previewing ? "bg-[var(--focus)] text-[var(--panel)]" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                )}
              >
                {previewing ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
                {previewing ? "Stop preview" : "Preview"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-medium text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink"
              >
                <RotateCcw aria-hidden className="size-3.5" />
                Restore…
              </button>
            </div>
          ) : (
            <div role="group" aria-label={`Restore “${snap.name}”?`} className="mt-1.5 rounded-[9px] border border-dashed border-line-2 bg-panel-2 p-2">
              <p className="text-[11.5px] leading-snug text-ink-2">
                Turn the board back into this snapshot? Weave adds ordinary edits, so it merges with others’ changes and{" "}
                <b className="font-semibold text-ink">undo</b> brings it back.
              </p>
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  autoFocus
                  onClick={restore}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-ink px-2.5 text-[12px] font-semibold text-paper hover:bg-ink-2"
                >
                  <RotateCcw aria-hidden className="size-3.5" /> Restore
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="h-7 rounded-[8px] px-2 text-[12px] text-ink-2 hover:bg-panel">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
});
