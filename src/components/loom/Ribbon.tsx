"use client";
/**
 * The collapsed Loom: every replica is a thread braided across the whole history (x = position
 * in canonical order). Each edit is a tick in its author's colour, knots are ◆, snapshots are
 * flags, offline stretches are hatched. It's also the time-travel scrubber (role="slider"):
 * drag or use ←/→ to view the board as of any edit; the head at the right is "live".
 */
import clsx from "clsx";
import { memo, useId, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Op, ReplicaId, VectorClock } from "@/lib/crdt/types";
import { useUi, useUiStore } from "@/lib/ui/store";
import { useElementSize, useFocusedConflict, useLoomThreads, useNativeKeydown, type LoomData, type LoomThread } from "./hooks";
import { useOpHover } from "./hover";
import type { Lane, LoomModel } from "./model";
import { isLiveKnot } from "./ops";
import { describeScrub, isCutScrub, scrubForSlot, slotOfScrub, stepScrub, type Scrub } from "./scrub";

export const RIBBON_H = 30;
const MID = RIBBON_H / 2;
const PAD_L = 10;
const HEAD_W = 28;
const BRAID_PERIOD = 56;

export interface RibbonViewport {
  from: number;
  to: number;
}

interface Geometry {
  width: number;
  n: number;
  step: number;
  headX: number;
  x: (i: number) => number;
}

function geometry(width: number, n: number): Geometry {
  const inner = Math.max(1, width - PAD_L - HEAD_W - 6);
  const step = n > 0 ? inner / n : inner;
  return { width, n, step, headX: width - HEAD_W / 2 - 2, x: (i) => PAD_L + (i + 0.5) * step };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** One wavy thread per lane, phase-shifted so the threads cross over each other: a braid. */
function braidPaths(lanes: readonly Lane[], model: LoomModel, g: Geometry): (string | null)[] {
  const L = lanes.length;
  const amp = L > 1 ? Math.min(3.6, 1.6 + L * 0.5) : 0;
  return lanes.map((lane, l) => {
    const first = model.firstIndex.get(lane.replica);
    if (first === undefined) return null;
    const x0 = Math.max(PAD_L - 2, g.x(first) - g.step / 2);
    const x1 = g.headX - 5;
    if (x1 <= x0) return null;
    const phase = (2 * Math.PI * l) / Math.max(1, L);
    const y = (x: number) => MID + amp * Math.sin((2 * Math.PI * x) / BRAID_PERIOD + phase);
    let d = `M${r1(x0)} ${r1(y(x0))}`;
    for (let x = x0 + 4; x < x1; x += 4) d += `L${r1(x)} ${r1(y(x))}`;
    return d + `L${r1(x1)} ${r1(y(x1))}`;
  });
}

interface TickArt {
  solid: string;
  offline: string;
}

function tickHalf(op: Op): number {
  if (op.kind === "shape.create" || op.kind === "shape.delete") return 7;
  return 5;
}

/** Tick paths per lane; with `inside`, ops outside the predicate go into the second set. */
function tickPaths(model: LoomModel, laneOf: ReadonlyMap<ReplicaId, number>, laneCount: number, g: Geometry, inside?: (op: Op) => boolean) {
  const mk = () => Array.from({ length: laneCount }, (): TickArt => ({ solid: "", offline: "" }));
  const main = mk();
  const outside = mk();
  const { log } = model;
  for (let i = 0; i < log.length; i++) {
    const op = log[i];
    if (op.kind === "snapshot.mark") continue;
    const l = laneOf.get(op.replica);
    if (l === undefined) continue;
    const h = tickHalf(op);
    const seg = `M${r1(g.x(i))} ${MID - h}V${MID + h}`;
    const target = !inside || inside(op) ? main[l] : outside[l];
    if (op.meta.offline) target.offline += seg;
    else target.solid += seg;
  }
  return { main, outside };
}

function diamond(x: number, y: number, s: number): string {
  return `M${r1(x)} ${r1(y - s)}L${r1(x + s)} ${r1(y)}L${r1(x)} ${r1(y + s)}L${r1(x - s)} ${r1(y)}Z`;
}

export const Ribbon = memo(function Ribbon({ data, viewport }: { data: LoomData; viewport: RibbonViewport | null }) {
  const uid = useId().replace(/:/g, "");
  const store = useUiStore();
  const scrub = useUi((s) => s.scrub);
  const hoverOp = useUi((s) => s.hoverOp);
  const focused = useFocusedConflict();
  const threads = useLoomThreads();
  const hover = useOpHover();
  const [sizeRef, el, size] = useElementSize<HTMLDivElement>();
  const dragging = useRef(false);

  const { model, lanes: laneLayout, knots, snapshotAt } = data;
  const { lanes, laneOf } = laneLayout;
  const { log, indexOf } = model;
  const n = log.length;
  const g = useMemo(() => geometry(size.width, n), [size.width, n]);
  const laneThreads = useMemo(() => lanes.map((l) => threads(l.replica, l.label)), [lanes, threads]);
  const braid = useMemo(() => (size.width > 0 ? braidPaths(lanes, model, g) : []), [lanes, model, g, size.width]);

  const cut: VectorClock | null = isCutScrub(scrub) ? scrub.cut : null;
  const ticks = useMemo(() => {
    if (size.width <= 0) return null;
    const inside = cut ? (op: Op) => op.counter <= (cut[op.replica] ?? 0) : undefined;
    return tickPaths(model, laneOf, lanes.length, g, inside);
  }, [model, laneOf, lanes.length, g, cut, size.width]);

  const knotPath = useMemo(() => {
    let d = "";
    for (const [i, list] of knots.byIndex) if (list.some(isLiveKnot)) d += diamond(g.x(i), MID, 3.8);
    return d;
  }, [knots, g]);

  const labelOf = (r: ReplicaId, fallback?: string) => threads(r, fallback).label;
  const desc = describeScrub(scrub, log, indexOf, labelOf, data.snapshots);
  const slot = slotOfScrub(scrub, log, indexOf);
  const live = scrub === null;
  const cursorX = live || cut ? null : slot === 0 ? PAD_L - 3 : g.x(slot - 1) + g.step / 2;
  const hoverIdx = hoverOp ? indexOf.get(hoverOp) : undefined;
  const strokeW = Math.max(0.8, Math.min(2, g.step * 0.6));

  const setScrub = (next: Scrub | null) => {
    const s = store.getState();
    const cur = s.scrub;
    if (cur === next) return;
    if (cur && next && "atOpId" in cur && "atOpId" in next && cur.atOpId === next.atOpId && !cur.cut) return;
    s.set({ scrub: next });
  };

  const slotAt = (clientX: number): number => {
    if (!el || n === 0) return n + 1;
    const x = clientX - el.getBoundingClientRect().left;
    if (x >= g.headX - HEAD_W / 2 + 2) return n + 1;
    const i = Math.floor((x - PAD_L) / g.step);
    if (i < 0) return 0;
    return Math.min(i, n - 1) + 1;
  };

  const showHover = (clientX: number) => {
    if (!el) return;
    const s = slotAt(clientX);
    if (s < 1 || s > n) return hover.clear();
    const rect = el.getBoundingClientRect();
    hover.show(log[s - 1], rect.left + g.x(s - 1), rect.top + 2);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || n === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    hover.clear();
    setScrub(scrubForSlot(log, slotAt(e.clientX)));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) setScrub(scrubForSlot(log, slotAt(e.clientX)));
    else if (e.pointerType === "mouse") showHover(e.clientX);
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  useNativeKeydown(el, (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || n === 0) return false;
    const cur = store.getState().scrub;
    const big = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        setScrub(stepScrub(cur, -big, log, indexOf));
        return true;
      case "ArrowRight":
      case "ArrowUp":
        setScrub(stepScrub(cur, big, log, indexOf));
        return true;
      case "PageDown":
        setScrub(stepScrub(cur, -10, log, indexOf));
        return true;
      case "PageUp":
        setScrub(stepScrub(cur, 10, log, indexOf));
        return true;
      case "Home":
        setScrub(scrubForSlot(log, 0));
        return true;
      case "End":
        setScrub(null);
        return true;
      case "Escape":
        if (!cur) return false;
        setScrub(null);
        return true;
      default:
        return false;
    }
  });

  const ready = size.width > 0 && ticks;

  return (
    <div
      ref={sizeRef}
      role="slider"
      tabIndex={0}
      aria-label="Time travel through the history"
      aria-valuemin={0}
      aria-valuemax={n + 1}
      aria-valuenow={Math.min(slot, n + 1)}
      aria-valuetext={desc.short}
      aria-disabled={n === 0 || undefined}
      title={n ? "Drag to travel back in time · ← → step one edit · End returns to live" : undefined}
      data-loom-scrubber
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        if (!dragging.current) hover.clear();
      }}
      className={clsx(
        "relative h-[30px] w-full touch-none select-none rounded-[9px] outline-offset-1",
        n > 0 ? "cursor-ew-resize" : "cursor-default",
        !live && "bg-[color-mix(in_oklab,var(--focus)_5%,transparent)]",
      )}
    >
      {ready && (
        <svg width={size.width} height={RIBBON_H} className="absolute inset-0 block overflow-visible" aria-hidden>
          <defs>
            {laneThreads.map((t, l) => (
              <pattern key={l} id={`${uid}-h${l}`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={4} height={4} fill={t.color} fillOpacity={0.08} />
                <line x1={0} y1={0} x2={0} y2={4} stroke={t.color} strokeOpacity={0.55} strokeWidth={1.6} />
              </pattern>
            ))}
          </defs>

          {viewport && n > 0 && (
            <rect
              x={g.x(viewport.from) - g.step / 2 - 1}
              y={1}
              width={Math.max(4, g.x(viewport.to) - g.x(viewport.from) + g.step + 2)}
              height={RIBBON_H - 2}
              rx={5}
              fill="color-mix(in oklab, var(--ink) 5%, transparent)"
              stroke="var(--line-2)"
              strokeWidth={1}
            />
          )}

          {model.offline.map((run) => {
            const l = laneOf.get(run.replica);
            if (l === undefined) return null;
            const x0 = g.x(run.from) - g.step / 2;
            return (
              <rect
                key={`${run.replica}:${run.from}`}
                x={x0}
                y={3}
                width={Math.max(2, g.x(run.to) + g.step / 2 - x0)}
                height={RIBBON_H - 6}
                rx={3}
                fill={`url(#${uid}-h${l})`}
              />
            );
          })}

          {braid.map((d, l) =>
            d ? (
              <path
                key={l}
                d={d}
                fill="none"
                stroke={laneThreads[l].color}
                strokeOpacity={0.5}
                strokeWidth={1.25}
                strokeDasharray={laneThreads[l].dash || undefined}
                strokeLinecap="round"
              />
            ) : null,
          )}

          {ticks.main.map((t, l) => (
            <g key={l} stroke={laneThreads[l].color} strokeWidth={strokeW} strokeLinecap="round">
              {t.solid && <path d={t.solid} />}
              {t.offline && <path d={t.offline} strokeDasharray="1.6 1.4" strokeLinecap="butt" />}
            </g>
          ))}
          {cut &&
            ticks.outside.map((t, l) => (
              <g key={l} stroke={laneThreads[l].color} strokeOpacity={0.18} strokeWidth={strokeW}>
                {t.solid && <path d={t.solid} />}
                {t.offline && <path d={t.offline} strokeDasharray="1.6 1.4" />}
              </g>
            ))}

          {[...snapshotAt].map(([i, snap]) => (
            <SnapshotFlag key={snap.snapshotId} x={g.x(i)} thread={threads(snap.replica, snap.author)} name={snap.name} />
          ))}

          {knotPath && <path d={knotPath} fill="var(--knot)" stroke="var(--panel)" strokeWidth={1.1} strokeLinejoin="round" />}
          {focused &&
            focused.ops.map((id) => {
              const i = indexOf.get(id);
              return i === undefined ? null : <circle key={id} cx={g.x(i)} cy={MID} r={6.5} fill="none" stroke="var(--knot)" strokeWidth={1.5} />;
            })}

          {hoverIdx !== undefined && n > 0 && (
            <line x1={g.x(hoverIdx)} x2={g.x(hoverIdx)} y1={1} y2={RIBBON_H - 1} stroke="var(--ink)" strokeOpacity={0.45} strokeWidth={1} />
          )}

          {cursorX !== null && (
            <g>
              <rect x={cursorX} y={0} width={Math.max(0, g.headX - HEAD_W / 2 - cursorX)} height={RIBBON_H} fill="var(--panel)" fillOpacity={0.66} />
              <line x1={cursorX} x2={cursorX} y1={0} y2={RIBBON_H} stroke="var(--focus)" strokeWidth={1.5} />
              <path d={`M${cursorX - 4} 0H${cursorX + 4}L${cursorX} 5Z`} fill="var(--focus)" />
              <path d={`M${cursorX - 4} ${RIBBON_H}H${cursorX + 4}L${cursorX} ${RIBBON_H - 5}Z`} fill="var(--focus)" />
            </g>
          )}

          <LiveHead x={g.headX} live={live} />

          {n === 0 && (
            <text x={PAD_L + 6} y={MID + 3.5} fontSize={11} fill="var(--muted)" fontFamily="var(--font-geist-sans), system-ui">
              History appears here as you draw
            </text>
          )}
        </svg>
      )}
    </div>
  );
});

function SnapshotFlag({ x, thread, name }: { x: number; thread: LoomThread; name: string }) {
  return (
    <g>
      <title>{`Snapshot “${name}” by ${thread.label}`}</title>
      <line x1={x} x2={x} y1={3} y2={RIBBON_H - 3} stroke="var(--ink-2)" strokeWidth={1.1} />
      <path d={`M${x} 3L${x + 8} 5.8L${x} 8.6Z`} fill={thread.color} stroke="var(--panel)" strokeWidth={0.8} strokeLinejoin="round" />
    </g>
  );
}

function LiveHead({ x, live }: { x: number; live: boolean }) {
  return (
    <g>
      <line x1={x} x2={x} y1={4} y2={RIBBON_H - 4} stroke="var(--line-2)" strokeWidth={1.5} strokeLinecap="round" />
      {live && (
        <circle cx={x} cy={MID} r={6.5} fill="var(--ok)" fillOpacity={0.18} className="origin-center animate-pulse motion-reduce:animate-none" />
      )}
      <circle cx={x} cy={MID} r={3.8} fill={live ? "var(--ok)" : "var(--panel)"} stroke={live ? "var(--ok)" : "var(--muted)"} strokeWidth={1.5} />
    </g>
  );
}
