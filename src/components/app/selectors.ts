/**
 * Narrow, module-level selectors for `useSessionState` / `useReplicaView` (stable identity,
 * primitive results where possible) and small pure helpers over session data.
 */
import type { Conflict, ReplicaId, ReplicaView } from "@/lib/crdt/types";
import type { NetworkConditions } from "@/lib/sync/protocol";
import type { PeerInfo, SessionState, WhiteboardSessionApi } from "@/lib/session/types";

export const isLivePeer = (p: PeerInfo): boolean => p.status === "online" || p.status === "idle";

/** A conflict that still shows on the board and actually changed something. */
export const isLiveKnot = (c: Conflict): boolean => c.status === "live" && !c.valuesEqual;

export const selectLabel = (s: SessionState) => s.label;
export const selectRoom = (s: SessionState) => s.room;
export const selectReplica = (s: SessionState) => s.replica;
export const selectForkedFrom = (s: SessionState) => s.forkedFrom;
export const selectOnline = (s: SessionState) => s.network.online;
export const selectNetwork = (s: SessionState) => s.network;
export const selectPeers = (s: SessionState) => s.peers;
export const selectUnsynced = (s: SessionState) => s.unsyncedLocalOps;
export const selectOfflineSince = (s: SessionState) => s.offlineSince;
export const selectRtcEnabled = (s: SessionState) => s.rtcEnabled;
export const selectTraffic = (s: SessionState) => s.traffic;
export const selectReady = (s: SessionState) => s.ready;
export const selectHasLivePeer = (s: SessionState) => s.peers.some(isLivePeer);
export const selectLivePeerCount = (s: SessionState) => {
  let n = 0;
  for (const p of s.peers) if (isLivePeer(p)) n++;
  return n;
};

/** Smallest letter not used by us or any peer that hasn't left — the label a new tab will get. */
export const selectNextLabel = (s: SessionState): string => {
  const used = new Set<string>([s.label.charAt(0).toUpperCase()]);
  for (const p of s.peers) if (p.status !== "left") used.add(p.label.charAt(0).toUpperCase());
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  return "?";
};

export function isChaotic(n: NetworkConditions): boolean {
  return n.latencyMs > 0 || n.jitterMs > 0 || n.dropRate > 0 || n.duplicateRate > 0 || n.clockSkewMs !== 0;
}
export const selectChaotic = (s: SessionState) => isChaotic(s.network);

export const selectLiveKnotCount = (v: ReplicaView): number => {
  let n = 0;
  for (const c of v.conflicts) if (isLiveKnot(c)) n++;
  return n;
};
export const selectBoardEmpty = (v: ReplicaView) => v.shapes.length === 0;
export const selectStateHash = (v: ReplicaView) => v.stateHash;
export const selectLamport = (v: ReplicaView) => v.lamport;
export const selectVc = (v: ReplicaView) => v.vc;
export const selectPendingCount = (v: ReplicaView) => v.pending.length;
export const selectCanUndo = (v: ReplicaView) => v.canUndo;
export const selectCanRedo = (v: ReplicaView) => v.canRedo;
export const selectUndoLabel = (v: ReplicaView) => v.undoLabel;
export const selectRedoLabel = (v: ReplicaView) => v.redoLabel;

/**
 * Display label for any replica id, read imperatively (event handlers): live peers first,
 * then the replica directory derived from the log.
 */
export function labelOf(session: WhiteboardSessionApi, replica: ReplicaId): string {
  const state = session.getState();
  if (replica === state.replica) return state.label;
  const peer = state.peers.find((p) => p.replica === replica);
  if (peer) return peer.label;
  return session.replica.getView().replicas.get(replica)?.label ?? "?";
}

/** Most recent live knot (highest Lamport), or null. */
export function latestLiveKnot(conflicts: readonly Conflict[]): Conflict | null {
  let best: Conflict | null = null;
  for (const c of conflicts) if (isLiveKnot(c) && (!best || c.lamport > best.lamport)) best = c;
  return best;
}
