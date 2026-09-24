"use client";
/**
 * The knot as a picture: the common past splits into each side's version and the two
 * threads merge into the result — drawn as one SVG so frames and threads line up exactly.
 * Every frame shares one world rectangle (a single camera), so movement between frames is real.
 *
 * panel: Before → (A over B) → Result, left to right.
 * seam:  Before on top, A on the left (facing pane A), B on the right, Result in the middle.
 */
import { memo } from "react";
import type { OpId, ShapeView } from "@/lib/crdt/types";
import type { Rect } from "@/lib/ui/geometry";
import { ShapesThumb } from "@/components/canvas/ShapeSvg";
import type { Film, FilmFrame } from "./useFilm";
import { roleWord, useExplainer, type DisplaySide, type WhyVariant } from "./model";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  vb: [number, number];
  before: Box;
  sides: [Box, Box];
  result: Box;
  /** Thread paths: before → side, side → result. */
  fork: [string, string];
  merge: [string, string];
  /** Where a losing thread stops (✕ mark). */
  cut: [[number, number], [number, number]];
  beforeLabel: { x: number; y: number; anchor: "start" | "middle" | "end" };
  resultLabel: { x: number; y: number };
}

const PANEL: Layout = {
  vb: [360, 200],
  before: { x: 0, y: 66, w: 80, h: 64 },
  sides: [
    { x: 136, y: 10, w: 104, h: 74 },
    { x: 136, y: 116, w: 104, h: 74 },
  ],
  result: { x: 280, y: 66, w: 80, h: 64 },
  fork: ["M80 98 C 110 98, 106 47, 136 47", "M80 98 C 110 98, 106 153, 136 153"],
  merge: ["M240 47 C 264 47, 256 98, 280 98", "M240 153 C 264 153, 256 98, 280 98"],
  cut: [
    [258, 68],
    [258, 128],
  ],
  beforeLabel: { x: 0, y: 58, anchor: "start" },
  resultLabel: { x: 280, y: 58 },
};

const SEAM: Layout = {
  vb: [360, 196],
  before: { x: 146, y: 0, w: 68, h: 50 },
  sides: [
    { x: 0, y: 60, w: 116, h: 84 },
    { x: 244, y: 60, w: 116, h: 84 },
  ],
  result: { x: 134, y: 92, w: 92, h: 76 },
  fork: ["M146 25 C 92 25, 58 30, 58 60", "M214 25 C 268 25, 302 30, 302 60"],
  merge: ["M116 102 C 126 102, 122 130, 134 130", "M244 102 C 234 102, 238 130, 226 130"],
  cut: [
    [124, 112],
    [236, 112],
  ],
  beforeLabel: { x: 140, y: 28, anchor: "end" },
  resultLabel: { x: 134, y: 186 },
};

function Frame({
  box,
  frame,
  focus,
  ring,
  onEnter,
  onLeave,
}: {
  box: Box;
  frame: FilmFrame;
  focus: Rect | null;
  ring?: string;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const { x, y, w, h } = box;
  return (
    <g transform={`translate(${x} ${y})`} onPointerEnter={onEnter} onPointerLeave={onLeave} style={onEnter ? { cursor: "help" } : undefined}>
      <rect width={w} height={h} rx={9} fill="var(--paper)" stroke={ring ?? "var(--line-2)"} strokeWidth={ring ? 2 : 1} />
      {frame.shape && (
        <g opacity={frame.dead ? 0.22 : 1}>
          <ShapesThumb shapes={[frame.shape as ShapeView]} width={w} height={h} focus={focus} padding={14} background="transparent" />
        </g>
      )}
      {frame.dead && (
        <g>
          <rect x={w * 0.2} y={h * 0.22} width={w * 0.6} height={h * 0.5} rx={5} fill="none" stroke="var(--muted)" strokeWidth={1.3} strokeDasharray="4 3" />
          <path
            d={`M${w * 0.32} ${h * 0.32} L${w * 0.68} ${h * 0.62} M${w * 0.68} ${h * 0.32} L${w * 0.32} ${h * 0.62}`}
            stroke="var(--muted)"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <text x={w / 2} y={h - 6} textAnchor="middle" fontSize={8.5} letterSpacing="0.1em" fill="var(--muted)" fontFamily="var(--font-geist-mono), monospace">
            {frame.shape ? "DELETED" : "NOT THERE"}
          </text>
        </g>
      )}
    </g>
  );
}

/** Letter chip + outcome tag pinned to a side frame. */
function SideTag({ box, d, won }: { box: Box; d: DisplaySide; won: boolean }) {
  const c = d.thread.color;
  const word = roleWord(d.role);
  const tagW = 10 + word.length * 5.4;
  return (
    <g transform={`translate(${box.x} ${box.y})`} pointerEvents="none">
      <g transform="translate(6 6)">
        <rect width={18} height={18} rx={9} fill={c} />
        <text x={9} y={12.6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--panel)" fontFamily="var(--font-geist-sans), system-ui">
          {d.thread.label}
        </text>
      </g>
      <g transform={`translate(${box.w - tagW - 6} ${box.h - 20})`}>
        <rect
          width={tagW}
          height={14}
          rx={7}
          fill={won ? c : "var(--panel)"}
          stroke={won ? c : "var(--line-2)"}
          strokeDasharray={won ? undefined : "3 2"}
        />
        <text x={tagW / 2} y={10} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={won ? "var(--panel)" : "var(--ink-2)"} fontFamily="var(--font-geist-sans), system-ui">
          {word}
        </text>
      </g>
    </g>
  );
}

function Cross({ at, color }: { at: [number, number]; color: string }) {
  const [x, y] = at;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={6.5} fill="var(--panel)" stroke={color} strokeWidth={1.3} />
      <path d="M-2.6 -2.6 L2.6 2.6 M2.6 -2.6 L-2.6 2.6" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
}

function Caption({ x, y, anchor = "start", children }: { x: number; y: number; anchor?: "start" | "middle" | "end"; children: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={9} letterSpacing="0.12em" fontWeight={600} fill="var(--muted)" fontFamily="var(--font-geist-mono), monospace">
      {children}
    </text>
  );
}

export const Filmstrip = memo(function Filmstrip({
  film,
  variant,
  onSideEnter,
  onSideLeave,
}: {
  film: Film;
  variant: WhyVariant;
  onSideEnter: (opId: OpId) => void;
  onSideLeave: () => void;
}) {
  const model = useExplainer();
  const L = variant === "seam" ? SEAM : PANEL;
  const [left, right] = model.sides;
  const kept = (d: DisplaySide) => d.role === "winner" || d.role === "edit" || d.role === "first" || d.role === "second";

  const describe = (f: FilmFrame) => (f.dead ? (f.shape ? "deleted" : "not there yet") : "present");
  const summary = [
    `Before: the ${model.noun} was ${describe(film.before)}.`,
    ...model.sides.map((d, i) => `${d.thread.label}'s version: ${d.side.summary} (${roleWord(d.role)}); ${describe(film.sides[i])}.`),
    `Result: ${film.result.dead ? "deleted" : `the ${model.noun} as it is now`}.`,
  ].join(" ");

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${L.vb[0]} ${L.vb[1]}`}
        className="block h-auto w-full overflow-visible"
        aria-hidden
        fill="none"
        strokeLinecap="round"
      >
        {/* threads first, so frames sit on top of them */}
        {model.sides.map((d, i) => {
          const won = kept(d);
          return (
            <g key={d.side.opId}>
              <path d={L.fork[i]} stroke={d.thread.color} strokeWidth={2.2} strokeDasharray={d.thread.dash || undefined} opacity={0.9} />
              <path
                d={L.merge[i]}
                stroke={d.thread.color}
                strokeWidth={won ? 2.6 : 1.6}
                strokeDasharray={won ? d.thread.dash || undefined : "2 4"}
                opacity={won ? 1 : 0.6}
              />
            </g>
          );
        })}
        <Frame box={L.before} frame={film.before} focus={film.focus} />
        {model.sides.map((d, i) => (
          <Frame
            key={d.side.opId}
            box={L.sides[i]}
            frame={film.sides[i]}
            focus={film.focus}
            ring={d === model.lead && model.hasLoser ? d.thread.color : undefined}
            onEnter={() => onSideEnter(d.side.opId)}
            onLeave={onSideLeave}
          />
        ))}
        <Frame box={L.result} frame={film.result} focus={film.focus} ring="var(--ink-2)" />
        {model.hasLoser && model.sides.map((d, i) => (!kept(d) ? <Cross key={d.side.opId} at={L.cut[i]} color={d.thread.color} /> : null))}
        {model.sides.map((d, i) => (
          <SideTag key={d.side.opId} box={L.sides[i]} d={d} won={kept(d) && (model.hasLoser || d.role === "first")} />
        ))}
        <Caption x={L.beforeLabel.x} y={L.beforeLabel.y} anchor={L.beforeLabel.anchor}>
          BEFORE
        </Caption>
        <Caption x={L.resultLabel.x} y={L.resultLabel.y}>
          RESULT
        </Caption>
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
      {variant === "panel" && (
        <p className="mt-1.5 flex items-center justify-between px-0.5 text-[10.5px] text-muted">
          <span>Hover a version to see it on the canvas</span>
          <span className="inline-flex items-center gap-1">
            <span className="font-medium" style={{ color: left.thread.color }}>
              {left.thread.label}
            </span>
            <span aria-hidden>·</span>
            <span className="font-medium" style={{ color: right.thread.color }}>
              {right.thread.label}
            </span>
          </span>
        </p>
      )}
    </figure>
  );
});
