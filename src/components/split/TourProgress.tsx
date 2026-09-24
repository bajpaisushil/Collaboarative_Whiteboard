"use client";
/**
 * Tour progress as two threads: A's on top, B's below. Each step is a bead on the thread of
 * the tab that acts (step 3 has one on each); completed stretches fill in the threads'
 * colours, and at the end both threads meet in a knot.
 */
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { TOUR_STEPS } from "./tour";

const Y_A = 15;
const Y_B = 41;
const KNOT = { x: 280, y: 28 };
const NODES: { x: number; lanes: ("A" | "B" | "knot")[] }[] = [
  { x: 40, lanes: ["A"] },
  { x: 100, lanes: ["B"] },
  { x: 160, lanes: ["A", "B"] },
  { x: 220, lanes: ["B"] },
  { x: KNOT.x, lanes: ["knot"] },
];
const PROGRESS_X = [10, 40, 100, 160, 220, 300];

const PATH_A = `M10 ${Y_A} H244 C262 ${Y_A} 266 ${KNOT.y} ${KNOT.x} ${KNOT.y}`;
const PATH_B = `M10 ${Y_B} H244 C262 ${Y_B} 266 ${KNOT.y} ${KNOT.x} ${KNOT.y}`;

const laneColor = (lane: "A" | "B" | "knot") => (lane === "A" ? "var(--thread-a)" : lane === "B" ? "var(--thread-b)" : "var(--knot)");

export function TourProgress({ step }: { step: number }) {
  const reduce = useReducedMotion();
  const clipId = useId();
  const doneCount = Math.min(step, TOUR_STEPS.length);
  const px = PROGRESS_X[doneCount];

  return (
    <svg viewBox="0 0 300 56" className="block h-auto w-full" role="img" aria-label={`Tour progress: ${doneCount} of ${TOUR_STEPS.length} steps done`}>
      <defs>
        <clipPath id={clipId}>
          <motion.rect x={0} y={0} height={56} initial={false} animate={{ width: px }} transition={{ duration: reduce ? 0 : 0.6, ease: [0.2, 0.8, 0.2, 1] }} />
        </clipPath>
      </defs>
      {/* Unwoven threads */}
      <path d={PATH_A} fill="none" stroke="var(--line-2)" strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
      <path d={PATH_B} fill="none" stroke="var(--line-2)" strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
      {/* Woven so far */}
      <g clipPath={`url(#${clipId})`}>
        <path d={PATH_B} fill="none" stroke="var(--thread-b)" strokeWidth={3} strokeLinecap="round" />
        <path d={PATH_A} fill="none" stroke="var(--thread-a)" strokeWidth={3} strokeLinecap="round" />
      </g>

      {NODES.map((node, i) =>
        node.lanes.map((lane) => {
          const state = i < doneCount ? "done" : i === doneCount ? "current" : "pending";
          const color = laneColor(lane);
          if (lane === "knot") {
            return (
              <g key={`${i}-${lane}`}>
                {state === "current" && !reduce && (
                  <motion.circle cx={KNOT.x} cy={KNOT.y} r={12} fill="none" stroke={color} strokeWidth={2} animate={{ r: [12, 17], opacity: [0.7, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }} />
                )}
                <circle cx={KNOT.x} cy={KNOT.y} r={12} fill={state === "done" ? color : "var(--panel)"} stroke={state === "pending" ? "var(--line-2)" : color} strokeWidth={2} />
                <KnotIcon x={KNOT.x - 8} y={KNOT.y - 8} size={16} strokeWidth={2.2} style={{ color: state === "done" ? "var(--panel)" : state === "current" ? color : "var(--muted)" }} />
              </g>
            );
          }
          const cy = lane === "A" ? Y_A : Y_B;
          return (
            <g key={`${i}-${lane}`}>
              {state === "current" && !reduce && (
                <motion.circle cx={node.x} cy={cy} r={8} fill="none" stroke={color} strokeWidth={2} animate={{ r: [8, 13], opacity: [0.7, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }} />
              )}
              <circle cx={node.x} cy={cy} r={8} fill={state === "done" ? color : "var(--panel)"} stroke={state === "pending" ? "var(--line-2)" : color} strokeWidth={2} />
              <text
                x={node.x}
                y={cy + 3.6}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fill={state === "done" ? "var(--panel)" : state === "current" ? color : "var(--muted)"}
              >
                {lane}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}
