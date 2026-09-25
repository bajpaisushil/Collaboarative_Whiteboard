"use client";
/**
 * View-model for one explanation: sides in display order (by letter, so A sits left/top and
 * faces pane A in /split), each side's thread and role, plus the explainer-wide context.
 */
import { createContext, useContext } from "react";
import { shapeNoun } from "@/lib/crdt/describe";
import { canonicalJson } from "@/lib/crdt/hash";
import type { Conflict, ExplainSide, Explanation, OpId, PropKey, ShapeProps, ShapeView } from "@/lib/crdt/types";
import type { Thread, ThreadOf } from "../threads";

export type WhyVariant = "panel" | "seam";

export type SideRole = "winner" | "loser" | "edit" | "delete" | "first" | "second";

export interface DisplaySide {
  side: ExplainSide;
  thread: Thread;
  role: SideRole;
  /** Position in `explanation.sides` (vcProof `a` = 0, `b` = 1). */
  engineIndex: 0 | 1;
}

export interface ExplainerModel {
  explanation: Explanation;
  conflict: Conflict;
  noun: string;
  /** Display order: [left/top, right/bottom], sorted by label. */
  sides: [DisplaySide, DisplaySide];
  /** The side whose value prevailed (writes: winner; delete-vs-edit: the edit; text: the one placed first). */
  lead: DisplaySide;
  /** True when one value replaced the other (not text, which keeps both). */
  hasLoser: boolean;
  threadOf: ThreadOf;
}

export function roleOf(explanation: Explanation, side: ExplainSide, index: number): SideRole {
  switch (explanation.conflict.kind) {
    case "concurrent-write":
      return side.opId === explanation.outcome.winner ? "winner" : "loser";
    case "delete-vs-edit":
      return side.kind === "shape.delete" ? "delete" : "edit";
    case "concurrent-text":
      return index === 0 ? "first" : "second";
  }
}

export function buildModel(explanation: Explanation, threadOf: ThreadOf): ExplainerModel | null {
  const raw = explanation.sides;
  if (raw.length < 2) return null;
  const all: DisplaySide[] = raw.slice(0, 2).map((side, i) => ({
    side,
    thread: threadOf(side.replica),
    role: roleOf(explanation, side, i),
    engineIndex: i as 0 | 1,
  }));
  const sorted = [...all].sort((a, b) => a.thread.label.localeCompare(b.thread.label) || a.engineIndex - b.engineIndex) as [DisplaySide, DisplaySide];
  const lead = all.find((s) => s.role === "winner" || s.role === "edit" || s.role === "first") ?? all[0];
  return {
    explanation,
    conflict: explanation.conflict,
    noun: shapeNoun(explanation.conflict.shapeType),
    sides: sorted,
    lead,
    hasLoser: explanation.conflict.kind !== "concurrent-text",
    threadOf,
  };
}

export function other(model: ExplainerModel, s: DisplaySide): DisplaySide {
  return model.sides[0] === s ? model.sides[1] : model.sides[0];
}

export function sideByOp(model: ExplainerModel, opId: OpId): DisplaySide | undefined {
  return model.sides.find((s) => s.side.opId === opId);
}

/** Does the shape currently hold every value this side wrote (for the knot's props)? */
export function sameValues(wrote: Partial<ShapeProps>, shape: ShapeView, props: readonly PropKey[]): boolean {
  for (const p of props) {
    const v = (wrote as Partial<Record<PropKey, unknown>>)[p];
    if (v === undefined) continue;
    if (canonicalJson(v) !== canonicalJson((shape as unknown as Record<PropKey, unknown>)[p])) return false;
  }
  return true;
}

/**
 * A write knot that was settled later (picked by hand, undone, overwritten): the side whose
 * value is on the board now, or null if neither is (someone wrote a third value) — or if the
 * knot is still live, where the merge's winner is on the board by definition.
 */
export function sideOnBoardAfter(model: ExplainerModel, shape: ShapeView | null): DisplaySide | null {
  if (model.conflict.status !== "superseded" || model.conflict.kind !== "concurrent-write" || !shape || !shape.alive) return null;
  return model.sides.find((d) => !!d.side.wrote && sameValues(d.side.wrote, shape, model.conflict.props)) ?? null;
}

/** Short outcome word for a side. */
export function roleWord(role: SideRole): string {
  switch (role) {
    case "winner":
      return "won";
    case "loser":
      return "kept in history";
    case "edit":
      return "kept it alive";
    case "delete":
      return "overridden";
    case "first":
      return "goes first";
    case "second":
      return "goes second";
  }
}

export const ExplainerContext = createContext<ExplainerModel | null>(null);

export function useExplainer(): ExplainerModel {
  const m = useContext(ExplainerContext);
  if (!m) throw new Error("useExplainer must be used inside <Explainer>");
  return m;
}
