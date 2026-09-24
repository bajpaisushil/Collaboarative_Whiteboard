"use client";
/**
 * Client-only entry for the board route. Everything in Weave lives in the browser
 * (BroadcastChannel, sessionStorage, Web Locks), so the app is never server-rendered.
 */
import dynamic from "next/dynamic";
import { Splash } from "./Splash";

const BoardApp = dynamic(() => import("./BoardApp"), {
  ssr: false,
  loading: () => <Splash />,
});

export function ClientBoard() {
  return <BoardApp />;
}

export default ClientBoard;
