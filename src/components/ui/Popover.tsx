"use client";
/**
 * Anchored popover: click-outside and Escape close it, focus moves into the panel on open
 * and back to the trigger on Escape. Positioned absolutely under (or over) its trigger, so
 * it stays inside its pane in /split.
 *
 * Escape is handled with a *native* listener on the wrapper: pane hotkeys are native
 * listeners on the pane root, which run before React's delegated handlers, so a React
 * onKeyDown here would be too late to stop them.
 */
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode, type Ref } from "react";

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>;
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup": "dialog";
  onClick: () => void;
}

export interface PopoverProps {
  /** Render the trigger button; spread the given props onto it. */
  trigger: (props: PopoverTriggerProps, open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Accessible name of the popover panel. */
  label: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
  panelClassName?: string;
}

const ALIGN = { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" } as const;

export function Popover({
  trigger,
  children,
  label,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side = "bottom",
  align = "start",
  className,
  panelClassName,
}: PopoverProps) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = openProp ?? innerOpen;
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const reduce = useReducedMotion();

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  const close = () => setOpen(false);

  const closeFromOutside = useEffectEvent((target: EventTarget | null) => {
    if (wrapRef.current && target instanceof Node && wrapRef.current.contains(target)) return;
    setOpen(false);
  });
  const closeFromEscape = useEffectEvent(() => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => closeFromOutside(e.target);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeFromEscape();
    };
    const wrap = wrapRef.current;
    document.addEventListener("pointerdown", onPointer, true);
    wrap?.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      wrap?.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  const triggerProps: PopoverTriggerProps = {
    ref: triggerRef,
    "aria-expanded": open,
    "aria-controls": panelId,
    "aria-haspopup": "dialog",
    onClick: () => setOpen(!open),
  };

  return (
    <div
      ref={wrapRef}
      className={clsx("relative inline-flex", className)}
      onBlur={(e) => {
        // Keyboard users tabbing out of the popover close it.
        if (!open) return;
        const next = e.relatedTarget;
        if (next instanceof Node && wrapRef.current?.contains(next)) return;
        if (next === null) return; // focus went to the page itself (e.g. a click on blank canvas handles it)
        setOpen(false);
      }}
    >
      {trigger(triggerProps, open)}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: side === "bottom" ? -6 : 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.98 }}
            transition={{ duration: reduce ? 0.1 : 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className={clsx(
              "sheet absolute z-50 outline-none",
              side === "bottom" ? "top-[calc(100%+10px)] origin-top" : "bottom-[calc(100%+10px)] origin-bottom",
              ALIGN[align],
              panelClassName,
            )}
          >
            {typeof children === "function" ? children(close) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
