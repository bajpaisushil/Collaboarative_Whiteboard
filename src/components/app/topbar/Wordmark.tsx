"use client";
import clsx from "clsx";
import { ThreadMark } from "@/components/ui/ThreadMark";

/** Small "Weave" wordmark: the woven thread mark + serif italic name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={clsx("flex shrink-0 select-none items-center gap-1.5 pl-1 pr-1.5", className)}>
      <ThreadMark size={24} />
      <span aria-hidden className="font-serif text-[23px] italic leading-none tracking-[-0.015em] text-ink @max-[1380px]:hidden">
        Weave
      </span>
      <span className="sr-only">Weave</span>
    </div>
  );
}
