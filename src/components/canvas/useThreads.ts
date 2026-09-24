"use client";
/**
 * Stable replica → thread lookups for the canvas. Unlike `useReplicaDirectory` (which also
 * tracks live peers and so changes on every heartbeat), these only change when a label
 * actually changes, so memoised shapes don't re-render in X-ray mode.
 */
import { useMemo } from "react";
import type { ReplicaId } from "@/lib/crdt/types";
import { useReplicaView, useSessionState } from "@/lib/session/react";
import { threadColor, threadDash } from "@/lib/ui/colors";

export interface Thread {
  label: string;
  color: string;
  dash: string;
  self: boolean;
}

function directorySignature(replicas: ReadonlyMap<ReplicaId, { label: string }>): string {
  let s = "";
  for (const [id, info] of replicas) s += `${id}=${info.label};`;
  return s;
}

export function useThreads(): (replica: ReplicaId) => Thread {
  const sig = useReplicaView((v) => directorySignature(v.replicas));
  const self = useSessionState((s) => s.replica);
  const selfLabel = useSessionState((s) => s.label);
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
      const t = { label, color: threadColor(label), dash: threadDash(label), self: isSelf };
      cache.set(replica, t);
      return t;
    };
  }, [sig, self, selfLabel]);
}

export function useColorOf(): (replica: ReplicaId) => string {
  const threads = useThreads();
  return useMemo(() => (r: ReplicaId) => threads(r).color, [threads]);
}

/** The local replica's thread (selection chrome, carets, handles). */
export function useSelfThread(): Thread {
  const label = useSessionState((s) => s.label);
  return useMemo(() => ({ label, color: threadColor(label), dash: threadDash(label), self: true }), [label]);
}
