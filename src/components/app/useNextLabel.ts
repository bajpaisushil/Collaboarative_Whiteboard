"use client";
import { useMemo } from "react";
import type { ReplicaInfo, ReplicaView } from "@/lib/crdt/types";
import { useReplicaView, useSessionState } from "@/lib/session/react";
import { nextFreeLabel, selectLabel, selectPeerLettersKey, selectReplica } from "./selectors";

const selectReplicas = (v: ReplicaView): ReadonlyMap<string, ReplicaInfo> => v.replicas;

/** The letter the next "Open Tab …" will most likely get (for button copy only). */
export function useNextLabel(): string {
  const self = useSessionState(selectLabel);
  const selfReplica = useSessionState(selectReplica);
  const peersKey = useSessionState(selectPeerLettersKey);
  const replicas = useReplicaView(selectReplicas);
  return useMemo(() => {
    const history: string[] = [];
    for (const [id, info] of replicas) if (id !== selfReplica) history.push(info.label);
    return nextFreeLabel(self, peersKey ? peersKey.split(",") : [], history);
  }, [self, selfReplica, peersKey, replicas]);
}
