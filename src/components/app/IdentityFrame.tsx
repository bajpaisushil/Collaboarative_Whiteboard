"use client";
/**
 * The pane's identity frame: a 3px inset line in this tab's thread colour. Offline, it
 * becomes an animated hatched band in the same colour — "this copy is diverging".
 */
import clsx from "clsx";
import { useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { selectLabel, selectOnline } from "./selectors";

const BAND = 7;

export function IdentityFrame() {
  const label = useSessionState(selectLabel);
  const online = useSessionState(selectOnline);
  const color = threadColor(label);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[60]">
      <div
        className={clsx("absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none", online ? "opacity-100" : "opacity-0")}
        style={{ boxShadow: `inset 0 0 0 3px ${color}` }}
      />
      <div className={clsx("absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none", online ? "opacity-0" : "opacity-100")}>
        {!online && (
          <>
            <div className="hatch hatch-animate absolute inset-x-0 top-0" style={{ color, height: BAND }} />
            <div className="hatch hatch-animate absolute inset-x-0 bottom-0" style={{ color, height: BAND }} />
            <div className="hatch hatch-animate absolute left-0" style={{ color, width: BAND, top: BAND, bottom: BAND }} />
            <div className="hatch hatch-animate absolute right-0" style={{ color, width: BAND, top: BAND, bottom: BAND }} />
            <div className="absolute" style={{ inset: BAND, boxShadow: `inset 0 0 0 1px ${color}` }} />
          </>
        )}
      </div>
    </div>
  );
}
