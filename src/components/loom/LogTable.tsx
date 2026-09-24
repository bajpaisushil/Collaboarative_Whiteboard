"use client";
/**
 * The operation log as a table: every integrated op in canonical (Lamport, replica) order,
 * newest at the bottom, then the ops still waiting for their causal dependencies. Windowed
 * (fixed 28px rows, only visible rows rendered) so thousands of ops stay cheap; follows new
 * ops unless you've scrolled up. Filter by tab, kind, or knots.
 *
 * Keyboard: the list is one tab stop (role="listbox"); ↑/↓/PgUp/PgDn/Home/End move the
 * highlighted row (the canvas outlines its shape), Enter selects that shape.
 */
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Conflict, Op, OpId, ReplicaId, ReplicaView } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { assignScrollTop, revealRow } from "./dom";
import { compareLabels, plural } from "./format";
import { useElementSize, useLoomThreads, useNativeKeydown, usePendingOps, useStableVc } from "./hooks";
import { COLUMNS_NARROW, COLUMNS_WIDE, LogRow, ROW_H } from "./LogRow";
import { KIND_FILTERS, kindGroup, shapeIdOf, type KindFilter } from "./ops";
import { isCutScrub, slotOfScrub } from "./scrub";

const OVERSCAN = 6;
const NARROW_AT = 640;

interface Row {
  op: Op;
  pending: boolean;
  index: number;
}

const selectLog = (v: ReplicaView) => v.log;
const selectConflicts = (v: ReplicaView) => v.conflicts;
const selectVc = (v: ReplicaView) => v.vc;

export function LogTable() {
  const session = useSession();
  const store = useUiStore();
  const log = useReplicaView(selectLog);
  const conflicts = useReplicaView(selectConflicts);
  const viewVc = useReplicaView(selectVc);
  const pending = usePendingOps();
  const threads = useLoomThreads();
  const stable = useStableVc();
  const scrub = useUi((s) => s.scrub);
  const baseId = useId().replace(/:/g, "");
  const [hidden, setHidden] = useState<ReadonlySet<ReplicaId>>(() => new Set());
  const [kind, setKind] = useState<KindFilter>("all");
  const [knotsOnly, setKnotsOnly] = useState(false);
  const [active, setActive] = useState<OpId | null>(null);
  const [listRef, listEl, size] = useElementSize<HTMLDivElement>();
  const [scrollTop, setScrollTop] = useState(0);
  const atBottom = useRef(true);
  const raf = useRef(0);

  const indexOf = useMemo(() => new Map(log.map((o, i) => [o.id, i] as const)), [log]);
  const knotsByOp = useMemo(() => {
    const m = new Map<OpId, Conflict[]>();
    for (const c of conflicts) for (const id of c.ops) m.set(id, [...(m.get(id) ?? []), c]);
    return m;
  }, [conflicts]);

  const authors = useMemo(() => {
    const counts = new Map<ReplicaId, { count: number; author: string }>();
    for (const op of log) {
      const e = counts.get(op.replica);
      if (e) e.count++;
      else counts.set(op.replica, { count: 1, author: op.meta.author });
    }
    for (const op of pending) if (!counts.has(op.replica)) counts.set(op.replica, { count: 0, author: op.meta.author });
    return [...counts].map(([replica, e]) => ({ replica, ...e }));
  }, [log, pending]);
  const authorChips = authors
    .map((a) => ({ ...a, thread: threads(a.replica, a.author) }))
    .sort((a, b) => compareLabels(a.thread.label, b.thread.label));

  const rows = useMemo(() => {
    const pass = (op: Op) => !hidden.has(op.replica) && (kind === "all" || kindGroup(op) === kind) && (!knotsOnly || knotsByOp.has(op.id));
    const out: Row[] = [];
    for (let i = 0; i < log.length; i++) if (pass(log[i])) out.push({ op: log[i], pending: false, index: i });
    for (const op of pending) if (pass(op)) out.push({ op, pending: true, index: -1 });
    return out;
  }, [log, pending, hidden, kind, knotsOnly, knotsByOp]);
  const activeIndex = useMemo(() => (active ? rows.findIndex((r) => r.op.id === active) : -1), [rows, active]);

  /* ---------------------------------------------------------------- scrolling */

  const onScroll = () => {
    const el = listEl;
    if (!el) return;
    atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_H / 2;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setScrollTop(el.scrollTop));
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useLayoutEffect(() => {
    if (listEl && atBottom.current) assignScrollTop(listEl, listEl.scrollHeight);
  }, [listEl, rows.length, size.height]);

  const reveal = (i: number) => {
    if (listEl) revealRow(listEl, i * ROW_H, ROW_H);
  };

  /* ---------------------------------------------------------------- actions */

  const setHover = useCallback(
    (op: Op | null) => {
      const s = store.getState();
      const next = op?.id ?? null;
      if (s.hoverOp !== next) s.set({ hoverOp: next });
    },
    [store],
  );
  const pick = useCallback(
    (op: Op, isPending: boolean) => {
      setActive(op.id);
      if (isPending) return;
      setHover(op);
      const sid = shapeIdOf(op);
      if (sid && session.replica.getView().shapeById.has(sid)) store.getState().select([sid]);
    },
    [session, store, setHover],
  );
  const openKnot = useCallback((c: Conflict) => store.getState().focusConflict({ id: c.id, lineageKey: c.lineageKey }), [store]);

  const moveTo = (i: number) => {
    if (rows.length === 0) return;
    const k = Math.max(0, Math.min(rows.length - 1, i));
    const row = rows[k];
    setActive(row.op.id);
    setHover(row.pending ? null : row.op);
    reveal(k);
  };

  useNativeKeydown(listEl, (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const page = Math.max(1, Math.floor((listEl?.clientHeight ?? ROW_H * 8) / ROW_H) - 1);
    const cur = activeIndex < 0 ? rows.length : activeIndex;
    switch (e.key) {
      case "ArrowDown":
        moveTo(activeIndex < 0 ? rows.length - 1 : cur + 1);
        return true;
      case "ArrowUp":
        moveTo(cur - 1);
        return true;
      case "PageDown":
        moveTo(cur + page);
        return true;
      case "PageUp":
        moveTo(cur - page);
        return true;
      case "Home":
        moveTo(0);
        return true;
      case "End":
        moveTo(rows.length - 1);
        return true;
      case "Enter":
      case " ":
        if (activeIndex < 0) return false;
        pick(rows[activeIndex].op, rows[activeIndex].pending);
        return true;
      case "Escape":
        if (!active) return false;
        setActive(null);
        setHover(null);
        return true;
      default:
        return false;
    }
  });

  /* ---------------------------------------------------------------- window */

  const narrow = size.width > 0 && size.width < NARROW_AT;
  const height = size.height || ROW_H * 10;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const slot = slotOfScrub(scrub, log, indexOf);
  const cut = isCutScrub(scrub) ? scrub.cut : null;
  const rowId = (id: OpId) => `${baseId}-op-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const filtered = hidden.size > 0 || kind !== "all" || knotsOnly;
  const total = log.length + pending.length;

  const visible = [];
  for (let i = start; i < end; i++) {
    const { op, pending: isPending, index } = rows[i];
    const dim = isPending ? false : cut ? op.counter > (cut[op.replica] ?? 0) : scrub ? index >= slot : false;
    visible.push(
      <LogRow
        key={op.id}
        id={rowId(op.id)}
        op={op}
        pending={isPending}
        top={i * ROW_H}
        narrow={narrow}
        active={op.id === active}
        dim={dim}
        stable={op.counter <= (stable[op.replica] ?? 0)}
        knots={knotsByOp.get(op.id)}
        replica={session.replica}
        threadOf={threads}
        viewVc={viewVc}
        onPick={pick}
        onHover={setHover}
        onKnot={openKnot}
      />,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2.5 py-1">
        <div role="group" aria-label="Show edits from" className="flex items-center gap-1">
          <span className="mr-0.5 text-[11px] text-muted">Show</span>
          {authorChips.map((a) => {
            const on = !hidden.has(a.replica);
            return (
              <button
                key={a.replica}
                type="button"
                aria-pressed={on}
                aria-label={`Edits by Tab ${a.thread.label} (${a.count})`}
                title={`${on ? "Hide" : "Show"} edits by Tab ${a.thread.label}`}
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(a.replica)) next.delete(a.replica);
                    else next.add(a.replica);
                    return next;
                  })
                }
                className={clsx(
                  "inline-flex h-6 items-center gap-1 rounded-full border pl-0.5 pr-2 text-[11px] tabular-nums transition-colors",
                  on ? "border-line-2 bg-panel text-ink-2" : "border-dashed border-line bg-transparent text-muted line-through",
                )}
              >
                <ThreadBadge label={a.thread.label} size="xs" dimmed={!on} />
                {a.count}
              </button>
            );
          })}
        </div>
        <label className="relative inline-flex items-center">
          <span className="sr-only">Kind of edit</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as KindFilter)}
            className="h-6 appearance-none rounded-[7px] border border-line-2 bg-panel pl-2 pr-6 text-[11.5px] text-ink-2 hover:border-muted"
          >
            {KIND_FILTERS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 size-3 text-muted" />
        </label>
        <button
          type="button"
          aria-pressed={knotsOnly}
          onClick={() => setKnotsOnly((v) => !v)}
          title="Only edits that are part of a knot"
          className={clsx(
            "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors",
            knotsOnly ? "border-transparent bg-knot text-panel" : "border-line-2 text-ink-2 hover:bg-panel-2",
          )}
        >
          <KnotIcon size={13} /> Knots only
        </button>
        <span className="ml-auto text-[11px] tabular-nums text-muted" aria-live="polite">
          {filtered ? `${plural(rows.length, "edit")} of ${total.toLocaleString()}` : plural(log.length, "edit")}
          {pending.length > 0 && ` · ${pending.length} waiting`}
        </span>
      </div>

      {/* header */}
      <div
        aria-hidden
        className="grid shrink-0 items-center gap-2 overflow-y-hidden border-b border-line px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted [scrollbar-gutter:stable]"
        style={{ gridTemplateColumns: narrow ? COLUMNS_NARROW : COLUMNS_WIDE }}
      >
        <span title="Lamport clock — the order every tab agrees on">L</span>
        <span>By</span>
        {!narrow && <span>Op id</span>}
        {!narrow && <span>Kind</span>}
        <span>What happened</span>
        {!narrow && <span title="Vector clock — how many edits from each tab this edit had seen">Had seen</span>}
        <span className="text-right">{narrow ? "" : "Notes"}</span>
      </div>

      {/* rows */}
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="Operation log, oldest first"
        aria-activedescendant={active && activeIndex >= 0 ? rowId(active) : undefined}
        onScroll={onScroll}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto outline-none [scrollbar-gutter:stable] focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]"
      >
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted">
            {log.length === 0 && pending.length === 0 ? "No edits yet. Every edit on the board will be listed here." : "No edits match these filters."}
          </p>
        ) : (
          <div className="relative" style={{ height: rows.length * ROW_H }}>
            {visible}
          </div>
        )}
      </div>
    </div>
  );
}
