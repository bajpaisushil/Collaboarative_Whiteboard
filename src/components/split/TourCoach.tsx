"use client";
/**
 * The 60-second tour, coached from the seam: a progress thread (A's and B's threads fill in as
 * the viewer completes steps, meeting in a knot at the end), the five steps with the current
 * one expanded, live hints about what the desk can see, and "Auto-play this step".
 */
import clsx from "clsx";
import { Check, Play, X } from "lucide-react";
import { useId } from "react";
import type { ShapeId, ShapeView } from "@/lib/crdt/types";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { threadColor } from "@/lib/ui/colors";
import { ShapesThumb } from "@/components/canvas/ShapeSvg";
import { IconButton } from "@/components/ui/IconButton";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { useExternal, useViewSelect } from "./hooks";
import { TourProgress } from "./TourProgress";
import type { Stage } from "./stage";
import { TOUR_STEPS, type TourController, type TourSnapshot, type TourStepDef } from "./tour";

export function TourCoach({ tour, stage }: { tour: TourController; stage: Stage }) {
  const t = useExternal(tour);
  const headingId = useId();
  const finished = t.step >= TOUR_STEPS.length;
  const current = TOUR_STEPS[t.step];

  return (
    <section aria-labelledby={headingId} className="relative px-4 pt-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">
            The 60-second tour
          </h2>
          <p className="text-[12px] text-ink-2" aria-live="polite">
            {finished ? "All five steps done." : `Step ${t.step + 1} of ${TOUR_STEPS.length} — ${current.title}`}
          </p>
        </div>
        <IconButton icon={X} label="Exit the tour" size="sm" onClick={() => tour.exit()} />
      </div>

      <div className="mt-2 rounded-[14px] border border-line bg-panel px-3 pb-2 pt-2.5">
        <TourProgress step={t.step} />
      </div>

      <ol className="mt-3 flex flex-col gap-1.5">
        {TOUR_STEPS.map((def, i) => (
          <TourStepRow key={def.id} def={def} index={i} snap={t} stage={stage} tour={tour} />
        ))}
      </ol>

      {finished && (
        <div className="mt-3 rounded-[14px] border px-3.5 py-3" style={{ borderColor: "color-mix(in oklab, var(--ok) 40%, var(--line))", background: "color-mix(in oklab, var(--ok) 7%, var(--panel))" }}>
          <p className="font-serif text-[20px] italic leading-tight text-ink">That’s the whole trick.</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
            Two tabs edited while apart, merged without a server, and can show exactly why they agree. The explanation is open below — try the “What if…” section, then play a scene.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => tour.exit()} className="rounded-[9px] bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-paper hover:bg-ink-2">
              Try a scripted scene
            </button>
            <button type="button" onClick={() => tour.start()} className="rounded-[9px] border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-panel-2">
              Take the tour again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function actorBadges(def: TourStepDef) {
  if (def.actor === "knot") return <KnotIcon size={15} className="text-knot" strokeWidth={2.1} />;
  if (def.actor === "both")
    return (
      <span className="flex -space-x-1">
        <ThreadBadge label="A" size="xs" solid />
        <ThreadBadge label="B" size="xs" solid />
      </span>
    );
  return <ThreadBadge label={def.actor} size="xs" solid />;
}

function TourStepRow({ def, index, snap, stage, tour }: { def: TourStepDef; index: number; snap: TourSnapshot; stage: Stage; tour: TourController }) {
  const done = index < snap.step;
  const current = index === snap.step;
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={clsx(
        "rounded-[12px] border px-3 py-2 transition-colors",
        current ? "border-line-2 bg-panel shadow-sheet" : "border-transparent",
        !current && !done && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={clsx("grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-bold", done ? "bg-ok text-paper" : "bg-panel-2 text-ink-2")}
          style={current ? { boxShadow: "inset 0 0 0 1.5px var(--ink-2)" } : undefined}
        >
          {done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
        </span>
        <span className={clsx("min-w-0 flex-1 text-[12.5px] leading-snug", current ? "font-semibold text-ink" : done ? "text-ink-2" : "text-muted")}>
          <span className="sr-only">{done ? "Done: " : current ? "Current step: " : "Later: "}</span>
          {def.title}
        </span>
        <span aria-hidden className="shrink-0">
          {actorBadges(def)}
        </span>
      </div>
      {done && <p className="ml-7 mt-0.5 text-[11.5px] leading-snug text-muted">{def.done}</p>}
      {current && (
        <div className="ml-7 mt-1">
          <p className="text-[12px] leading-relaxed text-ink-2">{def.body}</p>
          <StepHints def={def} snap={snap} stage={stage} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {def.id === "why" && snap.conflictId && (
              <button
                type="button"
                onClick={() => tour.focusKnot()}
                className="inline-flex items-center gap-1.5 rounded-full bg-knot px-3 py-1.5 text-[12.5px] font-semibold text-paper shadow-sheet hover:opacity-90"
              >
                <KnotIcon size={15} strokeWidth={2.2} />
                Why?
              </button>
            )}
            {!(def.id === "why" && snap.conflictId) && (
              <button
                type="button"
                disabled={snap.busy}
                onClick={() => tour.autoplay()}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[12px] font-medium text-ink hover:border-line-2 disabled:opacity-50"
              >
                <Play aria-hidden className="size-3 fill-current" />
                Auto-play this step
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Tick({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 text-[11.5px]", ok ? "text-ok" : "text-muted")}>
      {ok ? <Check aria-hidden className="size-3" strokeWidth={3} /> : <span aria-hidden className="size-2 rounded-full border border-current" />}
      {label}
    </span>
  );
}

function StepHints({ def, snap, stage }: { def: TourStepDef; snap: TourSnapshot; stage: Stage }) {
  switch (def.id) {
    case "recolour":
      return (
        <div className="mt-2">
          {snap.stickyId && <TwoVersions stage={stage} shapeId={snap.stickyId} />}
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <Tick ok={snap.aChanged} label={snap.aChanged ? "A recoloured it" : "A: not yet"} />
            <Tick ok={snap.bChanged} label={snap.bChanged ? "B recoloured it" : snap.aChanged ? "B: pick a different colour" : "B: not yet"} />
          </p>
          {snap.bOnline && (
            <p className="mt-1.5 rounded-[8px] bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] px-2 py-1 text-[11.5px] leading-snug text-ink">
              Tab B is plugged in, so A’s colour would simply sync over. Unplug B first.
            </p>
          )}
        </div>
      );
    case "replug":
      return <p className="mt-1.5 text-[11.5px] text-muted">{snap.bOnline ? "Syncing…" : "Tab B is still offline."}</p>;
    case "why":
      return snap.conflictId ? null : <p className="mt-1.5 text-[11.5px] text-muted">Waiting for the knot to appear…</p>;
    default:
      return null;
  }
}

const selectShape = (id: ShapeId) => (v: { shapeById: ReadonlyMap<ShapeId, ShapeView> }) => v.shapeById.get(id) ?? null;

/** The note as each tab sees it right now. */
function TwoVersions({ stage, shapeId }: { stage: Stage; shapeId: ShapeId }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <Version pane="A" session={stage.panes.A.session} shapeId={shapeId} />
      <Version pane="B" session={stage.panes.B.session} shapeId={shapeId} />
    </div>
  );
}

function Version({ pane, session, shapeId }: { pane: "A" | "B"; session: WhiteboardSessionApi; shapeId: ShapeId }) {
  const shape = useViewSelect(session, selectShape(shapeId), null);
  const color = threadColor(pane);
  return (
    <figure className="overflow-hidden rounded-[10px] border bg-paper" style={{ borderColor: `color-mix(in oklab, ${color} 40%, var(--line))` }}>
      <div className="h-[64px]">
        {shape ? <ShapesThumb shapes={[shape]} width="100%" height="100%" padding={10} /> : <p className="grid h-full place-items-center text-[11px] text-muted">not here</p>}
      </div>
      <figcaption className="flex items-center gap-1 border-t border-line bg-panel px-1.5 py-1 text-[10.5px] text-ink-2">
        <ThreadBadge label={pane} size="xs" />
        Tab {pane} sees
      </figcaption>
    </figure>
  );
}
