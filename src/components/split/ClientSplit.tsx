"use client";
/**
 * Client-only entry for /split. Both panes live entirely in the browser (BroadcastChannel,
 * sessionStorage, Web Locks), so the app is never server-rendered.
 */
import dynamic from "next/dynamic";
import { SplitSplash } from "./SplitSplash";

const SplitApp = dynamic(() => import("./SplitApp"), {
  ssr: false,
  loading: () => <SplitSplash />,
});

export function ClientSplit() {
  return <SplitApp />;
}

export default ClientSplit;
