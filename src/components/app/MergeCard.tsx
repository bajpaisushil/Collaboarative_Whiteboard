"use client";
/**
 * Reconnect choreography: when a merge report arrives, pulse the changed shapes on the canvas
 * and slide in a card that says who brought what ("Rejoined B after 1m 12s · you brought 7
 * edits · B brought 4 · 2 knots") with a shortcut into the explainer.
 */
import { ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { Conflict } from "@/lib/crdt/types";
import type { MergeReport, WhiteboardSessionApi } from "@/lib/session/types";
import { useSession, useSessionEvent, useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { useUiStore } from "@/lib/ui/store";
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
  direction: MergeReport["direction"];
  peerLabels: string[];
  title: string;
  facts: Fact[];
  knots: number;
  explain: { id: string; lineageKey: string } | null;
  announcement: string;
}

function buildModel(report: MergeReport, session: WhiteboardSessionApi): MergeCardModel | null {
  const peerLabels = report.peers.map((r) => labelOf(session, r));
  const peers = listLabels(peerLabels);
  const byId = new Map(session.replica.getView().conflicts.map((c) => [c.id, c] as const));
  const fresh = report.newConflicts.map((id) => byId.get(id)).filter((c): c is Conflict => c !== undefined);
  const knotList = fresh.filter(isLiveKnot);
  const knots = knotList.length;
  const received = report.receivedOpIds.length;
  const sent = report.sentCount;
  const revived = report.resurrected.length;
  const target = knotList[0] ?? fresh[0] ?? null;

  let title: string;
  const facts: Fact[] = [];
  switch (report.direction) {
    case "rejoined": {
      if (peerLabels.length === 0 && received === 0 && sent === 0) return null;
      const apart = report.apartMs >= 1000 ? ` after ${formatDuration(report.apartMs)}` : "";
      title = peerLabels.length > 0 ? `Rejoined ${peers}${apart}` : `Back online${apart}`;
      facts.push({ text: `you brought ${plural(sent, "edit")}` }, { text: `${peers || "others"} brought ${received}` });
      break;
    }
    case "peer-returned": {
      if (received === 0 && sent === 0 && fresh.length === 0) return null;
      const verb = peerLabels.length > 1 ? "are" : "is";
      title = received > 0 ? `${peers} ${verb} back with ${plural(received, "offline edit")}` : `${peers} ${verb} back`;
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
    direction: report.direction,
    peerLabels,
    title,
    facts,
    knots,
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
    const model = buildModel(report, session);
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
  const peerLabel = card.peerLabels[0] ?? "?";
  return (
    <motion.section
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
        <MergeGlyph self={selfLabel} peer={peerLabel} knot={card.knots > 0} animate={!reduce} />
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
          onClick={onDismiss}
          aria-label="Dismiss merge report"
          title="Dismiss"
          className="grid size-7 shrink-0 place-items-center self-start rounded-[8px] text-muted hover:bg-panel-2 hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      {card.knots > 0 && (
        <div className="flex items-center gap-2 border-t border-line bg-panel-2 py-2 pl-3.5 pr-2">
          <KnotIcon size={16} className="shrink-0 text-knot" />
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
            {card.knots === 1 ? "Two tabs changed the same thing at the same time." : "Tabs changed the same things at the same time."}{" "}
            <span className="text-muted">See how each was decided.</span>
          </p>
          <button
            type="button"
            onClick={onExplain}
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
function MergeGlyph({ self, peer, knot, animate }: { self: string; peer: string; knot: boolean; animate: boolean }) {
  const a = threadColor(peer);
  const b = threadColor(self);
  return (
    <div className="flex shrink-0 items-center">
      <div className="flex flex-col gap-[10px]">
        <ThreadBadge label={peer} size="xs" />
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
