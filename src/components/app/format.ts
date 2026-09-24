/** Small, pure formatting helpers for chrome copy. */

/** "8s", "1m 12s", "2h 3m", "a moment". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return "a moment";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Signed clock offset: "+1m 30s", "−45s", "none". */
export function formatSkew(ms: number): string {
  if (Math.abs(ms) < 500) return "none";
  const sign = ms > 0 ? "+" : "−";
  return `${sign}${formatDuration(Math.abs(ms))}`;
}

/** "1 edit", "3 edits". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "B", "B and C", "B, C and D". */
export function listLabels(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
