"use client";
/**
 * "Connect another computer": opens the pairing dialog. A badge counts computers connected
 * right now. Without WebRTC it stays focusable (aria-disabled) so its tooltip can explain why.
 * Full panes only — compact /split panes have no pairing store, so nothing renders there.
 */
import clsx from "clsx";
import { Laptop } from "lucide-react";
import { useStore, type StoreApi } from "zustand";
import { useSessionState } from "@/lib/session/react";
import { TipBody, Tooltip } from "@/components/ui/Tooltip";
import { PAIRING_TITLE, selectBridgeLabel, selectConnectedLinkCount, selectRtcAvailable } from "../pairing/links";
import { usePairingStore } from "../pairing/PairingProvider";
import type { PairingStore } from "../pairing/store";

export function ConnectButton() {
  const store = usePairingStore();
  return store ? <ConnectButtonInner store={store} /> : null;
}

const selectOpen = (s: PairingStore) => s.open;

function ConnectButtonInner({ store }: { store: StoreApi<PairingStore> }) {
  const open = useStore(store, selectOpen);
  const available = useSessionState(selectRtcAvailable);
  const connected = useSessionState(selectConnectedLinkCount);
  const bridge = useSessionState(selectBridgeLabel);
  const status =
    connected === 0
      ? bridge
        ? `Linked to another computer through Tab ${bridge}`
        : ""
      : connected === 1
        ? "1 computer connected"
        : `${connected} computers connected`;

  return (
    <Tooltip
      align="end"
      wide
      content={
        available ? (
          <TipBody title={PAIRING_TITLE}>
            Link this tab with a browser on another computer by copy-pasting an invite — no account, no server in between.
            {status && <span className="mt-1 block font-medium text-ok">{status}.</span>}
          </TipBody>
        ) : (
          <TipBody title="Can’t connect other computers here">
            This browser doesn’t support direct connections (WebRTC is missing or turned off), so this board only syncs with
            tabs on this computer.
          </TipBody>
        )
      }
    >
      <button
        type="button"
        aria-label={[PAIRING_TITLE, status].filter(Boolean).join(" — ")}
        aria-haspopup="dialog"
        aria-expanded={available ? open : undefined}
        aria-disabled={!available || undefined}
        data-connect-button=""
        onClick={() => {
          if (available) store.getState().openDialog();
        }}
        className={clsx(
          "relative flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-line-2 px-[7px] text-[12.5px] font-medium text-ink",
          available ? "hover:bg-panel-2" : "cursor-not-allowed opacity-45",
          open && "bg-panel-2",
        )}
      >
        <Laptop aria-hidden className="size-[17px] shrink-0" strokeWidth={1.75} />
        <span className="whitespace-nowrap pr-0.5 @max-[1380px]:hidden">
          Connect<span className="@max-[1500px]:hidden"> computer</span>
        </span>
        {connected > 0 && (
          <span
            aria-hidden
            className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-ok px-1 font-mono text-[10px] font-semibold leading-none text-paper ring-2 ring-panel tabular-nums"
          >
            {connected}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
