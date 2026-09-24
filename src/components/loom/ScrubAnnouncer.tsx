"use client";
/** Polite screen-reader announcements for time travel (debounced while dragging). */
import { useEffect, useRef, useState } from "react";
import type { ReplicaId } from "@/lib/crdt/types";
import { useUi } from "@/lib/ui/store";
import { useLoomThreads, type LoomData } from "./hooks";
import { describeScrub } from "./scrub";

export function ScrubAnnouncer({ data }: { data: LoomData }) {
  const scrub = useUi((s) => s.scrub);
  const threads = useLoomThreads();
  const labelOf = (r: ReplicaId, fallback?: string) => threads(r, fallback).label;
  const d = describeScrub(scrub, data.model.log, data.model.indexOf, labelOf, data.snapshots);
  const text = d.kind === "live" ? "" : `Time travel: ${d.short}. Read-only — press Escape to return to live.`;
  const [message, setMessage] = useState("");
  const prev = useRef(text);

  useEffect(() => {
    if (text === prev.current) return;
    const wasTravelling = prev.current !== "";
    prev.current = text;
    const t = setTimeout(() => setMessage(text || (wasTravelling ? "Back to live. You can edit again." : "")), text ? 450 : 0);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
