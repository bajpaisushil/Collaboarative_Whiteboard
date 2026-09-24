"use client";
import clsx from "clsx";
import { useId, type ReactNode } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  /** Small trailing badge next to the label (e.g. "experimental"). */
  badge?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Labelled on/off switch (role="switch"). The whole row is clickable. */
export function Switch({ checked, onChange, label, description, badge, disabled, className }: SwitchProps) {
  const labelId = useId();
  const descId = useId();
  return (
    <div className={clsx("flex items-start gap-3", disabled && "opacity-50", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span id={labelId} className="text-[12.5px] font-medium text-ink">
            {label}
          </span>
          {badge}
        </div>
        {description && (
          <p id={descId} className="mt-0.5 text-[11.5px] leading-snug text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-150",
          checked ? "border-transparent bg-ink" : "border-line-2 bg-panel-2",
        )}
      >
        <span
          aria-hidden
          className={clsx(
            "absolute top-1/2 size-3 -translate-y-1/2 rounded-full shadow-sm transition-[left,background-color] duration-150 motion-reduce:transition-none",
            checked ? "left-[16px] bg-paper" : "left-[2px] bg-muted",
          )}
        />
      </button>
    </div>
  );
}
