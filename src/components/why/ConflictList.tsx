"use client";
/**
 * The knot list: every conflict on the board, sorted into what it *meant* (a value lost, a
 * delete overridden, text interleaved, or harmless agreement) and grouped so one clash of
 * two user actions ("A's Move 10 shapes vs B's Move 10 shapes") is a single card.
 */
import clsx from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useMemo, useState, type KeyboardEvent } from "react";
import type { Conflict, ReplicaView } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUiStore } from "@/lib/ui/store";
import { Kbd } from "@/components/ui/Kbd";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ShapeThumb, StatusChip, ThreadChip } from "./bits";
import {
  actionsFor,
  CATEGORY_COPY,
  CATEGORY_ORDER,
  groupConflicts,
  groupNoun,
  headlineFor,
  statusFor,
  type Category,
  type ConflictGroup,
  type Segment,
} from "./conflictModel";
import { plural } from "./format";
import { ThreadsCrossing } from "./illustrations";
import { useThreadOf } from "./threads";
import { useShapeSnapshot } from "./useShapeSnapshot";

export type WhyVariant = "panel" | "seam";

const selectConflicts = (v: ReplicaView) => v.conflicts;

export function ConflictList({ variant = "panel" }: { variant?: WhyVariant }) {
  const conflicts = useReplicaView(selectConflicts);
  const [showBenign, setShowBenign] = useState(false);
  const groups = useMemo(() => groupConflicts(conflicts), [conflicts]);
  const compact = variant === "seam";

  const stats = useMemo(() => {
    let live = 0,
      settled = 0,
      agreed = 0;
    for (const c of conflicts) {
      if (c.valuesEqual) agreed++;
      else if (c.status === "live") live++;
      else settled++;
    }
    return { live, settled, agreed };
  }, [conflicts]);

  if (conflicts.length === 0) return <EmptyKnots compact={compact} />;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-knot-item]"));
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = i;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = i < 0 ? 0 : Math.min(items.length - 1, i + 1);
    else next = i < 0 ? items.length - 1 : Math.max(0, i - 1);
    e.preventDefault();
    items[next]?.focus();
  };

  const visibleCategories = CATEGORY_ORDER.filter((c) => c !== "benign" && groups[c].length > 0);
  const benignCount = groups.benign.reduce((n, g) => n + g.conflicts.length, 0);

  return (
    <div className={clsx("flex flex-col", compact ? "gap-3" : "gap-5")} data-own-keys onKeyDown={onKeyDown}>
      {!compact && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            When two tabs change the same thing without seeing each other&rsquo;s edit, Weave ties a{" "}
            <span className="font-medium text-knot">knot</span>. Open one to see exactly why it came out this way.
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted" aria-live="polite">
            <StatusChip tone="knot">{stats.live} live</StatusChip>
            {stats.settled > 0 && (
              <StatusChip tone="muted" hollow>
                {stats.settled} settled
              </StatusChip>
            )}
            {stats.agreed > 0 && (
              <StatusChip tone="ok" hollow>
                {stats.agreed} agreed
              </StatusChip>
            )}
          </p>
        </div>
      )}

      {visibleCategories.map((cat) => (
        <CategorySection key={cat} category={cat} groups={groups[cat]} compact={compact} />
      ))}

      {visibleCategories.length === 0 && (
        <p className="rounded-[12px] border border-dashed border-line-2 px-4 py-3 text-[12.5px] text-ink-2">
          No real disagreements — every knot so far is two tabs making the same change.
        </p>
      )}

      {benignCount > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showBenign}
            onClick={() => setShowBenign((v) => !v)}
            className="inline-flex w-fit items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink"
          >
            {showBenign ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
            {showBenign ? "Hide agreed edits" : `Show ${plural(benignCount, "agreed edit")}`}
          </button>
          {showBenign && <CategorySection category="benign" groups={groups.benign} compact={compact} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ sections */

function CategorySection({ category, groups, compact }: { category: Category; groups: ConflictGroup[]; compact: boolean }) {
  const copy = CATEGORY_COPY[category];
  const count = groups.reduce((n, g) => n + g.conflicts.length, 0);
  return (
    <section aria-label={`${copy.title}: ${plural(count, "knot")}`} className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2 px-0.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-2">{copy.title}</h3>
        <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
        {!compact && <span className="ml-1 min-w-0 flex-1 truncate text-[11.5px] text-muted">{copy.tagline}</span>}
      </header>
      <ul className="flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.key}>
            <KnotCard group={g} compact={compact} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ cards */

export function HeadlineText({ segments, className }: { segments: Segment[]; className?: string }) {
  return (
    <span className={className}>
      {segments.map((s, i) =>
        typeof s === "string" ? <span key={i}>{s}</span> : <ThreadChip key={i} thread={s.thread} size="xs" className="mx-[1px]" />,
      )}
    </span>
  );
}

function useGhostPreview(conflictId: string) {
  const ui = useUiStore();
  const enter = useCallback(() => ui.getState().set({ ghost: { conflictId } }), [ui, conflictId]);
  const leave = useCallback(() => {
    const g = ui.getState().ghost;
    if (g && g.conflictId === conflictId && !g.opId && !g.counterfactual) ui.getState().set({ ghost: null });
  }, [ui, conflictId]);
  return { enter, leave };
}

const KnotCard = memo(function KnotCard({ group, compact }: { group: ConflictGroup; compact: boolean }) {
  const session = useSession();
  const ui = useUiStore();
  const threadOf = useThreadOf();
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const lead = group.lead;
  const shape = useShapeSnapshot(lead.shapeId);
  const getOp = session.replica.getOp.bind(session.replica);
  const headline = headlineFor(lead, getOp, threadOf, group.conflicts);
  const status = statusFor(lead, threadOf);
  const actions = actionsFor(lead, getOp, threadOf, lead.shapeType);
  const many = group.conflicts.length > 1;
  const { enter, leave } = useGhostPreview(lead.id);

  const open = (c: Conflict) => {
    const s = ui.getState();
    s.focusConflict({ id: c.id, lineageKey: c.lineageKey });
    s.set({ ghost: null });
  };

  const tone = !group.live ? "settled" : group.category === "benign" ? "benign" : "live";

  return (
    <div
      className={clsx(
        "group/card relative overflow-hidden rounded-[12px] border bg-panel transition-[border-color,box-shadow] duration-150",
        tone === "live" ? "border-line hover:border-line-2 hover:shadow-[0_6px_18px_-12px_color-mix(in_oklab,var(--knot)_60%,transparent)]" : "border-line hover:border-line-2",
      )}
    >
      {/* knot-coloured selvedge on live cards */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{
          background: tone === "live" ? "var(--knot)" : "transparent",
          backgroundImage: tone === "settled" ? "repeating-linear-gradient(180deg, var(--line-2) 0 3px, transparent 3px 6px)" : undefined,
        }}
      />
      <button
        type="button"
        data-knot-item=""
        data-conflict-id={lead.id}
        onClick={() => open(lead)}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={enter}
        onBlur={leave}
        aria-label={`${headline.text}. ${group.conflicts.length > 1 ? `${groupNoun(group)}. ` : ""}${status.text}${status.thread ? ` ${status.thread.label}` : ""}. Open explanation.`}
        className={clsx("flex w-full items-start gap-3 text-left", compact ? "px-3 py-2.5" : "px-3.5 py-3")}
      >
        <span className="relative shrink-0">
          <ShapeThumb
            shape={shape}
            dead={shape ? !shape.alive : true}
            width={compact ? 40 : 52}
            height={compact ? 34 : 44}
            padding={10}
            className="rounded-[8px] ring-1 ring-line"
            background="var(--paper)"
          />
          {many && (
            <span className="absolute -bottom-1.5 -right-1.5 rounded-full border border-line bg-panel px-1 font-mono text-[9.5px] font-semibold leading-[14px] text-ink-2">
              ×{group.conflicts.length}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={clsx("leading-snug text-ink", compact ? "text-[12.5px]" : "text-[13px]")}>
            <span className="font-semibold">{headline.topic}</span>
            <span className="mx-1.5 text-muted" aria-hidden>
              ·
            </span>
            <HeadlineText segments={headline.segments} />
          </span>
          {!compact && actions.length > 0 && (
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-muted">
              {actions.map((a, i) => (
                <span key={i} className="inline-flex min-w-0 items-center gap-1">
                  {i > 0 && <span className="px-0.5 text-[10.5px] italic">vs</span>}
                  <ThreadChip thread={a.thread} size="xs" />
                  <span className="truncate">{a.label}</span>
                </span>
              ))}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {status.live ? (
              <StatusChip tone={group.category === "benign" ? "ok" : "knot"} hollow={group.category === "benign"}>
                {status.text}
              </StatusChip>
            ) : (
              <StatusChip tone="muted" hollow>
                {status.text}
                {status.thread && <ThreadChip thread={status.thread} size="xs" className="-my-1 ml-0.5" />}
              </StatusChip>
            )}
            <span className="text-[11px] text-muted">{groupNoun(group)}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-mono text-[10.5px] tabular-nums text-muted" title={`Lamport ${group.lamport}: where this knot sits in history`}>
            L{group.lamport}
          </span>
          <ChevronRight aria-hidden className="size-4 text-muted transition-transform group-hover/card:translate-x-0.5" />
        </span>
      </button>

      {many && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 border-t border-dashed border-line px-3.5 py-1.5 text-left text-[11.5px] font-medium text-ink-2 hover:bg-panel-2"
          >
            {expanded ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
            {expanded ? "Hide shapes" : `One knot per shape — show all ${group.conflicts.length}`}
          </button>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.ul
                initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: reduce ? 0.1 : 0.2 }}
                className="overflow-hidden border-t border-line bg-panel-2/60"
              >
                {group.conflicts.map((c) => (
                  <li key={c.id}>
                    <GroupRow conflict={c} onOpen={() => open(c)} />
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
});

function GroupRow({ conflict, onOpen }: { conflict: Conflict; onOpen: () => void }) {
  const session = useSession();
  const threadOf = useThreadOf();
  const shape = useShapeSnapshot(conflict.shapeId);
  const headline = headlineFor(conflict, session.replica.getOp.bind(session.replica), threadOf);
  const status = statusFor(conflict, threadOf);
  const { enter, leave } = useGhostPreview(conflict.id);
  return (
    <button
      type="button"
      data-knot-item=""
      data-conflict-id={conflict.id}
      onClick={onOpen}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocus={enter}
      onBlur={leave}
      aria-label={`${headline.text}. ${status.text}${status.thread ? ` ${status.thread.label}` : ""}. Open explanation.`}
      className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left hover:bg-panel-2"
    >
      <ShapeThumb shape={shape} dead={shape ? !shape.alive : true} width={30} height={24} padding={8} className="rounded-[6px] ring-1 ring-line" />
      <HeadlineText segments={headline.segments} className="min-w-0 flex-1 truncate text-[12px] text-ink-2" />
      {!status.live && <span className="text-[10.5px] text-muted">settled</span>}
      <span className="font-mono text-[10.5px] tabular-nums text-muted">L{conflict.lamport}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ empty */

function EmptyKnots({ compact }: { compact: boolean }) {
  return (
    <div className={clsx("flex flex-col items-center text-center", compact ? "gap-2 px-2 py-4" : "gap-3 px-4 py-8")}>
      <ThreadsCrossing className={compact ? "h-14 w-auto" : "h-20 w-auto"} />
      <p className={clsx("font-serif text-ink", compact ? "text-[20px]" : "text-[26px] leading-none")}>No knots.</p>
      <p className="max-w-[30ch] text-[12.5px] leading-relaxed text-ink-2">
        Unplug a tab, edit the same shape in both, plug it back in.
      </p>
      {!compact && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <KnotIcon size={14} className="text-knot" />
          Tip: <Kbd>\</Kbd> unplugs this tab.
        </p>
      )}
    </div>
  );
}
