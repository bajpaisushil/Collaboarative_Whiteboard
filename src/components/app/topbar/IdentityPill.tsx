"use client";
/** "You are Tab A": this tab's letter in its thread colour, with its replica id on hover. */
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
      threaded in <span style={{ color }}>this colour</span>.
      <span className="mt-1.5 block font-mono text-[11px] text-muted">replica id {replica}</span>
      {forkedFrom && (
        <span className="mt-1 flex items-start gap-1 text-[11.5px] text-ink-2">
          <GitFork aria-hidden className="mt-px size-3 shrink-0" />
          <span>
            Forked from <span className="font-mono">{forkedFrom}</span>: this tab was a duplicate, so it took a new identity.
          </span>
        </span>
      )}
    </TipBody>
  );

  return (
    <Tooltip content={tip} align="start" wide>
      <p
        className={clsx("flex shrink-0 items-center gap-2 rounded-full pr-3", compact ? "h-8 pl-0.5" : "h-9 pl-1")}
        style={{
          background: `color-mix(in oklab, ${color} 10%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 38%, transparent)`,
        }}
      >
        <span
          aria-hidden
          className={clsx(
            "grid place-items-center rounded-full bg-panel font-semibold leading-none",
            compact ? "size-7 text-[16px]" : "size-7 text-[18px]",
          )}
          style={{ color, boxShadow: `inset 0 0 0 2px ${color}` }}
        >
          {label}
        </span>
        <span className="whitespace-nowrap text-[13px] leading-none">
          <span className={clsx("text-muted", compact ? "hidden" : "@max-4xl:hidden")}>You are </span>
          <span className="font-semibold text-ink">Tab {label}</span>
          {forkedFrom && <GitFork aria-label="forked" className="ml-1 inline size-3 -translate-y-px text-muted" />}
        </span>
      </p>
    </Tooltip>
  );
}
