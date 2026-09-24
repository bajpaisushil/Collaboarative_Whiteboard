/**
 * Store bridge between the seam and the two panes.
 *
 * - Knot focus is shared: focusing a conflict anywhere (seam list, a pane's knot counter, a
 *   pane's canvas) focuses it everywhere, so both canvases halo the shape; Escape in any pane
 *   clears it everywhere.
 * - Ghosts are routed: hovering a side in the seam draws that side's ghost on the pane whose
 *   replica authored it (counterfactual ghosts, or sides from a third tab, go to both).
 * - "Show on canvas" in the seam (a selection / camera change there) selects and reveals the
 *   shape in both panes.
 * - Provenance ("why does this look like this?") opened in a pane is shown in the seam; only
 *   one pane holds it at a time.
 * - If the focused conflict's id changes under partial delivery, re-resolve it by lineageKey.
 */
import type { Conflict, OpId } from "@/lib/crdt/types";
import type { ConflictFocus, UiState } from "@/lib/ui/store";
import { PANE_IDS, type PaneId, type Stage } from "./stage";

type Ghost = UiState["ghost"];

const sameFocus = (x: ConflictFocus | null, y: ConflictFocus | null) => (x?.id ?? null) === (y?.id ?? null);

function conflictById(stage: Stage, id: string): Conflict | null {
  for (const p of PANE_IDS) {
    const c = stage.panes[p].session.replica.getView().conflicts.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

/** Which panes should draw this ghost. */
function ghostTargets(stage: Stage, ghost: NonNullable<Ghost>): PaneId[] {
  if (ghost.counterfactual) return [...PANE_IDS];
  const c = conflictById(stage, ghost.conflictId);
  let opId: OpId | undefined = ghost.opId;
  if (!opId && c && c.kind !== "concurrent-text" && c.ops.length === 2) opId = c.ops[1]; // [winner, loser]
  if (!opId) return [...PANE_IDS];
  let author: string | null = null;
  for (const p of PANE_IDS) {
    const op = stage.panes[p].session.replica.getOp(opId);
    if (op) {
      author = op.replica;
      break;
    }
  }
  if (!author) return [...PANE_IDS];
  const match = PANE_IDS.filter((p) => stage.panes[p].session.replica.id === author);
  return match.length ? match : [...PANE_IDS];
}

export function bridgeStores(stage: Stage): () => void {
  const seam = stage.seam;
  const routed: Record<PaneId, Ghost> = { A: null, B: null };

  const pushFocusToPanes = (focus: ConflictFocus | null) => {
    for (const p of PANE_IDS) {
      const ui = stage.panes[p].store.getState();
      if (sameFocus(ui.focus, focus)) continue;
      // `set`, not `focusConflict`: compact panes have no Why sheet to open.
      ui.set(focus ? { focus } : { focus: null, ghost: null });
    }
  };

  const routeGhost = (ghost: Ghost) => {
    const targets = ghost ? ghostTargets(stage, ghost) : [];
    for (const p of PANE_IDS) {
      const ui = stage.panes[p].store.getState();
      if (targets.includes(p)) {
        if (ui.ghost !== ghost) ui.set({ ghost });
        routed[p] = ghost;
      } else if (routed[p] && ui.ghost === routed[p]) {
        // Only clear ghosts we put there (a pane may be showing its own).
        ui.set({ ghost: null });
        routed[p] = null;
      }
    }
  };

  const unsubs: (() => void)[] = [];

  unsubs.push(
    seam.subscribe((s, prev) => {
      if (!sameFocus(s.focus, prev.focus)) pushFocusToPanes(s.focus);
      if (s.ghost !== prev.ghost) routeGhost(s.ghost);
      const selectionChanged = s.selection !== prev.selection && s.selection.length > 0;
      if (selectionChanged || s.camera !== prev.camera) {
        const target = s.selection[0] ?? (s.focus ? conflictById(stage, s.focus.id)?.shapeId : undefined);
        if (target) {
          stage.select(target);
          stage.reveal(target);
        }
      }
    }),
  );

  for (const p of PANE_IDS) {
    const other: PaneId = p === "A" ? "B" : "A";
    unsubs.push(
      stage.panes[p].store.subscribe((s, prev) => {
        if (!sameFocus(s.focus, prev.focus) && !sameFocus(s.focus, seam.getState().focus)) {
          if (s.focus) seam.getState().focusConflict(s.focus);
          else seam.getState().focusConflict(null);
        }
        if (s.provenance && s.provenance !== prev.provenance) {
          const o = stage.panes[other].store.getState();
          if (o.provenance) o.set({ provenance: null });
        }
      }),
    );
  }

  // Lineage re-resolution: a focused conflict whose id disappeared (e.g. a later op joined the
  // pair) is re-found by its lineage key in the seam's session (Tab A).
  const seamSession = stage.panes.A.session;
  unsubs.push(
    seamSession.replica.subscribe(() => {
      const focus = seam.getState().focus;
      if (!focus) return;
      const conflicts = seamSession.replica.getView().conflicts;
      if (conflicts.some((c) => c.id === focus.id)) return;
      const heir = conflicts.find((c) => c.lineageKey === focus.lineageKey);
      if (heir) seam.getState().focusConflict({ id: heir.id, lineageKey: heir.lineageKey });
    }),
  );

  // Adopt whatever is focused right now (e.g. a pane focused a knot before the seam mounted).
  const initial = seam.getState().focus ?? stage.panes.A.store.getState().focus ?? stage.panes.B.store.getState().focus;
  if (initial) {
    if (!sameFocus(seam.getState().focus, initial)) seam.getState().focusConflict(initial);
    pushFocusToPanes(initial);
  }

  return () => {
    for (const u of unsubs) u();
  };
}
