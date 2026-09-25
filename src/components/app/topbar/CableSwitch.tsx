"use client";
/**
 * The hero control: a network cable you plug in and pull out. Online = the plug (in this
 * tab's thread colour) sits in the socket and the socket's LED is lit; offline = the plug is
 * pulled out, leaving a visible air gap. Attached on the right: the Network lab popover.
 */
import clsx from "clsx";
import { motion, useReducedMotion } from "motion/react";
import { useSession, useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { KeyCombos } from "@/components/ui/Kbd";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { plural } from "../format";
import { selectBridgeLabel, selectConnectedLinkCount } from "../pairing/links";
import { selectLabel, selectLivePeerCount, selectOnline, selectUnsynced } from "../selectors";
import { NetworkPopover } from "./NetworkPopover";

const SHORTCUTS = [["\\"], ["mod", "shift", "O"]] as const;

export function CableControl({ compact = false }: { compact?: boolean }) {
  const online = useSessionState(selectOnline);
  const label = useSessionState(selectLabel);
  const color = threadColor(label);
  return (
    <div
      className={clsx(
        "flex shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-200",
        online ? "border-solid" : "border-dashed",
      )}
      style={
        online
          ? {
              borderColor: "color-mix(in oklab, var(--ok) 45%, var(--line))",
              background: "color-mix(in oklab, var(--ok) 8%, var(--panel))",
            }
          : {
              borderColor: `color-mix(in oklab, ${color} 70%, var(--line))`,
              background: `color-mix(in oklab, ${color} 7%, var(--panel-2))`,
            }
      }
    >
      <CableSwitch compact={compact} />
      <span aria-hidden className="h-5 w-px bg-line" />
      <NetworkPopover />
    </div>
  );
}

function CableSwitch({ compact }: { compact: boolean }) {
  const session = useSession();
  const online = useSessionState(selectOnline);
  const label = useSessionState(selectLabel);
  const unsynced = useSessionState(selectUnsynced);
  const peers = useSessionState(selectLivePeerCount);
  const links = useSessionState(selectConnectedLinkCount);
  const bridge = useSessionState(selectBridgeLabel);
  const color = threadColor(label);

  const sub = online
    ? peers > 0
      ? `linked · ${plural(peers, "tab")}`
      : "waiting for tabs"
    : unsynced > 0
      ? `+${plural(unsynced, "edit")} unsynced`
      : "diverging";

  const tip = (
    <TipBody
      title={online ? "Online — unplug this tab" : "Offline — plug this tab back in"}
      shortcut={
        <>
          <KeyCombos combos={SHORTCUTS} />
        </>
      }
    >
      {links > 0 || bridge ? (
        <>
          Tabs on this computer talk inside your browser; the other computer is reached over WebRTC
          {links > 0 ? "" : ` (through Tab ${bridge})`}. This switch cuts this tab off from both — edits keep working and merge
          when you reconnect.
        </>
      ) : (
        "Tabs talk directly inside your browser. This switch cuts that link — edits keep working and merge when you reconnect."
      )}
    </TipBody>
  );

  return (
    <Tooltip content={tip} align="start" wide>
      <button
        type="button"
        role="switch"
        aria-checked={online}
        aria-label="Online"
        aria-keyshortcuts="\ Control+Shift+O Meta+Shift+O"
        onClick={() => session.setOnline(!online)}
        className={clsx(
          "group/cable flex items-center gap-2 rounded-l-full py-1 pr-2.5 text-left @max-[440px]:pr-1.5",
          compact ? "h-8 pl-1" : "h-9 pl-1.5 @max-[440px]:pl-1",
        )}
      >
        <CableGraphic online={online} color={color} compact={compact} />
        {/* Hidden outright when both lines are (no empty gap next to the plug). */}
        <span className="flex flex-col leading-none @max-[400px]:hidden">
          <span className="text-[13px] font-semibold text-ink @max-[400px]:hidden">{online ? "Online" : "Offline"}</span>
          {!compact && (
            <span className="mt-[3px] whitespace-nowrap font-mono text-[10px] tabular-nums text-muted @max-[1000px]:hidden">{sub}</span>
          )}
        </span>
      </button>
    </Tooltip>
  );
}

/** Plug + socket. The plug group slides; the socket (drawn last) hides inserted prongs. */
function CableGraphic({ online, color, compact }: { online: boolean; color: string; compact: boolean }) {
  const reduce = useReducedMotion();
  const w = compact ? 48 : 56;
  return (
    <svg width={w} height={26} viewBox="0 0 60 28" fill="none" aria-hidden className="shrink-0 overflow-hidden rounded-full @max-[440px]:w-[46px]">
      <motion.g
        initial={false}
        animate={{ x: online ? 4 : -8 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 26 }}
      >
        {/* cable */}
        <path d="M-14 14H22" stroke={color} strokeWidth={3} strokeLinecap="round" />
        {/* plug body with grip lines */}
        <rect x={20} y={7} width={15} height={14} rx={3.5} fill={color} />
        <path d="M25 11v6M28.5 11v6" stroke="var(--panel)" strokeOpacity={0.55} strokeWidth={1.3} strokeLinecap="round" />
        {/* prongs */}
        <rect x={35} y={9.6} width={8} height={2.6} rx={1} fill="var(--ink-2)" />
        <rect x={35} y={15.8} width={8} height={2.6} rx={1} fill="var(--ink-2)" />
      </motion.g>
      {/* air gap sparks when unplugged */}
      <motion.path
        d="M37.6 8.5l1.6 2.2M37.6 19.5l1.6-2.2"
        stroke="var(--muted)"
        strokeWidth={1.3}
        strokeLinecap="round"
        initial={false}
        animate={{ opacity: online ? 0 : 1 }}
        transition={{ duration: reduce ? 0 : 0.2, delay: online || reduce ? 0 : 0.12 }}
      />
      {/* socket */}
      <rect
        x={41}
        y={4}
        width={17}
        height={20}
        rx={5}
        fill="var(--panel)"
        stroke={online ? "color-mix(in oklab, var(--ok) 70%, var(--line-2))" : "var(--line-2)"}
        strokeWidth={1.5}
      />
      <rect x={43.5} y={9.6} width={3} height={2.6} rx={0.8} fill="var(--line-2)" />
      <rect x={43.5} y={15.8} width={3} height={2.6} rx={0.8} fill="var(--line-2)" />
      <circle
        cx={52.5}
        cy={14}
        r={2.3}
        fill={online ? "var(--ok)" : "transparent"}
        stroke={online ? "var(--ok)" : "var(--muted)"}
        strokeWidth={1.2}
      />
    </svg>
  );
}
