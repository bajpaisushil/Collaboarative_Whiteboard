/**
 * Board edit commands. Each is exactly one session transaction (one undo step, one label).
 * Shared by the gesture controller, keyboard shortcuts and the tool dock.
 */
import type { ShapeId, ShapeProps, ShapeView } from "@/lib/crdt/types";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import type { StoreApi } from "zustand";
import type { UiStore } from "@/lib/ui/store";
import { countNoun, FILLABLE, maxZ, minZ, propsOf, round2, STROKED, WIDTHED } from "./shapeUtils";

export function selectedShapes(session: WhiteboardSessionApi, ids: readonly ShapeId[]): ShapeView[] {
  const byId = session.replica.getView().shapeById;
  const out: ShapeView[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) out.push(s);
  }
  return out;
}

/** Selected shapes in render order (back to front). */
function inRenderOrder(session: WhiteboardSessionApi, ids: readonly ShapeId[]): ShapeView[] {
  const set = new Set(ids);
  return session.replica.getView().shapes.filter((s) => set.has(s.id));
}

export function deleteShapes(session: WhiteboardSessionApi, ids: readonly ShapeId[], verb: "Delete" | "Erase" = "Delete"): number {
  const shapes = selectedShapes(session, ids);
  if (shapes.length === 0) return 0;
  session.transact(
    (tx) => {
      for (const s of shapes) tx.delete(s.id);
    },
    { label: `${verb} ${countNoun(shapes)}` },
  );
  return shapes.length;
}

export function moveShapes(session: WhiteboardSessionApi, moves: ReadonlyMap<ShapeId, { x: number; y: number }>, verb = "Move"): void {
  const shapes = selectedShapes(session, [...moves.keys()]);
  const changed = shapes.filter((s) => {
    const m = moves.get(s.id)!;
    return round2(m.x) !== round2(s.x) || round2(m.y) !== round2(s.y);
  });
  if (changed.length === 0) return;
  session.transact(
    (tx) => {
      for (const s of changed) {
        const m = moves.get(s.id)!;
        tx.update(s.id, { x: round2(m.x), y: round2(m.y) });
      }
    },
    { label: `${verb} ${countNoun(changed)}` },
  );
}

export function nudgeShapes(session: WhiteboardSessionApi, ids: readonly ShapeId[], dx: number, dy: number): void {
  const moves = new Map<ShapeId, { x: number; y: number }>();
  for (const s of selectedShapes(session, ids)) moves.set(s.id, { x: s.x + dx, y: s.y + dy });
  moveShapes(session, moves, "Nudge");
}

export function duplicateShapes(session: WhiteboardSessionApi, ids: readonly ShapeId[], offset = 16): ShapeId[] {
  const shapes = inRenderOrder(session, ids);
  if (shapes.length === 0) return [];
  const top = maxZ(session.replica.getView().shapes);
  const created: ShapeId[] = [];
  session.transact(
    (tx) => {
      shapes.forEach((s, i) => {
        const props: ShapeProps = { ...propsOf(s), x: s.x + offset, y: s.y + offset, z: top + 1 + i };
        created.push(tx.create({ type: s.type, props, text: s.text || undefined }));
      });
    },
    { label: `Duplicate ${countNoun(shapes)}` },
  );
  return created;
}

export function reorderShapes(session: WhiteboardSessionApi, ids: readonly ShapeId[], where: "front" | "back"): void {
  const shapes = inRenderOrder(session, ids);
  if (shapes.length === 0) return;
  const all = session.replica.getView().shapes;
  const n = shapes.length;
  // Already there? (the selection is exactly the top / bottom of the stack)
  const edge = where === "front" ? all.slice(all.length - n) : all.slice(0, n);
  if (edge.every((s, i) => s.id === shapes[i].id)) return;
  const base = where === "front" ? maxZ(all) + 1 : minZ(all) - n;
  session.transact(
    (tx) => {
      shapes.forEach((s, i) => tx.update(s.id, { z: base + i }));
    },
    { label: `${where === "front" ? "Bring" : "Send"} ${countNoun(shapes)} to ${where === "front" ? "front" : "back"}` },
  );
}

export type StyleTarget = { kind: "stroke"; value: string } | { kind: "fill"; value: string } | { kind: "strokeWidth"; value: number };

/** Which selected shapes a style change applies to, with only the ones that would change. */
export function styleTargets(shapes: readonly ShapeView[], t: StyleTarget): ShapeView[] {
  switch (t.kind) {
    case "stroke":
      return shapes.filter((s) => STROKED.has(s.type) && s.stroke.toLowerCase() !== t.value.toLowerCase());
    case "fill":
      // A sticky note always has paper: "no fill" leaves stickies alone.
      return shapes.filter((s) => FILLABLE.has(s.type) && !(s.type === "sticky" && t.value === "none") && s.fill.toLowerCase() !== t.value.toLowerCase());
    case "strokeWidth":
      return shapes.filter((s) => WIDTHED.has(s.type) && s.strokeWidth !== t.value);
  }
}

/** Apply a style to the selection (one txn) and remember it as the tool style. */
export function applyStyle(session: WhiteboardSessionApi, ui: StoreApi<UiStore>, t: StyleTarget): number {
  ui.getState().setStyle({ [t.kind]: t.value } as Partial<UiStore["style"]>);
  const shapes = styleTargets(selectedShapes(session, ui.getState().selection), t);
  if (shapes.length === 0) return 0;
  const verb = t.kind === "strokeWidth" ? "Restyle" : "Recolour";
  session.transact(
    (tx) => {
      for (const s of shapes) tx.update(s.id, { [t.kind]: t.value } as Partial<ShapeProps>);
    },
    { label: `${verb} ${countNoun(shapes)}` },
  );
  return shapes.length;
}
