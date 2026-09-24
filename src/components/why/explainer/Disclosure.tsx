"use client";
/**
 * Progressive-disclosure section: a question as the trigger, its short answer as a preview
 * on the right, and the full story inside. Button + region with aria-expanded/controls.
 */
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, type ReactNode } from "react";

export function Disclosure({
  index,
  title,
  preview,
  open,
  onToggle,
  children,
  compact,
}: {
  /** "01"… a quiet ordinal so the sections read as a sequence. */
  index?: string;
  title: ReactNode;
  /** One-line answer shown while collapsed (and dimmed while open). */
  preview?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  const buttonId = useId();
  const panelId = useId();
  return (
    <section className="border-t border-line first:border-t-0">
      <h3 className="m-0">
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={clsx("group/d flex w-full items-center gap-3 text-left transition-colors", compact ? "py-2.5" : "py-3.5")}
        >
          {index && <span className="w-5 shrink-0 font-mono text-[10.5px] tabular-nums text-muted">{index}</span>}
          <span
            className={clsx(
              "min-w-0 flex-1 font-medium text-ink decoration-line-2 underline-offset-4 group-hover/d:underline",
              compact ? "text-[13px]" : "text-[14px]",
            )}
          >
            {title}
          </span>
          {preview && (
            <span className={clsx("max-w-[46%] shrink-0 truncate text-right text-[11.5px] transition-opacity", open ? "opacity-0" : "text-ink-2")}>
              {preview}
            </span>
          )}
          <ChevronDown
            aria-hidden
            className={clsx("size-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
          />
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className={clsx(compact ? "pb-4" : "pb-6", index && !compact && "pl-8")}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
