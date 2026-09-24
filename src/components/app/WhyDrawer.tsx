"use client";
/** The right-hand Why sheet: slides in from the right while `ui.panelOpen`. */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useUi } from "@/lib/ui/store";
import { WhyPanel } from "@/components/why/WhyPanel";
import { RegionBoundary } from "./RegionBoundary";

export function WhyDrawer() {
  const open = useUi((s) => s.panelOpen);
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="why"
          aria-label="Why panel"
          initial={reduce ? { opacity: 0 } : { x: "108%", opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: "108%", opacity: 0.4 }}
          transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
          className="sheet absolute bottom-[10px] right-[10px] top-[var(--chrome-top)] z-20 flex w-[min(420px,calc(100%-20px))] flex-col overflow-hidden"
        >
          <RegionBoundary name="Why panel">
            <div className="flex min-h-0 flex-1 flex-col">
              <WhyPanel />
            </div>
          </RegionBoundary>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
