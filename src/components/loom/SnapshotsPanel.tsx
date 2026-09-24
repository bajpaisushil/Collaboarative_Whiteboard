"use client";
/**
 * Named snapshots: take one (a `snapshot.mark` op every tab receives), then preview it on the
 * canvas (time travel to its causal cut) or restore it (one undoable txn of ordinary edits).
 */
import { Flag } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { ReplicaView } from "@/lib/crdt/types";
import { useReplicaView, useSession, useSessionState } from "@/lib/session/react";
import type { SessionState } from "@/lib/session/types";
import { SnapshotCard } from "./SnapshotCard";
import { useCoarseNow, useLoomThreads, useSnapshots } from "./hooks";

const selectShapes = (v: ReplicaView) => v.shapes;
const selectReady = (s: SessionState) => s.ready;

export function SnapshotsPanel() {
  const session = useSession();
  const snapshots = useSnapshots();
  const shapes = useReplicaView(selectShapes);
  const ready = useSessionState(selectReady);
  const threads = useLoomThreads();
  const now = useCoarseNow();
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const newestFirst = useMemo(() => [...snapshots].reverse(), [snapshots]);
  const placeholder = `Snapshot ${snapshots.length + 1}`;

  const take = (e: FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || placeholder;
    const op = session.markSnapshot(finalName);
    if (op) {
      setName("");
      setStatus(`Took snapshot “${finalName}”. Every tab can now preview or restore it.`);
    } else {
      setStatus("Can’t take a snapshot yet — this tab is still starting up.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={take} className="flex items-center gap-2 px-4 pt-4">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Snapshot name</span>
          <input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={placeholder}
            maxLength={80}
            className="h-9 w-full rounded-[10px] border border-line-2 bg-panel px-3 text-[13px] text-ink placeholder:text-muted focus-visible:border-[var(--focus)]"
          />
        </label>
        <button
          type="submit"
          disabled={!ready}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-ink px-3 text-[12.5px] font-semibold text-paper transition-colors hover:bg-ink-2 disabled:opacity-40"
        >
          <Flag aria-hidden className="size-3.5" strokeWidth={2.2} />
          Take snapshot
        </button>
      </form>
      <p className="px-4 pb-3 pt-2 text-[11.5px] leading-snug text-muted">
        Snapshots are causal cuts — shared with every tab, restored as ordinary (undoable) edits.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {newestFirst.length === 0 ? (
        <EmptySnapshots />
      ) : (
        <ol aria-label="Snapshots, newest first" className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
          {newestFirst.map((snap) => (
            <SnapshotCard
              key={snap.snapshotId}
              snap={snap}
              thread={threads(snap.replica, snap.author)}
              current={shapes}
              offline={!!session.replica.getOp(snap.opId)?.meta.offline}
              now={now}
              onRestored={setStatus}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function EmptySnapshots() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-8 text-center">
      <svg aria-hidden width={120} height={56} viewBox="0 0 120 56" fill="none">
        <path d="M4 40c18-10 30 10 48 0s30-10 64 0" stroke="var(--thread-a)" strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" />
        <path d="M4 46c22-6 34 6 52-2s34-8 60 2" stroke="var(--thread-b)" strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" strokeDasharray="6 3" />
        <line x1={60} y1={42} x2={60} y2={10} stroke="var(--ink-2)" strokeWidth={1.6} strokeLinecap="round" />
        <path d="M60 10l18 6-18 6z" fill="var(--thread-c)" stroke="var(--panel)" strokeWidth={1} strokeLinejoin="round" />
      </svg>
      <p className="font-serif text-[20px] leading-tight text-ink">Plant a flag in the history</p>
      <p className="max-w-[300px] text-[12px] leading-snug text-muted">
        Name a moment — say “Before going offline” — and every tab can preview exactly that board, or restore it later.
      </p>
    </div>
  );
}
