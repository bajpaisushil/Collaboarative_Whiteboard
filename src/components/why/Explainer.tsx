"use client";
/**
 * The Explainer — why two concurrent edits were resolved the way they were, in three levels:
 *   L1  verdict: the question, the plain answer, the before/versions/result filmstrip, actions.
 *   L2  five questions you can open: were they really concurrent (seen-dots), who wins and why
 *       (decision flow), would every tab agree (convergence), what if (counterfactuals), and a
 *       step-by-step replay of the merge.
 *   L3  for engineers: stamps, clocks and raw ops.
 *
 * variant "seam" (the /split centre column): A's side sits left facing pane A, B's right, the
 * result in the middle, with compact typography.
 */
import clsx from "clsx";
import { ArrowLeft, Check, Code, Link2, LocateFixed } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReplicaView } from "@/lib/crdt/types";
import { useReplicaView, useSession, useSessionState } from "@/lib/session/react";
import type { SessionState } from "@/lib/session/types";
import { usePane } from "@/lib/ui/pane";
import { useUiStore } from "@/lib/ui/store";
import { useToast } from "@/components/ui/Toast";
import { valueWord } from "./format";
import { LooseThread } from "./illustrations";
import { useThreadOf } from "./threads";
import { useShapeSnapshot } from "./useShapeSnapshot";
import { copyText, explainLink, revealShape, useSideGhost } from "./explainer/actions";
import { Convergence } from "./explainer/Convergence";
import { DecisionFlow } from "./explainer/DecisionFlow";
import { Disclosure } from "./explainer/Disclosure";
import { Engineers } from "./explainer/Engineers";
import { Filmstrip } from "./explainer/Filmstrip";
import { buildModel, ExplainerContext, sideByOp, useExplainer, type WhyVariant } from "./explainer/model";
import { Replay } from "./explainer/Replay";
import { SeenDots } from "./explainer/SeenDots";
import { adoptStateFor, SideCard } from "./explainer/SideCards";
import { TextMerge } from "./explainer/TextMerge";
import { useFilm } from "./explainer/useFilm";
import { Verdict } from "./explainer/Verdict";
import { WhatIf } from "./explainer/WhatIf";

export interface ExplainerProps {
  conflictId: string;
  variant?: WhyVariant;
  /** Back / dismiss. When given, a "← All knots" bar is shown above the explanation. */
  onClose?: () => void;
}

const selectVersion = (v: ReplicaView) => v.version;
const selectConflicts = (v: ReplicaView) => v.conflicts;
const selectRoom = (s: SessionState) => s.room;

type SectionId = "concurrency" | "decision" | "convergence" | "whatif" | "replay" | "engineers";

const ALL_CLOSED: Record<SectionId, boolean> = {
  concurrency: false,
  decision: false,
  convergence: false,
  whatif: false,
  replay: false,
  engineers: false,
};

export function Explainer({ conflictId, variant = "panel", onClose }: ExplainerProps) {
  const session = useSession();
  const ui = useUiStore();
  const version = useReplicaView(selectVersion);
  const conflicts = useReplicaView(selectConflicts);
  const threadOf = useThreadOf();

  // The engine memoises per conflict; `version` only makes us ask again after a change.
  const explanation = useMemo(() => {
    void version;
    return session.replica.explain(conflictId);
  }, [session, conflictId, version]);
  const model = useMemo(() => (explanation ? buildModel(explanation, threadOf) : null), [explanation, threadOf]);
  const exists = conflicts.some((c) => c.id === conflictId);

  // Under partial delivery a knot can be re-identified (a later pair replaces the earlier one):
  // follow it by lineage instead of showing "gone".
  useEffect(() => {
    if (exists) return;
    const focus = ui.getState().focus;
    if (!focus || focus.id !== conflictId) return;
    const next = conflicts.find((c) => c.lineageKey === focus.lineageKey);
    if (next && next.id !== conflictId) ui.getState().focusConflict({ id: next.id, lineageKey: next.lineageKey });
  }, [exists, conflicts, conflictId, ui]);

  const dismiss = () => {
    ui.getState().focusConflict(null);
    onClose?.();
  };

  if (!model) {
    return (
      <div className="flex flex-col gap-4">
        {onClose && <BackBar onBack={dismiss} />}
        <KnotGone exists={exists} onBack={dismiss} compact={variant === "seam"} />
      </div>
    );
  }
  return (
    <ExplainerContext.Provider value={model}>
      <ExplainerBody variant={variant} onClose={onClose} onDismiss={dismiss} />
    </ExplainerContext.Provider>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1.5 inline-flex w-fit items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink"
      title="Back to all knots (Esc)"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      All knots
    </button>
  );
}

function KnotGone({ exists, onBack, compact }: { exists: boolean; onBack: () => void; compact: boolean }) {
  return (
    <div className={clsx("flex flex-col items-center gap-3 text-center", compact ? "py-4" : "py-8")} role="status">
      <LooseThread className="h-12 w-auto" />
      <p className={clsx("font-serif text-ink", compact ? "text-[20px]" : "text-[24px] leading-tight")}>
        {exists ? "This knot can’t be explained yet" : "This conflict is no longer present"}
      </p>
      <p className="max-w-[34ch] text-[12.5px] leading-relaxed text-ink-2">
        {exists
          ? "Some of the edits behind it haven’t reached this tab yet. It will fill in as soon as they arrive."
          : "A later edit replaced one of the two that clashed, so there is nothing left to decide. Both are still in the history."}
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-1 rounded-[9px] border border-line-2 px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-panel-2"
      >
        Back to all knots
      </button>
    </div>
  );
}

function ExplainerBody({ variant, onClose, onDismiss }: { variant: WhyVariant; onClose?: () => void; onDismiss: () => void }) {
  const model = useExplainer();
  const session = useSession();
  const ui = useUiStore();
  const toast = useToast();
  const { rootRef } = usePane();
  const room = useSessionState(selectRoom);
  const film = useFilm(model);
  const shape = useShapeSnapshot(model.conflict.shapeId);
  const conflictId = model.conflict.id;
  const { enter, leave } = useSideGhost(conflictId);
  const [open, setOpen] = useState(ALL_CLOSED);
  const [technical, setTechnical] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [copied, setCopied] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const headingId = useId();
  const compact = variant === "seam";
  const { conflict, explanation } = model;

  // Move keyboard focus to the question when a knot opens from inside this panel (the card
  // that was clicked is gone) — never steal it from the canvas.
  useEffect(() => {
    const active = document.activeElement;
    const scope = articleRef.current?.closest("[data-why-scope]") ?? articleRef.current;
    if (!active || active === document.body || (scope && scope.contains(active))) headingRef.current?.focus({ preventScroll: true });
  }, [conflictId]);

  // Don't leave a hover ghost behind when the explainer goes away.
  useEffect(() => () => leave(), [leave]);

  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const onAdopt = (opId: string) => {
    const d = sideByOp(model, opId);
    if (!d) return;
    const res = session.adoptConflictValue(conflictId, opId);
    if (!res) {
      setAnnouncement(session.getState().ready ? "Nothing to change — that value is already on the board." : "This tab is still starting up — try again in a moment.");
      return;
    }
    leave();
    const msg =
      d.role === "delete"
        ? `Deleted the ${model.noun}, as ${d.thread.label} intended.`
        : `Switched to ${d.thread.label}'s ${valueWord(d.side.wrote, conflict.props)}.`;
    setAnnouncement(msg);
    toast.push({
      id: `adopt-${conflictId}`,
      title: msg,
      detail: "It’s an ordinary new edit, sent to every tab. Undo brings the previous value back.",
      tone: "ok",
    });
  };

  const onShow = () => {
    if (!shape) return;
    const ok = revealShape(ui, rootRef.current, articleRef.current, shape);
    setAnnouncement(ok ? `Centred the ${model.noun} on the canvas.` : `Selected the ${model.noun}.`);
  };

  const onCopy = async () => {
    const ok = await copyText(explainLink(conflictId, room));
    setCopied(ok);
    setAnnouncement(ok ? "Link copied. Anyone in this room can open it to see this explanation." : "Couldn’t copy the link.");
    if (ok) setTimeout(() => setCopied(false), 1800);
  };

  const decisive = explanation.steps.find((s) => s.outcome === "decisive");
  const cfDiffer = explanation.counterfactuals.filter((c) => c.differs).length;
  const sideCards = model.sides.map((d) => (
    <SideCard
      key={d.side.opId}
      d={d}
      variant={variant}
      layout={compact ? "column" : "row"}
      adopt={adoptStateFor(d, conflict.kind, conflict.props, shape)}
      onAdopt={onAdopt}
      onEnter={enter}
      onLeave={leave}
    />
  ));

  return (
    <article ref={articleRef} aria-labelledby={headingId} data-why-scope="" className={clsx("flex flex-col", compact ? "gap-4" : "gap-5")}>
      {onClose && <BackBar onBack={onClose} />}

      <div
        className={clsx("flex flex-col rounded-[14px] border border-line", compact ? "gap-3 p-3" : "gap-4 p-4")}
        style={{
          background:
            "repeating-linear-gradient(90deg, color-mix(in oklab, var(--line) 28%, transparent) 0 1px, transparent 1px 7px), var(--panel)",
        }}
      >
        <Verdict variant={variant} headingId={headingId} ref={headingRef} />
        <Filmstrip film={film} variant={variant} onSideEnter={enter} onSideLeave={leave} />
        <div className={clsx(compact ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2")}>{sideCards}</div>
        {conflict.kind === "concurrent-text" && <TextMerge compact={compact} />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!compact && (
          <button
            type="button"
            onClick={onShow}
            disabled={!shape}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-line-2 px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
            title="Select the shape and centre it on the canvas"
          >
            <LocateFixed aria-hidden className="size-3.5" />
            Show on canvas
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-line-2 px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2"
          title="Copy a link that opens this explanation"
        >
          {copied ? <Check aria-hidden className="size-3.5 text-ok" /> : <Link2 aria-hidden className="size-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[10px] bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2"
          title="Keep the result as it is and close this explanation"
        >
          <Check aria-hidden className="size-3.5" strokeWidth={2.4} />
          Keep result
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div className="flex flex-col">
        <Disclosure
          index="01"
          compact={compact}
          title="Were they really at the same time?"
          preview={explanation.vcProof.relation === "concurrent" ? "Yes — neither saw the other" : "No — one came first"}
          open={open.concurrency}
          onToggle={() => toggle("concurrency")}
        >
          <SeenDots compact={compact} />
        </Disclosure>
        <Disclosure
          index="02"
          compact={compact}
          title="Who wins, and why?"
          preview={decisive?.title}
          open={open.decision}
          onToggle={() => toggle("decision")}
        >
          <DecisionFlow technical={technical} onTechnical={setTechnical} />
        </Disclosure>
        <Disclosure
          index="03"
          compact={compact}
          title="Would every tab agree?"
          preview={
            explanation.convergence.equal ? (
              <span className="text-ok">Same result ✓</span>
            ) : (
              <span className="font-semibold text-knot">Different results ✕</span>
            )
          }
          open={open.convergence}
          onToggle={() => toggle("convergence")}
        >
          <Convergence />
        </Disclosure>
        <Disclosure
          index="04"
          compact={compact}
          title="What if…"
          preview={`${cfDiffer} of ${explanation.counterfactuals.length} would change it`}
          open={open.whatif}
          onToggle={() => toggle("whatif")}
        >
          <WhatIf />
        </Disclosure>
        <Disclosure index="05" compact={compact} title="Replay the merge" preview="6 beats" open={open.replay} onToggle={() => toggle("replay")}>
          <Replay key={conflictId} />
        </Disclosure>
      </div>

      <div className="rounded-[14px] border border-dashed border-line-2 px-3">
        <Disclosure
          compact
          title={
            <span className="inline-flex items-center gap-2 font-mono text-[12px] tracking-tight text-ink-2">
              <Code aria-hidden className="size-3.5" />
              For engineers
            </span>
          }
          preview={<span className="font-mono">{conflict.ops.length} ops · stamps · JSON</span>}
          open={open.engineers}
          onToggle={() => toggle("engineers")}
        >
          <Engineers />
        </Disclosure>
      </div>
    </article>
  );
}
