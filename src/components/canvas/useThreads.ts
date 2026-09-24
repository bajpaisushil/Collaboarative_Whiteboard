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
    // Built once per directory change; lookups never allocate, so memoised consumers get
    // the same Thread object for the same replica on every render.
    const byReplica = new Map<ReplicaId, Thread>();
    for (const part of sig.split(";")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const id = part.slice(0, eq);
      byReplica.set(id, makeThread(part.slice(eq + 1), false));
    }
    byReplica.set(self, makeThread(selfLabel, true));
    const unknown = makeThread("?", false);
    return (replica: ReplicaId) => byReplica.get(replica) ?? unknown;
  }, [sig, self, selfLabel]);
}

function makeThread(label: string, self: boolean): Thread {
  return { label, color: threadColor(label), dash: threadDash(label), self };
}

export function useColorOf(): (replica: ReplicaId) => string {
  const threads = useThreads();
  return useMemo(() => (r: ReplicaId) => threads(r).color, [threads]);
}

/** The local replica's thread (selection chrome, carets, handles). */
export function useSelfThread(): Thread {
  const label = useSessionState((s) => s.label);
  return useMemo(() => makeThread(label, true), [label]);
}
