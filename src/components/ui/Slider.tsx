"use client";
import clsx from "clsx";
import { useId, type CSSProperties, type ReactNode } from "react";

export interface SliderProps {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Value readout, e.g. `(v) => `${v} ms``. Also used for aria-valuetext. */
  format?: (value: number) => string;
  /** Fill the track from this value instead of from `min` (e.g. 0 for a ± slider). */
  origin?: number;
  hint?: ReactNode;
  /** Track fill colour (CSS colour). Defaults to ink. */
  accent?: string;
  disabled?: boolean;
  className?: string;
}

const THUMB =
  "[&::-webkit-slider-thumb]:size-[15px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--slider-accent)] [&::-webkit-slider-thumb]:bg-panel [&::-webkit-slider-thumb]:shadow-[0_1px_2px_#0003] [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110 " +
  "[&::-moz-range-thumb]:size-[11px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--slider-accent)] [&::-moz-range-thumb]:bg-panel " +
  "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent";

/** Labelled range input with a value readout and a filled track. */
export function Slider({ label, value, min, max, step = 1, onChange, format, origin, hint, accent = "var(--ink)", disabled, className }: SliderProps) {
  const id = useId();
  const hintId = useId();
  const span = max - min || 1;
  const pct = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / span) * 100;
  const from = pct(origin ?? min);
  const to = pct(value);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const readout = format ? format(value) : String(value);
  const style = {
    "--slider-accent": accent,
    background: `linear-gradient(to right, var(--line) 0 ${lo}%, ${accent} ${lo}% ${hi}%, var(--line) ${hi}% 100%)`,
  } as CSSProperties;
  return (
    <div className={clsx("flex flex-col gap-1.5", disabled && "opacity-50", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[12.5px] font-medium text-ink">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-[11.5px] tabular-nums text-ink-2">
          {readout}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={readout}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className={clsx("h-1.5 w-full cursor-pointer appearance-none rounded-full outline-offset-4", THUMB)}
        style={style}
      />
      {hint && (
        <p id={hintId} className="text-[11px] leading-snug text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
