"use client";
/**
 * React hooks shared by the Loom components. Selectors are narrow and return values with
 * stable identity so a heartbeat (new session state object) doesn't re-render the loom.
 */
import { useCallback, useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from "react";
import type { Conflict, Op, ReplicaId, ReplicaView, SnapshotInfo, VectorClock } from "@/lib/crdt/types";
import { useReplicaView, useSession, useSessionState } from "@/lib/session/react";
import type { SessionState } from "@/lib/session/types";
import { useUi } from "@/lib/ui/store";
import { createThreadLookup, type ThreadInfo } from "./dom";
import { buildKnots, buildLanes, buildLoomModel, snapshotsByIndex, type KnotIndex, type LaneLayout, type LoomModel } from "./model";

/* ------------------------------------------------------------------ threads */

export type LoomThread = ThreadInfo;

const dirSig = (v: ReplicaView) => {
  let s = "";
  for (const [id, info] of v.replicas) s += `${id}=${info.label};`;
  return s;
};
const selectReplica = (s: SessionState) => s.replica;
const selectLabel = (s: SessionState) => s.label;

/**
 * Replica → thread (label, colour, dash). Only changes when a label changes. Unknown replicas
 * (e.g. authors of ops still waiting in the causal buffer) fall back to the op's author label.
 */
export function useLoomThreads(): (replica: ReplicaId, fallbackLabel?: string) => LoomThread {
  const sig = useReplicaView(dirSig);
  const self = useSessionState(selectReplica);
  const selfLabel = useSessionState(selectLabel);
  return useMemo(() => createThreadLookup(sig, self, selfLabel), [sig, self, selfLabel]);
}

/* ------------------------------------------------------------------ stable identities */

function vcKey(vc: VectorClock): string {
  return Object.keys(vc)
    .filter((k) => vc[k] > 0)
    .sort()
    .map((k) => `${k}=${vc[k]}`)
    .join(";");
}

function parseVcKey(key: string): VectorClock {
  const out: Record<ReplicaId, number> = {};
  for (const part of key.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    out[part.slice(0, eq)] = Number(part.slice(eq + 1));
  }
  return out;
}

const selectStableKey = (s: SessionState) => vcKey(s.stableVc);

/** Causally stable frontier: ops covered by it have been seen by every known tab. */
export function useStableVc(): VectorClock {
  const key = useSessionState(selectStableKey);
  return useMemo(() => parseVcKey(key), [key]);
}

const EMPTY_OPS: readonly Op[] = [];
const EMPTY_SNAPS: readonly SnapshotInfo[] = [];
const selectPendingSig = (v: ReplicaView) => v.pending.map((o) => o.id).join("|");
const selectSnapshotSig = (v: ReplicaView) => v.snapshots.map((s) => s.snapshotId).join("|");

/** Ops waiting in the causal buffer (stable identity while the set doesn't change). */
export function usePendingOps(): readonly Op[] {
  const session = useSession();
  const sig = useReplicaView(selectPendingSig);
  return useMemo(() => (sig ? session.replica.getView().pending : EMPTY_OPS), [session, sig]);
}

/** Named snapshots in canonical order (stable identity while the set doesn't change). */
export function useSnapshots(): readonly SnapshotInfo[] {
  const session = useSession();
  const sig = useReplicaView(selectSnapshotSig);
  return useMemo(() => (sig ? session.replica.getView().snapshots : EMPTY_SNAPS), [session, sig]);
}

/** The focused conflict, re-resolved by lineage key if its id changed under partial delivery. */
export function useFocusedConflict(): Conflict | null {
  const focus = useUi((s) => s.focus);
  const conflicts = useReplicaView((v) => v.conflicts);
  return useMemo(() => {
    if (!focus) return null;
    return conflicts.find((c) => c.id === focus.id) ?? conflicts.find((c) => c.lineageKey === focus.lineageKey) ?? null;
  }, [focus, conflicts]);
}

/* ------------------------------------------------------------------ loom data */

export interface LoomData {
  model: LoomModel;
  lanes: LaneLayout;
  knots: KnotIndex;
  snapshots: readonly SnapshotInfo[];
  snapshotAt: ReadonlyMap<number, SnapshotInfo>;
  pending: readonly Op[];
}

const selectLog = (v: ReplicaView) => v.log;
const selectReplicas = (v: ReplicaView) => v.replicas;
const selectConflicts = (v: ReplicaView) => v.conflicts;

/** Everything the ribbon and the space-time diagram draw, memoised on log identity. */
export function useLoomData(): LoomData {
  const log = useReplicaView(selectLog);
  const replicas = useReplicaView(selectReplicas);
  const conflicts = useReplicaView(selectConflicts);
  const self = useSessionState(selectReplica);
  const selfLabel = useSessionState(selectLabel);
  const pending = usePendingOps();
  const snapshots = useSnapshots();
  const model = useMemo(() => buildLoomModel(log), [log]);
  const lanes = useMemo(() => buildLanes(model, replicas, self, selfLabel, pending), [model, replicas, self, selfLabel, pending]);
  const knots = useMemo(() => buildKnots(conflicts, model.indexOf), [conflicts, model]);
  const snapshotAt = useMemo(() => snapshotsByIndex(snapshots, model.indexOf), [snapshots, model]);
  return useMemo(() => ({ model, lanes, knots, snapshots, snapshotAt, pending }), [model, lanes, knots, snapshots, snapshotAt, pending]);
}

/* ------------------------------------------------------------------ DOM helpers */

export interface Size {
  width: number;
  height: number;
}

/** Observe an element's content box. Returns a callback ref, the element and its size. */
export function useElementSize<T extends Element>(): [(el: T | null) => void, T | null, Size] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      setSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return [ref, el, size];
}

/**
 * Native keydown on an element. Pane shortcuts are native listeners on the pane root, which run
 * before React's delegated handlers — widgets that own keys must stop them at the source.
 * Return true to mark the key handled (preventDefault + stopPropagation).
 */
export function useNativeKeydown(el: HTMLElement | SVGElement | null, handler: (e: KeyboardEvent) => boolean | void): void {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (handler(e) === true) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  useEffect(() => {
    if (!el) return;
    const listener = (e: Event) => onKey(e as KeyboardEvent);
    el.addEventListener("keydown", listener);
    return () => el.removeEventListener("keydown", listener);
  }, [el]);
}

/* ------------------------------------------------------------------ wall clock */

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 15_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const getNow = () => now;
const getServerNow = () => 0;

/** Coarse wall clock (15 s tick) for "3 min ago" labels. */
export function useCoarseNow(): number {
  return useSyncExternalStore(subscribeNow, getNow, getServerNow);
}
