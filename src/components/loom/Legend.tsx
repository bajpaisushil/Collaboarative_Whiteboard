"use client";
/** "How to read the loom" — a small key to the diagram's visual language. */
import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { Popover } from "@/components/ui/Popover";
import { FlagGlyph, HatchPattern, KnotGlyph, OpGlyph } from "./glyphs";

const INK = "var(--thread-b)";

function Row({ glyph, children }: { glyph: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <svg aria-hidden width={34} height={20} viewBox="0 0 34 20" className="mt-px shrink-0 overflow-visible">
        {glyph}
      </svg>
      <span className="text-[12px] leading-snug text-ink-2">{children}</span>
    </li>
  );
}

export function LoomLegend() {
  const uid = useId().replace(/:/g, "");
  return (
    <Popover
      label="How to read the loom"
      side="top"
      align="end"
      panelClassName="w-[330px] p-4"
      trigger={(props, open) => (
        <button
          {...props}
          type="button"
          aria-label="How to read the loom"
          title="How to read the loom"
          className={`inline-flex size-7 items-center justify-center rounded-[8px] text-ink-2 hover:bg-panel-2 hover:text-ink ${open ? "bg-panel-2 text-ink" : ""}`}
        >
          <CircleHelp aria-hidden className="size-[15px]" strokeWidth={1.75} />
        </button>
      )}
    >
      <p className="font-serif text-[19px] leading-tight text-ink">Reading the loom</p>
      <p className="mt-1 text-[12px] text-muted">Each tab is a thread. Left to right is the order every tab agrees on.</p>
      <svg aria-hidden width={0} height={0} className="absolute">
        <defs>
          <HatchPattern id={`${uid}-h`} color={INK} />
        </defs>
      </svg>
      <ul className="mt-3 flex flex-col gap-2.5">
        <Row
          glyph={
            <>
              <line x1={2} x2={32} y1={10} y2={10} stroke={INK} strokeOpacity={0.5} strokeWidth={1.5} />
              <OpGlyph kind="shape.update" x={17} y={10} r={4.4} color={INK} stable />
            </>
          }
        >
          <b className="font-semibold text-ink">An edit</b> on its tab’s thread. Solid means every tab has seen it.
        </Row>
        <Row glyph={<OpGlyph kind="shape.update" x={17} y={10} r={4.4} color={INK} stable={false} />}>
          <b className="font-semibold text-ink">Haloed</b> — not every tab has seen it yet.
        </Row>
        <Row glyph={<OpGlyph kind="shape.update" x={17} y={10} r={4.4} color={INK} stable hatch={`url(#${uid}-h)`} />}>
          <b className="font-semibold text-ink">Hatched</b> — made while that tab was offline.
        </Row>
        <Row
          glyph={
            <>
              <OpGlyph kind="shape.create" x={5} y={10} r={3.4} color={INK} stable />
              <OpGlyph kind="shape.delete" x={17} y={10} r={3.4} color={INK} stable />
              <OpGlyph kind="text.insert" x={29} y={10} r={3.4} color={INK} stable />
            </>
          }
        >
          Bigger dot = created a shape, square = deleted one, pill = typed text.
        </Row>
        <Row
          glyph={
            <>
              <circle cx={4} cy={16} r={3.5} fill="var(--thread-a)" />
              <path d="M4 16C16 16 18 4 30 4" fill="none" stroke="var(--thread-a)" strokeOpacity={0.6} strokeWidth={1.3} />
              <circle cx={30} cy={4} r={3.5} fill={INK} />
            </>
          }
        >
          <b className="font-semibold text-ink">A crossing thread</b> — the later edit had already seen the earlier one.
        </Row>
        <Row glyph={<KnotGlyph x={17} y={10} s={5} variant="live" />}>
          <b className="font-semibold text-ink">A knot</b> — two tabs changed the same thing without seeing each other. Click it to see why it resolved the way it did.
        </Row>
        <Row glyph={<FlagGlyph x={13} y={18} h={16} color={INK} />}>
          <b className="font-semibold text-ink">A snapshot</b> — click to preview the board as its author saw it.
        </Row>
        <Row
          glyph={
            <>
              <rect x={1} y={2} width={32} height={16} rx={4} fill="var(--panel)" fillOpacity={0.6} />
              <line x1={10} x2={10} y1={0} y2={20} stroke="var(--focus)" strokeWidth={1.5} />
            </>
          }
        >
          <b className="font-semibold text-ink">Time travel</b> — click any edit (or drag the ribbon) to view the board as of that moment. Esc returns to live.
        </Row>
      </ul>
    </Popover>
  );
}
