/**
 * Contract between the UI and the runtime (replica + sync + persistence).
 * The UI never talks to transports or the replica's mutating API directly: all edits go
 * through `WhiteboardSessionApi` so new ops are broadcast and flagged offline correctly.
 */
import type {
  Op,
  OpId,
  ReplicaId,
  ReplicaReadApi,
  ShapeId,
  ShapeView,
  TransactOptions,
  TxnId,
  Tx,
  UndoResult,
  VectorClock,
} from "../crdt/types";
import type { LinkTransport, NetworkConditions, PresenceState, Transport } from "../sync/protocol";

/** online = heard recently; idle = tab hidden (throttled); unreachable = silent, no bye; left = said bye. */
export type PeerStatus = "online" | "idle" | "unreachable" | "left";

export interface PeerInfo {
  replica: ReplicaId;
  label: string;
  color: string;
  status: PeerStatus;
  lastSeen: number;
  vc: VectorClock;
  stateHash: string;
  transport: LinkTransport;
  transportError?: string;
  /** Same vc and same state hash as us. */
  converged: boolean;
  /** Same vc but different hash — should never happen; shown as an alarm. */
  diverged: boolean;
  /** Local ops this peer (per its last known vc) hasn't seen. */
  unseenByPeer: number;
  presence: PresenceState | null;
}

export interface MergeChange {
  shapeId: ShapeId;
  before: ShapeView | null;
  after: ShapeView | null;
}

export interface MergeReport {
  id: string;
  at: number;
  /** 'rejoined' = we came back online; 'peer-returned' = an unreachable peer came back. */
  direction: "rejoined" | "peer-returned" | "joined";
  peers: ReplicaId[];
  vcBefore: VectorClock;
  vcAfter: VectorClock;
  receivedOpIds: OpId[];
  /** Local ops the peers hadn't seen, delivered in this window. */
  sentCount: number;
  changed: MergeChange[];
  newConflicts: string[];
  resurrected: ShapeId[];
  /** How long we (or the peer) were apart. */
  apartMs: number;
}

export type SessionEvent =
  | { type: "merge"; report: MergeReport }
  | { type: "undo"; result: UndoResult; redo: boolean }
  | { type: "fork"; from: ReplicaId; to: ReplicaId; reason: string }
  | { type: "peer-joined"; replica: ReplicaId }
  | { type: "peer-left"; replica: ReplicaId }
  | { type: "storage-error"; message: string }
  | { type: "info"; message: string };

export interface SessionState {
  /** False until identity (Web Locks lease) and label are settled. Don't author ops before. */
  ready: boolean;
  room: string;
  pane: string;
  replica: ReplicaId;
  label: string;
  color: string;
  forkedFrom: ReplicaId | null;
  network: NetworkConditions;
  rtcEnabled: boolean;
  peers: PeerInfo[];
  /** Wall time we went offline, or null. */
  offlineSince: number | null;
  /** Local ops not covered by the last known vc of every replica ever seen. */
  unsyncedLocalOps: number;
  /** Covered by every known replica's last vc (stable = safe everywhere). */
  stableVc: VectorClock;
  lastMerge: MergeReport | null;
  mergeHistory: MergeReport[];
  traffic: { sent: number; received: number; dropped: number };
  storage: { bytes: number; error: string | null };
}

export interface WhiteboardSessionApi {
  readonly replica: ReplicaReadApi;

  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  onEvent(handler: (e: SessionEvent) => void): () => void;

  /* network */
  setOnline(online: boolean): void;
  setConditions(patch: Partial<NetworkConditions>): void;
  setRtcEnabled(enabled: boolean): void;
  /** Immediately send hello/heartbeat and run an anti-entropy round. */
  syncNow(): void;
  /** Resolves once every live peer has our vc and hash (or rejects on timeout). */
  whenConverged(timeoutMs?: number): Promise<void>;

  /* edits (broadcast automatically; no-ops returning null/empty before ready) */
  transact(build: (tx: Tx) => void, opts?: TransactOptions): { txn: TxnId; ops: Op[] };
  undo(): UndoResult | null;
  redo(): UndoResult | null;
  markSnapshot(name: string): Op | null;
  restoreSnapshot(snapshotId: string): { txn: TxnId; ops: Op[] } | null;
  adoptConflictValue(conflictId: string, opId: OpId): { txn: TxnId; ops: Op[] } | null;

  /* presence (throttled internally) */
  updatePresence(patch: Partial<Omit<PresenceState, "label" | "color">>): void;
  /** Remote presence lives in its own store (30 Hz) so the shape layer doesn't re-render. */
  getPresence(): ReadonlyMap<ReplicaId, PresenceState>;
  subscribePresence(listener: () => void): () => void;

  /** Wipe this tab's local state for the room and reload into a fresh room. */
  resetRoom(): string;
  /** Start transports/timers/lease. Constructors are side-effect free. */
  start(): void;
  dispose(): void;
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SessionOptions {
  room: string;
  /** Storage namespace within the tab: 'main' for a normal tab, 'A'/'B' for /split panes. */
  pane?: string;
  /** Force a display label (used by /split panes). */
  label?: string;
  /** Ignore persisted state (new tab opened via "Open Tab B"). */
  fresh?: boolean;
  /** Injection points (tests). */
  replicaId?: string;
  transport?: Transport;
  storage?: StorageLike | null;
  now?: () => number;
  random?: () => number;
  timers?: TimerApi;
  conditions?: Partial<NetworkConditions>;
  heartbeatMs?: number;
  /** Skip the Web Locks identity lease (tests / insecure contexts fall back to nonce check). */
  useLocks?: boolean;
}
