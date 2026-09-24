"use client";
/**
 * Turns session events into toasts: undo/redo results (with per-property skips), forks,
 * storage errors, info, and peers arriving/leaving. Merge reports get their own card.
 *
 * Timing details handled here:
 * - A duplicated tab forks while claiming its identity — before the board (and this
 *   component) mounts — so a fork that already happened is announced on mount.
 * - A new tab says hello before it has picked its letter ("?"), so its "joined" toast waits
 *   until the letter is known.
 */
import { GitFork, HardDriveDownload, Redo2, Undo2, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReplicaId, UndoResult, UndoSkip } from "@/lib/crdt/types";
import { propsNoun } from "@/lib/crdt/describe";
import type { PeerStatus, WhiteboardSessionApi } from "@/lib/session/types";
import { useSession, useSessionEvent } from "@/lib/session/react";
import { useToast, type ToastApi, type ToastOptions } from "@/components/ui/Toast";
import { hasLabel, labelOf } from "./selectors";

/** Give up waiting for a booting peer's letter after this long (it may have crashed). */
const JOIN_LABEL_WAIT_MS = 6000;

/** Sessions whose fork has been announced (survives StrictMode remounts and pane remounts). */
const announcedForks = new WeakSet<WhiteboardSessionApi>();

function skipNoun(prop: UndoSkip["prop"]): string {
  if (prop === "text") return "text";
  if (prop === "shape") return "the shape";
  return propsNoun([prop]);
}

function undoToast(result: UndoResult, redo: boolean): ToastOptions {
  const verb = redo ? "Redid" : "Undid";
  const failVerb = redo ? "redo" : "undo";
  const label = result.label || "last change";
  const seen = new Set<string>();
  const skips: string[] = [];
  for (const s of result.skipped) {
    const line = `Skipped ${skipNoun(s.prop)} — ${s.reason}`;
    if (seen.has(line)) continue;
    seen.add(line);
    skips.push(line);
  }
  const nothingApplied = result.ops.length === 0 && skips.length > 0;
  return {
    id: "undo",
    title: nothingApplied ? `Couldn’t ${failVerb} “${label}”` : `${verb} “${label}”`,
    detail:
      skips.length > 0 ? (
        <ul className="space-y-0.5">
          {skips.slice(0, 4).map((s) => (
            <li key={s}>{s}</li>
          ))}
          {skips.length > 4 && <li className="text-muted">…and {skips.length - 4} more</li>}
        </ul>
      ) : undefined,
    tone: skips.length > 0 ? "warn" : "neutral",
    icon: redo ? Redo2 : Undo2,
    durationMs: skips.length > 0 ? 7000 : 3200,
  };
}

function pushFork(toast: ToastApi, label: string): void {
  toast.push({
    id: "fork",
    title: `This tab was a copy of another tab, so it became Tab ${label}`,
    detail: "Duplicated tabs share their history but never an identity — both copies keep working and sync.",
    icon: GitFork,
    durationMs: 9000,
  });
}

function pushJoined(toast: ToastApi, replica: ReplicaId, label: string): void {
  toast.push({ id: `peer-${replica}`, title: `Tab ${label} joined`, icon: UserPlus, tone: "ok", durationMs: 3500 });
}

/** "Couldn't save this tab's history: quota exceeded" → "Quota exceeded." */
function storageDetail(message: string): string {
  const core = message.replace(/^couldn[’']t save this tab[’']s history:\s*/i, "").trim();
  if (!core) return "The browser refused to store it.";
  const sentence = core.charAt(0).toUpperCase() + core.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export function SessionToasts() {
  const session = useSession();
  const toast = useToast();
  /** Peers that joined before choosing a letter: replica → when we first heard of them. */
  const pendingJoins = useRef(new Map<ReplicaId, number>());

  // A fork that happened before the board mounted (duplicate tab detected at start-up).
  useEffect(() => {
    const st = session.getState();
    if (!st.forkedFrom || announcedForks.has(session)) return;
    announcedForks.add(session);
    pushFork(toast, st.label);
  }, [session, toast]);

  // Watch peers: announce booting peers once their letter is known, and tabs that come back
  // after saying goodbye (a reload sends "bye", then the same replica says hello again —
  // the session doesn't emit "peer-joined" for a peer it already knows).
  useEffect(() => {
    const pending = pendingJoins.current;
    const statuses = new Map<ReplicaId, PeerStatus>();
    for (const p of session.getState().peers) statuses.set(p.replica, p.status);
    return session.subscribe(() => {
      const { peers } = session.getState();
      for (const p of peers) {
        const prev = statuses.get(p.replica);
        statuses.set(p.replica, p.status);
        if (prev === "left" && p.status !== "left" && hasLabel(p) && !pending.has(p.replica)) {
          toast.push({ id: `peer-${p.replica}`, title: `Tab ${p.label} is back`, icon: UserPlus, tone: "ok", durationMs: 3500 });
        }
      }
      if (pending.size === 0) return;
      const now = Date.now();
      for (const [replica, since] of pending) {
        const p = peers.find((x) => x.replica === replica);
        if (!p || p.status === "left") pending.delete(replica);
        else if (hasLabel(p)) {
          pending.delete(replica);
          pushJoined(toast, replica, p.label);
        } else if (now - since > JOIN_LABEL_WAIT_MS) pending.delete(replica);
      }
    });
  }, [session, toast]);

  useSessionEvent((e) => {
    switch (e.type) {
      case "undo":
        toast.push(undoToast(e.result, e.redo));
        return;
      case "fork":
        announcedForks.add(session);
        // The session emits before its state snapshot is rebuilt; read the new letter after.
        queueMicrotask(() => pushFork(toast, session.getState().label));
        return;
      case "storage-error":
        toast.push({
          id: "storage-error",
          title: "Couldn’t save this tab’s history",
          detail: `${storageDetail(e.message)} Edits still sync to other tabs, but a reload may lose the ones nobody else has yet.`,
          tone: "error",
          icon: HardDriveDownload,
          durationMs: 0,
        });
        return;
      case "info":
        toast.push({ title: e.message });
        return;
      case "peer-joined": {
        const label = labelOf(session, e.replica);
        if (label) pushJoined(toast, e.replica, label);
        else pendingJoins.current.set(e.replica, Date.now());
        return;
      }
      case "peer-left": {
        const wasPending = pendingJoins.current.delete(e.replica);
        if (wasPending) return; // never announced as joined; stay quiet
        const label = labelOf(session, e.replica);
        toast.push({
          id: `peer-${e.replica}`,
          title: label ? `Tab ${label} left` : "A tab left",
          detail: "Its edits stay in the history.",
          icon: UserMinus,
          durationMs: 3500,
        });
        return;
      }
      case "merge":
        return;
    }
  });

  return null;
}
