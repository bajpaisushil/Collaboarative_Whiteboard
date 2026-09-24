"use client";
/**
 * The card of the scene that is playing: its lesson, the step list as a thread of beads
 * (each bead in the colour of the tab acting; ticked when done), and the verdict read from
 * the engine's own explanation at the end.
 */
import clsx from "clsx";
import { ArrowDown, Check, Info, RotateCcw, Square, Undo2, X, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { threadColor } from "@/lib/ui/colors";
import { IconButton } from "@/components/ui/IconButton";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import type { RunSnapshot, StepStatus, Verdict } from "./runner";
import type { Scenario, ScenarioStep } from "./scenarios";
import type { Stage } from "./stage";

const PHASE_LABEL: Record<RunSnapshot["phase"], string> = {
  idle: "",
  setup: "Setting the stage",
  running: "Now playing",
  done: "Finished",
  stopped: "Stopped",
  failed: "Couldn’t finish",
};

export function RunCard({
  scenario,
  run,
  stage,
  icon: Icon,
  onStop,
  onReplay,
  onDismiss,
}: {
  scenario: Scenario;
  run: RunSnapshot;
  stage: Stage;
  icon: LucideIcon;
  onStop: () => void;
  onReplay: () => void;
  onDismiss: () => void;
}) {
  const busy = run.phase === "setup" || run.phase === "running";
  const active = run.statuses.indexOf("active");
  const announce = busy ? (active >= 0 ? scenario.steps[active].say : run.message) : run.verdict ? run.verdict.question : run.message;

  return (
    <div className="mt-3 overflow-hidden rounded-[14px] border border-line-2 bg-panel shadow-sheet">
      <div className="flex items-start gap-2 px-3.5 pt-3">
        <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[9px] bg-panel-2 text-ink-2">
          <Icon className="size-[15px]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={clsx("text-[10px] font-semibold uppercase tracking-[0.14em]", run.phase === "failed" ? "text-knot" : "text-muted")}>
            {PHASE_LABEL[run.phase]}
          </p>
          <h3 className="text-[14.5px] font-semibold leading-tight tracking-tight text-ink">{scenario.title}</h3>
        </div>
        {busy ? (
          <IconButton icon={Square} label="Stop this scene" size="sm" onClick={onStop} iconClassName="fill-current size-[11px]" className="border border-line">
            <span className="pr-0.5">Stop</span>
          </IconButton>
        ) : (
          <div className="flex items-center gap-0.5">
            <IconButton icon={RotateCcw} label="Play this scene again" size="sm" onClick={onReplay} />
            <IconButton icon={X} label="Close this scene card" size="sm" onClick={onDismiss} />
          </div>
        )}
      </div>
      <p className="px-3.5 pt-1.5 text-[12px] leading-snug text-ink-2">{scenario.lesson}</p>

      {run.message && (
        <p className={clsx("mx-3.5 mt-2.5 rounded-[9px] px-2.5 py-1.5 text-[11.5px] leading-snug", run.phase === "failed" ? "bg-[var(--knot-soft)] text-knot" : "bg-panel-2 text-ink-2")}>
          {run.message}
        </p>
      )}

      <StepList steps={scenario.steps} statuses={run.statuses} notes={run.notes} />

      {run.verdict && <VerdictCard verdict={run.verdict} stage={stage} />}

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ steps */

type Actor = "A" | "B" | "sync" | "knot";

function actorOf(step: ScenarioStep): Actor {
  if (step.do === "wait") return "sync";
  if (step.do === "explain") return "knot";
  return step.pane;
}

function actorColor(actor: Actor): string {
  if (actor === "sync") return "var(--ink-2)";
  if (actor === "knot") return "var(--knot)";
  return threadColor(actor);
}

function StepList({ steps, statuses, notes }: { steps: readonly ScenarioStep[]; statuses: readonly StepStatus[]; notes: readonly (string | null)[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const active = statuses.indexOf("active");

  // Keep the step being performed in view inside the seam's scroller.
  useEffect(() => {
    if (active < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-step="${active}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ol ref={listRef} className="px-3.5 pb-3 pt-3" aria-label="Steps">
      {steps.map((step, i) => (
        <StepRow key={i} index={i} step={step} status={statuses[i] ?? "pending"} note={notes[i] ?? null} last={i === steps.length - 1} />
      ))}
    </ol>
  );
}

const STATUS_WORD: Record<StepStatus, string> = { pending: "to do", active: "in progress", done: "done", failed: "failed" };

function StepRow({ index, step, status, note, last }: { index: number; step: ScenarioStep; status: StepStatus; note: string | null; last: boolean }) {
  const actor = actorOf(step);
  const color = actorColor(actor);
  return (
    <li data-step={index} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 pb-2.5 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[10.5px] top-[20px] w-px"
          style={status === "done" ? { background: color, opacity: 0.55 } : { backgroundImage: "linear-gradient(var(--line-2) 50%, transparent 0)", backgroundSize: "1px 5px" }}
        />
      )}
      <Bead actor={actor} color={color} status={status} />
      <div className="min-w-0 pt-[1px]">
        <p
          className={clsx(
            "text-[12.5px] leading-snug",
            status === "active" && "font-medium text-ink",
            status === "done" && "text-ink-2",
            status === "pending" && "text-muted",
            status === "failed" && "text-knot",
          )}
        >
          <span className="sr-only">
            Step {index + 1}, {STATUS_WORD[status]}:{" "}
          </span>
          {step.say}
        </p>
        {note && <p className="mt-0.5 font-mono text-[10.5px] leading-snug text-muted">{note}</p>}
      </div>
    </li>
  );
}

function Bead({ actor, color, status }: { actor: Actor; color: string; status: StepStatus }) {
  const reduce = useReducedMotion();
  const letter = actor === "A" || actor === "B" ? actor : null;
  if (status === "done") {
    return (
      <span aria-hidden className="relative z-[1] grid size-[22px] place-items-center rounded-full text-paper" style={{ background: color }}>
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span aria-hidden className="relative z-[1] grid size-[22px] place-items-center rounded-full bg-knot text-paper">
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  }
  const inner =
    actor === "knot" ? (
      <KnotIcon size={13} strokeWidth={2.2} />
    ) : actor === "sync" ? (
      <span className="text-[11px] font-bold leading-none">⇄</span>
    ) : (
      <span className="text-[10.5px] font-bold leading-none">{letter}</span>
    );
  if (status === "active") {
    return (
      <span aria-hidden className="relative z-[1] grid size-[22px] place-items-center">
        {!reduce && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 2px ${color}` }}
            animate={{ scale: [1, 1.45], opacity: [0.7, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span
          className="relative grid size-[22px] place-items-center rounded-full"
          style={{ color, background: `color-mix(in oklab, ${color} 16%, var(--panel))`, boxShadow: `inset 0 0 0 2px ${color}` }}
        >
          {inner}
        </span>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="relative z-[1] grid size-[22px] place-items-center rounded-full bg-panel"
      style={{ color: `color-mix(in oklab, ${color} 70%, var(--muted))`, boxShadow: "inset 0 0 0 1.5px var(--line-2)" }}
    >
      {inner}
    </span>
  );
}

/* ------------------------------------------------------------------ verdict */

function VerdictCard({ verdict, stage }: { verdict: Verdict; stage: Stage }) {
  const reduce = useReducedMotion();
  const tone =
    verdict.tone === "knot"
      ? { color: "var(--knot)", label: "The verdict", icon: null as LucideIcon | null }
      : verdict.tone === "undo"
        ? { color: "var(--warn)", label: "Undo, explained", icon: Undo2 }
        : { color: "var(--muted)", label: "Result", icon: Info };
  const Icon = tone.icon;

  const openExplanation = () => {
    if (verdict.conflictId && verdict.lineageKey) stage.focusConflict({ id: verdict.conflictId, lineageKey: verdict.lineageKey });
    document.getElementById("seam-knots")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0.1 : 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className="mx-3.5 mb-3.5 rounded-[12px] border px-3 py-2.5"
      style={{ borderColor: `color-mix(in oklab, ${tone.color} 35%, var(--line))`, background: `color-mix(in oklab, ${tone.color} 6%, var(--panel))` }}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: tone.color }}>
        {Icon ? <Icon aria-hidden className="size-3.5" strokeWidth={2} /> : <KnotIcon size={14} strokeWidth={2.1} />}
        {tone.label}
      </p>
      <p className="mt-1 font-serif text-[18px] leading-[1.2] text-ink">{verdict.question}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{verdict.answer}</p>
      {verdict.conflictId && (
        <button
          type="button"
          onClick={openExplanation}
          className="mt-2 inline-flex items-center gap-1 rounded-[8px] px-1.5 py-1 text-[12px] font-semibold text-ink underline decoration-line-2 underline-offset-2 hover:bg-panel-2"
        >
          <ArrowDown aria-hidden className="size-3.5" />
          Step through the whole decision
        </button>
      )}
      {verdict.tone === "undo" && verdict.pane && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
          <ThreadBadge label={verdict.pane} size="xs" />
          Tab {verdict.pane} got the same news as a toast.
        </p>
      )}
    </motion.div>
  );
}
