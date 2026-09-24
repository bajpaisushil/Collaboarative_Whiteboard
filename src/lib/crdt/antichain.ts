/**
 * Antichains of causal refs (sets of mutually concurrent ops = the maximal elements).
 * Insert is an idempotent, monotone join: a dominated or duplicate element is a no-op;
 * elements the new one dominates are removed. Arrays are kept sorted by opId (canonical).
 */
import type { CausalRef } from "./types";
import { refHappenedBefore } from "./vector-clock";

export function antichainInsert(chain: readonly CausalRef[], ref: CausalRef): CausalRef[] {
  for (const e of chain) {
    if (e.opId === ref.opId || refHappenedBefore(ref, e)) return chain as CausalRef[];
  }
  const out = chain.filter((e) => !refHappenedBefore(e, ref));
  out.push(ref);
  out.sort((a, b) => (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0));
  return out;
}

export function antichainUnion(a: readonly CausalRef[], b: readonly CausalRef[]): CausalRef[] {
  let out = a as CausalRef[];
  for (const r of b) out = antichainInsert(out, r);
  return out;
}

/**
 * Observed-remove visibility: some "show" (keep-alive) element was not observed by any
 * "hide" (remove) element. Used for shapes (writers vs deletes) and RGA chars (shows vs hides).
 */
export function orVisible(shows: readonly CausalRef[], hides: readonly CausalRef[]): boolean {
  if (hides.length === 0) return shows.length > 0;
  return shows.some((s) => !hides.some((h) => refHappenedBefore(s, h)));
}

/** Delete-wins counterfactual: no removes, or some show causally after every remove. */
export function dwVisible(shows: readonly CausalRef[], hides: readonly CausalRef[]): boolean {
  if (hides.length === 0) return shows.length > 0;
  return shows.some((s) => hides.every((h) => refHappenedBefore(h, s)));
}
