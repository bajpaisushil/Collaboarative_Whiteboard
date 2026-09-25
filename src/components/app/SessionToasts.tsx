"use client";
/**
 * Turns session events into toasts: undo/redo results (with per-property skips), forks,
 * storage errors, info, peers arriving/leaving, and WebRTC links to other computers
 * connecting, dropping or failing. Merge reports get their own card.
 *
 * Timing details handled here:
 * - A duplicated tab forks while claiming its identity — before the board (and this
 *   component) mounts — so a fork that already happened is announced on mount.
 * - A new tab says hello before it has picked its letter ("?"), so its "joined" toast waits
 *   until the letter is known.
 * - Two computers often both start as Tab A; right after pairing one of them re-picks. So a
 *   link's "connected" toast waits (briefly) until the other side's letter is settled, and
 *   replaces the plain "joined" toast for that tab.
 * - WebRTC links end with a reload. Full panes remember their links in sessionStorage, so the
 *   reloaded page says its link ended instead of silently showing "Just you".
 */
import { GitFork, HardDriveDownload, Laptop, Redo2, Undo2, Unplug, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";
import type { ReplicaId, UndoResult, UndoSkip } from "@/lib/crdt/types";
import { propsNoun } from "@/lib/crdt/describe";
import type { PeerStatus, RtcLinkInfo, SessionEvent, WhiteboardSessionApi } from "@/lib/session/types";
import { safeSessionStorage } from "@/lib/session/persistence";
import { useSession, useSessionEvent } from "@/lib/session/react";
import { useToast, type ToastApi, type ToastOptions } from "@/components/ui/Toast";
import { consumeUserClosed, remoteLabelIn, remoteName } from "./pairing/links";
import { linksToRemember, reloadNotice, rememberLinks, takeRememberedLinks } from "./pairing/linkMemory";
import { usePairingStore } from "./pairing/PairingProvider";
import { hasLabel, labelOf } from "./selectors";

/** Give up waiting for a booting peer's letter after this long (it may have crashed). */
const JOIN_LABEL_WAIT_MS = 6000;
/** Wait at most this long for a newly linked computer's letter to settle before announcing. */
const LINK_LABEL_WAIT_MS = 3000;

/** Sessions whose fork has been announced (survives StrictMode remounts and pane remounts). */
const announcedForks = new WeakSet<WhiteboardSessionApi>();

function skipNoun(prop: UndoSkip["prop"]): string {
  if (prop === "text") return "text";
  if (prop === "shape") return "the shape";
  return propsNoun([prop]);
}

function undoToast(result: UndoResult, redo: boolean): ToastOptions {
  const verb = redo ? "Redid" : "Undid";
  const failVerb = redo ? "redo" : "undo";
  const label = result.label || "last change";
  const seen = new Set<string>();
  const skips: string[] = [];
  for (const s of result.skipped) {
    const line = `Skipped ${skipNoun(s.prop)} — ${s.reason}`;
    if (seen.has(line)) continue;
    seen.add(line);
    skips.push(line);
  }
  const nothingApplied = result.ops.length === 0 && skips.length > 0;
  return {
    id: "undo",
    title: nothingApplied ? `Couldn’t ${failVerb} “${label}”` : `${verb} “${label}”`,
    detail:
      skips.length > 0 ? (
        <ul className="space-y-0.5">
          {skips.slice(0, 4).map((s) => (
            <li key={s}>{s}</li>
          ))}
          {skips.length > 4 && <li className="text-muted">…and {skips.length - 4} more</li>}
        </ul>
      ) : undefined,
    tone: skips.length > 0 ? "warn" : "neutral",
    icon: redo ? Redo2 : Undo2,
    durationMs: skips.length > 0 ? 7000 : 3200,
  };
}

function pushFork(toast: ToastApi, label: string): void {
  toast.push({
    id: "fork",
    title: `This tab was a copy of another tab, so it became Tab ${label}`,
    detail: "Duplicated tabs share their history but never an identity — both copies keep working and sync.",
    icon: GitFork,
    durationMs: 9000,
  });
}

/** A replica we reach (or reached) over a WebRTC link: its link toasts replace "joined". */
function isLinkedReplica(session: WhiteboardSessionApi, replica: ReplicaId): boolean {
  return session.getState().rtc.links.some((l) => l.remoteReplica === replica || l.remoteReplicas.includes(replica));
}

/**
 * The linked tab's letter once it is settled: known, and not the same as ours (a clash
 * is resolved within a heartbeat by one side re-picking). Null while still settling.
 */
function settledLinkLabel(session: WhiteboardSessionApi, link: RtcLinkInfo): string | null {
  const st = session.getState();
  const peer = link.remoteReplica ? st.peers.find((p) => p.replica === link.remoteReplica) : undefined;
  return peer && hasLabel(peer) && peer.label !== st.label ? peer.label : null;
}

function pushJoined(toast: ToastApi, replica: ReplicaId, label: string): void {
  toast.push({ id: `peer-${replica}`, title: `Tab ${label} joined`, icon: UserPlus, tone: "ok", durationMs: 3500 });
}

/** "Couldn't save this tab's history: quota exceeded" → "Quota exceeded." */
function storageDetail(message: string): string {
  const core = message.replace(/^couldn[’']t save this tab[’']s history:\s*/i, "").trim();
  if (!core) return "The browser refused to store it.";
  const sentence = core.charAt(0).toUpperCase() + core.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export function SessionToasts() {
  const session = useSession();
  const toast = useToast();
  const pairing = usePairingStore();
  /** Peers that joined before choosing a letter: replica → when we first heard of them. */
  const pendingJoins = useRef(new Map<ReplicaId, number>());
  /** Links that just connected, waiting for the other side's letter: pid → link + fallback timer. */
  const pendingLinks = useRef(new Map<string, { link: RtcLinkInfo; timer: ReturnType<typeof setTimeout> }>());

  const pushLinkConnected = (link: RtcLinkInfo, label: string | null) => {
    const pending = pendingLinks.current.get(link.pid);
    if (pending) clearTimeout(pending.timer);
    pendingLinks.current.delete(link.pid);
    toast.push({
      id: `link-${link.pid}`,
      title: `Connected to ${remoteName(label, "a tab")} on another computer`,
      detail: "Edits now sync directly between the two computers.",
      tone: "ok",
      icon: Laptop,
      durationMs: 5000,
    });
  };

  const announceLink = useEffectEvent((link: RtcLinkInfo, label: string) => pushLinkConnected(link, label));

  const repairAction = (link: RtcLinkInfo): ToastOptions["action"] =>
    pairing ? { label: "Re-pair", onClick: () => pairing.getState().repair(link.pid) } : undefined;

  const onLinkEvent = (e: Extract<SessionEvent, { type: "link" }>) => {
    const { link, change } = e;
    if (change === "connected") {
      const label = settledLinkLabel(session, link);
      if (label) {
        pushLinkConnected(link, label);
        return;
      }
      const timer = setTimeout(() => {
        const p = pendingLinks.current.get(link.pid);
        if (p) pushLinkConnected(p.link, remoteLabelIn(session.getState(), p.link));
      }, LINK_LABEL_WAIT_MS);
      pendingLinks.current.set(link.pid, { link, timer });
      return;
    }
    const pending = pendingLinks.current.get(link.pid);
    if (pending) clearTimeout(pending.timer);
    pendingLinks.current.delete(link.pid);
    const name = remoteName(remoteLabelIn(session.getState(), link), "the other computer");
    if (change === "lost") {
      if (link.remoteClosed) {
        // They pressed "Disconnect" on their computer: nothing is broken.
        toast.push({
          id: `link-${link.pid}`,
          title: `${name.charAt(0).toUpperCase()}${name.slice(1)} disconnected`,
          detail: "They closed the link on their computer. Your edits keep working here — pair again any time to sync.",
          icon: Unplug,
          durationMs: 7000,
          action: repairAction(link),
        });
        return;
      }
      if (consumeUserClosed(session, link.pid)) {
        toast.push({
          id: `link-${link.pid}`,
          title: `Disconnected from ${name}`,
          detail: "Your edits keep working here. Pair again any time to sync.",
          icon: Unplug,
          durationMs: 4000,
        });
        return;
      }
      toast.push({
        id: `link-${link.pid}`,
        title: `Lost the connection to ${name}`,
        detail: "Your edits keep working and merge when you reconnect. Re-pair to reconnect.",
        tone: "warn",
        icon: Unplug,
        durationMs: 12_000,
        action: repairAction(link),
      });
      return;
    }
    toast.push({
      id: `link-${link.pid}`,
      title: link.error ?? `The connection to ${name} failed.`,
      detail: "Your edits are safe and keep working. Re-pair to try again.",
      tone: "error",
      icon: Unplug,
      durationMs: 12_000,
      action: repairAction(link),
    });
  };

  // Fallback timers of links still waiting for a letter.
  useEffect(() => {
    const pending = pendingLinks.current;
    return () => {
      for (const p of pending.values()) clearTimeout(p.timer);
      pending.clear();
    };
  }, []);

  // Links a reload ended (full panes only — /split's compact panes can't pair), then keep
  // remembering this page's links for the next reload.
  useEffect(() => {
    if (!pairing) return;
    const storage = safeSessionStorage();
    const { room, pane, forkedFrom } = session.getState();
    const before = takeRememberedLinks(storage, room, pane);
    const notice = forkedFrom ? null : reloadNotice(before); // a duplicated tab never had them
    if (notice) {
      toast.push({
        id: "links-reloaded",
        title: notice.title,
        detail: notice.detail,
        tone: "warn",
        icon: Laptop,
        durationMs: 12_000,
        action: { label: "Re-pair", onClick: () => pairing.getState().openDialog("invite") },
      });
    }
    let last = "";
    const save = () => {
      const links = linksToRemember(session.getState());
      const json = JSON.stringify(links);
      if (json === last) return;
      last = json;
      rememberLinks(storage, room, pane, links);
    };
    save();
    return session.subscribe(save);
  }, [session, toast, pairing]);

  // A fork that happened before the board mounted (duplicate tab detected at start-up).
  useEffect(() => {
    const st = session.getState();
    if (!st.forkedFrom || announcedForks.has(session)) return;
    announcedForks.add(session);
    pushFork(toast, st.label);
  }, [session, toast]);

  // Watch peers: announce booting peers once their letter is known, and tabs that come back
  // after saying goodbye (a reload sends "bye", then the same replica says hello again —
  // the session doesn't emit "peer-joined" for a peer it already knows).
  useEffect(() => {
    const pending = pendingJoins.current;
    const links = pendingLinks.current;
    const statuses = new Map<ReplicaId, PeerStatus>();
    for (const p of session.getState().peers) statuses.set(p.replica, p.status);
    let prevLabel = session.getState().label;
    let prevFork = session.getState().forkedFrom;
    return session.subscribe(() => {
      const st = session.getState();
      const { peers } = st;

      // Our own letter changed without a fork: it clashed with a newly linked computer's.
      if (st.label !== prevLabel) {
        const was = prevLabel;
        prevLabel = st.label;
        if (st.forkedFrom === prevFork && hasLabel({ label: was }) && hasLabel(st) && st.rtc.links.some((l) => l.state === "connected")) {
          toast.push({
            id: "relabel",
            title: `This tab is now Tab ${st.label}`,
            detail: `The other computer already had a Tab ${was}, so this tab took the next free letter. Nothing else changed.`,
            icon: Laptop,
            durationMs: 7000,
          });
        }
      }
      prevFork = st.forkedFrom;

      for (const [pid, p] of links) {
        const label = settledLinkLabel(session, p.link);
        if (label) announceLink(p.link, label);
        else if (!st.rtc.links.some((l) => l.pid === pid)) {
          clearTimeout(p.timer);
          links.delete(pid);
        }
      }

      for (const p of peers) {
        const prev = statuses.get(p.replica);
        statuses.set(p.replica, p.status);
        if (prev === "left" && p.status !== "left" && hasLabel(p) && !pending.has(p.replica) && !isLinkedReplica(session, p.replica)) {
          toast.push({ id: `peer-${p.replica}`, title: `Tab ${p.label} is back`, icon: UserPlus, tone: "ok", durationMs: 3500 });
        }
      }
      if (pending.size === 0) return;
      const now = Date.now();
      for (const [replica, since] of pending) {
        const p = peers.find((x) => x.replica === replica);
        if (!p || p.status === "left") pending.delete(replica);
        else if (hasLabel(p)) {
          pending.delete(replica);
          if (!isLinkedReplica(session, replica)) pushJoined(toast, replica, p.label);
        } else if (now - since > JOIN_LABEL_WAIT_MS) pending.delete(replica);
      }
    });
  }, [session, toast]);

  useSessionEvent((e) => {
    switch (e.type) {
      case "undo":
        toast.push(undoToast(e.result, e.redo));
        return;
      case "fork":
        announcedForks.add(session);
        // The session emits before its state snapshot is rebuilt; read the new letter after.
        queueMicrotask(() => pushFork(toast, session.getState().label));
        return;
      case "storage-error":
        toast.push({
          id: "storage-error",
          title: "Couldn’t save this tab’s history",
          detail: `${storageDetail(e.message)} Edits still sync to other tabs, but a reload may lose the ones nobody else has yet.`,
          tone: "error",
          icon: HardDriveDownload,
          durationMs: 0,
        });
        return;
      case "info":
        toast.push({ title: e.message });
        return;
      case "link":
        onLinkEvent(e);
        return;
      case "peer-joined": {
        // A computer we just paired with gets its "Connected to Tab B…" toast instead.
        if (isLinkedReplica(session, e.replica)) return;
        const label = labelOf(session, e.replica);
        if (label) pushJoined(toast, e.replica, label);
        else pendingJoins.current.set(e.replica, Date.now());
        return;
      }
      case "peer-left": {
        const wasPending = pendingJoins.current.delete(e.replica);
        if (wasPending) return; // never announced as joined; stay quiet
        const label = labelOf(session, e.replica);
        toast.push({
          id: `peer-${e.replica}`,
          title: label ? `Tab ${label} left` : "A tab left",
          detail: "Its edits stay in the history.",
          icon: UserMinus,
          durationMs: 3500,
        });
        return;
      }
      case "merge":
        return;
    }
  });

  return null;
}
