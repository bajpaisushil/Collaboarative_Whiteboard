"use client";
/** Undo / redo of this tab's own edits (labels from the undo stack). Disabled while time travelling. */
import { Redo2, Undo2 } from "lucide-react";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { IconButton } from "@/components/ui/IconButton";
import { formatShortcut, useIsMac } from "@/components/ui/keys";
import { selectCanRedo, selectCanUndo, selectRedoLabel, selectUndoLabel } from "../selectors";

export function UndoRedo() {
  const session = useSession();
  const isMac = useIsMac();
  const canUndo = useReplicaView(selectCanUndo);
  const canRedo = useReplicaView(selectCanRedo);
  const undoLabel = useReplicaView(selectUndoLabel);
  const redoLabel = useReplicaView(selectRedoLabel);
  const scrubbing = useUi((s) => s.scrub !== null);

  const undoName = scrubbing
    ? "Undo (leave time travel first)"
    : canUndo && undoLabel
      ? `Undo “${undoLabel}”`
      : "Nothing of yours to undo";
  const redoName = scrubbing
    ? "Redo (leave time travel first)"
    : canRedo && redoLabel
      ? `Redo “${redoLabel}”`
      : "Nothing to redo";

  return (
    <div className="flex shrink-0 items-center">
      <IconButton
        icon={Undo2}
        label={undoName}
        shortcut={formatShortcut(["mod", "Z"], isMac)}
        aria-keyshortcuts="Control+Z Meta+Z"
        disabled={!canUndo || scrubbing}
        onClick={() => session.undo()}
      />
      <IconButton
        icon={Redo2}
        label={redoName}
        shortcut={`${formatShortcut(["mod", "shift", "Z"], isMac)}${isMac ? "" : " or Ctrl+Y"}`}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        disabled={!canRedo || scrubbing}
        onClick={() => session.redo()}
      />
    </div>
  );
}
