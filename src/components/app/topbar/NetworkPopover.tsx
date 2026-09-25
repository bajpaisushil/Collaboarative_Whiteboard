"use client";
/**
 * Network lab: make the link between tabs slow, lossy, duplicated or clock-skewed, and watch
 * traffic counters and per-peer link transports.
 */
import clsx from "clsx";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { DEFAULT_CONDITIONS, type NetworkConditions } from "@/lib/sync/protocol";
import { useSession, useSessionState } from "@/lib/session/react";
import { Popover } from "@/components/ui/Popover";
import { Slider } from "@/components/ui/Slider";
import { STATUS_WORD, ThreadBadge } from "@/components/ui/ThreadBadge";
import { formatSkew } from "../format";
import { peerPlace, useRemoteReplicas } from "./PeerAvatars";
import { isChaotic, selectChaotic, selectNetwork, selectNamedPeers, selectTraffic } from "../selectors";

export function NetworkPopover() {
  const chaotic = useSessionState(selectChaotic);
  return (
    <Popover
      label="Network lab"
      align="start"
      panelClassName="w-[340px] max-w-[calc(100vw-40px)]"
      trigger={(props, open) => (
        <button
          {...props}
          type="button"
          aria-label={chaotic ? "Network lab (network chaos is on)" : "Network lab"}
          title="Network lab — latency, drops, duplicates, clock drift"
          className={clsx(
            "relative grid h-8 w-7 place-items-center rounded-r-full pr-0.5 text-ink-2 hover:text-ink @max-[440px]:w-6",
            open && "text-ink",
          )}
        >
          <ChevronDown aria-hidden className={clsx("size-4 transition-transform duration-150", open && "rotate-180")} strokeWidth={2} />
          {chaotic && <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-warn ring-2 ring-panel" />}
        </button>
      )}
    >
      <NetworkLab />
    </Popover>
  );
}

function NetworkLab() {
  const session = useSession();
  const network = useSessionState(selectNetwork);
  const set = (patch: Partial<NetworkConditions>) => session.setConditions(patch);
  const reset = () =>
    session.setConditions({
      latencyMs: DEFAULT_CONDITIONS.latencyMs,
      jitterMs: DEFAULT_CONDITIONS.jitterMs,
      dropRate: DEFAULT_CONDITIONS.dropRate,
      duplicateRate: DEFAULT_CONDITIONS.duplicateRate,
      clockSkewMs: DEFAULT_CONDITIONS.clockSkewMs,
    });

  return (
    <div className="scrollbar-thin max-h-[min(640px,calc(100dvh-96px))] overflow-y-auto">
      <header className="px-4 pb-3 pt-3.5">
        <p className="text-[13.5px] font-semibold text-ink">Network lab</p>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-2">
          Make the link between tabs slow, lossy or chaotic. Sync repairs it anyway — every tab still ends up identical.
        </p>
      </header>

      <div className="space-y-4 border-t border-dashed border-line px-4 py-3.5">
        <Slider
          label="Latency"
          value={network.latencyMs}
          min={0}
          max={2000}
          step={10}
          onChange={(v) => set({ latencyMs: v })}
          format={(v) => `${v} ms`}
          hint="Delay before each message arrives."
        />
        <Slider
          label="Jitter"
          value={network.jitterMs}
          min={0}
          max={1000}
          step={10}
          onChange={(v) => set({ jitterMs: v })}
          format={(v) => (v === 0 ? "0 ms" : `+0–${v} ms`)}
          hint="Random extra delay, so messages arrive out of order. Edits wait until what they depend on arrives."
        />
        <Slider
          label="Drop rate"
          value={Math.round(network.dropRate * 100)}
          min={0}
          max={50}
          onChange={(v) => set({ dropRate: v / 100 })}
          format={(v) => `${v}%`}
          accent="var(--knot)"
          hint="Messages silently lost. Tabs compare clocks every heartbeat and re-send what’s missing."
        />
        <Slider
          label="Duplicates"
          value={Math.round(network.duplicateRate * 100)}
          min={0}
          max={50}
          onChange={(v) => set({ duplicateRate: v / 100 })}
          format={(v) => `${v}%`}
          accent="var(--warn)"
          hint="Messages delivered twice. Every edit has a unique id, so repeats are ignored."
        />
        <Slider
          label="Clock drift"
          value={network.clockSkewMs}
          min={-300_000}
          max={300_000}
          step={5_000}
          origin={0}
          onChange={(v) => set({ clockSkewMs: v })}
          format={formatSkew}
          accent="var(--thread-d)"
          hint="Shifts this tab’s wall clock. Weave never orders edits by wall time — the explainer shows what wall clocks would have got wrong."
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={!isChaotic(network)}
            className="flex items-center gap-1.5 rounded-[9px] border border-line-2 px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2 disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Calm the network
          </button>
          <button
            type="button"
            onClick={() => session.syncNow()}
            title="Send a heartbeat now and fetch anything missing"
            className="flex items-center gap-1.5 rounded-[9px] border border-line-2 px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            Sync now
          </button>
        </div>
      </div>

      <Traffic />
      <Links />
    </div>
  );
}

function Traffic() {
  const traffic = useSessionState(selectTraffic);
  const cells = [
    { k: "Sent", v: traffic.sent, c: "text-ink" },
    { k: "Received", v: traffic.received, c: "text-ink" },
    { k: "Dropped", v: traffic.dropped, c: traffic.dropped > 0 ? "text-knot" : "text-ink" },
  ];
  return (
    <div className="border-t border-dashed border-line px-4 py-3">
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Messages</p>
      <dl className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.k} className="rounded-[9px] bg-panel-2 px-2.5 py-1.5">
            <dt className="text-[10.5px] text-muted">{c.k}</dt>
            <dd className={clsx("font-mono text-[14px] font-medium tabular-nums", c.c)}>{c.v.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Links() {
  const peers = useSessionState(selectNamedPeers);
  const shown = peers.filter((p) => p.status !== "left");
  const remote = useRemoteReplicas();
  return (
    <div className="border-t border-dashed border-line px-4 pb-3.5 pt-3">
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Links</p>
      {shown.length === 0 ? (
        <p className="text-[12px] text-muted">No other tabs in this room yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((p) => {
            const place = peerPlace(p, remote);
            return (
              <li key={p.replica} className="flex items-center gap-2 text-[12px]">
                <ThreadBadge label={p.label} size="xs" status={p.status} />
                <span className="font-medium text-ink">Tab {p.label}</span>
                <span className="text-muted">
                  {STATUS_WORD[p.status]}
                  {place !== "local" && " · on another computer"}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  {p.transportError && (
                    <span className="max-w-[120px] truncate text-[11px] text-knot" title={p.transportError}>
                      {p.transportError}
                    </span>
                  )}
                  <span
                    className={clsx(
                      "rounded-full px-1.5 py-px font-mono text-[10px]",
                      p.transport === "webrtc" ? "bg-[color-mix(in_oklab,var(--thread-d)_16%,transparent)] text-ink" : "bg-panel-2 text-ink-2",
                    )}
                  >
                    {p.transport === "webrtc" ? "WebRTC" : place === "remote-lost" ? "link lost" : "BroadcastChannel"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
