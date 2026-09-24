"use client";
/** "You are Tab A": this tab's letter in its thread colour, with its replica id (and fork origin) on hover/focus. */
import clsx from "clsx";
import { GitFork } from "lucide-react";
import { useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { selectForkedFrom, selectLabel, selectReplica } from "../selectors";

export function IdentityPill({ compact = false }: { compact?: boolean }) {
  const label = useSessionState(selectLabel);
  const replica = useSessionState(selectReplica);
  const forkedFrom = useSessionState(selectForkedFrom);
  const color = threadColor(label);

  const tip = (
    <TipBody title={`You are Tab ${label}`}>
      Every browser tab is its own copy of the board — a separate “person” as far as Weave is concerned. Your edits are
      threaded in <span style={{ color }}>this colour</span>, marked {label}.
      <span className="mt-1.5 block font-mono text-[11px] text-muted">replica id {replica}</span>
      {forkedFrom && (
        <span className="mt-1 flex items-start gap-1 text-[11.5px] text-ink-2">
          <GitFork aria-hidden className="mt-px size-3 shrink-0" />
          <span>
            Forked from <span className="font-mono">{forkedFrom}</span>: this tab was a copy of another tab, so it took a new
            identity (same history).
          </span>
        </span>
      )}
    </TipBody>
  );

  return (
    <Tooltip content={tip} align="start" wide>
      <p
        tabIndex={0}
        role="img"
        aria-label={`You are Tab ${label}${forkedFrom ? `, forked from ${forkedFrom}` : ""}`}
        className={clsx(
          "flex shrink-0 items-center gap-2 rounded-full pr-3 @max-[460px]:pr-0.5",
          compact ? "h-8 pl-0.5" : "h-9 pl-1",
        )}
        style={{
          background: `color-mix(in oklab, ${color} 10%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 38%, transparent)`,
        }}
      >
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full bg-panel font-semibold leading-none"
          style={{ color, boxShadow: `inset 0 0 0 2px ${color}`, fontSize: compact ? 16 : 18 }}
        >
          {label}
        </span>
        <span aria-hidden className="whitespace-nowrap text-[13px] leading-none @max-[460px]:hidden">
          <span className={clsx("text-muted", compact ? "hidden" : "@max-[1170px]:hidden")}>You are </span>
          <span className="font-semibold text-ink">Tab {label}</span>
          {forkedFrom && <GitFork aria-hidden className="ml-1 inline size-3 -translate-y-px text-muted" />}
        </span>
      </p>
    </Tooltip>
  );
}
