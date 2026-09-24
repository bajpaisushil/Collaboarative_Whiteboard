"use client";
import { useCallback } from "react";
import type { ReplicaId } from "../crdt/types";
import { useReplicaView, useSessionState } from "../session/react";
import { threadColor } from "./colors";

export interface ReplicaDisplay {
  label: string;
  color: string;
  /** True for the local replica. */
  self: boolean;
}

/**
 * Resolve any replica id (even ones no longer online) to its display label + thread colour,
 * using the replica directory derived from the log plus live peers.
 */
export function useReplicaDirectory(): (replica: ReplicaId) => ReplicaDisplay {
  const replicas = useReplicaView((v) => v.replicas);
  const self = useSessionState((s) => s.replica);
  const selfLabel = useSessionState((s) => s.label);
  const peers = useSessionState((s) => s.peers);
  return useCallback(
    (replica: ReplicaId) => {
      if (replica === self) return { label: selfLabel, color: threadColor(selfLabel), self: true };
      const info = replicas.get(replica);
      const peer = peers.find((p) => p.replica === replica);
      const label = info?.label ?? peer?.label ?? "?";
      return { label, color: threadColor(label), self: false };
    },
    [replicas, self, selfLabel, peers],
  );
}
