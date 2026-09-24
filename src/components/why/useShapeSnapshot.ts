"use client";
import { useCallback, useMemo } from "react";
import type { ReplicaView, ShapeId, ShapeView } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";

/**
 * The current view of a shape, alive or dead. Alive shapes come straight from the structurally
 * shared view (identity-stable); dead ones are read with `includeDead` when the shape leaves it.
 */
export function useShapeSnapshot(shapeId: ShapeId | null | undefined): ShapeView | null {
  const session = useSession();
  const select = useCallback((v: ReplicaView) => (shapeId ? v.shapeById.get(shapeId) : undefined), [shapeId]);
  const live = useReplicaView(select);
  return useMemo(() => {
    if (live) return live;
    if (!shapeId) return null;
    return session.replica.getShape(shapeId, { includeDead: true });
  }, [live, session, shapeId]);
}
