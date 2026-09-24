"use client";
/** Draw ⇄ X-ray view mode (X). X-ray reveals authorship tints, knots and clocks. */
import clsx from "clsx";
import { PenLine, ScanEye, type LucideIcon } from "lucide-react";
import { useUi, useUiStore, type ViewMode } from "@/lib/ui/store";
import { Kbd } from "@/components/ui/Kbd";

const MODES: { mode: ViewMode; label: string; icon: LucideIcon; hint: string }[] = [
  { mode: "draw", label: "Draw", icon: PenLine, hint: "Clean whiteboard" },
  { mode: "xray", label: "X-ray", icon: ScanEye, hint: "Reveal who wrote what, knots and clocks" },
];

export function ModeToggle() {
  const mode = useUi((s) => s.mode);
  const store = useUiStore();
  return (
    <div role="group" aria-label="View mode" className="flex shrink-0 items-center rounded-full bg-panel-2 p-0.5">
      {MODES.map((m) => {
        const active = mode === m.mode;
        const Icon = m.icon;
        return (
          <button
            key={m.mode}
            type="button"
            aria-pressed={active}
            aria-keyshortcuts="X"
            title={`${m.label} — ${m.hint} (X)`}
            onClick={() => store.getState().set({ mode: m.mode })}
            className={clsx(
              "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150",
              active ? "bg-panel text-ink shadow-[0_1px_2px_#0000001f,inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-[15px]" strokeWidth={1.9} />
            <span className="@max-[1240px]:sr-only">{m.label}</span>
            {m.mode === "xray" && <Kbd className="ml-0.5 @max-[1500px]:hidden">X</Kbd>}
          </button>
        );
      })}
    </div>
  );
}
