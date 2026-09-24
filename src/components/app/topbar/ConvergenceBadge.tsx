"use client";
/**
 * Convergence badge: this board's fingerprint glyph plus a verdict — "In sync with B" when a
 * peer has the same edits and the same resulting state, "Syncing…" while catching up, and a
 * loud DIVERGED alarm if a peer has the same edits but a different state (must never happen).
 */
import clsx from "clsx";
import { CircleCheck, LoaderCircle, TriangleAlert, Unplug, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { PeerInfo } from "@/lib/session/types";
import { useReplicaView, useSession, useSessionState } from "@/lib/session/react";
import { FingerprintGlyph } from "@/components/ui/FingerprintGlyph";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { listLabels } from "../format";
import { isLivePeer, selectOnline, selectNamedPeers, selectStateHash } from "../selectors";

type Verdict =
  | { kind: "diverged"; labels: string[] }
  | { kind: "offline" }
  | { kind: "alone" }
  | { kind: "synced"; labels: string[]; pending: string[] }
  | { kind: "syncing"; labels: string[] };

function verdictOf(peers: readonly PeerInfo[], online: boolean): Verdict {
  const diverged = peers.filter((p) => p.diverged && p.status !== "left").map((p) => p.label);
  if (diverged.length > 0) return { kind: "diverged", labels: diverged };
  if (!online) return { kind: "offline" };
  const live = peers.filter(isLivePeer);
  if (live.length === 0) return { kind: "alone" };
  const synced = live.filter((p) => p.converged).map((p) => p.label);
  const pending = live.filter((p) => !p.converged).map((p) => p.label);
  if (synced.length > 0) return { kind: "synced", labels: synced, pending };
  return { kind: "syncing", labels: pending };
}

export function ConvergenceBadge() {
  const session = useSession();
  const hash = useReplicaView(selectStateHash);
  const peers = useSessionState(selectNamedPeers);
  const online = useSessionState(selectOnline);
  const v = verdictOf(peers, online);

  let icon: ReactNode;
  let text: string;
  let tone: string;
  switch (v.kind) {
    case "diverged":
      icon = <TriangleAlert aria-hidden className="size-3.5" strokeWidth={2.2} />;
      text = "DIVERGED";
      tone = "bg-knot text-paper font-bold tracking-wider motion-safe:animate-pulse";
      break;
    case "offline":
      icon = <Unplug aria-hidden className="size-3.5" />;
      text = "Not syncing";
      tone = "text-muted";
      break;
    case "alone":
      icon = <Users aria-hidden className="size-3.5" />;
      text = "Only tab";
      tone = "text-muted";
      break;
    case "synced":
      icon = <CircleCheck aria-hidden className="size-3.5 text-ok" strokeWidth={2.2} />;
      text = `In sync with ${listLabels(v.labels)}`;
      tone = "text-ink";
      break;
    case "syncing":
      icon = <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />;
      text = "Syncing…";
      tone = "text-ink-2";
      break;
  }

  const tip = (
    <TipBody title="State fingerprint">
      This pattern is drawn from a hash of the whole board. Same pattern in two tabs ⇔ identical boards.
      <span className="mt-1 block font-mono text-[11px] text-muted">hash {hash.slice(0, 12) || "—"}</span>
      {v.kind === "synced" && (
        <span className="mt-1 block text-ok">
          {listLabels(v.labels)} {v.labels.length === 1 ? "has" : "have"} exactly your edits and exactly your board.
          {v.pending.length > 0 && <span className="block text-ink-2">Still catching up: {listLabels(v.pending)}.</span>}
        </span>
      )}
      {v.kind === "syncing" && <span className="mt-1 block">Exchanging missing edits with {listLabels(v.labels)}…</span>}
      {v.kind === "diverged" && (
        <span className="mt-1 block font-medium text-knot">
          {listLabels(v.labels)} saw the same edits but ended with a different board. That’s a merge bug — please report it.
        </span>
      )}
      {v.kind === "offline" && <span className="mt-1 block">You’re offline, so nobody can compare with you right now.</span>}
      {v.kind === "alone" && <span className="mt-1 block">No other tab to compare with yet.</span>}
      <span className="mt-1.5 block text-[11px] text-muted">Click to sync now.</span>
    </TipBody>
  );

  return (
    <Tooltip content={tip} wide>
      <button
        type="button"
        onClick={() => session.syncNow()}
        aria-label={`${text}. State fingerprint ${hash.slice(0, 8)}. Click to sync now.`}
        className={clsx(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] font-medium hover:bg-panel-2",
          v.kind === "diverged" && "hover:bg-knot",
          tone,
        )}
      >
        <FingerprintGlyph hash={hash} size={24} title={`State fingerprint ${hash.slice(0, 8)}`} />
        {icon}
        <span className="whitespace-nowrap @max-[1170px]:sr-only">{text}</span>
      </button>
    </Tooltip>
  );
}
