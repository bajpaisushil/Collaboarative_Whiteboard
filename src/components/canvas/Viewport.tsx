"use client";
/**
 * The only component that subscribes to the full camera: it renders the dot grid and the
 * root world <g> with ONE transform. Its children are created by the parent, so a pan
 * re-renders this component only — never the shape layer.
 */
import { memo, type ReactNode } from "react";
import { useUi } from "@/lib/ui/store";
import { cameraTransform, gridStep } from "./camera";

function ViewportImpl({ gridId, children }: { gridId: string; children: ReactNode }) {
  const cam = useUi((s) => s.camera);
  const step = gridStep(cam.zoom);
  const major = step * 4;
  const dot = 1.05 / cam.zoom;
  const patternTransform = `translate(${-cam.x * cam.zoom} ${-cam.y * cam.zoom}) scale(${cam.zoom})`;
  return (
    <>
      <defs>
        <pattern id={gridId} width={step} height={step} patternUnits="userSpaceOnUse" patternTransform={patternTransform}>
          <circle cx={0} cy={0} r={dot} fill="var(--grid-dot)" />
          <circle cx={step} cy={0} r={dot} fill="var(--grid-dot)" />
          <circle cx={0} cy={step} r={dot} fill="var(--grid-dot)" />
          <circle cx={step} cy={step} r={dot} fill="var(--grid-dot)" />
        </pattern>
        <pattern id={`${gridId}-major`} width={major} height={major} patternUnits="userSpaceOnUse" patternTransform={patternTransform}>
          <circle cx={0} cy={0} r={dot * 1.7} fill="var(--grid-dot)" />
          <circle cx={major} cy={0} r={dot * 1.7} fill="var(--grid-dot)" />
          <circle cx={0} cy={major} r={dot * 1.7} fill="var(--grid-dot)" />
          <circle cx={major} cy={major} r={dot * 1.7} fill="var(--grid-dot)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${gridId})`} />
      <rect width="100%" height="100%" fill={`url(#${gridId}-major)`} opacity={0.9} />
      <g transform={cameraTransform(cam)}>{children}</g>
    </>
  );
}

export const Viewport = memo(ViewportImpl);
