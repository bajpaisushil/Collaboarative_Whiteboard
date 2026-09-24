"use client";
/** Keyboard shortcut reference ("?"). Mirrors the pane hotkeys and the canvas shortcuts. */
import { useId } from "react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { Dialog } from "@/components/ui/Dialog";
import { KeyCombos } from "@/components/ui/Kbd";

type Combos = readonly (readonly string[])[];

interface Shortcut {
  keys: Combos;
  what: string;
  /** Secondary line under the description. */
  note?: string;
}

interface Group {
  title: string;
  items: readonly Shortcut[];
}

const one = (...keys: string[]): Combos => [keys];

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
      { keys: one("mod", "Z"), what: "Undo", note: "Only your own edits — never another tab’s" },
      {
        keys: [
          ["mod", "shift", "Z"],
          ["ctrl", "Y"],
        ],
        what: "Redo",
      },
      { keys: [["delete"], ["backspace"]], what: "Delete selection" },
      { keys: one("mod", "D"), what: "Duplicate selection" },
      { keys: [["up"], ["down"], ["left"], ["right"]], what: "Nudge", note: "Hold Shift for 10 px steps" },
      { keys: [["]"], ["["]], what: "Bring to front · send to back" },
      { keys: one("mod", "A"), what: "Select everything" },
      { keys: one("enter"), what: "Edit the selected note’s text" },
      { keys: one("esc"), what: "Deselect · cancel a drag" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: one("X"), what: "Draw ⇄ X-ray", note: "X-ray shows authorship, knots and clocks" },
      { keys: [["+"], ["−"]], what: "Zoom in · out" },
      { keys: one("shift", "1"), what: "Zoom to fit everything" },
      { keys: one("shift", "0"), what: "Reset zoom to 100%" },
      { keys: one("space"), what: "Hold and drag to pan", note: "Or scroll; pinch or ⌘/Ctrl-scroll zooms" },
    ],
  },
  {
    title: "Sync & history",
    items: [
      { keys: [["\\"], ["mod", "shift", "O"]], what: "Unplug / plug in this tab", note: "Edits keep working and merge on reconnect" },
      { keys: [["W"], ["Right-click"]], what: "Why does this shape look like this?", note: "With a shape selected (or under the pointer)" },
      { keys: [["left"], ["right"]], what: "Step through history", note: "While time-travelling (drag the loom to start); Shift steps 10" },
      { keys: one("esc"), what: "Leave time travel · close the explanation" },
      { keys: one("?"), what: "This sheet" },
    ],
  },
];

export function ShortcutSheet() {
  const open = useUi((s) => s.showShortcuts);
  const store = useUiStore();
  const idBase = useId();
  return (
    <Dialog
      open={open}
      onClose={() => store.getState().set({ showShortcuts: false })}
      title="Keyboard shortcuts"
      description="Shortcuts act on the board you last clicked — in split view, each side has its own."
    >
      {/* Container query: in a narrow /split pane the sheet is narrow even on a wide screen. */}
      <div className="@container">
        <div className="grid gap-x-8 gap-y-6 @min-[560px]:grid-cols-2">
          {GROUPS.map((g, i) => (
            <section key={g.title} aria-labelledby={`${idBase}-g${i}`}>
              <h3 id={`${idBase}-g${i}`} className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
                {g.title}
              </h3>
              <dl className="divide-y divide-dashed divide-line">
                {g.items.map((s) => (
                  <div key={`${g.title}-${s.what}`} className="flex items-center justify-between gap-4 py-1.5">
                    <dt className="min-w-0 text-[12.5px] text-ink-2">
                      {s.what}
                      {s.note && <span className="block text-[11px] leading-snug text-muted">{s.note}</span>}
                    </dt>
                    <dd className="shrink-0">
                      <KeyCombos combos={s.keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
