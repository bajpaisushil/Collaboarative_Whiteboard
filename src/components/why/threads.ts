"use client";
/**
 * Replica → thread lookups for the Why panel. Derived from the replica directory (log) plus
 * our own label only, so it keeps its identity across peer heartbeats and memoised explainer
 * sections don't re-render every 1.5 s.
 */
import { useMemo } from "react";
import type { OpId, ReplicaId, ReplicaView } from "@/lib/crdt/types";
import { useReplicaView, useSessionState } from "@/lib/session/react";
import type { SessionState } from "@/lib/session/types";
import { threadColor, threadDash } from "@/lib/ui/colors";

export interface Thread {
  replica: ReplicaId;
  label: string;
  color: string;
  dash: string;
  self: boolean;
}

export type ThreadOf = (replica: ReplicaId) => Thread;

const directorySignature = (v: ReplicaView): string => {
  let s = "";
  for (const [id, info] of v.replicas) s += `${id}=${info.label};`;
  return s;
};
const selectSelf = (s: SessionState) => s.replica;
const selectSelfLabel = (s: SessionState) => s.label;

/** Thread for a display label (used when only the label is known, e.g. explanation sides). */
export function threadForLabel(label: string, replica: ReplicaId = "", self = false): Thread {
  return { replica, label, color: threadColor(label), dash: threadDash(label), self };
}

export function useThreadOf(): ThreadOf {
  const sig = useReplicaView(directorySignature);
  const self = useSessionState(selectSelf);
  const selfLabel = useSessionState(selectSelfLabel);
  return useMemo(() => {
    const labels = new Map<string, string>();
    for (const part of sig.split(";")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      labels.set(part.slice(0, eq), part.slice(eq + 1));
    }
    const cache = new Map<ReplicaId, Thread>();
    return (replica: ReplicaId) => {
      const hit = cache.get(replica);
      if (hit) return hit;
      const isSelf = replica === self;
      const label = isSelf ? selfLabel : (labels.get(replica) ?? "?");
      const t = threadForLabel(label, replica, isSelf);
      cache.set(replica, t);
      return t;
    };
  }, [sig, self, selfLabel]);
}

/** `${replica}:${counter}` → replica. */
export function replicaOfOp(opId: OpId): ReplicaId {
  const i = opId.lastIndexOf(":");
  return i < 0 ? opId : opId.slice(0, i);
}

/** `${replica}:${counter}` → counter. */
export function counterOfOp(opId: OpId): number {
  const i = opId.lastIndexOf(":");
  return i < 0 ? 0 : Number(opId.slice(i + 1)) || 0;
}
