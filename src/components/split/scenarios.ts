/**
 * Scripted scenes for the /split director. Plain data: each scene is a list of steps that the
 * runner (runner.ts) performs through the two panes' session APIs, with a short pause between
 * steps so viewers can follow along in both tabs.
 *
 * Shapes are referred to by a local `name`; the runner remembers the ShapeId returned by
 * `tx.create` and places new shapes in a free spot in view. Narration (`say`) never names a
 * winner: ties between equal Lamport counters are decided by the (random) replica ids, so the
 * verdict is read from the engine's own explanation at the end.
 */
import type { ConflictKind, ShapeProps } from "@/lib/crdt/types";
import type { PaneId } from "./stage";

export type { PaneId };

export type ScenarioStep =
  | { do: "offline" | "online"; pane: PaneId; say: string }
  | {
      do: "create";
      pane: PaneId;
      name: string;
      shape: "sticky" | "rect";
      text?: string;
      props?: Partial<ShapeProps>;
      label: string;
      say: string;
    }
  | {
      do: "update";
      pane: PaneId;
      name: string;
      /** Absolute props to write (e.g. a fill). */
      props?: Partial<ShapeProps>;
      /** Relative move from the shape's position as that pane sees it. */
      move?: { dx: number; dy: number };
      /** Relative resize from the shape's size as that pane sees it. */
      grow?: { dw: number; dh: number };
      label: string;
      say: string;
    }
  | { do: "delete"; pane: PaneId; name: string; label: string; say: string }
  /** Type `text` at the end of the shape's text (as that pane sees it). */
  | { do: "type"; pane: PaneId; name: string; text: string; label: string; say: string }
  | { do: "undo"; pane: PaneId; say: string }
  /** Skew the pane's wall clock (restored when the scene ends). */
  | { do: "clock"; pane: PaneId; skewMs: number; say: string }
  | { do: "wait"; until: "converged"; say: string }
  | { do: "wait"; ms: number; say: string }
  /** Find the conflict on `name` of `kind`, focus it everywhere and read out the verdict. */
  | { do: "explain"; name: string; kind: ConflictKind; say: string };

export type ScenarioId = "colour-clash" | "offline-marathon" | "delete-vs-edit" | "typing-together" | "move-vs-resize" | "undo-after-merge";

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** One line on the scene card. */
  tagline: string;
  /** What the scene teaches (shown while it runs). */
  lesson: string;
  steps: readonly ScenarioStep[];
}

const INK = "#1d1b16";
const BUTTER = "#ffe58a";
const PEACH = "#ffc2a8";
const MINT = "#b8ecd9";
const SKY = "#bcd4ff";
const PINK = "#f3c1e3";
const LINEN = "#e6e0d2";

const STICKY: Partial<ShapeProps> = { w: 200, h: 160, fill: BUTTER, stroke: INK, fontSize: 20 };
const RECT: Partial<ShapeProps> = { w: 220, h: 140, stroke: INK, strokeWidth: 2 };

const SYNC = (say = "The tabs sync — both now hold the same board."): ScenarioStep => ({ do: "wait", until: "converged", say });

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "colour-clash",
    title: "Colour clash",
    tagline: "Both tabs recolour the same note while apart.",
    lesson: "Two edits to one property, made without seeing each other: exactly one value can win, and every tab picks the same one.",
    steps: [
      { do: "create", pane: "A", name: "plan", shape: "sticky", text: "Plan", props: STICKY, label: "Add sticky note", say: "Tab A adds a sticky note, “Plan”." },
      SYNC("The tabs sync — B has the note too."),
      { do: "offline", pane: "A", say: "Tab A pulls its cable." },
      { do: "update", pane: "A", name: "plan", props: { fill: PEACH }, label: "Recolour sticky note", say: "Offline, A makes the note peach." },
      { do: "update", pane: "B", name: "plan", props: { fill: MINT }, label: "Recolour sticky note", say: "Meanwhile B makes it mint. Neither tab can see the other’s edit." },
      { do: "online", pane: "A", say: "A plugs back in." },
      SYNC("The tabs swap what they missed…"),
      { do: "explain", name: "plan", kind: "concurrent-write", say: "One colour survives — the same one in both tabs." },
    ],
  },
  {
    id: "offline-marathon",
    title: "Offline marathon",
    tagline: "Five offline edits vs. one later edit — Lamport beats the wall clock.",
    lesson: "“Who edited last” means nothing when neither side saw the other. Weave orders concurrent edits by Lamport counter, never by wall-clock time.",
    steps: [
      { do: "create", pane: "A", name: "box", shape: "rect", props: { ...RECT, fill: SKY }, label: "Draw rectangle", say: "Tab A draws a box." },
      SYNC(),
      { do: "offline", pane: "A", say: "A goes offline for a while." },
      { do: "update", pane: "A", name: "box", move: { dx: 70, dy: 0 }, label: "Move rectangle", say: "A moves the box…" },
      { do: "update", pane: "A", name: "box", move: { dx: 0, dy: 50 }, label: "Move rectangle", say: "…moves it again…" },
      { do: "update", pane: "A", name: "box", props: { fill: PINK }, label: "Recolour rectangle", say: "…recolours it pink…" },
      { do: "update", pane: "A", name: "box", props: { fill: LINEN }, label: "Recolour rectangle", say: "…changes its mind — linen…" },
      { do: "update", pane: "A", name: "box", move: { dx: 40, dy: -30 }, label: "Move rectangle", say: "…and nudges it once more. Five edits, none of them sent." },
      { do: "clock", pane: "B", skewMs: 180_000, say: "B’s clock runs 3 minutes fast (clock drift happens)." },
      { do: "update", pane: "B", name: "box", move: { dx: -90, dy: 40 }, label: "Move rectangle", say: "Now — later by every clock in the room — B moves the box once." },
      { do: "online", pane: "A", say: "A reconnects with its five edits." },
      SYNC("The tabs swap what they missed…"),
      { do: "explain", name: "box", kind: "concurrent-write", say: "B moved last. Whose position stands?" },
    ],
  },
  {
    id: "delete-vs-edit",
    title: "Delete vs. edit",
    tagline: "One tab deletes a note the other is still editing.",
    lesson: "A delete only removes what the deleter had seen. An edit it never saw keeps the shape alive (“update wins”) — nobody’s work vanishes silently.",
    steps: [
      { do: "create", pane: "A", name: "note", shape: "sticky", text: "Draft", props: STICKY, label: "Add sticky note", say: "Tab A adds a sticky note, “Draft”." },
      SYNC(),
      { do: "offline", pane: "B", say: "Tab B goes offline." },
      { do: "delete", pane: "A", name: "note", label: "Delete sticky note", say: "A deletes the note." },
      { do: "update", pane: "B", name: "note", props: { fill: SKY }, label: "Recolour sticky note", say: "B, unaware, recolours it sky blue…" },
      { do: "type", pane: "B", name: "note", text: " v2", label: "Edit text", say: "…and adds “ v2” to its text." },
      { do: "online", pane: "B", say: "B reconnects." },
      SYNC("The tabs swap what they missed…"),
      { do: "explain", name: "note", kind: "delete-vs-edit", say: "Deleted or edited? Look at both tabs." },
    ],
  },
  {
    id: "typing-together",
    title: "Typing together",
    tagline: "Two tabs type at the same spot while offline.",
    lesson: "Text is never overwritten: both insertions are kept, and a fixed rule decides their order, so every tab reads the same sentence.",
    steps: [
      { do: "create", pane: "A", name: "memo", shape: "sticky", text: "Hello", props: { ...STICKY, w: 240, fill: MINT }, label: "Add sticky note", say: "Tab A adds a note that says “Hello”." },
      SYNC(),
      { do: "offline", pane: "A", say: "Tab A goes offline…" },
      { do: "offline", pane: "B", say: "…and so does Tab B." },
      { do: "type", pane: "A", name: "memo", text: " world", label: "Edit text", say: "A types “ world” at the end." },
      { do: "type", pane: "B", name: "memo", text: " there", label: "Edit text", say: "B types “ there” at the very same spot." },
      { do: "online", pane: "A", say: "A reconnects…" },
      { do: "online", pane: "B", say: "…and B too." },
      SYNC("The tabs swap what they missed…"),
      { do: "explain", name: "memo", kind: "concurrent-text", say: "Both words survive. In which order — and why?" },
    ],
  },
  {
    id: "move-vs-resize",
    title: "Move vs. resize",
    tagline: "One tab drags a box while the other resizes it.",
    lesson: "Position and size are one register, so a concurrent move and resize resolve as a whole — you never get a box neither user made.",
    steps: [
      { do: "create", pane: "B", name: "frame", shape: "rect", props: { ...RECT, w: 200, h: 120, fill: MINT }, label: "Draw rectangle", say: "Tab B draws a box." },
      SYNC(),
      { do: "offline", pane: "A", say: "Tab A goes offline." },
      { do: "update", pane: "A", name: "frame", move: { dx: 130, dy: 40 }, label: "Move rectangle", say: "A drags the box to the right." },
      { do: "update", pane: "B", name: "frame", grow: { dw: 120, dh: 80 }, label: "Resize rectangle", say: "B makes it bigger." },
      { do: "online", pane: "A", say: "A plugs back in." },
      SYNC("The tabs swap what they missed…"),
      { do: "explain", name: "frame", kind: "concurrent-write", say: "Moved or resized? One edit wins whole." },
    ],
  },
  {
    id: "undo-after-merge",
    title: "Undo after merge",
    tagline: "A’s undo won’t erase B’s newer edit.",
    lesson: "Undo takes back only your own latest word. If someone changed the thing after you, Undo leaves their edit alone and tells you why.",
    steps: [
      { do: "create", pane: "B", name: "idea", shape: "sticky", text: "Idea", props: STICKY, label: "Add sticky note", say: "Tab B adds a sticky note, “Idea”." },
      SYNC(),
      { do: "update", pane: "A", name: "idea", props: { fill: PEACH }, label: "Recolour sticky note", say: "A makes it peach." },
      SYNC("B receives A’s change…"),
      { do: "update", pane: "B", name: "idea", props: { fill: SKY }, label: "Recolour sticky note", say: "…and then, having seen it, makes the note sky blue." },
      SYNC("A receives B’s change."),
      { do: "undo", pane: "A", say: "A presses Undo." },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
