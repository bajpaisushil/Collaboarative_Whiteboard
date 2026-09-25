"use client";
/**
 * Every WebRTC link this tab has: who is on the other end (their letter in their thread
 * colour), the link's live state, why it failed, and what you can do — cancel an invite,
 * disconnect, or re-pair / remove a dead link.
 */
import clsx from "clsx";
import { Laptop, RotateCw, Unplug, X } from "lucide-react";
import { useCallback, useId } from "react";
import type { RtcLinkInfo, SessionState } from "@/lib/session/types";
import { useSessionState } from "@/lib/session/react";
import { ThreadBadge, type ThreadStatus } from "@/components/ui/ThreadBadge";
import { isDeadLink, LINK_STATE_WORD, remoteLabelIn, remoteName, selectRtcLinks, type LinkState } from "./links";
import { SMALL_BTN } from "./parts";
import { useRequiredPairingStore } from "./PairingProvider";

/** Presence-dot shape per state (shape, not just colour). */
const DOT: Partial<Record<LinkState, ThreadStatus>> = {
  connected: "online",
  disconnected: "idle",
  failed: "unreachable",
  closed: "left",
};

const STATE_TONE: Record<LinkState, string> = {
  gathering: "text-muted",
  "waiting-answer": "text-muted",
  connecting: "text-ink-2",
  connected: "text-ok",
  disconnected: "text-warn",
  failed: "text-knot",
  closed: "text-muted",
};

export function LinkList() {
  const links = useSessionState(selectRtcLinks);
  const headingId = useId();
  if (links.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
        Links to other computers
      </h3>
      <ul className="divide-y divide-dashed divide-line rounded-[12px] border border-line bg-panel">
        {links.map((l) => (
          <LinkRow key={l.pid} link={l} />
        ))}
      </ul>
    </section>
  );
}

function LinkRow({ link }: { link: RtcLinkInfo }) {
  const store = useRequiredPairingStore();
  const { remoteReplica, remoteLabel: frozen } = link;
  const select = useCallback(
    (s: SessionState) => remoteLabelIn(s, { remoteReplica, remoteLabel: frozen }),
    [remoteReplica, frozen],
  );
  const label = useSessionState(select);
  const dead = isDeadLink(link);
  const pending = link.state === "gathering" || link.state === "waiting-answer";
  const name = label ? remoteName(label) : pending ? "Your invite" : "The other computer";
  const how = link.role === "inviter" ? "Invited from this tab" : "You joined their invite";
  const api = () => store.getState();

  return (
    <li className="flex items-start gap-3 px-3 py-2.5" data-link-state={link.state}>
      {label ? (
        <ThreadBadge label={label} size="md" status={DOT[link.state]} dimmed={dead} className="mt-px" />
      ) : (
        <span aria-hidden className="mt-px grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-line-2 text-muted">
          <Laptop className="size-3.5" strokeWidth={1.9} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-tight">
          <span className="font-semibold text-ink">{name}</span>
          <span aria-hidden className="text-muted"> · </span>
          <span className={clsx("font-medium", STATE_TONE[link.state])}>{LINK_STATE_WORD[link.state]}</span>
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
          {how} · <span className="font-mono text-[10.5px]">WebRTC</span>
        </p>
        {link.error && <p className="mt-1 text-[11.5px] leading-snug text-knot">{link.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {dead ? (
          <>
            <button type="button" className={SMALL_BTN} onClick={() => api().repair(link.pid)} aria-label={`Re-pair with ${name}`}>
              <RotateCw aria-hidden className="size-3" />
              Re-pair
            </button>
            <button
              type="button"
              onClick={() => api().dismiss(link.pid)}
              aria-label={`Remove this link to ${name} from the list`}
              title="Remove from the list"
              className="grid size-7 place-items-center rounded-[8px] text-muted hover:bg-panel-2 hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className={SMALL_BTN}
            onClick={() => api().disconnect(link.pid)}
            aria-label={link.state === "connected" || link.state === "disconnected" ? `Disconnect ${name}` : `Cancel the link with ${name}`}
          >
            <Unplug aria-hidden className="size-3" />
            {link.state === "connected" || link.state === "disconnected" ? "Disconnect" : "Cancel"}
          </button>
        )}
      </div>
    </li>
  );
}
