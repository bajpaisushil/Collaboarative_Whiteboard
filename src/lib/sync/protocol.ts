/**
 * Wire protocol between replicas (BroadcastChannel or WebRTC DataChannel).
 * See docs/ARCHITECTURE.md §9. All messages are structured-clone / JSON safe.
 */
import type { Op, Point, ReplicaId, ShapeId, ShapeProps, ShapeType, VectorClock } from "../crdt/types";

export const PROTOCOL_VERSION = 1;

export type LinkTransport = "broadcast" | "webrtc";

interface Envelope {
  v: typeof PROTOCOL_VERSION;
  from: ReplicaId;
  /** Random per tab *instance* (document); detects duplicated tabs sharing a replica id. */
  nonce: string;
  /** Unicast target; absent = broadcast to every peer in the room. */
  to?: ReplicaId;
}

export interface HelloMsg extends Envelope {
  t: "hello";
  label: string;
  vc: VectorClock;
  stateHash: string;
  /** Ask peers to answer with their own hello (true on start / reconnect / tab visible). */
  wantReply: boolean;
  rtc: boolean;
  visible: boolean;
}

export interface OpsMsg extends Envelope {
  t: "ops";
  ops: Op[];
  /** 'live' for fresh local ops, 'catchup' for anti-entropy repair. */
  reason: "live" | "catchup";
}

export interface SyncReqMsg extends Envelope {
  t: "sync-req";
  vc: VectorClock;
}

export interface HeartbeatMsg extends Envelope {
  t: "heartbeat";
  label: string;
  vc: VectorClock;
  stateHash: string;
  rtc: boolean;
  /** Hidden tabs are throttled by the browser: show them as idle, not gone. */
  visible: boolean;
}

export interface PresenceDrawing {
  tool: ShapeType;
  /** World coordinates. */
  points: Point[];
  stroke: string;
  fill: string;
  strokeWidth: number;
}

export interface PresenceState {
  label: string;
  color: string;
  /** World coordinates; null when the pointer left the canvas. */
  cursor: { x: number; y: number } | null;
  drawing: PresenceDrawing | null;
  /** Live preview of an in-progress move/resize/restyle (committed as one txn on pointerup). */
  preview: { shapeId: ShapeId; props: Partial<ShapeProps> }[] | null;
  selection: ShapeId[];
  editingText: ShapeId | null;
}

export interface PresenceMsg extends Envelope {
  t: "presence";
  /** Monotonic per sender; receivers drop anything older than the last seen seq. */
  seq: number;
  state: PresenceState;
}

export interface ByeMsg extends Envelope {
  t: "bye";
}

export interface RtcSignalMsg extends Envelope {
  t: "rtc-signal";
  to: ReplicaId;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
}

export type SyncMessage =
  | HelloMsg
  | OpsMsg
  | SyncReqMsg
  | HeartbeatMsg
  | PresenceMsg
  | ByeMsg
  | RtcSignalMsg;

export type SyncMessageType = SyncMessage["t"];

/** Minimal transport surface. Implementations: BroadcastTransport, MemoryTransport, RtcMesh. */
export interface Transport {
  readonly kind: LinkTransport | "memory";
  send(msg: SyncMessage): void;
  onMessage(handler: (msg: SyncMessage) => void): () => void;
  close(): void;
}

export interface NetworkConditions {
  online: boolean;
  /** Offset added to this tab's wall clock (shows why wall-clock LWW is unsafe). */
  clockSkewMs: number;
  /** Base one-way latency in ms. */
  latencyMs: number;
  /** Uniform random extra latency 0..jitterMs (causes reordering). */
  jitterMs: number;
  /** 0..1 probability a message is dropped (presence included). */
  dropRate: number;
  /** 0..1 probability a message is delivered twice. */
  duplicateRate: number;
}

export const DEFAULT_CONDITIONS: NetworkConditions = {
  online: true,
  clockSkewMs: 0,
  latencyMs: 0,
  jitterMs: 0,
  dropRate: 0,
  duplicateRate: 0,
};

export const HEARTBEAT_MS = 1500;
export const PEER_STALE_MS = 5000;
export const PEER_GONE_MS = 15000;
export const BUFFER_STUCK_MS = 2000;
