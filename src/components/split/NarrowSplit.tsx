"use client";
/**
 * Split view under 1100px: a slim bar with a segmented control ([A] [B] [Both] — both = two
 * stacked halves) and a button that opens the director's desk as a drawer. Hidden panes
 * unmount (their sessions keep running); while the drawer is closed, a pill shows what the
 * current scene or tour step is doing.
 */
import clsx from "clsx";
import { Clapperboard } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { threadColor } from "@/lib/ui/colors";
import { ThreadMark } from "@/components/ui/ThreadMark";
import { useExternal } from "./hooks";
import type { ScenarioRunner } from "./runner";
import { scenarioById } from "./scenarios";
import { TOUR_STEPS, type TourController } from "./tour";

type View = "A" | "B" | "both";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "A", label: "A", hint: "Show Tab A only" },
  { id: "B", label: "B", hint: "Show Tab B only" },
  { id: "both", label: "Both", hint: "Show both tabs, stacked" },
];

export function NarrowSplit({
  paneA,
  paneB,
  seam,
  runner,
  tour,
}: {
  paneA: ReactNode;
  paneB: ReactNode;
  seam: (close: () => void) => ReactNode;
  runner: ScenarioRunner;
  tour: TourController;
}) {
  const [view, setView] = useState<View>("both");
  const [drawer, setDrawer] = useState(false);
  const run = useExternal(runner);
  const t = useExternal(tour);
  const busy = run.phase === "setup" || run.phase === "running";

  return (
    <main aria-label="Weave split view" className="flex h-dvh flex-col bg-paper-2 text-ink">
      <h1 className="sr-only">Weave split view — Tab A and Tab B, with the director’s desk</h1>
      <div className="flex h-12 shrink-0 items-center gap-2 px-2.5">
        <span className="flex items-center gap-1.5">
          <ThreadMark size={20} surface="var(--paper-2)" />
          <span className="font-serif text-[18px] italic leading-none">Weave</span>
        </span>
        <Segmented view={view} onChange={setView} />
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-expanded={drawer}
          aria-controls="split-director"
          className="relative ml-auto inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-panel px-2.5 text-[12.5px] font-semibold text-ink hover:bg-panel-2"
        >
          <Clapperboard aria-hidden className="size-4" strokeWidth={1.8} />
          Director
          {(busy || t.active) && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-knot ring-2 ring-paper-2" />}
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
        {view !== "B" && <div className="flex min-h-0 flex-1 flex-col">{paneA}</div>}
        {view !== "A" && <div className="flex min-h-0 flex-1 flex-col">{paneB}</div>}

        {!drawer && (busy || t.active) && (
          <StatusPill onOpen={() => setDrawer(true)}>
            {busy ? <RunLine runner={runner} /> : t.step < TOUR_STEPS.length ? `Tour ${t.step + 1}/5 · ${TOUR_STEPS[t.step].title}` : "Tour complete — open the director"}
          </StatusPill>
        )}

        <Drawer open={drawer} onClose={() => setDrawer(false)}>
          {seam(() => setDrawer(false))}
        </Drawer>
      </div>
    </main>
  );
}

function Segmented({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div role="group" aria-label="Which tabs to show" className="flex items-center rounded-[10px] border border-line bg-panel p-0.5">
      {VIEWS.map((v) => {
        const on = v.id === view;
        const color = v.id === "both" ? "var(--ink)" : threadColor(v.id);
        return (
          <button
            key={v.id}
            type="button"
            aria-pressed={on}
            title={v.hint}
            onClick={() => onChange(v.id)}
            className={clsx("h-7 min-w-9 rounded-[8px] px-2 text-[12.5px] font-semibold transition-colors", on ? "text-paper" : "text-ink-2 hover:bg-panel-2")}
            style={on ? { background: color } : v.id !== "both" ? { color } : undefined}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

function RunLine({ runner }: { runner: ScenarioRunner }) {
  const run = useExternal(runner);
  const scenario = run.scenarioId ? scenarioById(run.scenarioId) : undefined;
  const active = run.statuses.indexOf("active");
  if (!scenario) return null;
  return (
    <>
      <span className="font-semibold">{scenario.title}</span>
      <span className="text-muted"> · {active >= 0 ? `${active + 1}/${scenario.steps.length} ${scenario.steps[active].say}` : run.message}</span>
    </>
  );
}

function StatusPill({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <button
        type="button"
        onClick={onOpen}
        aria-live="polite"
        className="pointer-events-auto max-w-[min(520px,100%)] truncate rounded-full border border-line bg-panel px-3.5 py-2 text-left text-[12px] text-ink shadow-sheet hover:bg-panel-2"
      >
        {children}
      </button>
    </div>
  );
}

function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => panel.querySelector<HTMLElement>("[data-pane='seam']")?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep keyboard focus inside the drawer while it covers the tabs.
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || !panel.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      panel.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="drawer" className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0.08 : 0.16 }}>
          <div aria-hidden className="absolute inset-0 bg-[color-mix(in_oklab,var(--ink)_20%,transparent)] backdrop-blur-[1px]" onPointerDown={onClose} />
          <motion.div
            ref={panelRef}
            id="split-director"
            role="dialog"
            aria-modal="true"
            aria-label="Director’s view"
            className="absolute inset-y-2 right-2 flex w-[min(400px,calc(100%-16px))] flex-col"
            initial={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
            transition={{ duration: reduce ? 0.08 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
