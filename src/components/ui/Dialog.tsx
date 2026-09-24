"use client";
/**
 * Modal sheet scoped to its pane (absolute, not fixed — /split has two panes). Focus is
 * moved into the dialog, trapped while open, and restored on close. Escape closes it via a
 * native listener so pane hotkeys never see that keypress.
 */
import clsx from "clsx";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const reduce = useReducedMotion();
  const requestClose = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKey);
    return () => {
      panel.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog"
          className="absolute inset-0 z-[55] grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.08 : 0.16 }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-[color-mix(in_oklab,var(--ink)_22%,transparent)] backdrop-blur-[2px]"
            onPointerDown={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: reduce ? 0.08 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className={clsx(
              "sheet stitch relative flex max-h-full w-[min(720px,100%)] flex-col overflow-hidden outline-none",
              className,
            )}
          >
            <div className="flex items-start gap-3 border-b border-line px-6 pb-4 pt-5">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[16px] font-semibold tracking-tight text-ink">
                  {title}
                </h2>
                {description && (
                  <p id={descId} className="mt-1 text-[12.5px] text-ink-2">
                    {description}
                  </p>
                )}
              </div>
              <IconButton icon={X} label="Close" shortcut="Esc" onClick={onClose} />
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
