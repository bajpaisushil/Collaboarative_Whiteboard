/**
 * Scenario runner: performs a scene's steps through the panes' session APIs, one at a time,
 * with a visible pause between them, and exposes its progress as a tiny external store
 * (`subscribe` / `getSnapshot`) for the seam to render.
 *
 * Every step is defensive: it checks the sessions are ready, waits briefly for shapes that are
 * still in flight, and fails with a plain-language message instead of throwing into React.
 * `stop()` aborts at the next await; clock skews set by a scene are always restored.
 */
import type { Conflict, PropKey, ShapeId, ShapeProps, UndoResult } from "@/lib/crdt/types";
import { propsNoun } from "@/lib/crdt/describe";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import type { Scenario, ScenarioStep } from "./scenarios";
import { findConflict, PANE_IDS, type PaneId, type Stage } from "./stage";

export type StepStatus = "pending" | "active" | "done" | "failed";
export type RunPhase = "idle" | "setup" | "running" | "done" | "stopped" | "failed";

export interface Verdict {
  tone: "knot" | "undo" | "none";
  question: string;
  answer: string;
  conflictId?: string;
  lineageKey?: string;
  /** Undo verdicts: the tab that pressed Undo (it shows a matching toast). */
  pane?: PaneId;
}

export interface RunSnapshot {
  scenarioId: string | null;
  phase: RunPhase;
  statuses: readonly StepStatus[];
  /** Extra detail learned while running a step ("in sync after 0.6 s", an undo's reason…). */
  notes: readonly (string | null)[];
  verdict: Verdict | null;
  /** Setup / stop / failure message. */
  message: string | null;
}

export const STEP_GAP_MS = 650;
const CONVERGE_TIMEOUT_MS = 4000;
const SHAPE_WAIT_MS = 2500;
const KNOT_WAIT_MS = 3000;
const READY_WAIT_MS = 5000;

const IDLE: RunSnapshot = { scenarioId: null, phase: "idle", statuses: [], notes: [], verdict: null, message: null };

class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

/** A step that can't be performed; the message is shown to the viewer. */
class StepFailure extends Error {}

interface Token {
  aborted: boolean;
  wake: Set<() => void>;
}

interface RunCtx {
  stage: Stage;
  token: Token;
  names: Map<string, ShapeId>;
  skewed: Set<PaneId>;
}

const tab = (p: PaneId) => `Tab ${p}`;

function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms / 10) * 10)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function skipNoun(prop: PropKey | "text" | "shape"): string {
  if (prop === "text") return "the text";
  if (prop === "shape") return "the shape";
  return `the ${propsNoun([prop])}`;
}

export class ScenarioRunner {
  private readonly gapMs: number;
  private snap: RunSnapshot = IDLE;
  private listeners = new Set<() => void>();
  private token: Token | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RunSnapshot => this.snap;

  /** `gapMs`: pause between steps (tests use a short one). */
  constructor(opts: { gapMs?: number } = {}) {
    this.gapMs = opts.gapMs ?? STEP_GAP_MS;
  }

  get busy(): boolean {
    return this.snap.phase === "setup" || this.snap.phase === "running";
  }

  private emit(next: RunSnapshot): void {
    this.snap = next;
    for (const l of [...this.listeners]) l();
  }

  private patch(p: Partial<RunSnapshot>): void {
    this.emit({ ...this.snap, ...p });
  }

  private setStep(i: number, status: StepStatus, note?: string | null): void {
    const statuses = this.snap.statuses.slice();
    statuses[i] = status;
    const notes = this.snap.notes.slice();
    if (note !== undefined) notes[i] = note;
    this.emit({ ...this.snap, statuses, notes });
  }

  /** Clear a finished run's card. */
  dismiss(): void {
    if (!this.busy) this.emit(IDLE);
  }

  stop(): void {
    const t = this.token;
    if (!t || t.aborted) return;
    t.aborted = true;
    for (const w of [...t.wake]) w();
  }

  async run(scenario: Scenario, stage: Stage): Promise<void> {
    if (this.busy) return;
    const token: Token = { aborted: false, wake: new Set() };
    this.token = token;
    const n = scenario.steps.length;
    this.emit({
      scenarioId: scenario.id,
      phase: "setup",
      statuses: Array<StepStatus>(n).fill("pending"),
      notes: Array<string | null>(n).fill(null),
      verdict: null,
      message: "Setting the stage…",
    });
    const ctx: RunCtx = { stage, token, names: new Map(), skewed: new Set() };
    let current = -1;
    try {
      await this.setup(ctx);
      this.patch({ phase: "running", message: null });
      for (let i = 0; i < n; i++) {
        current = i;
        this.setStep(i, "active");
        const note = await this.perform(scenario.steps[i], ctx);
        this.setStep(i, "done", note);
        if (i < n - 1) await this.sleep(token, this.gapMs);
      }
      current = -1;
      this.patch({ phase: "done" });
    } catch (e) {
      if (current >= 0) this.setStep(current, e instanceof Aborted ? "pending" : "failed");
      if (e instanceof Aborted) {
        const offline = PANE_IDS.filter((p) => !stage.pane(p).session.getState().network.online);
        this.patch({
          phase: "stopped",
          message: offline.length
            ? `Stopped. ${offline.map(tab).join(" and ")} ${offline.length > 1 ? "are" : "is"} still offline — use the switches above to plug back in.`
            : "Stopped. Both tabs are left exactly as they are.",
        });
      } else {
        this.patch({
          phase: "failed",
          message: e instanceof StepFailure ? e.message : "Something went wrong while running this scene. Try again, or reset the room.",
        });
      }
    } finally {
      for (const p of ctx.skewed) stage.pane(p).session.setConditions({ clockSkewMs: 0 });
      if (this.token === token) this.token = null;
    }
  }

  /* ------------------------------------------------------------------ plumbing */

  private sleep(token: Token, ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (token.aborted) {
        reject(new Aborted());
        return;
      }
      const wake = () => {
        clearTimeout(timer);
        token.wake.delete(wake);
        reject(new Aborted());
      };
      const timer = setTimeout(() => {
        token.wake.delete(wake);
        resolve();
      }, ms);
      token.wake.add(wake);
    });
  }

  /** Resolve true as soon as `predicate` holds (re-checked on any change of `sessions`), false on timeout. */
  private waitFor(token: Token, predicate: () => boolean, sessions: readonly WhiteboardSessionApi[], timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (token.aborted) {
        reject(new Aborted());
        return;
      }
      if (predicate()) {
        resolve(true);
        return;
      }
      const unsubs: (() => void)[] = [];
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        token.wake.delete(wake);
        for (const u of unsubs) u();
        fn();
      };
      const check = () => {
        if (predicate()) finish(() => resolve(true));
      };
      const wake = () => finish(() => reject(new Aborted()));
      const timer = setTimeout(() => finish(() => resolve(predicate())), timeoutMs);
      token.wake.add(wake);
      for (const s of sessions) {
        unsubs.push(s.replica.subscribe(check));
        unsubs.push(s.subscribe(check));
      }
    });
  }

  private sessionsOf(stage: Stage): WhiteboardSessionApi[] {
    return PANE_IDS.map((p) => stage.pane(p).session);
  }

  private async converge(ctx: RunCtx): Promise<string> {
    const { stage, token } = ctx;
    const sessions = this.sessionsOf(stage);
    const offline = PANE_IDS.filter((p) => !stage.pane(p).session.getState().network.online);
    if (offline.length) return `${offline.map(tab).join(" and ")} is offline — nothing to sync yet`;
    const t0 = performance.now();
    for (const s of sessions) s.syncNow();
    const ok = await this.waitFor(token, () => stage.identical(), sessions, CONVERGE_TIMEOUT_MS);
    // Let heartbeats catch up too, so counters and merge cards settle.
    for (const s of sessions) s.syncNow();
    if (!ok) return "still syncing — carrying on";
    return `identical after ${fmtMs(performance.now() - t0)}`;
  }

  private async setup(ctx: RunCtx): Promise<void> {
    const { stage, token } = ctx;
    const sessions = this.sessionsOf(stage);
    if (!stage.ready()) {
      const ok = await this.waitFor(token, () => stage.ready(), sessions, READY_WAIT_MS);
      if (!ok) throw new StepFailure("The two tabs are still starting up. Give them a second and try again.");
    }
    stage.clearFocus();
    let changed = false;
    for (const p of PANE_IDS) {
      const s = stage.pane(p).session;
      const net = s.getState().network;
      if (net.clockSkewMs !== 0) s.setConditions({ clockSkewMs: 0 });
      if (!net.online) {
        s.setOnline(true);
        changed = true;
      }
    }
    if (changed || !stage.identical()) {
      this.patch({ message: "Plugging both tabs in and letting them sync first…" });
      await this.converge(ctx);
    }
  }

  private shapeId(ctx: RunCtx, name: string): ShapeId {
    const id = ctx.names.get(name);
    if (!id) throw new StepFailure(`The scene lost track of its “${name}” shape.`);
    return id;
  }

  /** The shape as `pane` sees it, waiting briefly if it is still in flight. */
  private async shapeIn(ctx: RunCtx, pane: PaneId, name: string) {
    const id = this.shapeId(ctx, name);
    const s = ctx.stage.pane(pane).session;
    const ok = await this.waitFor(ctx.token, () => !!s.replica.getShape(id), [s], SHAPE_WAIT_MS);
    const shape = s.replica.getShape(id);
    if (!ok || !shape) throw new StepFailure(`${tab(pane)} doesn’t have the shape — did it go offline before it arrived?`);
    return { id, shape, session: s };
  }

  private requireReady(stage: Stage, pane: PaneId): WhiteboardSessionApi {
    const s = stage.pane(pane).session;
    if (!s.getState().ready) throw new StepFailure(`${tab(pane)} isn’t ready to edit yet.`);
    return s;
  }

  /* ------------------------------------------------------------------ steps */

  private async perform(step: ScenarioStep, ctx: RunCtx): Promise<string | null> {
    const { stage, token } = ctx;
    switch (step.do) {
      case "offline":
      case "online": {
        const s = stage.pane(step.pane).session;
        s.setOnline(step.do === "online");
        return null;
      }
      case "clock": {
        const s = stage.pane(step.pane).session;
        s.setConditions({ clockSkewMs: step.skewMs });
        ctx.skewed.add(step.pane);
        return "set right again when the scene ends";
      }
      case "wait": {
        if ("ms" in step) {
          await this.sleep(token, step.ms);
          return null;
        }
        return this.converge(ctx);
      }
      case "create": {
        const s = this.requireReady(stage, step.pane);
        const w = step.props?.w ?? (step.shape === "sticky" ? 200 : 220);
        const h = step.props?.h ?? (step.shape === "sticky" ? 160 : 140);
        const at = stage.place({ w, h });
        const out: { id?: ShapeId } = {};
        s.transact(
          (tx) => {
            out.id = tx.create({ type: step.shape, props: { ...step.props, x: at.x, y: at.y, w, h }, text: step.text });
          },
          { label: step.label },
        );
        if (!out.id || !s.replica.getShape(out.id)) throw new StepFailure(`${tab(step.pane)} couldn’t create the shape.`);
        ctx.names.set(step.name, out.id);
        stage.reveal(out.id);
        return null;
      }
      case "update": {
        this.requireReady(stage, step.pane);
        const { id, shape, session } = await this.shapeIn(ctx, step.pane, step.name);
        const props: Partial<ShapeProps> = { ...step.props };
        if (step.move) {
          props.x = shape.x + step.move.dx;
          props.y = shape.y + step.move.dy;
        }
        if (step.grow) {
          props.w = Math.max(24, shape.w + step.grow.dw);
          props.h = Math.max(24, shape.h + step.grow.dh);
        }
        const res = session.transact((tx) => tx.update(id, props), { label: step.label });
        stage.reveal(id);
        return res.ops.length ? null : "no change needed";
      }
      case "delete": {
        this.requireReady(stage, step.pane);
        const { id, session } = await this.shapeIn(ctx, step.pane, step.name);
        session.transact((tx) => tx.delete(id), { label: step.label });
        return null;
      }
      case "type": {
        this.requireReady(stage, step.pane);
        const { id, shape, session } = await this.shapeIn(ctx, step.pane, step.name);
        session.transact((tx) => tx.insertText(id, shape.text.length, step.text), { label: step.label });
        const now = session.replica.getShape(id)?.text;
        return now !== undefined ? `${tab(step.pane)} now reads “${now}”` : null;
      }
      case "undo": {
        const s = this.requireReady(stage, step.pane);
        const result = s.undo();
        const verdict = undoVerdict(stage, step.pane, result);
        this.patch({ verdict });
        const id = [...ctx.names.values()].pop();
        if (id) {
          stage.select(id);
          stage.reveal(id);
        }
        return verdict.tone === "undo" ? "skipped — see the verdict below" : null;
      }
      case "explain": {
        const id = this.shapeId(ctx, step.name);
        const seamSession = stage.pane("A").session;
        await this.waitFor(token, () => !!findConflict(seamSession, id, step.kind), [seamSession], KNOT_WAIT_MS);
        const c = findConflict(seamSession, id, step.kind) ?? findConflict(stage.pane("B").session, id, step.kind);
        if (!c) {
          this.patch({
            verdict: {
              tone: "none",
              question: "No knot this time",
              answer: "The edits didn’t overlap after all (one tab may have synced early), so there was nothing to resolve. Run the scene again to see the clash.",
            },
          });
          return "no knot formed";
        }
        stage.focusConflict(c);
        this.patch({ verdict: conflictVerdict(stage, c) });
        return null;
      }
    }
  }
}

function conflictVerdict(stage: Stage, c: Conflict): Verdict {
  const ex = stage.pane("A").session.replica.explain(c.id) ?? stage.pane("B").session.replica.explain(c.id);
  return {
    tone: "knot",
    question: ex?.question ?? "Why did the tabs settle on this?",
    answer: ex?.answer ?? "Both tabs changed the same thing at the same time — neither had seen the other’s edit. Open the knot below for the full story.",
    conflictId: c.id,
    lineageKey: c.lineageKey,
  };
}

function labelOf(stage: Stage, replica: string): string {
  for (const p of PANE_IDS) if (stage.pane(p).session.replica.id === replica) return p;
  return stage.pane("A").session.replica.getView().replicas.get(replica)?.label ?? "another tab";
}

function undoVerdict(stage: Stage, pane: PaneId, result: UndoResult | null): Verdict {
  if (!result) {
    return { tone: "none", question: "Nothing to undo", answer: `${tab(pane)} had no edit of its own left to take back.` };
  }
  if (result.skipped.length) {
    const first = result.skipped[0];
    const what = skipNoun(first.prop);
    const more = result.skipped.length > 1 ? ` (and ${result.skipped.length - 1} more)` : "";
    return {
      tone: "undo",
      pane,
      question: first.byReplica
        ? `Why did ${pane}’s Undo leave ${labelOf(stage, first.byReplica)}’s edit alone?`
        : `Why did ${pane}’s Undo skip ${what}?`,
      answer:
        `${tab(pane)}’s undo would have restored ${what}${more}, but ${first.reason}. ` +
        "Undo in Weave only takes back your own latest word — it never silently erases a newer edit someone made on top of yours.",
    };
  }
  return {
    tone: "none",
    question: `Undid “${result.label}”`,
    answer: `Nobody had changed it since, so ${tab(pane)}’s undo went through and both tabs see the result.`,
  };
}
