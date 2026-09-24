"use client";
/** Keyboard shortcut reference ("?"). */
import { useUi, useUiStore } from "@/lib/ui/store";
import { Dialog } from "@/components/ui/Dialog";
import { KeyCombos } from "@/components/ui/Kbd";

interface Shortcut {
  keys: readonly (readonly string[])[];
  what: string;
}

interface Group {
  title: string;
  items: readonly Shortcut[];
}

const one = (...keys: string[]): readonly (readonly string[])[] => [keys];

const GROUPS: readonly Group[] = [
  {
    title: "Tools",
    items: [
      { keys: one("V"), what: "Select" },
      { keys: one("H"), what: "Hand — pan the board" },
      { keys: one("P"), what: "Pen" },
      { keys: one("R"), what: "Rectangle" },
      { keys: one("O"), what: "Ellipse" },
      { keys: one("A"), what: "Arrow" },
      { keys: one("S"), what: "Sticky note" },
      { keys: one("T"), what: "Text" },
      { keys: one("E"), what: "Eraser" },
    ],
  },
  {
    title: "Edit",
    items: [
      { keys: one("mod", "Z"), what: "Undo (only your own edits)" },
      { keys: [["mod", "shift", "Z"], ["ctrl", "Y"]], what: "Redo" },
      { keys: [["delete"], ["backspace"]], what: "Delete selection" },
      { keys: one("mod", "D"), what: "Duplicate selection" },
      { keys: [["up"], ["down"], ["left"], ["right"]], what: "Nudge (hold Shift for 10×)" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: one("X"), what: "X-ray — show clocks, authorship and knots" },
      { keys: one("mod", "scroll"), what: "Zoom (or pinch)" },
      { keys: one("H"), what: "Pan with the hand tool (or scroll)" },
    ],
  },
  {
    title: "Sync & history",
    items: [
      { keys: [["\\"], ["mod", "shift", "O"]], what: "Unplug / plug in this tab" },
      { keys: one("W"), what: "Why does this shape look like this?" },
      { keys: one("Esc"), what: "Leave time travel · clear the focused knot" },
      { keys: one("?"), what: "This sheet" },
    ],
  },
];

export function ShortcutSheet() {
  const open = useUi((s) => s.showShortcuts);
  const store = useUiStore();
  return (
    <Dialog
      open={open}
      onClose={() => store.getState().set({ showShortcuts: false })}
      title="Keyboard shortcuts"
      description="Shortcuts act on the board you last clicked — in split view, each side has its own."
    >
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} aria-labelledby={`kb-${g.title}`}>
            <h3 id={`kb-${g.title}`} className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              {g.title}
            </h3>
            <dl className="divide-y divide-dashed divide-line">
              {g.items.map((s) => (
                <div key={s.what} className="flex items-center justify-between gap-4 py-1.5">
                  <dt className="text-[12.5px] text-ink-2">{s.what}</dt>
                  <dd className="shrink-0">
                    <KeyCombos combos={s.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
