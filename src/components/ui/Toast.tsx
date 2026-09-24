"use client";
/**
 * Per-pane toast stack. `ToastProvider` owns the queue, `ToastViewport` renders it (an
 * always-present polite live region, so new toasts are announced), `useToast()` pushes.
 * Toasts pause their auto-dismiss timer while hovered or focused.
 */
import clsx from "clsx";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { KnotIcon } from "./KnotIcon";

export type ToastTone = "neutral" | "ok" | "warn" | "error" | "knot";

export interface ToastOptions {
  /** Pushing with an existing id replaces that toast (and restarts its timer). */
  id?: string;
  title: ReactNode;
  detail?: ReactNode;
  tone?: ToastTone;
  icon?: LucideIcon;
  /** Default 5000 ms; 0 = sticky until dismissed. */
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: string;
  /** Bumped on replace so the timer restarts. */
  rev: number;
}

export interface ToastApi {
  push: (toast: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_VISIBLE = 4;

const ToastApiContext = createContext<ToastApi | null>(null);
const ToastItemsContext = createContext<readonly ToastItem[]>([]);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const api = useMemo<ToastApi>(
    () => ({
      push: (t) => {
        const id = t.id ?? `toast-${++seq}`;
        setItems((prev) => {
          const existing = prev.find((x) => x.id === id);
          if (existing) return prev.map((x) => (x.id === id ? { ...t, id, rev: existing.rev + 1 } : x));
          return [...prev, { ...t, id, rev: 0 }].slice(-MAX_VISIBLE * 2);
        });
        return id;
      },
      dismiss: (id) => setItems((prev) => prev.filter((x) => x.id !== id)),
      clear: () => setItems([]),
    }),
    [],
  );
  return (
    <ToastApiContext.Provider value={api}>
      <ToastItemsContext.Provider value={items}>{children}</ToastItemsContext.Provider>
    </ToastApiContext.Provider>
  );
}

const NOOP_API: ToastApi = {
  push: () => "",
  dismiss: () => {},
  clear: () => {},
};

/** Push toasts into the nearest pane's stack (no-op outside a ToastProvider). */
export function useToast(): ToastApi {
  return useContext(ToastApiContext) ?? NOOP_API;
}

const TONE_ICON: Record<ToastTone, LucideIcon | null> = {
  neutral: Info,
  ok: CircleCheck,
  warn: TriangleAlert,
  error: CircleAlert,
  knot: null,
};

const TONE_COLOR: Record<ToastTone, string> = {
  neutral: "var(--muted)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  error: "var(--knot)",
  knot: "var(--knot)",
};

export function ToastViewport({ className }: { className?: string }) {
  const items = useContext(ToastItemsContext);
  const api = useToast();
  const visible = items.slice(-MAX_VISIBLE);
  return (
    <section aria-label="Notifications" className={clsx("pointer-events-none flex flex-col items-center", className)}>
      <ol aria-live="polite" aria-relevant="additions text" className="flex w-full flex-col items-center gap-2">
        <AnimatePresence initial={false}>
          {visible.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => api.dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const tone = toast.tone ?? "neutral";
  const duration = toast.durationMs ?? 5000;
  const Icon = toast.icon ?? TONE_ICON[tone];
  const color = TONE_COLOR[tone];

  useEffect(() => {
    if (paused || duration <= 0) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
    // `rev` restarts the timer when the toast is replaced in place.
  }, [paused, duration, onDismiss, toast.rev]);

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto relative flex w-[min(440px,100%)] items-start gap-2.5 overflow-hidden rounded-[12px] border border-line bg-panel py-2.5 pl-3.5 pr-2 shadow-sheet"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <span aria-hidden className="mt-px shrink-0" style={{ color }}>
        {Icon ? <Icon className="size-4" strokeWidth={2} /> : <KnotIcon size={16} />}
      </span>
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
        <p className="font-medium text-ink">{toast.title}</p>
        {toast.detail && <div className="mt-0.5 text-ink-2">{toast.detail}</div>}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="shrink-0 rounded-[8px] px-2 py-1 text-[12px] font-semibold text-ink underline decoration-line-2 underline-offset-2 hover:bg-panel-2"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        title="Dismiss"
        className="grid size-6 shrink-0 place-items-center rounded-[7px] text-muted hover:bg-panel-2 hover:text-ink"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </motion.li>
  );
}
