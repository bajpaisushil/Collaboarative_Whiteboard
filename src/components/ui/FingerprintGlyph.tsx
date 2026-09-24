"use client";
/**
 * Generative 3×3 woven glyph for a state hash: same glyph ⇔ same state. Lets anyone compare
 * two tabs (or two merge orders) at a glance without reading hex.
 */
import { memo } from "react";

function bits(hash: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hash.length && out.length < 36; i++) {
    const n = parseInt(hash[i], 16);
    if (Number.isNaN(n)) continue;
    out.push(n & 3, (n >> 2) & 3);
  }
  while (out.length < 36) out.push(0);
  return out;
}

const HUES = ["var(--thread-a)", "var(--thread-b)", "var(--thread-c)", "var(--thread-d)"];

function GlyphImpl({ hash, size = 22, title }: { hash: string; size?: number; title?: string }) {
  const b = bits(hash || "0");
  const cell = 10;
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" role="img" aria-label={title ?? `State fingerprint ${hash.slice(0, 8)}`}>
      <title>{title ?? `State fingerprint ${hash.slice(0, 8)}`}</title>
      <rect width="30" height="30" rx="6" fill="var(--panel-2)" />
      {Array.from({ length: 9 }, (_, i) => {
        const x = (i % 3) * cell;
        const y = Math.floor(i / 3) * cell;
        const kind = b[i * 4];
        const color = HUES[b[i * 4 + 1]];
        const over = b[i * 4 + 2] & 1;
        return (
          <g key={i}>
            {kind !== 0 && (
              <rect x={x + 1.5} y={y + (over ? 3.5 : 1.5)} width={7} height={over ? 3 : 7} rx={1.5} fill={color} opacity={0.9} />
            )}
            {kind === 3 && <rect x={x + 3.5} y={y + 1.5} width={3} height={7} rx={1.5} fill={HUES[(b[i * 4 + 1] + 1) % 4]} />}
          </g>
        );
      })}
    </svg>
  );
}

export const FingerprintGlyph = memo(GlyphImpl);
