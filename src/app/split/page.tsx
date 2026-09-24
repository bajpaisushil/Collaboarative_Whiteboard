import type { Metadata } from "next";
import { ClientSplit } from "@/components/split/ClientSplit";

export const metadata: Metadata = {
  title: "Weave — split view: two tabs, one window",
  description:
    "Two Weave tabs side by side in one window, syncing over BroadcastChannel, with a director’s desk that scripts classic conflicts and explains every merge.",
};

/**
 * Apply the stored light/dark choice (localStorage "weave:theme", shared with the board)
 * before the client-only split view paints.
 */
const THEME_BOOT = `try{var t=localStorage.getItem("weave:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}`;

export default function SplitPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <ClientSplit />
    </>
  );
}
