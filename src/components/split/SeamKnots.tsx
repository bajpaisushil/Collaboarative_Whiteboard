"use client";
/**
 * Knots on the director's desk: the conflict list (seam variant) or, when a knot is focused
 * anywhere, its Explainer — A's side facing Tab A, B's facing Tab B. Provenance cards opened
 * in a pane ("why does this look like this?") appear here too, read from that pane's session.
 */
import { useReducedMotion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { useStore } from "zustand";
import type { ReplicaView } from "@/lib/crdt/types";
import { SessionProvider } from "@/lib/session/react";
import { useUi } from "@/lib/ui/store";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ConflictList } from "@/components/why/ConflictList";
import { Explainer } from "@/components/why/Explainer";
import { ProvenanceCard } from "@/components/why/ProvenanceCard";
import { useViewSelect } from "./hooks";
import { SeamBoundary } from "./SeamBoundary";
import type { PaneId, Stage } from "./stage";

const selectLiveKnots = (v: ReplicaView) => {
  let n = 0;
  for (const c of v.conflicts) if (c.status === "live" && !c.valuesEqual) n++;
  return n;
};

export function SeamKnots({ stage }: { stage: Stage }) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();
  const focusId = useUi((s) => s.focus?.id ?? null);
  const count = useViewSelect(stage.panes.A.session, selectLiveKnots, 0);
  const provA = useStore(stage.panes.A.store, (s) => s.provenance);
  const provB = useStore(stage.panes.B.store, (s) => s.provenance);
  const prov: { pane: PaneId; shapeId: string } | null = provA ? { pane: "A", shapeId: provA } : provB ? { pane: "B", shapeId: provB } : null;

  // Bring the explanation into view whenever a knot gets focused (from here, a pane or a scene).
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => sectionRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }), 280);
    return () => clearTimeout(t);
  }, [focusId, reduce]);

  return (
    <section ref={sectionRef} id="seam-knots" aria-labelledby={headingId} className="relative scroll-mt-1 px-4 pt-6">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="grid size-6 place-items-center rounded-full bg-[var(--knot-soft)] text-knot">
          <KnotIcon size={15} strokeWidth={2.1} />
        </span>
        <h2 id={headingId} className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">
          Knots
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
        <span className="ml-auto text-[11px] text-muted">same list in both tabs</span>
      </div>

      {prov && (
        <div className="mb-3">
          <SessionProvider session={stage.panes[prov.pane].session}>
            <SeamBoundary name="Provenance card">
              <ProvenanceCard shapeId={prov.shapeId} onClose={() => stage.panes[prov.pane].store.getState().set({ provenance: null })} />
            </SeamBoundary>
          </SessionProvider>
        </div>
      )}

      <SeamBoundary name="The knots panel">
        {focusId ? <Explainer conflictId={focusId} variant="seam" onClose={() => stage.clearFocus()} /> : <ConflictList variant="seam" />}
      </SeamBoundary>
    </section>
  );
}
