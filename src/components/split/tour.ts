/**
 * The 60-second guided tour: five steps that detect what the viewer actually did in the two
 * panes (by watching both sessions) and advance on their own. Every step can also be
 * auto-played through the same session APIs a user's clicks would use.
 *
 * External store (`subscribe` / `getSnapshot`); attach it to a stage once both panes exist.
 */
import type { ShapeId } from "@/lib/crdt/types";
import { findConflict, type Stage } from "./stage";

export type TourActor = "A" | "B" | "both" | "knot";

export interface TourStepDef {
  id: "sticky" | "unplug" | "recolour" | "replug" | "why";
  actor: TourActor;
  title: string;
  body: string;
  done: string;
}

export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: "sticky",
    actor: "A",
    title: "Tab A: drop a sticky",
    body: "In Tab A, pick the sticky-note tool (S) from its tool dock and click anywhere on the board.",
    done: "A placed a sticky — and B got it instantly.",
  },
  {
    id: "unplug",
    actor: "B",
    title: "Unplug Tab B",
    body: "Pull Tab B’s cable — the switch in its top bar, or the one above. B keeps working; it just stops hearing from A.",
    done: "B is offline. From now on the two tabs drift apart.",
  },
  {
    id: "recolour",
    actor: "both",
    title: "Make it different colours in each tab",
    body: "Select the note in Tab A and pick a colour, then do the same in Tab B with a different one. Same note, two edits, and neither tab can see the other’s.",
    done: "Two versions of one note now exist.",
  },
  {
    id: "replug",
    actor: "B",
    title: "Plug Tab B back in",
    body: "Reconnect B and watch: the tabs swap what they missed and settle on the same colour — without a server.",
    done: "Back in sync — both tabs are byte-for-byte identical.",
  },
  {
    id: "why",
    actor: "knot",
    title: "A knot appeared — tap Why?",
    body: "Two edits collided, so Weave tied a knot. Tap Why? to see exactly how both tabs agreed on the winner.",
    done: "That’s the whole trick.",
  },
] as const;

export interface TourSnapshot {
  active: boolean;
  /** Index into TOUR_STEPS; TOUR_STEPS.length = finished. */
  step: number;
  stickyId: ShapeId | null;
  /** Step 3 progress. */
  aChanged: boolean;
  bChanged: boolean;
  /** Live facts shown as hints. */
  bOnline: boolean;
  conflictId: string | null;
  /** An auto-play is in flight. */
  busy: boolean;
}

const INACTIVE: TourSnapshot = {
  active: false,
  step: 0,
  stickyId: null,
  aChanged: false,
  bChanged: false,
  bOnline: true,
  conflictId: null,
  busy: false,
};

const COLOURS_A = ["#ffc2a8", "#bcd4ff"];
const COLOURS_B = ["#b8ecd9", "#f3c1e3"];
const pickOther = (choices: readonly string[], avoid: string | null) => choices.find((c) => c.toLowerCase() !== avoid?.toLowerCase()) ?? choices[0];

export class TourController {
  private snap: TourSnapshot = INACTIVE;
  private listeners = new Set<() => void>();
  private stage: Stage | null = null;
  private known = new Set<ShapeId>();
  private baseFill: string | null = null;
  private pendingStart = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TourSnapshot => this.snap;

  private set(p: Partial<TourSnapshot>): void {
    let changed = false;
    for (const k of Object.keys(p) as (keyof TourSnapshot)[]) {
      if (this.snap[k] !== p[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snap = { ...this.snap, ...p };
    for (const l of [...this.listeners]) l();
  }

  /** Watch both panes. Returns a detach function. */
  attach(stage: Stage, opts: { autoStart?: boolean } = {}): () => void {
    this.stage = stage;
    if (opts.autoStart) this.pendingStart = true;
    const check = () => this.evaluate();
    const unsubs = [
      stage.panes.A.session.replica.subscribe(check),
      stage.panes.B.session.replica.subscribe(check),
      stage.panes.A.session.subscribe(check),
      stage.panes.B.session.subscribe(check),
      stage.seam.subscribe((s, prev) => {
        if (s.focus !== prev.focus) check();
      }),
    ];
    queueMicrotask(check);
    return () => {
      for (const u of unsubs) u();
      for (const t of this.timers) clearTimeout(t);
      this.timers.clear();
      if (this.stage === stage) this.stage = null;
      if (this.snap.busy) this.set({ busy: false });
    };
  }

  start(): void {
    const stage = this.stage;
    if (!stage || !stage.ready()) {
      this.pendingStart = true;
      return;
    }
    this.pendingStart = false;
    this.known = new Set(stage.panes.A.session.replica.getView().shapes.filter((s) => s.type === "sticky").map((s) => s.id));
    this.baseFill = null;
    this.snap = { ...INACTIVE, active: true, bOnline: stage.panes.B.session.getState().network.online };
    for (const l of [...this.listeners]) l();
    this.evaluate();
  }

  exit(): void {
    this.pendingStart = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.snap = INACTIVE;
    for (const l of [...this.listeners]) l();
  }

  /* ------------------------------------------------------------------ detection */

  private fillIn(pane: "A" | "B", id: ShapeId): string | null {
    return this.stage?.panes[pane].session.replica.getShape(id)?.fill ?? null;
  }

  private evaluate(): void {
    const stage = this.stage;
    if (!stage) return;
    if (this.pendingStart && stage.ready()) this.start();
    if (!this.snap.active) return;
    const a = stage.panes.A.session;
    const b = stage.panes.B.session;
    const bOnline = b.getState().network.online;
    let { step, stickyId } = this.snap;
    let aChanged = this.snap.aChanged;
    let bChanged = this.snap.bChanged;
    let conflictId: string | null = this.snap.conflictId;

    for (let guard = 0; guard < TOUR_STEPS.length; guard++) {
      const before = step;
      switch (TOUR_STEPS[step]?.id) {
        case "sticky": {
          const fresh = a.replica
            .getView()
            .shapes.filter((s) => s.type === "sticky" && !this.known.has(s.id))
            .sort((x, y) => y.z - x.z)[0];
          if (fresh) {
            stickyId = fresh.id;
            step++;
            stage.reveal(fresh.id);
          }
          break;
        }
        case "unplug": {
          if (stickyId && !a.replica.getShape(stickyId)) {
            // The note was deleted: go back and drop another one.
            stickyId = null;
            step = 0;
            break;
          }
          if (!bOnline) {
            this.baseFill = stickyId ? this.fillIn("A", stickyId) : null;
            step++;
          }
          break;
        }
        case "recolour": {
          if (!stickyId) {
            step = 0;
            break;
          }
          const fa = this.fillIn("A", stickyId);
          const fb = this.fillIn("B", stickyId);
          aChanged = fa !== null && fa !== this.baseFill;
          // Receiving A's colour (B plugged in too early) doesn't count as B's own edit.
          bChanged = fb !== null && fb !== this.baseFill && fb !== fa;
          if (aChanged && bChanged && fa !== fb) step++;
          break;
        }
        case "replug": {
          if (bOnline && stage.identical()) {
            step++;
            const c = stickyId ? findConflict(a, stickyId) : null;
            conflictId = c?.id ?? null;
          }
          break;
        }
        case "why": {
          const c = (stickyId ? findConflict(a, stickyId) : null) ?? latest(stage);
          conflictId = c?.id ?? null;
          const focus = stage.seam.getState().focus;
          if (focus && c && (focus.id === c.id || focus.lineageKey === c.lineageKey)) step++;
          break;
        }
        default:
          break;
      }
      if (step === before) break;
    }
    this.set({ step, stickyId, aChanged, bChanged, bOnline, conflictId });
  }

  /* ------------------------------------------------------------------ auto-play */

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  /** Perform the current step via the session APIs. */
  autoplay(): void {
    const stage = this.stage;
    if (!stage || !this.snap.active || this.snap.busy || !stage.ready()) return;
    const a = stage.panes.A.session;
    const b = stage.panes.B.session;
    const { stickyId } = this.snap;
    switch (TOUR_STEPS[this.snap.step]?.id) {
      case "sticky": {
        const size = { w: 200, h: 160 };
        const at = stage.place(size);
        const out: { id?: ShapeId } = {};
        a.transact(
          (tx) => {
            out.id = tx.create({ type: "sticky", text: "Our plan", props: { ...at, ...size, fill: "#ffe58a", stroke: "#1d1b16", fontSize: 20 } });
          },
          { label: "Add sticky note" },
        );
        if (out.id) {
          stage.reveal(out.id);
          stage.select(out.id);
        }
        break;
      }
      case "unplug":
        b.setOnline(false);
        break;
      case "recolour": {
        if (!stickyId) break;
        if (b.getState().network.online) b.setOnline(false);
        const base = this.baseFill;
        stage.select(stickyId);
        this.set({ busy: true });
        const recolourB = () => {
          if (!this.snap.bChanged) b.transact((tx) => tx.update(stickyId, { fill: pickOther(COLOURS_B, base) }), { label: "Recolour sticky note" });
          this.set({ busy: false });
        };
        if (!this.snap.aChanged) {
          a.transact((tx) => tx.update(stickyId, { fill: pickOther(COLOURS_A, base) }), { label: "Recolour sticky note" });
          this.later(recolourB, 550);
        } else recolourB();
        break;
      }
      case "replug":
        b.setOnline(true);
        b.syncNow();
        a.syncNow();
        break;
      case "why":
        this.focusKnot();
        break;
      default:
        break;
    }
  }

  /** Focus the tour's knot everywhere (the "Why?" button). */
  focusKnot(): void {
    const stage = this.stage;
    if (!stage) return;
    const a = stage.panes.A.session;
    const c = (this.snap.stickyId ? findConflict(a, this.snap.stickyId) : null) ?? latest(stage);
    if (c) stage.focusConflict(c);
  }
}

function latest(stage: Stage) {
  let best = null as ReturnType<typeof findConflict>;
  for (const c of stage.panes.A.session.replica.getView().conflicts) {
    if (c.status !== "live" || c.valuesEqual) continue;
    if (!best || c.lamport > best.lamport) best = c;
  }
  return best;
}
