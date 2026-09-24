"use client";
/**
 * The floating tool dock: a paper sheet with the nine tools and a style chip that opens the
 * style sheet (ink, fill, line width). Vertical on the left of the board; bottom-centre and
 * horizontal in compact panes (/split) and on narrow screens, where it portals into the
 * canvas's dock slot so it can centre over the board.
 *
 * Keyboard: one tab stop (roving focus, arrow keys move between items); the tool letters work
 * from anywhere in the pane. Buttons don't steal focus on click, so Space-to-pan and the text
 * editor keep working after picking a tool or a colour.
 */
import clsx from "clsx";
import {
  Circle,
  Eraser,
  Hand,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Square,
  StickyNote,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { colorName } from "@/lib/crdt/describe";
import { usePane } from "@/lib/ui/pane";
import { useUi, useUiStore, type Tool } from "@/lib/ui/store";
import { useDockSlot } from "./dockSlot";
import { hasFill, paint } from "./shapeUtils";
import { keepFocus, StylePanel } from "./StylePanel";
import { TOOLS, type ToolMeta } from "./tools";
import { useSelfThread } from "./useThreads";

export type DockOrientation = "vertical" | "horizontal";

const ICONS: Record<Tool, LucideIcon> = {
  select: MousePointer2,
  hand: Hand,
  pen: Pencil,
  rect: Square,
  ellipse: Circle,
  arrow: MoveUpRight,
  sticky: StickyNote,
  text: Type,
  eraser: Eraser,
};

/** Phones and very short windows: dock goes horizontal along the bottom of the board. */
const NARROW_QUERY = "(max-width: 639px), (max-height: 539px)";
const STYLE_OPEN_KEY = "weave:style-sheet";

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function ToolDock() {
  const { compact } = usePane();
  const narrow = useMediaQuery(NARROW_QUERY);
  const slot = useDockSlot();
  const horizontal = compact || narrow;
  if (!horizontal) return <Dock orientation="vertical" />;
  // Wait for the canvas to expose its slot (same commit; one extra render at most).
  return slot ? createPortal(<Dock orientation="horizontal" />, slot) : null;
}

function initialStyleOpen(orientation: DockOrientation): boolean {
  try {
    const saved = window.localStorage.getItem(STYLE_OPEN_KEY);
    if (saved === "open") return true;
    if (saved === "closed") return false;
  } catch {
    /* storage blocked: fall through to the default */
  }
  // Start tidy: the colour chip opens the palette, and the choice is remembered.
  void orientation;
  return false;
}

function Dock({ orientation }: { orientation: DockOrientation }) {
  const vertical = orientation === "vertical";
  const ui = useUiStore();
  const tool = useUi((s) => s.tool);
  const readOnly = useUi((s) => s.scrub !== null);
  const self = useSelfThread();
  const [styleOpen, setStyleOpen] = useState(() => initialStyleOpen(orientation));
  const toolbarRef = useRef<HTMLDivElement>(null);
  const styleButtonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const toggleStyle = (open: boolean) => {
    setStyleOpen(open);
    try {
      window.localStorage.setItem(STYLE_OPEN_KEY, open ? "open" : "closed");
    } catch {
      /* preference just won't persist */
    }
  };

  const closeStyle = useCallback(() => {
    setStyleOpen(false);
    try {
      window.localStorage.setItem(STYLE_OPEN_KEY, "closed");
    } catch {
      /* preference just won't persist */
    }
    styleButtonRef.current?.focus({ preventScroll: true });
  }, []);

  // Roving focus between dock items. Native listener so it runs before the pane-root
  // shortcuts (which would otherwise read the arrows as "nudge the selection").
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const items = [...el.querySelectorAll<HTMLButtonElement>("[data-dock-item]")];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") j = (i + 1) % items.length;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") j = (i - 1 + items.length) % items.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = items.length - 1;
      if (j < 0) return;
      e.preventDefault();
      e.stopPropagation();
      items[j].focus();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  const pick = (meta: ToolMeta) => {
    if (readOnly && !meta.readOnlyOk) return;
    ui.getState().setTool(meta.tool);
  };

  return (
    <div className={clsx("relative", !vertical && "max-w-full")}>
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation={orientation}
        data-own-keys=""
        className={clsx(
          "sheet stitch pointer-events-auto flex select-none gap-0.5",
          vertical ? "flex-col items-center p-1.5" : "max-w-full flex-row items-center overflow-x-auto p-1 [scrollbar-width:none]",
        )}
      >
        {TOOLS.map((meta, i) => (
          <Fragment key={meta.tool}>
            {i === 2 && <Divider vertical={vertical} />}
            <ToolButton
              meta={meta}
              active={tool === meta.tool}
              disabled={readOnly && !meta.readOnlyOk}
              vertical={vertical}
              threadColor={self.color}
              onPick={pick}
            />
          </Fragment>
        ))}
        <Divider vertical={vertical} />
        <StyleChip ref={styleButtonRef} open={styleOpen} panelId={panelId} vertical={vertical} onToggle={() => toggleStyle(!styleOpen)} />
      </div>
      <AnimatePresence>
        {styleOpen && <StylePanel key="style" id={panelId} orientation={orientation} onClose={closeStyle} />}
      </AnimatePresence>
    </div>
  );
}

function Divider({ vertical }: { vertical: boolean }) {
  return <span aria-hidden className={clsx("shrink-0 bg-line", vertical ? "my-1 h-px w-6" : "mx-1 h-6 w-px")} />;
}

function ToolButton({
  meta,
  active,
  disabled,
  vertical,
  threadColor,
  onPick,
}: {
  meta: ToolMeta;
  active: boolean;
  disabled: boolean;
  vertical: boolean;
  threadColor: string;
  onPick: (meta: ToolMeta) => void;
}) {
  const Icon = ICONS[meta.tool];
  const title = disabled ? `${meta.label} (${meta.key}) — unavailable while viewing history` : `${meta.label} (${meta.key}) — ${meta.hint}`;
  return (
    <button
      type="button"
      data-dock-item=""
      tabIndex={active ? 0 : -1}
      aria-label={meta.label}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={meta.key}
      title={title}
      onMouseDown={keepFocus}
      onClick={() => onPick(meta)}
      className={clsx(
        "group relative grid shrink-0 place-items-center rounded-[10px] transition-[background-color,color,transform] duration-100",
        vertical ? "size-[38px] [@media(max-height:760px)]:size-[33px]" : "size-[34px]",
        active ? "bg-panel-2 text-ink shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
        disabled ? "cursor-not-allowed opacity-35" : "active:translate-y-px",
      )}
    >
      <Icon aria-hidden className="size-[18px]" strokeWidth={active ? 2 : 1.75} />
      {/* The active tool carries the local thread: a short woven bar on the dock's inner edge. */}
      {active && (
        <span
          aria-hidden
          className={clsx("absolute rounded-full", vertical ? "bottom-2 left-[3px] top-2 w-[3px]" : "bottom-[3px] left-2 right-2 h-[3px]")}
          style={{ background: threadColor }}
        />
      )}
      <span
        aria-hidden
        className={clsx(
          "pointer-events-none absolute font-mono text-[8.5px] font-medium leading-none",
          vertical ? "bottom-[3px] right-[4px]" : "right-[3px] top-[3px]",
          active ? "text-ink-2" : "text-muted opacity-80 group-hover:opacity-100",
        )}
      >
        {meta.key}
      </span>
    </button>
  );
}

function StyleChip({
  ref,
  open,
  panelId,
  vertical,
  onToggle,
}: {
  ref: Ref<HTMLButtonElement>;
  open: boolean;
  panelId: string;
  vertical: boolean;
  onToggle: () => void;
}) {
  const style = useUi((s) => s.style);
  const filled = hasFill(style.fill);
  const ring = Math.min(4.5, 1.2 + style.strokeWidth * 0.45);
  const label = `Style: ${colorName(style.stroke)} ink, ${filled ? colorName(style.fill) : "no"} fill, ${style.strokeWidth}px line`;
  return (
    <button
      ref={ref}
      type="button"
      data-dock-item=""
      tabIndex={-1}
      aria-label={label}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      title={`${open ? "Hide" : "Show"} colours & line width`}
      onMouseDown={keepFocus}
      onClick={onToggle}
      className={clsx(
        "relative grid shrink-0 place-items-center rounded-[10px] transition-[background-color,transform] duration-100 active:translate-y-px",
        vertical ? "size-[38px] [@media(max-height:760px)]:size-[33px]" : "size-[34px]",
        open ? "bg-panel-2 shadow-[inset_0_0_0_1px_var(--line-2)]" : "hover:bg-panel-2",
      )}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-[24px] overflow-visible">
        {filled ? (
          <circle cx={12} cy={12} r={8.5} fill={paint(style.fill)} />
        ) : (
          <>
            <circle cx={12} cy={12} r={8.5} fill="var(--panel)" />
            <path d="M 6.5 17.5 L 17.5 6.5" stroke="var(--muted)" strokeWidth={1.2} strokeLinecap="round" />
          </>
        )}
        <circle cx={12} cy={12} r={8.5} fill="none" stroke={paint(style.stroke)} strokeWidth={ring} />
      </svg>
    </button>
  );
}
