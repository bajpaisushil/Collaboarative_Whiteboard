"use client";
import clsx from "clsx";
import type { ReactNode } from "react";
import { keyLabel, useIsMac } from "./keys";

/** One physical key cap. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-b-2 border-line-2 bg-panel-2 px-1 font-mono text-[10.5px] font-medium leading-none text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A key combination rendered as caps, e.g. `keys={["mod", "shift", "o"]}` → ⌘ ⇧ O. */
export function KeyCombo({ keys, className }: { keys: readonly string[]; className?: string }) {
  const isMac = useIsMac();
  return (
    <span className={clsx("inline-flex items-center gap-0.5 align-middle", className)}>
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{keyLabel(k, isMac)}</Kbd>
      ))}
    </span>
  );
}

/** Alternative combos separated by a muted "or". */
export function KeyCombos({ combos, className }: { combos: readonly (readonly string[])[]; className?: string }) {
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-1", className)}>
      {combos.map((c, i) => (
        <span key={c.join("+")} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[10.5px] text-muted">or</span>}
          <KeyCombo keys={c} />
        </span>
      ))}
    </span>
  );
}
