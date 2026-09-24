"use client";
/**
 * A shared 1 Hz wall-clock tick for elapsed-time readouts ("offline for 1m 12s"). One
 * interval serves every subscriber and stops when nobody is listening.
 */
import { useSyncExternalStore } from "react";

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const idle = () => () => {};
const getNow = () => now;
const getServerNow = () => 0;

/** Current wall time, re-rendering every second while `active`. */
export function useNow(active = true): number {
  return useSyncExternalStore(active ? subscribe : idle, getNow, getServerNow);
}
