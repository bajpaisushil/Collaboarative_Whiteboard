"use client";
/**
 * "Why does this look like this?" — per-property provenance for any shape: who set each
 * value, and whether that was an ordinary overwrite (the writer had seen the old value) or a
 * concurrent clash (a knot). Plus text authorship and alive/deleted state.
 */
import { X } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { shapeNoun } from "@/lib/crdt/describe";
import type { Op, OpCause, ReplicaView, ShapeProps, ShapeProvenance, ShapeType } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUiStore } from "@/lib/ui/store";
import { IconButton } from "@/components/ui/IconButton";
import { KnotIcon } from "@/components/ui/KnotIcon";
import { ShapeThumb, StatusChip, Swatch, ThreadChip } from "./bits";
import { plural, propsTitle, valueDetail, valueWord } from "./format";
import { useThreadOf } from "./threads";
import { useShapeSnapshot } from "./useShapeSnapshot";

type Register = ShapeProvenance["registers"][number];

const selectVersion = (v: ReplicaView) => v.version;
const selectConflicts = (v: ReplicaView) => v.conflicts;

const RELEVANT: Record<string, ReadonlySet<ShapeType>> = {
  points: new Set<ShapeType>(["stroke", "arrow"]),
  fill: new Set<ShapeType>(["rect", "ellipse", "sticky"]),
  stroke: new Set<ShapeType>(["stroke", "arrow", "rect", "ellipse", "text"]),
};

function relevant(r: Register, type: ShapeType): boolean {
  const only = RELEVANT[r.key];
  if (!only || only.has(type)) return true;
  return r.overwrote.length > 0 || r.conflictIds.length > 0;
}

/** The register's value as the props it covers, for the shared value formatters. */
function asProps(r: Register): Partial<ShapeProps> {
  if (r.key === "bounds") return r.value as Partial<ShapeProps>;
  return { [r.key]: r.value } as Partial<ShapeProps>;
}

const CAUSE_TAG: Partial<Record<OpCause, string>> = {
  undo: "via undo",
  redo: "via redo",
  adopt: "picked in the explainer",
  "snapshot-restore": "snapshot restore",
};

function RegisterRow({ r, type, getOp, onKnot }: { r: Register; type: ShapeType; getOp: (id: string) => Op | undefined; onKnot: (id: string) => void }) {
  const threadOf = useThreadOf();
  const setter = threadOf(r.setBy.replica);
  const values = asProps(r);
  const swatch = r.key === "fill" || r.key === "stroke" ? String(r.value) : null;
  const holder = getOp(r.setBy.opId);
  const created = holder?.kind === "shape.create";
  const prev = r.overwrote[0];
  const prevOp = prev ? getOp(prev.opId) : undefined;
  const prevWord = prevOp && prevOp.kind === "shape.update" ? valueWord(prevOp.props, r.props) : "value";

  let story: ReactNode;
  if (!prev) {
    story = created ? (
      <>Set when {setter.label} created it. No one has changed it since.</>
    ) : (
      <>No earlier value was replaced.</>
    );
  } else if (prev.observed) {
    story = (
      <>
        {setter.label} had already seen {prev.label}&rsquo;s earlier {prevWord} (L{prev.lamport}), so this was a normal overwrite, not a conflict.
      </>
    );
  } else {
    story = (
      <>
        {setter.label} hadn&rsquo;t seen {prev.label}&rsquo;s {prevWord} (L{prev.lamport}) — they were made at the same time, so a merge rule decided.
      </>
    );
  }

  return (
    <li className="flex flex-col gap-1 border-t border-line py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="w-[98px] shrink-0 text-[12px] font-medium text-ink">{propsTitle(r.props)}</span>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2">
          {swatch && <Swatch color={swatch} />}
          <span className="truncate">{valueDetail(values, r.props, type)}</span>
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 pl-[106px] text-[11.5px] text-muted max-[360px]:pl-0">
        set by <ThreadChip thread={setter} size="xs" />
        <span className="font-mono tabular-nums">L{r.setBy.lamport}</span>
        {CAUSE_TAG[r.setBy.cause] && <span className="rounded bg-panel-2 px-1 text-[10.5px] text-ink-2">{CAUSE_TAG[r.setBy.cause]}</span>}
      </p>
      <p className="pl-[106px] text-[12px] leading-relaxed text-ink-2 max-[360px]:pl-0">
        {story}
        {prev && r.overwrote.length > 1 && <span className="text-muted"> ({plural(r.overwrote.length - 1, "earlier edit")} before that.)</span>}
      </p>
      {r.conflictIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-[106px] max-[360px]:pl-0">
          {r.conflictIds.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => onKnot(id)}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--knot-soft)] px-2 py-[3px] text-[11px] font-medium text-knot hover:underline"
            >
              <KnotIcon size={12} />
              {r.conflictIds.length > 1 ? `Concurrent — see knot ${i + 1}` : "Concurrent — see the knot"}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function Authorship({ text }: { text: NonNullable<ShapeProvenance["text"]> }) {
  const threadOf = useThreadOf();
  const total = text.reduce((n, t) => n + t.chars, 0);
  if (total === 0) return null;
  const sorted = [...text].sort((a, b) => b.chars - a.chars);
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
      <p className="text-[12px] font-medium text-ink">Who wrote the text</p>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-panel-2"
        role="img"
        aria-label={sorted.map((t) => `${threadOf(t.replica).label}: ${plural(t.chars, "character")}`).join(", ")}
      >
        {sorted.map((t) => {
          const th = threadOf(t.replica);
          return (
            <span
              key={t.replica}
              style={{
                width: `${(t.chars / total) * 100}%`,
                background: th.color,
                backgroundImage: th.dash ? "repeating-linear-gradient(90deg, transparent 0 5px, color-mix(in oklab, var(--panel) 45%, transparent) 5px 7px)" : undefined,
              }}
            />
          );
        })}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-2">
        {sorted.map((t) => (
          <span key={t.replica} className="inline-flex items-center gap-1">
            <ThreadChip thread={threadOf(t.replica)} size="xs" />
            {plural(t.chars, "char")}
            <span className="text-muted">({Math.round((t.chars / total) * 100)}%)</span>
          </span>
        ))}
      </p>
    </div>
  );
}

export function ProvenanceCard({ shapeId, onClose }: { shapeId: string; onClose: () => void }) {
  const session = useSession();
  const ui = useUiStore();
  const version = useReplicaView(selectVersion);
  const shape = useShapeSnapshot(shapeId);
  const prov = useMemo(() => {
    void version;
    return session.replica.explainShape(shapeId);
  }, [session, shapeId, version]);
  const getOp = (id: string) => session.replica.getOp(id);
  const conflicts = useReplicaView(selectConflicts);

  const onKnot = (id: string) => {
    const c = conflicts.find((x) => x.id === id);
    if (c) ui.getState().focusConflict({ id: c.id, lineageKey: c.lineageKey });
  };

  const type = shape?.type ?? "rect";
  const noun = shapeNoun(type);
  const registers = prov ? prov.registers.filter((r) => relevant(r, type)) : [];
  const liveKnots = prov ? prov.conflictIds.filter((id) => conflicts.some((c) => c.id === id && c.status === "live" && !c.valuesEqual)).length : 0;

  return (
    <section aria-label={`Why this ${noun} looks like this`} className="sheet stitch relative flex flex-col gap-3 px-4 py-3.5">
      <header className="flex items-start gap-3">
        <ShapeThumb shape={shape} dead={shape ? !shape.alive : true} width={56} height={46} padding={10} className="shrink-0 rounded-[9px] ring-1 ring-line" />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[20px] leading-[1.1] text-ink">Why does this {noun} look like this?</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {(prov?.alive ?? shape?.alive) ? <StatusChip tone="ok">on the board</StatusChip> : <StatusChip tone="muted" hollow>deleted</StatusChip>}
            {liveKnots > 0 && <StatusChip tone="knot">{plural(liveKnots, "live knot")}</StatusChip>}
          </p>
        </div>
        <IconButton icon={X} label="Close provenance" shortcut="Esc" size="sm" onClick={onClose} />
      </header>

      {!prov ? (
        <p className="text-[12.5px] text-ink-2">This shape isn&rsquo;t in this tab&rsquo;s history.</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {registers.map((r) => (
              <RegisterRow key={r.key} r={r} type={type} getOp={getOp} onKnot={onKnot} />
            ))}
          </ul>
          {prov.text && <Authorship text={prov.text} />}
          <p className="text-[11px] leading-relaxed text-muted">
            Each property merges on its own: the edit with the highest stamp wins, and an edit that had seen the old value always carries a
            higher stamp. Only edits made without seeing each other become knots.
          </p>
        </>
      )}
    </section>
  );
}
