/**
 * Geometry of the space-time diagram: lanes top→bottom (one per replica), columns left→right
 * (canonical order, uneventful stretches folded), then the live "reed" and waiting ops.
 */
import { COL, PAD_L, type ColumnLayout } from "./model";

export const ST_TOP = 18;
export const ST_BOTTOM = 10;
const HEAD_GAP = 26;

export interface StGeometry {
  layout: ColumnLayout;
  laneH: number;
  /** Radius of an op dot. */
  r: number;
  height: number;
  width: number;
  headX: number;
  laneY: (l: number) => number;
  pendingX: (j: number) => number;
  /** x just after op i (where a time-travel cursor "as of op i" sits). */
  xAfter: (i: number) => number;
}

export function stGeometry(layout: ColumnLayout, laneCount: number, available: number, pendingCount: number): StGeometry {
  const lanes = Math.max(1, laneCount);
  const laneH = Math.max(18, Math.min(48, (available - ST_TOP - ST_BOTTOM) / lanes));
  const natural = ST_TOP + laneH * lanes + ST_BOTTOM;
  // Few lanes: centre them vertically instead of leaving a gap at the bottom.
  const top = ST_TOP + Math.max(0, available - natural) / 2;
  const height = Math.max(natural, available);
  const headX = layout.end + HEAD_GAP;
  const pendingX0 = headX + 30;
  const width = pendingX0 + pendingCount * COL + (pendingCount ? 70 : 24);
  const r = laneH >= 24 ? 4.4 : 3.5;
  const { opX, bundleOf, bundles } = layout;
  return {
    layout,
    laneH,
    r,
    height,
    width,
    headX,
    laneY: (l) => top + laneH * (l + 0.5),
    pendingX: (j) => pendingX0 + j * COL + COL / 2,
    xAfter: (i) => {
      if (i < 0) return PAD_L - 4;
      const b = bundleOf[i];
      if (b >= 0) {
        const bundle = bundles[b];
        return bundle.x + ((i - bundle.from + 1) / (bundle.to - bundle.from + 1)) * bundle.w;
      }
      return opX[i] + COL / 2;
    },
  };
}
