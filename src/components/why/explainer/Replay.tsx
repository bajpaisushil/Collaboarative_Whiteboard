"use client";
/**
 * "Replay the merge" — a two-lane space-time strip stepped in six beats:
 *   1 lanes & common past · 2 one side's edit + its causal cone · 3 the other edit lands
 *   outside that cone · 4 and vice versa · 5 the stamps are compared · 6 the winning thread
 *   runs into the result.
 * ◀ ▶ / arrow keys step; it auto-plays once when opened. Reduced motion → a static,
 * numbered storyboard with every beat's caption listed.
 */
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSession } from "@/lib/session/react";
import { IconButton } from "@/components/ui/IconButton";
import { plural } from "../format";
import { buildReplay, conePoints, RP, type ReplayDot } from "./replayModel";
import { useExplainer, type DisplaySide, type ExplainerModel } from "./model";

const BEATS = 6;
const BEAT_MS = 2400;

function captions(model: ExplainerModel, commonTotal: number): string[] {
  const [top, bottom] = model.sides;
  const T = top.thread.label;
  const B = bottom.thread.label;
  const { conflict, explanation, noun } = model;
  const decisive = explanation.steps.find((s) => s.outcome === "decisive");
  const lead = model.lead;
  const lose = lead === top ? bottom : top;
  let stamps: string;
  let result: string;
  if (conflict.kind === "concurrent-write") {
    const tie = lead.side.lamport === lose.side.lamport;
    stamps = tie
      ? `The stamps tie at L${lead.side.lamport}, so the tab ids break the tie — the same way on every tab. ${lead.thread.label} wins.`
      : `So every tab compares the stamps: L${lead.side.lamport} beats L${lose.side.lamport}. The bigger counter wins — ${lead.thread.label}.`;
    result = `${lead.thread.label}'s thread runs through to the result. ${lose.thread.label}'s value stays in the history.`;
  } else if (conflict.kind === "delete-vs-edit") {
    const del = model.sides.find((d) => d.role === "delete") ?? lose;
    const edit = model.sides.find((d) => d.role === "edit") ?? lead;
    stamps = `A delete only removes what it has seen. ${del.thread.label}'s delete never saw ${edit.thread.label}'s edit, so it can't remove it.`;
    result = `${edit.thread.label}'s edit carries the ${noun} into the result — nothing done offline is silently lost.`;
  } else {
    const first = explanation.textAnchors?.[0]?.order[0];
    const firstLabel = first ? model.threadOf(first.replica).label : lead.thread.label;
    const secondLabel = firstLabel === T ? B : T;
    stamps = decisive?.plain ?? `Text keeps both. The newer insert sits closer to the spot where both typed.`;
    result = `Both threads are woven into the result: ${firstLabel}'s text first, then ${secondLabel}'s.`;
  }
  return [
    commonTotal > 0
      ? `Both tabs start from the same history — ${plural(commonTotal, "edit")} they had both seen.`
      : "Both tabs start from the same empty history.",
    `${T} makes its edit (L${top.side.lamport}). The shaded cone is everything ${T} knew about at that moment.`,
    `${B}'s edit (L${bottom.side.lamport}) lands outside ${T}'s cone — ${T} never saw it.`,
    `And ${T}'s edit lies outside ${B}'s cone. Neither saw the other, so there is no “last” edit to pick.`,
    stamps,
    result,
  ];
}

function Show({ on, children, reduce }: { on: boolean; children: ReactNode; reduce: boolean }) {
  return (
    <motion.g initial={false} animate={{ opacity: on ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.35 }} style={{ pointerEvents: "none" }}>
      {children}
    </motion.g>
  );
}

function Badge({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={7} fill="var(--ink)" />
      <text y={3.3} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--panel)" fontFamily="var(--font-geist-mono), monospace">
        {n}
      </text>
    </g>
  );
}

function Stamp({ d, dot, win, tie }: { d: DisplaySide; dot: ReplayDot; win: boolean; tie: boolean }) {
  const y = dot.lane === 0 ? RP.laneY[0] - 36 : RP.laneY[1] + 14;
  const text = tie ? `L${d.side.lamport} · ${d.side.replica.slice(0, 4)}` : `L${d.side.lamport}`;
  const w = 12 + text.length * 6.2;
  return (
    <g transform={`translate(${dot.x - w / 2} ${y})`}>
      <rect width={w} height={20} rx={6} fill={win ? d.thread.color : "var(--panel)"} stroke={d.thread.color} strokeWidth={1.3} strokeDasharray={win ? undefined : "3 2"} />
      <text x={w / 2} y={13.6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={win ? "var(--panel)" : "var(--ink)"} fontFamily="var(--font-geist-mono), monospace">
        {text}
      </text>
    </g>
  );
}

export const Replay = memo(function Replay() {
  const model = useExplainer();
  const session = useSession();
  const reduce = useReducedMotion() ?? false;
  const [beat, setBeat] = useState(1);
  const [playing, setPlaying] = useState(true);
  const geo = useMemo(() => buildReplay(model.explanation, model.sides, (id) => session.replica.getOp(id)), [model, session]);
  const lines = useMemo(() => captions(model, geo.commonTotal), [model, geo.commonTotal]);
  const active = playing && !reduce && beat < BEATS;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setBeat((b) => Math.min(BEATS, b + 1)), BEAT_MS);
    return () => clearInterval(t);
  }, [active]);

  const shown = reduce ? BEATS : beat;
  const go = (b: number) => {
    setPlaying(false);
    setBeat(Math.max(1, Math.min(BEATS, b)));
  };
  const togglePlay = () => {
    if (active) {
      setPlaying(false);
      return;
    }
    if (beat >= BEATS) setBeat(1);
    setPlaying(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight") go(beat + 1);
    else if (e.key === "ArrowLeft") go(beat - 1);
    else if (e.key === "Home") go(1);
    else if (e.key === "End") go(BEATS);
    else if (e.key === " " || e.key === "k") togglePlay();
    else return;
    e.preventDefault();
  };

  const [top, bottom] = model.sides;
  const [eTop, eBot] = geo.edits;
  const [yT, yB] = RP.laneY;
  const kind = model.conflict.kind;
  const tie = kind === "concurrent-write" && top.side.lamport === bottom.side.lamport;
  const winners = kind === "concurrent-text" ? new Set([0, 1]) : new Set([model.sides.indexOf(model.lead)]);
  const threadPath = (dot: ReplayDot) => `M${dot.x} ${dot.lane === 0 ? yT : yB} C ${dot.x + 26} ${dot.lane === 0 ? yT : yB}, ${RP.resultX - 30} ${RP.resultY}, ${RP.resultX - 13} ${RP.resultY}`;
  const loserPath = (dot: ReplayDot) => {
    const y = dot.lane === 0 ? yT : yB;
    return `M${dot.x} ${y} C ${dot.x + 18} ${y}, ${dot.x + 28} ${(y + RP.resultY) / 2}, ${dot.x + 34} ${(y + RP.resultY) / 2}`;
  };

  const svg = (
    <svg viewBox={`0 0 ${RP.w} ${RP.h}`} className="block h-auto w-full" aria-hidden fill="none" strokeLinecap="round">
      {/* cones (under everything) */}
      <Show on={shown >= 2} reduce={reduce}>
        <polygon points={conePoints(0, eTop.x, geo.seenEdge[0])} fill={`color-mix(in oklab, ${top.thread.color} ${shown >= 4 ? 9 : 15}%, transparent)`} />
      </Show>
      <Show on={shown >= 4} reduce={reduce}>
        <polygon points={conePoints(1, eBot.x, geo.seenEdge[1])} fill={`color-mix(in oklab, ${bottom.thread.color} 13%, transparent)`} />
      </Show>

      {/* lanes */}
      {model.sides.map((d, i) => {
        const y = RP.laneY[i];
        return (
          <g key={d.side.opId}>
            <line x1={RP.xStart} y1={y} x2={RP.xLast + 12} y2={y} stroke={d.thread.color} strokeWidth={1.6} strokeDasharray={d.thread.dash || "1 0"} opacity={0.55} />
            <g transform={`translate(14 ${y})`}>
              <circle r={10} fill={d.thread.color} />
              <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--panel)" fontFamily="var(--font-geist-sans), system-ui">
                {d.thread.label}
              </text>
            </g>
            {geo.hidden[i] > 0 && (
              <text x={RP.xStart + 4} y={y - 8} fontSize={8.5} fill="var(--muted)" fontFamily="var(--font-geist-mono), monospace">
                +{geo.hidden[i]}
              </text>
            )}
          </g>
        );
      })}

      {/* history dots */}
      {geo.dots
        .filter((d) => d.role !== "edit")
        .map((d) => {
          const side = model.sides[d.lane];
          const on = d.role === "common" ? shown >= 1 : shown >= (d.lane === 0 ? 2 : 3);
          return (
            <Show key={d.id} on={on} reduce={reduce}>
              <circle
                cx={d.x}
                cy={RP.laneY[d.lane]}
                r={4}
                fill={d.role === "common" ? "var(--ink-2)" : side.thread.color}
                stroke="var(--panel)"
                strokeWidth={1.5}
                opacity={d.role === "common" ? 0.7 : 0.85}
              />
            </Show>
          );
        })}

      {/* the result and the threads into it */}
      <Show on={shown >= 6} reduce={reduce}>
        {geo.edits.map((dot, i) =>
          winners.has(i) ? null : (
            <g key={dot.id}>
              <path d={loserPath(dot)} stroke={model.sides[i].thread.color} strokeWidth={1.6} strokeDasharray="2 4" opacity={0.7} />
              <g transform={`translate(${dot.x + 38} ${(RP.laneY[i] + RP.resultY) / 2})`}>
                <path d="M-3 -3 L3 3 M3 -3 L-3 3" stroke={model.sides[i].thread.color} strokeWidth={1.6} />
              </g>
            </g>
          ),
        )}
        <circle cx={RP.resultX} cy={RP.resultY} r={13} fill="var(--panel)" stroke="var(--ink)" strokeWidth={1.5} />
        <path d={`M${RP.resultX - 5} ${RP.resultY} l3.5 3.5 l6 -7`} stroke="var(--ok)" strokeWidth={2} strokeLinejoin="round" />
        <text x={RP.resultX} y={RP.resultY + 26} textAnchor="middle" fontSize={8.5} letterSpacing="0.1em" fontWeight={600} fill="var(--muted)" fontFamily="var(--font-geist-mono), monospace">
          RESULT
        </text>
      </Show>
      {geo.edits.map((dot, i) =>
        winners.has(i) ? (
          <motion.path
            key={dot.id}
            d={threadPath(dot)}
            stroke={model.sides[i].thread.color}
            strokeWidth={2.6}
            initial={false}
            animate={{ pathLength: shown >= 6 ? 1 : 0, opacity: shown >= 6 ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.8, ease: [0.3, 0.7, 0.2, 1] }}
          />
        ) : null,
      )}

      {/* the two edits */}
      {geo.edits.map((dot, i) => {
        const d = model.sides[i];
        const y = RP.laneY[i];
        return (
          <Show key={dot.id} on={shown >= (i === 0 ? 2 : 3)} reduce={reduce}>
            <circle cx={dot.x} cy={y} r={7.5} fill={d.thread.color} stroke="var(--panel)" strokeWidth={2} />
            <circle cx={dot.x} cy={y} r={2.2} fill="var(--panel)" />
          </Show>
        );
      })}

      {/* "never saw it" callouts */}
      <Show on={shown >= 3 && shown <= 4} reduce={reduce}>
        <circle cx={eBot.x} cy={yB} r={12} stroke="var(--knot)" strokeWidth={1.5} strokeDasharray="3 2.5" />
        <text x={Math.min(eBot.x + 16, RP.w - 8)} y={yB + 24} textAnchor={eBot.x > 220 ? "end" : "start"} fontSize={9.5} fontWeight={600} fill="var(--knot)" fontFamily="var(--font-geist-sans), system-ui">
          {top.thread.label} never saw this
        </text>
      </Show>
      <Show on={shown === 4} reduce={reduce}>
        <circle cx={eTop.x} cy={yT} r={12} stroke="var(--knot)" strokeWidth={1.5} strokeDasharray="3 2.5" />
        <text x={Math.min(eTop.x + 16, RP.w - 8)} y={yT - 18} textAnchor={eTop.x > 220 ? "end" : "start"} fontSize={9.5} fontWeight={600} fill="var(--knot)" fontFamily="var(--font-geist-sans), system-ui">
          {bottom.thread.label} never saw this
        </text>
      </Show>

      {/* stamps */}
      <Show on={shown >= 5} reduce={reduce}>
        {geo.edits.map((dot, i) => (
          <Stamp key={dot.id} d={model.sides[i]} dot={dot} win={model.sides[i] === model.lead} tie={tie} />
        ))}
      </Show>

      {reduce && (
        <g>
          <Badge n={1} x={RP.xStart + 2} y={RP.resultY} />
          <Badge n={2} x={eTop.x - 14} y={yT - 14} />
          <Badge n={3} x={eBot.x - 14} y={yB + 14} />
          <Badge n={4} x={Math.max(RP.xStart + 22, eBot.x - 34)} y={yB - 16} />
          <Badge n={5} x={eTop.x + 30} y={yT - 26} />
          <Badge n={6} x={RP.resultX - 16} y={RP.resultY - 18} />
        </g>
      )}
    </svg>
  );

  if (reduce) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-[12px] border border-line bg-paper px-2 py-2">{svg}</div>
        <ol className="flex flex-col gap-1.5">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
              <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full bg-ink font-mono text-[9px] font-bold text-paper">{i + 1}</span>
              {l}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        tabIndex={0}
        role="group"
        aria-roledescription="replay"
        aria-label={`Replay of the merge, beat ${beat} of ${BEATS}. Use the left and right arrow keys to step, space to play or pause.`}
        data-own-keys=""
        onKeyDown={onKeyDown}
        className="rounded-[12px] border border-line bg-paper px-2 py-2 outline-none focus-visible:shadow-[0_0_0_2px_var(--focus)]"
      >
        {svg}
      </div>
      <p aria-live="polite" className="min-h-[3.2em] text-[12.5px] leading-relaxed text-ink-2">
        <span className="mr-1.5 font-mono text-[10.5px] text-muted">
          {beat}/{BEATS}
        </span>
        {lines[beat - 1]}
      </p>
      <div className="flex items-center gap-1.5">
        <IconButton icon={ChevronLeft} label="Previous beat" shortcut="←" size="sm" onClick={() => go(beat - 1)} disabled={beat <= 1} />
        <IconButton
          icon={active ? Pause : beat >= BEATS ? RotateCcw : Play}
          label={active ? "Pause replay" : beat >= BEATS ? "Replay from the start" : "Play"}
          shortcut="Space"
          size="sm"
          onClick={togglePlay}
        />
        <IconButton icon={ChevronRight} label="Next beat" shortcut="→" size="sm" onClick={() => go(beat + 1)} disabled={beat >= BEATS} />
        <span className="ml-auto flex items-center gap-1" role="group" aria-label="Jump to beat">
          {Array.from({ length: BEATS }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Beat ${i + 1}`}
              aria-current={beat === i + 1 ? "step" : undefined}
              title={`Beat ${i + 1}`}
              onClick={() => go(i + 1)}
              className="grid size-5 place-items-center rounded-full"
            >
              <span
                aria-hidden
                className={clsx("block rounded-full transition-all duration-200", beat === i + 1 ? "h-2 w-4 bg-ink" : i + 1 < beat ? "size-2 bg-ink-2" : "size-2 bg-line-2")}
              />
            </button>
          ))}
        </span>
      </div>
    </div>
  );
});
