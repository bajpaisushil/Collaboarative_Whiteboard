"use client";
/**
 * Turns session events into toasts: undo/redo results (with per-property skips), forks,
 * storage errors, info, and peers arriving/leaving. Merge reports get their own card.
 */
import { GitFork, HardDriveDownload, Redo2, Undo2, UserMinus, UserPlus } from "lucide-react";
import type { UndoResult, UndoSkip } from "@/lib/crdt/types";
import { propsNoun } from "@/lib/crdt/describe";
import { useSession, useSessionEvent } from "@/lib/session/react";
import { useToast } from "@/components/ui/Toast";
import { labelOf } from "./selectors";

function skipNoun(prop: UndoSkip["prop"]): string {
  if (prop === "text") return "text";
  if (prop === "shape") return "the shape";
  return propsNoun([prop]);
}

function undoToast(result: UndoResult, redo: boolean) {
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
    tone: skips.length > 0 ? ("warn" as const) : ("neutral" as const),
    icon: redo ? Redo2 : Undo2,
    durationMs: skips.length > 0 ? 7000 : 3200,
  };
}

export function SessionToasts() {
  const session = useSession();
  const toast = useToast();

  useSessionEvent((e) => {
    switch (e.type) {
      case "undo":
        toast.push({ id: "undo", ...undoToast(e.result, e.redo) });
        return;
      case "fork": {
        const label = session.getState().label;
        toast.push({
          title: `This tab was a copy of another tab, so it became Tab ${label}`,
          detail: "Duplicated tabs share history but never share an identity — both copies keep working.",
          icon: GitFork,
          durationMs: 9000,
        });
        return;
      }
      case "storage-error":
        toast.push({
          id: "storage-error",
          title: "Couldn’t save this tab’s history",
          detail: `${e.message.trim().replace(/[.!]?$/, ".")} Edits still sync to other tabs, but a reload may lose unsynced ones.`,
          tone: "error",
          icon: HardDriveDownload,
          durationMs: 0,
        });
        return;
      case "info":
        toast.push({ title: e.message });
        return;
      case "peer-joined":
        toast.push({
          id: `peer-${e.replica}`,
          title: `Tab ${labelOf(session, e.replica)} joined`,
          icon: UserPlus,
          tone: "ok",
          durationMs: 3500,
        });
        return;
      case "peer-left":
        toast.push({
          id: `peer-${e.replica}`,
          title: `Tab ${labelOf(session, e.replica)} left`,
          detail: "Its edits stay in the history.",
          icon: UserMinus,
          durationMs: 3500,
        });
        return;
      case "merge":
        return;
    }
  });

  return null;
}
