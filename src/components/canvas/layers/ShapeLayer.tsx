"use client";
/**
 * Shape rendering layers. `ShapeLayer` subscribes to `view.shapes` only; each ShapeSvg is
 * memoised on ShapeView identity (views are structurally shared), so an edit to one shape
 * re-renders one shape. Gesture feedback (drag previews, drafts, eraser marks) lives in
 * sibling layers fed by the interaction store.
 */
import { memo, useMemo } from "react";
import type { ShapeView } from "@/lib/crdt/types";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import type { UiState } from "@/lib/ui/store";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { ShapeSvg } from "../ShapeSvg";
import { useInteraction } from "../interaction";
import { withProps } from "../shapeUtils";
import { useColorOf } from "../useThreads";

/** Live board. */
export const ShapeLayer = memo(function ShapeLayer() {
  const shapes = useReplicaView((v) => v.shapes);
  const editing = useUi((s) => s.editingText);
  const xray = useUi((s) => s.mode === "xray");
  const hidden = useInteraction((s) => s.hidden);
  const colorOf = useColorOf();
  return (
    <g data-layer="shapes">
      {shapes.map((s) =>
        hidden.has(s.id) ? null : (
          <ShapeSvg key={s.id} shape={s} authorship={xray} colorOf={xray ? colorOf : undefined} hideText={s.id === editing} muted={xray} />
        ),
      )}
    </g>
  );
});

function shapesAt(session: WhiteboardSessionApi, scrub: NonNullable<UiState["scrub"]>, version: number): ShapeView[] {
  if (version < 0) return [];
  if ("atOpId" in scrub && scrub.atOpId !== undefined) return session.replica.shapesAtOp(scrub.atOpId);
  if (scrub.cut) return session.replica.shapesAtCut(scrub.cut);
  return session.replica.getView().shapes;
}

/** Time travel: shapes materialised at a canonical prefix or causal cut (read-only). */
export const ScrubShapeLayer = memo(function ScrubShapeLayer() {
  const session = useSession();
  const scrub = useUi((s) => s.scrub);
  const version = useReplicaView((v) => v.version);
  const xray = useUi((s) => s.mode === "xray");
  const colorOf = useColorOf();
  const shapes = useMemo(() => (scrub ? shapesAt(session, scrub, version) : []), [session, scrub, version]);
  return (
    <g data-layer="scrub-shapes">
      {shapes.map((s) => (
        <ShapeSvg key={s.id} shape={s} authorship={xray} colorOf={xray ? colorOf : undefined} muted={xray} />
      ))}
    </g>
  );
});

/** Local drag / resize preview: only the shapes being manipulated re-render per frame. */
export const PreviewLayer = memo(function PreviewLayer() {
  const hidden = useInteraction((s) => s.hidden);
  const preview = useInteraction((s) => s.preview);
  const byId = useReplicaView((v) => v.shapeById);
  const xray = useUi((s) => s.mode === "xray");
  if (hidden.size === 0) return null;
  // Keep the dragged shapes in their stacking order relative to each other.
  const shapes = [...hidden]
    .map((id) => byId.get(id))
    .filter((s): s is ShapeView => s !== undefined)
    .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return (
    <g data-layer="preview" pointerEvents="none">
      {shapes.map((s) => (
        <ShapeSvg key={s.id} shape={withProps(s, preview?.get(s.id))} muted={xray} />
      ))}
    </g>
  );
});

/** In-progress local shape (pen stroke, rectangle being dragged out…). */
export const DraftLayer = memo(function DraftLayer() {
  const draft = useInteraction((s) => s.draft);
  if (!draft) return null;
  return (
    <g data-layer="draft" pointerEvents="none">
      <ShapeSvg shape={draft} />
    </g>
  );
});

/** Eraser: shapes marked for deletion, plus a fading trail. */
export const EraserLayer = memo(function EraserLayer() {
  const erasing = useInteraction((s) => s.erasing);
  const trail = useInteraction((s) => s.eraserTrail);
  const byId = useReplicaView((v) => v.shapeById);
  const zoom = useUi((s) => s.camera.zoom);
  if (erasing.size === 0 && !trail) return null;
  return (
    <g data-layer="eraser" pointerEvents="none">
      {[...erasing].map((id) => {
        const s = byId.get(id);
        return s ? (
          <g key={id} opacity={0.85}>
            <ShapeSvg shape={s} ghost ghostColor="var(--knot)" />
          </g>
        ) : null;
      })}
      {trail && trail.length > 1 && (
        <polyline
          points={trail.map((p) => `${p[0]},${p[1]}`).join(" ")}
          fill="none"
          stroke="var(--knot)"
          strokeOpacity={0.35}
          strokeWidth={10 / zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </g>
  );
});
