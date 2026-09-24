"use client";
/**
 * The expanded Loom: a space-time diagram. One lane (warp thread) per tab; every edit is a
 * dot on its author's lane at its position in canonical order; curved weft threads show
 * "this edit had already seen that one" (derived from vector clocks — only direct, newly
 * observed dependencies). Knots tie concurrent edits together, flags mark snapshots, the
 * "NOW" reed is live, and ops still waiting for their causes sit greyed after it.
 *
 * Rendering is windowed horizontally (only columns near the viewport are drawn) and all
 * pointer handling is delegated to the <svg> (no per-dot handlers), so thousands of ops stay
 * smooth.
 */
import { useReducedMotion } from "motion/react";
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Op, OpId, ReplicaId } from "@/lib/crdt/types";
import { useSession } from "@/lib/session/react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { assignScrollLeft, scrollToLeft } from "./dom";
import { stGeometry } from "./geometry";
import { BandPattern, HatchPattern, OpGlyph } from "./glyphs";
import { useElementSize, useFocusedConflict, useLoomThreads, useStableVc, type LoomData } from "./hooks";
import { useOpHover } from "./hover";
import { COL, PAD_L, cutFrontier, layoutColumns, lowerBoundX } from "./model";
import { causalPastFromClocks, isLiveKnot } from "./ops";
import type { RibbonViewport } from "./Ribbon";
import { isCutScrub } from "./scrub";
import { BundleMark, CutFrontier, FlagMark, HoverRing, KnotMark, LiveReed, ScrubCursor } from "./SpaceTimeMarks";

const GUTTER = 52;
const WINDOW_MARGIN = 160;

interface Pick {
  op: Op;
  pending: boolean;
  cx: number;
  cy: number;
}

export const SpaceTime = memo(function SpaceTime({
  data,
  height,
  onViewport,
}: {
  data: LoomData;
  height: number;
  onViewport: (v: RibbonViewport | null) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const session = useSession();
  const store = useUiStore();
  const threads = useLoomThreads();
  const stable = useStableVc();
  const focused = useFocusedConflict();
  const cut = useUi((s) => (isCutScrub(s.scrub) ? s.scrub.cut : null));
  const cutLabel = useUi((s) => (isCutScrub(s.scrub) ? (s.scrub.label ?? "Causal cut") : ""));
  const live = useUi((s) => s.scrub === null);
  const hover = useOpHover();
  const reduce = useReducedMotion();
  const [unfolded, setUnfolded] = useState<ReadonlySet<OpId>>(() => new Set());
  const [scrollRef, scroller, view] = useElementSize<HTMLDivElement>();
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const follow = useRef(true);
  const wasLive = useRef(live);
  const raf = useRef(0);

  const { model, lanes: laneLayout, knots, snapshotAt, pending } = data;
  const { lanes, laneOf } = laneLayout;
  const { log, indexOf, edges } = model;
  const n = log.length;
  const laneThreads = useMemo(() => lanes.map((l) => threads(l.replica, l.label)), [lanes, threads]);
  const labelOf = useCallback((r: ReplicaId) => threads(r).label, [threads]);

  /* focus + context: the knot's two ops and everything in their causal pasts */
  const focusOps = useMemo(() => new Set<OpId>(focused?.ops ?? []), [focused]);
  const context = useMemo(() => {
    if (!focused) return null;
    const ids = new Set<OpId>(focused.ops);
    const exp = session.replica.explain(focused.id);
    if (exp) {
      for (const list of Object.values(exp.causalPast)) for (const id of list) ids.add(id);
    } else {
      const ops = focused.ops.map((id) => session.replica.getOp(id)).filter((o): o is Op => !!o);
      for (const id of causalPastFromClocks(log, ops)) ids.add(id);
    }
    return ids;
  }, [session, focused, log]);

  const layout = useMemo(
    () => layoutColumns(model, laneOf, lanes.length, (i) => knots.byIndex.has(i) || focusOps.has(log[i].id), unfolded),
    [model, laneOf, lanes.length, knots, focusOps, log, unfolded],
  );
  const geo = useMemo(() => stGeometry(layout, lanes.length, height - 12, pending.length), [layout, lanes.length, height, pending.length]);
  const frontier = useMemo(() => (cut ? cutFrontier(lanes, cut, indexOf) : null), [cut, lanes, indexOf]);
  const onUnfold = useCallback((key: OpId) => setUnfolded((prev) => new Set(prev).add(key)), []);

  /* ---------------------------------------------------------------- scrolling */

  const onScroll = () => {
    const el = scroller;
    if (!el) return;
    follow.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 24;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setScrollLeft(el.scrollLeft));
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Follow the live head while it's in view; jump back to it when returning to live.
  useLayoutEffect(() => {
    if (!scroller) return;
    if (live && !wasLive.current) follow.current = true;
    wasLive.current = live;
    if (live && follow.current) assignScrollLeft(scroller, scroller.scrollWidth);
  }, [scroller, geo.width, live]);

  const focusedId = focused?.id ?? null;
  const centerOnFocus = useEffectEvent(() => {
    if (!scroller || !focused) return;
    const xs: number[] = [];
    for (const id of focused.ops) {
      const i = indexOf.get(id);
      if (i !== undefined) xs.push(layout.opX[i]);
    }
    if (!xs.length) return;
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    follow.current = false;
    scrollToLeft(scroller, mid - scroller.clientWidth / 2, !reduce);
  });
  useEffect(() => {
    if (focusedId) centerOnFocus();
  }, [focusedId, scroller]);

  /* ---------------------------------------------------------------- viewport → ribbon */

  const vw = view.width;
  const vpFrom = n && vw ? Math.min(n - 1, lowerBoundX(layout.opX, scrollLeft)) : -1;
  const vpTo = n && vw ? Math.max(vpFrom, Math.min(n - 1, lowerBoundX(layout.opX, scrollLeft + vw) - 1)) : -1;
  useEffect(() => {
    onViewport(vpFrom >= 0 ? { from: vpFrom, to: vpTo } : null);
  }, [onViewport, vpFrom, vpTo]);
  useEffect(() => () => onViewport(null), [onViewport]);

  /* ---------------------------------------------------------------- pointer (delegated) */

  const pick = (clientX: number, clientY: number): Pick | null => {
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const near = (op: Op, cx: number, isPending: boolean): Pick | null => {
      const l = laneOf.get(op.replica);
      if (l === undefined) return null;
      const ly = geo.laneY(l);
      if (Math.abs(y - ly) > geo.laneH / 2) return null;
      return { op, pending: isPending, cx: rect.left + cx, cy: rect.top + ly };
    };
    if (pending.length && x > geo.headX + 12) {
      const j = Math.round((x - geo.pendingX(0)) / COL);
      return j >= 0 && j < pending.length ? near(pending[j], geo.pendingX(j), true) : null;
    }
    const i = lowerBoundX(layout.opX, x);
    let best = -1;
    let dist = Infinity;
    for (const k of [i - 1, i]) {
      if (k < 0 || k >= n || layout.bundleOf[k] >= 0) continue;
      const d = Math.abs(layout.opX[k] - x);
      if (d < dist) {
        dist = d;
        best = k;
      }
    }
    if (best < 0 || dist > COL / 2) return null;
    return near(log[best], layout.opX[best], false);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    const p = pick(e.clientX, e.clientY);
    e.currentTarget.style.cursor = p && !p.pending ? "pointer" : "";
    if (p) hover.show(p.op, p.cx, p.cy - geo.r - 6, p.pending);
    else hover.clear();
  };
  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const p = pick(e.clientX, e.clientY);
    if (!p || p.pending) return;
    store.getState().set({ scrub: { atOpId: p.op.id, label: `L${p.op.lamport}` } });
  };

  /* ---------------------------------------------------------------- visible window */

  const x0 = scrollLeft - WINDOW_MARGIN;
  const x1 = scrollLeft + (vw || 1600) + WINDOW_MARGIN;
  const i0 = Math.max(0, lowerBoundX(layout.opX, x0 - COL));
  const i1 = Math.min(n - 1, lowerBoundX(layout.opX, x1 + COL));
  const laneYOf = (op: Op) => geo.laneY(laneOf.get(op.replica) ?? 0);

  const dots: ReactNode[] = [];
  const knotMarks: ReactNode[] = [];
  const flags: ReactNode[] = [];
  for (let i = i0; i <= i1; i++) {
    const b = layout.bundleOf[i];
    if (b >= 0) {
      i = layout.bundles[b].to;
      continue;
    }
    const op = log[i];
    const l = laneOf.get(op.replica) ?? 0;
    const x = layout.opX[i];
    const y = geo.laneY(l);
    const outOfContext = context !== null && !context.has(op.id);
    const outOfCut = cut !== null && op.counter > (cut[op.replica] ?? 0);
    const snap = snapshotAt.get(i);
    if (snap) {
      flags.push(
        <g key={op.id} opacity={outOfContext || outOfCut ? 0.25 : 1}>
          <FlagMark snap={snap} x={x} y={y} h={Math.min(16, geo.laneH * 0.62)} thread={laneThreads[l]} />
        </g>,
      );
    } else {
      dots.push(
        <OpGlyph
          key={op.id}
          kind={op.kind}
          x={x}
          y={y}
          r={geo.r}
          color={laneThreads[l].color}
          hatch={op.meta.offline ? `url(#${uid}-o${l})` : null}
          stable={op.counter <= (stable[op.replica] ?? 0)}
          opacity={outOfContext ? 0.14 : outOfCut ? 0.2 : undefined}
        />,
      );
    }
    const k = knots.byIndex.get(i);
    if (k) {
      knotMarks.push(
        <g key={`k${op.id}`} opacity={context && !focusOps.has(op.id) ? 0.3 : 1}>
          <KnotMark conflicts={k} x={x} y={y - geo.r - 7} focusedId={focused?.id ?? null} labelOf={labelOf} />
        </g>,
      );
    }
  }

  const weft: ReactNode[] = [];
  for (const e of edges) {
    if (e.to < i0 || e.from > i1) continue;
    const a = log[e.from];
    const b = log[e.to];
    const xs = layout.opX[e.from];
    const xt = layout.opX[e.to];
    const ys = laneYOf(a);
    const yt = laneYOf(b);
    const dx = Math.min(46, (xt - xs) * 0.55);
    const inCtx = !context || (context.has(a.id) && context.has(b.id));
    const inCut = !cut || b.counter <= (cut[b.replica] ?? 0);
    weft.push(
      <path
        key={`${e.from}>${e.to}`}
        d={`M${xs} ${ys}C${xs + dx} ${ys} ${xt - dx} ${yt} ${xt} ${yt}`}
        fill="none"
        stroke={laneThreads[laneOf.get(a.replica) ?? 0].color}
        strokeOpacity={!inCtx ? 0.05 : !inCut ? 0.08 : context ? 0.8 : 0.38}
        strokeWidth={context && inCtx ? 1.5 : 1.15}
      />,
    );
  }

  const ties: ReactNode[] = [];
  for (const t of knots.ties) {
    if (t.b < i0 || t.a > i1) continue;
    if (layout.bundleOf[t.a] >= 0 || layout.bundleOf[t.b] >= 0) continue;
    const isFocused = t.conflict.id === focused?.id;
    const liveKnot = isLiveKnot(t.conflict);
    if (!isFocused && !liveKnot && context) continue;
    const xa = layout.opX[t.a];
    const xb = layout.opX[t.b];
    const ya = laneYOf(log[t.a]);
    const yb = laneYOf(log[t.b]);
    const lift = Math.min(ya, yb) - geo.r - 7;
    ties.push(
      <path
        key={`t${t.conflict.id}`}
        d={`M${xa} ${ya - geo.r - 7}Q${(xa + xb) / 2} ${lift - 6} ${xb} ${yb - geo.r - 7}`}
        fill="none"
        stroke="var(--knot)"
        strokeWidth={isFocused ? 1.8 : 1.2}
        strokeDasharray={isFocused ? undefined : "2 3"}
        strokeOpacity={isFocused ? 0.95 : liveKnot ? 0.55 : 0.22}
        strokeLinecap="round"
      />,
    );
  }

  const liveKnotCount = useMemo(() => {
    let c = 0;
    for (const list of knots.byIndex.values()) if (list.some(isLiveKnot)) c++;
    return c;
  }, [knots]);

  const empty = n === 0 && pending.length === 0;

  return (
    <div className="scrollbar-thin relative overflow-y-auto overflow-x-hidden" style={{ height }}>
      <div className="flex min-w-0" style={{ height: Math.max(geo.height + 12, height) }}>
        {/* lane gutter */}
        <div className="relative shrink-0 border-r border-dashed border-line" style={{ width: GUTTER, height: geo.height }}>
          {lanes.map((lane, l) => (
            <div
              key={lane.replica}
              className="absolute left-0 flex w-full items-center justify-center gap-1"
              style={{ top: geo.laneY(l) - 10, height: 20 }}
              title={`Tab ${lane.label}${lane.self ? " (you)" : ""} · ${lane.opCount.toLocaleString()} edit${lane.opCount === 1 ? "" : "s"}`}
            >
              <ThreadBadge label={lane.label} size="xs" solid={lane.self} />
              <span className="sr-only">
                Tab {lane.label}
                {lane.self ? " (you)" : ""}
              </span>
              {lane.self && (
                <span aria-hidden className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                  you
                </span>
              )}
            </div>
          ))}
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <svg
            ref={setSvgEl}
            width={Math.max(geo.width, vw)}
            height={geo.height}
            role="group"
            aria-roledescription="space-time diagram"
            aria-label={`Space-time diagram: ${n.toLocaleString()} edits across ${lanes.length} tab${lanes.length === 1 ? "" : "s"}${
              liveKnotCount ? `, ${liveKnotCount} knotted edits` : ""
            }. Curved threads show which edits had already seen which. The table view lists the same history as rows.`}
            data-own-keys
            className="block select-none"
            onPointerMove={onPointerMove}
            onPointerLeave={() => hover.clear()}
            onClick={onClick}
          >
            <defs>
              {laneThreads.map((t, l) => (
                <g key={l}>
                  <HatchPattern id={`${uid}-o${l}`} color={t.color} />
                  <BandPattern id={`${uid}-b${l}`} color={t.color} />
                </g>
              ))}
            </defs>

            {/* offline stretches */}
            {model.offline.map((run) => {
              if (run.to < i0 || run.from > i1) return null;
              const l = laneOf.get(run.replica);
              if (l === undefined) return null;
              const xa = layout.opX[run.from] - COL / 2 + 1;
              const xb = layout.opX[run.to] + COL / 2 - 1;
              const y = geo.laneY(l);
              return (
                <rect
                  key={`${run.replica}:${run.from}`}
                  x={xa}
                  y={y - 8.5}
                  width={Math.max(COL - 2, xb - xa)}
                  height={17}
                  rx={8.5}
                  fill={`url(#${uid}-b${l})`}
                  stroke={laneThreads[l].color}
                  strokeOpacity={0.3}
                  strokeDasharray="2 2"
                />
              );
            })}

            {/* warp: one thread per tab */}
            {lanes.map((lane, l) => {
              const first = model.firstIndex.get(lane.replica);
              const xa = first === undefined ? PAD_L : layout.opX[first] - 8;
              return (
                <line
                  key={lane.replica}
                  x1={xa}
                  x2={geo.headX}
                  y1={geo.laneY(l)}
                  y2={geo.laneY(l)}
                  stroke={laneThreads[l].color}
                  strokeOpacity={first === undefined ? 0.22 : 0.5}
                  strokeWidth={1.5}
                  strokeDasharray={first === undefined ? "2 4" : laneThreads[l].dash || undefined}
                />
              );
            })}

            {layout.bundles.map((b) =>
              b.x + b.w < x0 || b.x > x1 ? null : (
                <BundleMark key={b.key} bundle={b} geo={geo} lanes={lanes} threads={laneThreads} onUnfold={onUnfold} />
              ),
            )}

            <g>{weft}</g>
            <HoverRing geo={geo} model={model} laneOf={laneOf} />
            <g>{ties}</g>
            <g>{dots}</g>
            <g>{flags}</g>

            {/* waiting for causal dependencies */}
            {pending.length > 0 && (
              <g>
                <text x={geo.pendingX(0) - COL / 2} y={11} fontSize={9} fill="var(--muted)" fontFamily="var(--font-geist-sans), system-ui">
                  waiting for causes
                </text>
                {pending.map((op, j) => {
                  const l = laneOf.get(op.replica) ?? 0;
                  return (
                    <circle
                      key={op.id}
                      cx={geo.pendingX(j)}
                      cy={geo.laneY(l)}
                      r={geo.r}
                      fill="var(--panel-2)"
                      stroke={laneThreads[l]?.color ?? "var(--muted)"}
                      strokeOpacity={0.7}
                      strokeWidth={1.3}
                      strokeDasharray="2 1.6"
                    />
                  );
                })}
              </g>
            )}

            {frontier && <CutFrontier geo={geo} frontier={frontier} label={cutLabel} />}
            <ScrubCursor geo={geo} model={model} scroller={scroller} />
            <LiveReed geo={geo} live={live} />
            <g>{knotMarks}</g>

            {empty && (
              <text x={PAD_L + 8} y={geo.laneY(0) - 12} fontSize={11.5} fill="var(--muted)" fontFamily="var(--font-geist-sans), system-ui">
                No edits yet — each edit becomes a dot on its tab’s thread. Open a second tab to watch the threads cross.
              </text>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
});
