"use client";
/**
 * /split: two independent Weave sessions ("Tab A" and "Tab B") in one document — each with its
 * own replica id, storage namespace and BroadcastChannel object, so they sync exactly like two
 * browser tabs would — plus the director's seam between them.
 *
 * ≥1100px: [ Pane A | Seam | Pane B ]. Narrower: a segmented control shows A, B or both
 * (stacked halves), and the seam opens as a drawer.
 */
import { useEffect, useMemo, useState } from "react";
import { useAcquiredSession } from "@/lib/session/react";
import { createUiStore } from "@/lib/ui/store";
import { bridgeStores } from "./bridge";
import { useMediaQuery } from "./hooks";
import { NarrowSplit } from "./NarrowSplit";
import { PaneFrame } from "./PaneFrame";
import { readSplitParams, stripTourParam, writeRoomToUrl, type SplitParams } from "./room";
import { ScenarioRunner } from "./runner";
import { Seam } from "./Seam";
import { SplitSplash } from "./SplitSplash";
import { createStage } from "./stage";
import { TourController } from "./tour";

export const WIDE_QUERY = "(min-width: 1100px)";

export default function SplitApp() {
  // Client-only (ssr:false), so reading the URL on first render is safe.
  const [params] = useState<SplitParams>(() => readSplitParams(window.location.search));
  const [stores] = useState(() => ({ A: createUiStore(), B: createUiStore(), seam: createUiStore() }));
  const [runner] = useState(() => new ScenarioRunner());
  const [tour] = useState(() => new TourController());

  useEffect(() => {
    if (params.generated) writeRoomToUrl(params.room);
    if (params.tour) stripTourParam();
  }, [params]);

  const a = useAcquiredSession({ room: params.room, pane: "A", label: "A" });
  const b = useAcquiredSession({ room: params.room, pane: "B", label: "B" });

  const stage = useMemo(
    () => (a && b ? createStage({ a, b, storeA: stores.A, storeB: stores.B, seam: stores.seam }) : null),
    [a, b, stores],
  );

  useEffect(() => (stage ? bridgeStores(stage) : undefined), [stage]);
  useEffect(() => (stage ? tour.attach(stage, { autoStart: params.tour }) : undefined), [stage, tour, params.tour]);
  useEffect(() => () => runner.stop(), [runner]);

  const wide = useMediaQuery(WIDE_QUERY);

  if (!a || !b) return <SplitSplash />;

  const paneA = <PaneFrame pane="A" session={a} store={stores.A} />;
  const paneB = <PaneFrame pane="B" session={b} store={stores.B} />;

  if (!wide) {
    return (
      <NarrowSplit
        paneA={paneA}
        paneB={paneB}
        runner={runner}
        tour={tour}
        seam={(close) => <Seam stage={stage} runner={runner} tour={tour} room={params.room} onClose={close} />}
      />
    );
  }

  return (
    <main aria-label="Weave split view" className="grid h-dvh grid-cols-[minmax(0,1fr)_380px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-2.5 bg-paper-2 p-2.5 text-ink">
      <h1 className="sr-only">Weave split view — Tab A and Tab B side by side, with the director’s desk between them</h1>
      {paneA}
      <Seam stage={stage} runner={runner} tour={tour} room={params.room} />
      {paneB}
    </main>
  );
}
