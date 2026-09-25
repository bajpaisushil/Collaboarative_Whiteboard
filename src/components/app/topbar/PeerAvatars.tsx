"use client";
/**
 * Other tabs in the room: letter in thread colour + status dot (shape-coded). Hover/focus
 * explains the link and how far behind they are; click previews the board as they last saw it.
 * A tab on another computer (paired over WebRTC) carries a small laptop mark and reads
 * "on another computer · WebRTC" — also the other computer's other tabs, which we hear through
 * the paired tab ("through Tab A").
 */
import clsx from "clsx";
import { CircleCheck, Laptop, TriangleAlert, Users } from "lucide-react";
import { useMemo } from "react";
import type { PeerInfo, PeerStatus } from "@/lib/session/types";
import { useSessionState } from "@/lib/session/react";
import { useUiStore } from "@/lib/ui/store";
import { STATUS_WORD, ThreadBadge } from "@/components/ui/ThreadBadge";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { selectRemoteReplicasKey } from "../pairing/links";
import { selectNamedPeers } from "../selectors";

const MAX_SHOWN = 5;

const STATUS_RANK: Record<PeerStatus, number> = { online: 0, idle: 1, unreachable: 2, left: 3 };

const STATUS_NOTE: Record<PeerStatus, string | null> = {
  online: null,
  idle: "It’s a background tab — browsers throttle those, so it answers slowly.",
  unreachable: "Silent for a while: offline, or closed without saying goodbye.",
  left: "This tab was closed. Its edits stay in the history.",
};

/** Where a peer is: this computer (BroadcastChannel) or another one (WebRTC link, live or lost). */
export type PeerPlace = "local" | "remote" | "remote-lost";

export function peerPlace(peer: Pick<PeerInfo, "transport" | "replica"> & { remote?: boolean }, remoteReplicas: ReadonlySet<string>): PeerPlace {
  if (peer.transport === "webrtc") return "remote";
  return peer.remote || remoteReplicas.has(peer.replica) ? "remote-lost" : "local";
}

export const PLACE_TEXT: Record<PeerPlace, string> = {
  local: "on this computer · BroadcastChannel",
  remote: "on another computer · WebRTC",
  "remote-lost": "on another computer · link lost",
};

const PLACE_SPOKEN: Record<PeerPlace, string> = {
  local: "",
  remote: ", on another computer over WebRTC",
  "remote-lost": ", on another computer, link lost",
};

/** Replicas reached over a WebRTC link (now or earlier), as a Set. */
export function useRemoteReplicas(): ReadonlySet<string> {
  const key = useSessionState(selectRemoteReplicasKey);
  return useMemo(() => new Set(key ? key.split(",") : []), [key]);
}

function byStatusThenLabel(a: PeerInfo, b: PeerInfo): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label);
}

export function PeerAvatars({ compact = false }: { compact?: boolean }) {
  const peers = useSessionState(selectNamedPeers);
  const sorted = useMemo(() => [...peers].sort(byStatusThenLabel), [peers]);
  const shown = sorted.slice(0, MAX_SHOWN);
  const extra = sorted.length - shown.length;
  const remote = useRemoteReplicas();

  if (sorted.length === 0) {
    return (
      <Tooltip
        content={
          <TipBody title="No other tabs yet">
            Open another tab in this room (or try split view) to see edits sync and merge — or connect another computer.
          </TipBody>
        }
      >
        <span
          tabIndex={0}
          role="img"
          aria-label="No other tabs in this room"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line-2 px-2.5 text-[12px] text-muted @max-[440px]:px-2"
        >
          <Users aria-hidden className="size-3.5" />
          <span className={compact ? "sr-only" : "@max-[1000px]:hidden"}>Just you</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <ul aria-label="Other tabs" className="flex shrink-0 items-center -space-x-1.5">
      {shown.map((p) => (
        <li key={p.replica}>
          <PeerAvatar peer={p} place={peerPlace(p, remote)} via={p.relay ? (peers.find((q) => q.replica === p.relay)?.label ?? null) : null} />
        </li>
      ))}
      {extra > 0 && (
        <li>
          <span className="relative grid size-7 place-items-center rounded-full bg-panel-2 font-mono text-[11px] text-ink-2 ring-2 ring-panel">
            +{extra}
          </span>
        </li>
      )}
    </ul>
  );
}

function PeerAvatar({ peer, place, via }: { peer: PeerInfo; place: PeerPlace; via: string | null }) {
  const store = useUiStore();
  const L = peer.label;
  const gone = peer.status === "left";
  const canPreview = !gone && Object.keys(peer.vc).length > 0;

  const n = peer.unseenByPeer;
  const seen = n === 0 ? `${L} has seen all your edits` : `${L} hasn’t seen ${n} of your ${n === 1 ? "edit" : "edits"}`;

  const tip = (
    <TipBody title={`Tab ${L} · ${STATUS_WORD[peer.status]}`}>
      <span className="block">
        <span className={clsx("font-medium", place === "local" ? "text-ink-2" : "text-ink")}>
          {PLACE_TEXT[place]}
          {via && place === "remote" && ` · through Tab ${via}`}
        </span>
        {peer.transportError && <span className="block text-knot">{peer.transportError}</span>}
      </span>
      {!gone && (
        <>
          <span className="mt-1 block">{seen}</span>
          {peer.diverged ? (
            <span className="mt-1 flex items-start gap-1 font-medium text-knot">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              Same edits, different board — this should never happen.
            </span>
          ) : peer.converged ? (
            <span className="mt-1 flex items-center gap-1 text-ok">
              <CircleCheck aria-hidden className="size-3.5" />
              Identical board (same fingerprint)
            </span>
          ) : (
            <span className="mt-1 block text-muted">Not identical yet — catching up.</span>
          )}
        </>
      )}
      {STATUS_NOTE[peer.status] && <span className="mt-1 block text-muted">{STATUS_NOTE[peer.status]}</span>}
      {canPreview && <span className="mt-1.5 block text-[11px] text-muted">Click to see the board as {L} last saw it.</span>}
    </TipBody>
  );

  return (
    <Tooltip content={tip} wide>
      <button
        type="button"
        aria-disabled={!canPreview || undefined}
        aria-label={[`Tab ${L}, ${STATUS_WORD[peer.status]}${PLACE_SPOKEN[place]}.`, gone ? "" : `${seen}.`, peer.converged ? "Identical board." : ""]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (canPreview) store.getState().set({ scrub: { cut: peer.vc, label: `As Tab ${L} last saw it` } });
        }}
        className={clsx(
          "relative block rounded-full ring-2 ring-panel transition-transform duration-150 hover:z-10 motion-reduce:transition-none",
          canPreview ? "hover:-translate-y-0.5" : "cursor-default",
          peer.diverged && "ring-knot",
        )}
      >
        <ThreadBadge label={L} size="md" status={peer.status} dimmed={gone} />
        {place !== "local" && (
          <span aria-hidden className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-panel text-ink-2 ring-1 ring-line-2">
            <Laptop className="size-2.5" strokeWidth={2.25} />
          </span>
        )}
      </button>
    </Tooltip>
  );
}
