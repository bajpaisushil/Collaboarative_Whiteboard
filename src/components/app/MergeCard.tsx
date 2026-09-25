"use client";
/**
 * Reconnect choreography: when a merge report arrives, pulse the changed shapes on the canvas
 * and slide in a card that says who brought what ("Rejoined B after 1m 12s · you brought 7
 * edits · B brought 4 · 2 knots") with a shortcut into the explainer.
 */
import { ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Conflict } from "@/lib/crdt/types";
import type { MergeReport, WhiteboardSessionApi } from "@/lib/session/types";
import { useSession, useSessionEvent, useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { useUiStore } from "@/lib/ui/store";
import { handOffFocus } from "@/components/ui/focus";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { formatDuration, listLabels, plural } from "./format";
import { isLiveKnot, labelOf, selectLabel } from "./selectors";

const AUTO_HIDE_MS = 12_000;

interface Fact {
  text: string;
  /** Highlight as a knot count. */
  knot?: boolean;
}

interface MergeCardModel {
  id: string;
  /** First peer's letter for the glyph (null when unknown). */
  peerLabel: string | null;
  title: string;
  facts: Fact[];
  knots: number;
  /** Conflicts this merge created (knots + benign/superseded ones). */
  conflicts: number;
  explain: { id: string; lineageKey: string } | null;
  announcement: string;
}

function labelsOf(ids: Iterable<string>, session: WhiteboardSessionApi): string[] {
  const labels = new Set<string>();
  for (const r of ids) {
    const l = labelOf(session, r);
    if (l) labels.add(l);
  }
  return [...labels].sort();
}

/** Letters of the tabs that wrote the edits we received (not whoever happened to pass them on). */
export function authorLabelsOf(report: MergeReport, session: WhiteboardSessionApi): string[] {
  const self = session.getState().replica;
  const ids = new Set<string>();
  for (const opId of report.receivedOpIds) {
    const author = session.replica.getOp(opId)?.replica ?? opId.slice(0, opId.lastIndexOf(":"));
    if (author && author !== self) ids.add(author);
  }
  return labelsOf(ids, session);
}

/** Letters of the tabs we (re)connected with: the report's peers, else the authors. */
function peerLabelsOf(report: MergeReport, session: WhiteboardSessionApi): string[] {
  const self = session.getState().replica;
  const peers = labelsOf(
    report.peers.filter((r) => r !== self),
    session,
  );
  return peers.length > 0 ? peers : authorLabelsOf(report, session);
}

export function buildMergeCardModel(report: MergeReport, session: WhiteboardSessionApi): MergeCardModel | null {
  const peerLabels = peerLabelsOf(report, session);
  const peers = listLabels(peerLabels);
  // Who *brought* edits: their authors. Through a bridge tab, the tab we heard from (the
  // report's peer) is often not the one that made the edit.
  const authorLabels = authorLabelsOf(report, session);
  const authors = listLabels(authorLabels.length > 0 ? authorLabels : peerLabels);
  const who = authors || peers || "another tab";
  const byId = new Map(session.replica.getView().conflicts.map((c) => [c.id, c] as const));
  const fresh = report.newConflicts.map((id) => byId.get(id)).filter((c): c is Conflict => c !== undefined);
  const knotList = fresh.filter(isLiveKnot);
  const knots = knotList.length;
  const received = report.receivedOpIds.length;
  const offline = report.receivedOpIds.reduce((n, id) => n + (session.replica.getOp(id)?.meta.offline ? 1 : 0), 0);
  const sent = report.sentCount;
  const revived = report.resurrected.length;
  const target = knotList[0] ?? fresh[0] ?? null;

  let title: string;
  const facts: Fact[] = [];
  switch (report.direction) {
    case "rejoined": {
      if (received === 0 && sent === 0) return null;
      const apart = report.apartMs >= 1000 ? ` after ${formatDuration(report.apartMs)}` : "";
      title = peers ? `Rejoined ${peers}${apart}` : `Back online${apart}`;
      facts.push({ text: `you brought ${plural(sent, "edit")}` }, { text: `${authors || "others"} brought ${received}` });
      break;
    }
    case "peer-returned": {
      if (received === 0 && sent === 0 && fresh.length === 0) return null;
      const verb = peerLabels.length > 1 ? "are" : "is";
      if (offline > 0) {
        // They were unplugged (or unreachable) and came back with edits made meanwhile.
        const many = (authorLabels.length || peerLabels.length) > 1;
        title = `${authors || "A tab"} ${many ? "are" : "is"} back with ${plural(offline, "offline edit")}`;
        if (received > offline) facts.push({ text: `+${received - offline} more` });
      } else if (received > 0) {
        // Both online, but slow links let edits cross in flight.
        title = `Merged ${plural(received, "edit")} from ${who} that crossed yours`;
      } else {
        title = `${peers || "A tab"} ${verb} back`;
      }
      facts.push({ text: sent > 0 ? `you had ${plural(sent, "edit")} they hadn’t seen` : "they’d seen all your edits" });
      break;
    }
    case "joined": {
      // Ordinary joins are quiet (a toast covers them) unless the merge tied a knot.
      if (knots === 0 && revived === 0) return null;
      title = `Synced with ${peers || "a new tab"}`;
      facts.push({ text: `received ${plural(received, "edit")}` }, { text: `sent ${sent}` });
      break;
    }
  }
  facts.push(knots > 0 ? { text: plural(knots, "knot"), knot: true } : { text: "no knots" });
  if (revived > 0) facts.push({ text: `${plural(revived, "deleted shape")} came back` });

  return {
    id: report.id,
    peerLabel: authorLabels[0] ?? peerLabels[0] ?? null,
    title,
    facts,
    knots,
    conflicts: fresh.length,
    explain: target ? { id: target.id, lineageKey: target.lineageKey } : null,
    announcement: `${title}. ${facts.map((f) => f.text).join(", ")}.`,
  };
}

export function MergeCard() {
  const session = useSession();
  const store = useUiStore();
  const [card, setCard] = useState<MergeCardModel | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [paused, setPaused] = useState(false);

  useSessionEvent((e) => {
    if (e.type !== "merge") return;
    const report = e.report;
    if (report.changed.length > 0 || report.resurrected.length > 0) {
      store.getState().set({
        flash: { shapeIds: report.changed.map((c) => c.shapeId), revived: report.resurrected, at: Date.now() },
      });
    }
    const model = buildMergeCardModel(report, session);
    if (!model) return;
    setCard(model);
    setPaused(false);
    setAnnouncement(model.announcement);
  });

  useEffect(() => {
    if (!card || paused) return;
    const t = setTimeout(() => setCard(null), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [card, paused]);

  const explain = () => {
    if (!card) return;
    const ui = store.getState();
    const conflicts = session.replica.getView().conflicts;
    const want = card.explain;
    const hit = want
      ? (conflicts.find((c) => c.id === want.id) ?? conflicts.find((c) => c.lineageKey === want.lineageKey))
      : undefined;
    if (hit) ui.focusConflict({ id: hit.id, lineageKey: hit.lineageKey });
    else ui.set({ panelOpen: true, lensTab: "why" });
    setCard(null);
  };

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <AnimatePresence>
        {card && (
          <CardView
            key={card.id}
            card={card}
            onExplain={explain}
            onDismiss={() => setCard(null)}
            onPause={setPaused}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function CardView({
  card,
  onExplain,
  onDismiss,
  onPause,
}: {
  card: MergeCardModel;
  onExplain: () => void;
  onDismiss: () => void;
  onPause: (paused: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const selfLabel = useSessionState(selectLabel);
  const ref = useRef<HTMLElement>(null);
  const leave = (then: () => void) => () => {
    handOffFocus(ref.current);
    then();
  };
  return (
    <motion.section
      ref={ref}
      aria-label="Merge report"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onPointerEnter={() => onPause(true)}
      onPointerLeave={() => onPause(false)}
      onFocus={() => onPause(true)}
      onBlur={() => onPause(false)}
      className="sheet pointer-events-auto w-full max-w-[480px] overflow-hidden"
    >
      <div className="flex items-center gap-3 py-3 pl-3 pr-2">
        <MergeGlyph self={selfLabel} peer={card.peerLabel} knot={card.knots > 0} animate={!reduce} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-snug text-ink">{card.title}</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
            {card.facts.map((f, i) => (
              <span key={f.text}>
                {i > 0 && (
                  <span aria-hidden className="px-1 text-line-2">
                    ·
                  </span>
                )}
                <span className={f.knot ? "font-medium text-knot" : undefined}>{f.text}</span>
              </span>
            ))}
          </p>
        </div>
        <button
          type="button"
          onClick={leave(onDismiss)}
          aria-label="Dismiss merge report"
          title="Dismiss"
          className="grid size-7 shrink-0 place-items-center self-start rounded-[8px] text-muted hover:bg-panel-2 hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      {card.explain && (
        <div className="flex items-center gap-2 border-t border-line bg-panel-2 py-2 pl-3.5 pr-2">
          <KnotIcon size={16} className={card.knots > 0 ? "shrink-0 text-knot" : "shrink-0 text-muted"} />
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
            {card.knots > 1
              ? "Tabs changed the same things at the same time — neither had seen the other’s edit."
              : card.knots === 1
                ? "Two tabs changed the same thing at the same time — neither had seen the other’s edit."
                : "Tabs edited the same thing at once, but it didn’t change the result."}{" "}
            <span className="text-muted">See how {card.conflicts === 1 ? "it was" : "each was"} decided.</span>
          </p>
          <button
            type="button"
            onClick={leave(onExplain)}
            className="flex shrink-0 items-center gap-1 rounded-[9px] bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2"
          >
            Explain
            <ArrowRight aria-hidden className="size-3.5" />
          </button>
        </div>
      )}
    </motion.section>
  );
}

/** Two labelled threads converging into one woven line (with a knot where they met). */
function MergeGlyph({ self, peer, knot, animate }: { self: string; peer: string | null; knot: boolean; animate: boolean }) {
  const a = peer ? threadColor(peer) : "var(--muted)";
  const b = threadColor(self);
  return (
    <div className="flex shrink-0 items-center">
      <div className="flex flex-col gap-[10px]">
        {peer ? (
          <ThreadBadge label={peer} size="xs" />
        ) : (
          <span aria-hidden className="size-[18px] rounded-full border-[1.5px] border-dashed border-line-2 bg-panel" />
        )}
        <ThreadBadge label={self} size="xs" />
      </div>
      <svg width="40" height="46" viewBox="0 0 40 46" fill="none" aria-hidden className="-ml-px">
        <motion.path
          d="M0 9C12 9 13 23 22 23"
          stroke={a}
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={animate ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        <motion.path
          d="M0 37C12 37 13 23 22 23"
          stroke={b}
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={animate ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        <path d="M22 23H39" stroke={a} strokeWidth={2.5} strokeDasharray="4 4" />
        <path d="M22 23H39" stroke={b} strokeWidth={2.5} strokeDasharray="4 4" strokeDashoffset={4} />
        {knot && <circle cx="22" cy="23" r="4.2" fill="var(--knot)" stroke="var(--panel)" strokeWidth={1.5} />}
      </svg>
    </div>
  );
}
