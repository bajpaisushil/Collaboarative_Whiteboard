"use client";
/**
 * Scenes: the tour call-to-action, the scripted-conflict buttons, and the card of the scene
 * that is playing (or just finished). Scene buttons are disabled while one runs.
 */
import clsx from "clsx";
import { ChevronRight, Footprints, Hourglass, Palette, Scaling, Trash2, Type, Undo2, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { threadColor } from "@/lib/ui/colors";
import { useExternal } from "./hooks";
import { RunCard } from "./RunCard";
import type { ScenarioRunner } from "./runner";
import { SCENARIOS, scenarioById, type Scenario, type ScenarioId } from "./scenarios";
import type { Stage } from "./stage";
import type { TourController } from "./tour";

const ICONS: Record<ScenarioId, LucideIcon> = {
  "colour-clash": Palette,
  "offline-marathon": Hourglass,
  "delete-vs-edit": Trash2,
  "typing-together": Type,
  "move-vs-resize": Scaling,
  "undo-after-merge": Undo2,
};

export function ScenePanel({ runner, tour, stage }: { runner: ScenarioRunner; tour: TourController; stage: Stage }) {
  const run = useExternal(runner);
  const headingId = useId();
  const busy = run.phase === "setup" || run.phase === "running";
  const current = run.scenarioId ? scenarioById(run.scenarioId) : undefined;

  const play = (s: Scenario) => {
    void runner.run(s, stage);
  };

  return (
    <section aria-labelledby={headingId} className="relative px-4 pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">
          Scenes
        </h2>
        <span className="text-[11px] text-muted">scripted clashes — watch both tabs</span>
      </div>

      <TourCta disabled={busy} onStart={() => tour.start()} />

      {current && run.phase !== "idle" && (
        <RunCard
          scenario={current}
          run={run}
          stage={stage}
          icon={ICONS[current.id]}
          onStop={() => runner.stop()}
          onReplay={() => play(current)}
          onDismiss={() => runner.dismiss()}
        />
      )}

      <ul className="mt-3 grid grid-cols-2 gap-1.5">
        {SCENARIOS.map((s) => {
          const Icon = ICONS[s.id];
          const isCurrent = run.scenarioId === s.id && run.phase !== "idle";
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={busy}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => play(s)}
                title={`Play “${s.title}”: ${s.tagline}`}
                className={clsx(
                  "group flex h-full w-full flex-col gap-1 rounded-[12px] border bg-panel p-2.5 text-left transition-[background-color,border-color,opacity] duration-150",
                  "hover:border-line-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-45",
                  isCurrent ? "border-ink/40 shadow-[inset_0_0_0_1px_var(--line-2)]" : "border-line",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Icon aria-hidden className="size-[15px] shrink-0 text-ink-2 group-hover:text-ink" strokeWidth={1.75} />
                  <span className="truncate text-[12.5px] font-semibold tracking-tight text-ink">{s.title}</span>
                </span>
                <span className="line-clamp-2 text-[11px] leading-snug text-muted">{s.tagline}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TourCta({ disabled, onStart }: { disabled: boolean; onStart: () => void }) {
  const a = threadColor("A");
  const b = threadColor("B");
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onStart}
      className="group mt-2.5 flex w-full items-center gap-3 rounded-[14px] border border-line p-3 text-left transition-[border-color,transform] duration-150 hover:border-line-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        background: `linear-gradient(100deg, color-mix(in oklab, ${a} 10%, var(--panel)) 0%, var(--panel) 45%, var(--panel) 55%, color-mix(in oklab, ${b} 10%, var(--panel)) 100%)`,
      }}
    >
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-paper">
        <Footprints className="size-[17px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold tracking-tight text-ink">Take the 60-second tour</span>
        <span className="block text-[11.5px] leading-snug text-ink-2">Five steps. You do them in the tabs — the desk checks your work.</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
