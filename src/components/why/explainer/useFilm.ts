"use client";
import { useMemo } from "react";
import type { ShapeView, VectorClock } from "@/lib/crdt/types";
import { useSession } from "@/lib/session/react";
import { shapeBounds, unionRects, type Rect } from "@/lib/ui/geometry";
import { useShapeSnapshot } from "../useShapeSnapshot";
import type { ExplainerModel } from "./model";

export interface FilmFrame {
  /** Shape to draw (for a dead frame: the last known look, drawn faded under a tombstone). */
  shape: ShapeView | null;
  dead: boolean;
}

export interface Film {
  before: FilmFrame;
  /** Display order, matching `model.sides`. */
  sides: [FilmFrame, FilmFrame];
  result: FilmFrame;
  /** Shared world rectangle so every frame is shot from the same camera. */
  focus: Rect | null;
}

/**
 * The four frames of a knot: the common past, each side's view right after its edit, and now.
 * Cut states are immutable history, so they're only recomputed when the explanation changes.
 */
export function useFilm(model: ExplainerModel): Film {
  const session = useSession();
  const { explanation, sides } = model;
  const shapeId = explanation.conflict.shapeId;
  const current = useShapeSnapshot(shapeId);

  const past = useMemo(() => {
    const at = (vc: VectorClock) => session.replica.shapesAtCut(vc).find((s) => s.id === shapeId) ?? null;
    return { before: at(explanation.baseCut), left: at(sides[0].side.vc), right: at(sides[1].side.vc) };
  }, [session, shapeId, explanation.baseCut, sides]);

  return useMemo(() => {
    const fallback = past.before ?? current ?? past.left ?? past.right;
    const frame = (s: ShapeView | null): FilmFrame => (s ? { shape: s, dead: false } : { shape: fallback, dead: true });
    const result: FilmFrame = current ? { shape: current, dead: !current.alive } : { shape: fallback, dead: true };
    const shown = [past.before, past.left, past.right, current].filter((s): s is ShapeView => !!s);
    const focus = unionRects(shown.map((s) => shapeBounds(s)));
    return { before: frame(past.before), sides: [frame(past.left), frame(past.right)], result, focus };
  }, [past, current]);
}
