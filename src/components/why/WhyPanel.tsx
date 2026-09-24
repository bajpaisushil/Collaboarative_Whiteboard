"use client";
/**
 * Content of the right-hand "Why?" sheet (the shell positions and animates the sheet).
 * Tabs: Knots (the conflict list, or the Explainer for the focused knot) and Snapshots.
 * A shape's provenance card ("why does this look like this?") sits on top when open.
 */
import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { ReplicaView } from "@/lib/crdt/types";
import { useReplicaView } from "@/lib/session/react";
import { useUi, useUiStore, type LensTab } from "@/lib/ui/store";
import { IconButton } from "@/components/ui/IconButton";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { SnapshotsPanel } from "@/components/loom/SnapshotsPanel";
import { ConflictList } from "./ConflictList";
import { Explainer } from "./Explainer";
import { ProvenanceCard } from "./ProvenanceCard";
import { useExplainDeepLink } from "./WhyDeepLink";

type PanelTab = "knots" | "snapshots";

const selectLiveKnots = (v: ReplicaView) => {
  let n = 0;
  for (const c of v.conflicts) if (c.status === "live" && !c.valuesEqual) n++;
  return n;
};
const selectSnapshotCount = (v: ReplicaView) => v.snapshots.length;

const TAB_OF: Record<PanelTab, LensTab> = { knots: "why", snapshots: "snapshots" };

export function WhyPanel() {
  const ui = useUiStore();
  const focus = useUi((s) => s.focus);
  const provenance = useUi((s) => s.provenance);
  const lensTab = useUi((s) => s.lensTab);
  const live = useReplicaView(selectLiveKnots);
  const snapshots = useReplicaView(selectSnapshotCount);
  const baseId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastOpened = useRef<string | null>(null);
  const tab: PanelTab = lensTab === "snapshots" ? "snapshots" : "knots";
  const focusId = focus?.id ?? null;

  useExplainDeepLink();

  // A newly opened knot (or tab) starts at the top.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [focusId, tab]);

  // Coming back to the list: put keyboard focus back on the card that was opened.
  useEffect(() => {
    if (focusId) {
      lastOpened.current = focusId;
      return;
    }
    const id = lastOpened.current;
    lastOpened.current = null;
    const scroller = scrollRef.current;
    if (!id || !scroller) return;
    const active = document.activeElement;
    if (active && active !== document.body && !scroller.contains(active)) return;
    const raf = requestAnimationFrame(() => {
      const card = Array.from(scroller.querySelectorAll<HTMLElement>("[data-conflict-id]")).find((el) => el.dataset.conflictId === id);
      card?.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusId]);

  const close = () => ui.getState().set({ panelOpen: false, ghost: null });
  const setTab = (t: PanelTab) => ui.getState().set({ lensTab: TAB_OF[t] });

  const tabs: { id: PanelTab; label: string; count: number }[] = [
    { id: "knots", label: "Knots", count: live },
    { id: "snapshots", label: "Snapshots", count: snapshots },
  ];

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next].id);
    requestAnimationFrame(() => document.getElementById(`${baseId}-tab-${tabs[next].id}`)?.focus());
  };

  return (
    <div data-why-scope="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-2 pt-4">
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-[var(--knot-soft)] text-knot">
          <KnotIcon size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[27px] italic leading-none tracking-tight text-ink">Why?</h2>
          <p className="mt-0.5 truncate text-[11.5px] text-muted">
            {live === 0 ? "Every merge, explained." : `${live} live knot${live === 1 ? "" : "s"} — two edits that never saw each other`}
          </p>
        </div>
        <IconButton icon={X} label="Close the Why panel" onClick={close} />
      </div>

      <div role="tablist" aria-label="Why panel sections" className="flex gap-1 border-b border-line px-4" onKeyDown={onTabKey}>
        {tabs.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              id={`${baseId}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={clsx(
                "relative -mb-px inline-flex items-center gap-1.5 px-2 pb-2.5 pt-2 text-[12.5px] font-medium transition-colors",
                selected ? "text-ink" : "text-muted hover:text-ink-2",
              )}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={clsx(
                    "rounded-full px-1.5 font-mono text-[10px] leading-[16px] tabular-nums",
                    t.id === "knots" ? "bg-[var(--knot-soft)] text-knot" : "bg-panel-2 text-ink-2",
                  )}
                >
                  {t.count}
                </span>
              )}
              {/* a stitched thread under the selected tab */}
              <span
                aria-hidden
                className={clsx("absolute inset-x-1 bottom-0 h-[2px] rounded-full transition-opacity", selected ? "opacity-100" : "opacity-0")}
                style={{ background: "repeating-linear-gradient(90deg, var(--ink) 0 5px, transparent 5px 8px)" }}
              />
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-4">
        {provenance && (
          <div className="mb-5">
            <ProvenanceCard shapeId={provenance} onClose={() => ui.getState().set({ provenance: null })} />
          </div>
        )}
        <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`}>
          {tab === "snapshots" ? (
            <SnapshotsPanel />
          ) : focus ? (
            <Explainer conflictId={focus.id} variant="panel" onClose={() => ui.getState().focusConflict(null)} />
          ) : (
            <ConflictList variant="panel" />
          )}
        </div>
      </div>
    </div>
  );
}
