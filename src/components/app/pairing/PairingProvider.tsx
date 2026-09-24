"use client";
/**
 * Per-pane pairing store ("Connect another computer"), plus invite links: a `#join=W1.…`
 * fragment — captured at load, or pasted into the address bar later (hashchange) — opens
 * the dialog on the join track and accepts it, exactly once, then leaves the address bar
 * clean so a reload doesn't accept it again. Mounted inside ReadyGate, so the session is
 * ready by the time any invite is accepted.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { useSession } from "@/lib/session/react";
import type { WhiteboardSessionApi } from "@/lib/session/types";
import { parseJoinHash, stripJoinHash } from "../params";
import { createPairingStore, type PairingStore } from "./store";

const PairingContext = createContext<StoreApi<PairingStore> | null>(null);

/** Invite codes already accepted per session (survives StrictMode remounts). */
const consumed = new WeakMap<WhiteboardSessionApi, Set<string>>();

function claim(session: WhiteboardSessionApi, code: string): boolean {
  let set = consumed.get(session);
  if (!set) consumed.set(session, (set = new Set()));
  if (set.has(code)) return false;
  set.add(code);
  return true;
}

export function PairingProvider({ joinCode, children }: { joinCode?: string | null; children: ReactNode }) {
  const session = useSession();
  const [store] = useState(() => createPairingStore(session));

  useEffect(() => {
    const take = (code: string | null) => {
      stripJoinHash();
      if (!code || !claim(session, code)) return;
      const s = store.getState();
      s.openDialog("join");
      void s.acceptInvite(code);
    };
    take(joinCode ?? null);
    const onHash = () => {
      const code = parseJoinHash(window.location.hash);
      if (code) take(code);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [session, store, joinCode]);

  return <PairingContext.Provider value={store}>{children}</PairingContext.Provider>;
}

/** The pane's pairing store, or null where pairing isn't offered (compact /split panes). */
export function usePairingStore(): StoreApi<PairingStore> | null {
  return useContext(PairingContext);
}

/** Select from the pairing store (throws outside a PairingProvider). */
export function usePairing<T>(selector: (s: PairingStore) => T): T {
  const store = useContext(PairingContext);
  if (!store) throw new Error("usePairing must be used inside <PairingProvider>");
  return useStore(store, selector);
}
