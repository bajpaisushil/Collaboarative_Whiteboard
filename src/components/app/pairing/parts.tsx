"use client";
/**
 * Building blocks of the pairing dialog: code boxes with copy buttons, busy lines, errors,
 * steps. `data-step-focus` marks the control that should take focus when a step changes
 * (see useStepFocus in PairingDialog).
 */
import clsx from "clsx";
import { Check, CircleAlert, Copy, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useIsMac } from "@/components/ui/keys";

export const PRIMARY_BTN =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-ink px-3 text-[12.5px] font-semibold text-paper transition-[background-color,transform] duration-100 hover:bg-ink-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-40";
export const SECONDARY_BTN =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-line-2 px-2.5 text-[12.5px] font-medium text-ink transition-[background-color,transform] duration-100 hover:bg-panel-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-40";
export const SMALL_BTN =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-[8px] border border-line-2 px-2 text-[12px] font-medium text-ink transition-[background-color,transform] duration-100 hover:bg-panel-2 active:translate-y-px";
export const QUIET_BTN =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-ink-2 underline decoration-line-2 underline-offset-2 hover:bg-panel-2 hover:text-ink";

export const FIELD =
  "block w-full resize-none rounded-[10px] border border-line-2 bg-panel px-3 py-2 font-mono text-[11.5px] leading-[1.45] text-ink [overflow-wrap:anywhere] placeholder:font-sans placeholder:text-[12.5px] placeholder:text-muted focus-visible:border-transparent";

/**
 * Copy text. The async clipboard needs a secure context (https or localhost) — a LAN demo on
 * http://192.168.… has none — so fall back to a temporary selection + execCommand.
 */
export async function writeClipboard(text: string, host: HTMLElement | null): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // denied or unavailable: try the legacy path
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.tabIndex = -1;
  Object.assign(ta.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", opacity: "0" });
  (host ?? document.body).appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus({ preventScroll: true });
  return ok;
}

export interface CopyAction {
  id: string;
  label: string;
  /** What was copied, for the confirmation ("Invite link"). */
  what: string;
  text: string;
  primary?: boolean;
  /** Take focus when this step appears. */
  stepFocus?: boolean;
}

/** Read-only code/link box with copy buttons; a click selects everything for a manual copy. */
export function CodeBox({ value, label, actions, rows = 3 }: { value: string; label: string; actions: CopyAction[]; rows?: number }) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<{ id: string; ok: boolean; what: string } | null>(null);
  const isMac = useIsMac();

  useEffect(() => {
    if (!status?.ok) return;
    const t = setTimeout(() => setStatus(null), 2200);
    return () => clearTimeout(t);
  }, [status]);

  const copy = async (a: CopyAction) => {
    const ok = await writeClipboard(a.text, wrapRef.current);
    if (!ok) {
      // Leave exactly that text selected so ⌘C / Ctrl+C copies it.
      const el = fieldRef.current;
      if (el) {
        el.focus();
        const at = value.indexOf(a.text);
        if (at >= 0) el.setSelectionRange(at, at + a.text.length);
        else el.select();
      }
    }
    setStatus({ id: a.id, ok, what: a.what });
  };

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={fieldRef}
        readOnly
        value={value}
        rows={rows}
        spellCheck={false}
        data-pairing-code=""
        onClick={(e) => {
          const t = e.currentTarget;
          if (t.selectionStart === t.selectionEnd) t.select();
        }}
        className={clsx(FIELD, "scrollbar-thin bg-panel-2 text-ink-2")}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {actions.map((a) => {
          const done = status?.id === a.id && status.ok;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => void copy(a)}
              data-step-focus={a.stepFocus ? "" : undefined}
              className={a.primary ? PRIMARY_BTN : SECONDARY_BTN}
            >
              {done ? <Check aria-hidden className="size-3.5" strokeWidth={2.25} /> : <Copy aria-hidden className="size-3.5" />}
              {done ? "Copied" : a.label}
            </button>
          );
        })}
        <span role="status" className="text-[11.5px] text-muted">
          {status ? (status.ok ? `${status.what} copied.` : `Selected — press ${isMac ? "⌘C" : "Ctrl+C"} to copy.`) : ""}
        </span>
      </div>
    </div>
  );
}

/** A spinner line. Not a live region itself: the dialog's announcer speaks state changes. */
export function Busy({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-ink-2">
      <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-muted motion-reduce:animate-none" />
      <span>{children}</span>
    </p>
  );
}

export function InlineError({ children, icon: Icon = CircleAlert }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-[12px] leading-snug text-knot">
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

export type StepState = "todo" | "active" | "done";

/**
 * One numbered step on a vertical thread. The node is dashed while pending, stitched in this
 * tab's thread colour while active, and a check when done — never colour alone.
 */
export function Step({
  n,
  title,
  state,
  color,
  last = false,
  children,
}: {
  n: number;
  title: ReactNode;
  state: StepState;
  color: string;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="relative flex gap-3.5" aria-current={state === "active" ? "step" : undefined}>
      {!last && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[13px] top-8 w-0 border-l-[1.5px]"
          style={{ borderColor: state === "done" ? "var(--ok)" : "var(--line-2)", borderStyle: state === "done" ? "solid" : "dashed" }}
        />
      )}
      <span
        aria-hidden
        className={clsx(
          "relative z-[1] mt-0.5 grid size-[27px] shrink-0 place-items-center rounded-full text-[12px] font-semibold",
          state === "todo" && "border-[1.5px] border-dashed border-line-2 bg-panel text-muted",
          state === "done" && "bg-ok text-paper",
        )}
        style={state === "active" ? { color, background: `color-mix(in oklab, ${color} 12%, var(--panel))`, boxShadow: `inset 0 0 0 2px ${color}` } : undefined}
      >
        {state === "done" ? <Check className="size-3.5" strokeWidth={2.75} /> : n}
      </span>
      <div className={clsx("min-w-0 flex-1", last ? "pb-1" : "pb-5")}>
        <h3 className={clsx("pt-1 text-[13px] font-semibold leading-tight", state === "todo" ? "text-muted" : "text-ink")}>
          <span className="sr-only">
            Step {n}
            {state === "done" ? " (done)" : ""}:{" "}
          </span>
          {title}
        </h3>
        {children && state !== "todo" && <div className="mt-2 space-y-2.5">{children}</div>}
      </div>
    </li>
  );
}
