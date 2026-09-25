/**
 * Pairing dialog state for one pane: which track is showing (invite / join), and each
 * track's progress. It lives outside the dialog so closing and reopening it (or a toast's
 * "Re-pair" button) keeps an invite in flight. Live link state (connecting → connected…)
 * is read from the session, never copied here — the flows only remember which link is theirs.
 */
import { createStore, type StoreApi } from "zustand";
import type { RtcLinkInfo, WhiteboardSessionApi } from "@/lib/session/types";
import { RoomMismatchError } from "@/lib/session/session";
import { decodePairing, extractPairingCode } from "@/lib/sync/rtc-codec";
import { disconnectLink, isDeadLink, mismatchRoom, pairingErrorText } from "./links";

export type PairingTrack = "invite" | "join";

/** How this page reaches other computers (`?ice=`): the public STUN default, none (LAN), or custom. */
export type IceMode = "default" | "none" | "custom";

export interface InviteFlow {
  phase: "idle" | "creating" | "ready";
  /** The link this flow created. */
  pid: string | null;
  /** The invite code (the dialog turns it into a link). */
  code: string | null;
  error: string | null;
  /** "Paste their reply code" textarea. */
  draft: string;
  completing: boolean;
  replyError: string | null;
}

export interface JoinFlow {
  phase: "idle" | "accepting" | "ready";
  pid: string | null;
  /** The reply code to send back. */
  reply: string | null;
  /** "Paste an invite link or code" textarea (kept to make a fresh reply if one expires). */
  draft: string;
  error: string | null;
  /** The invite is for another board: offer to switch to it. */
  mismatch: { room: string; code: string } | null;
}

export interface PairingState {
  /** Fixed for the page's lifetime; only changes the dialog's wording. */
  ice: IceMode;
  open: boolean;
  track: PairingTrack;
  invite: InviteFlow;
  join: JoinFlow;
}

export interface PairingActions {
  openDialog(track?: PairingTrack): void;
  closeDialog(): void;
  setTrack(track: PairingTrack): void;
  setInviteDraft(text: string): void;
  setJoinDraft(text: string): void;
  /** Make a new invite (an unused previous one is withdrawn). */
  createInvite(): Promise<void>;
  /** Apply the reply code pasted into the invite track. */
  completeInvite(text?: string): Promise<void>;
  /** Accept an invite (code or whole link) on the join track. */
  acceptInvite(text?: string): Promise<void>;
  /** Replace an expired/failed reply code with a fresh one for the same invite. */
  retryJoin(): Promise<void>;
  resetJoin(): void;
  /** Drop a dead link and start a new invite for it. */
  repair(pid: string): void;
  /** Close a link on purpose. */
  disconnect(pid: string): void;
  /** Remove a dead link from the list. */
  dismiss(pid: string): void;
}

export type PairingStore = PairingState & PairingActions;

export const INVITE_IDLE: InviteFlow = { phase: "idle", pid: null, code: null, error: null, draft: "", completing: false, replyError: null };
export const JOIN_IDLE: JoinFlow = { phase: "idle", pid: null, reply: null, draft: "", error: null, mismatch: null };

export function createPairingStore(session: WhiteboardSessionApi, ice: IceMode = "default"): StoreApi<PairingStore> {
  const linkById = (pid: string | null): RtcLinkInfo | null =>
    pid ? (session.getState().rtc.links.find((l) => l.pid === pid) ?? null) : null;

  return createStore<PairingStore>()((set, get) => {
    const patchInvite = (patch: Partial<InviteFlow>) => set((s) => ({ invite: { ...s.invite, ...patch } }));
    const patchJoin = (patch: Partial<JoinFlow>) => set((s) => ({ join: { ...s.join, ...patch } }));

    /** Accept `text`; a stale link for the same invite (expired reply) is replaced once. */
    const accept = async (text: string): Promise<void> => {
      patchJoin({ phase: "accepting", pid: null, reply: null, error: null, mismatch: null, draft: text });
      try {
        let link = await session.acceptInvite(text);
        if (isDeadLink(link)) {
          session.closeLink(link.pid);
          link = await session.acceptInvite(text);
        }
        patchJoin({ phase: "ready", pid: link.pid, reply: link.code });
      } catch (e) {
        const room = e instanceof RoomMismatchError ? e.room : mismatchRoom(e);
        const code = extractPairingCode(text);
        if (room && code) patchJoin({ phase: "idle", mismatch: { room, code } });
        else patchJoin({ phase: "idle", error: pairingErrorText(e) });
      }
    };

    return {
      ice,
      open: false,
      track: "invite",
      invite: INVITE_IDLE,
      join: JOIN_IDLE,

      openDialog: (track) => set((s) => ({ open: true, track: track ?? s.track })),
      closeDialog: () => set({ open: false }),
      setTrack: (track) => set({ track }),
      setInviteDraft: (draft) => patchInvite({ draft, replyError: null }),
      setJoinDraft: (draft) => patchJoin({ draft, error: null, mismatch: null }),

      async createInvite() {
        const { invite } = get();
        if (invite.phase === "creating") return;
        // An invite nobody answered would wait forever; a dead one only clutters the list.
        const previous = linkById(invite.pid);
        if (previous && (previous.state === "gathering" || previous.state === "waiting-answer" || isDeadLink(previous))) {
          session.closeLink(previous.pid);
        }
        set({ invite: { ...INVITE_IDLE, phase: "creating" } });
        try {
          const link = await session.createInvite();
          set({ invite: { ...INVITE_IDLE, phase: "ready", pid: link.pid, code: link.code } });
        } catch (e) {
          set({ invite: { ...INVITE_IDLE, error: pairingErrorText(e) } });
        }
      },

      async completeInvite(text) {
        const { invite } = get();
        const reply = (text ?? invite.draft).trim();
        if (invite.completing) return;
        if (!reply) {
          patchInvite({ replyError: "Paste the reply code the other computer showed you." });
          return;
        }
        patchInvite({ completing: true, replyError: null, draft: reply });
        try {
          const link = await session.completeInvite(reply);
          patchInvite({ completing: false, pid: link.pid });
        } catch (e) {
          patchInvite({ completing: false, replyError: pairingErrorText(e) });
        }
      },

      async acceptInvite(text) {
        const { join } = get();
        if (join.phase === "accepting") return;
        const invite = (text ?? join.draft).trim();
        if (!invite) {
          patchJoin({ error: "Paste the invite link or code first." });
          return;
        }
        // Show the spinner right away (an invite link opens the dialog straight into this).
        patchJoin({ phase: "accepting", error: null, mismatch: null, draft: invite });
        // A reply code pasted into this track by mistake: if it answers this tab's own open
        // invite, just use it there.
        const code = extractPairingCode(invite);
        if (code) {
          const decoded = await decodePairing(code).catch(() => null);
          const mine = decoded?.k === "answer" ? linkById(decoded.pid) : null;
          if (mine && mine.role === "inviter" && mine.state === "waiting-answer") {
            set((s) => ({
              track: "invite",
              join: JOIN_IDLE,
              invite: { ...s.invite, pid: mine.pid, phase: "ready", code: mine.code ?? s.invite.code },
            }));
            await get().completeInvite(invite);
            return;
          }
        }
        await accept(invite);
      },

      async retryJoin() {
        const { join } = get();
        if (join.phase === "accepting" || !join.draft) return;
        if (join.pid) session.closeLink(join.pid);
        await accept(join.draft);
      },

      resetJoin: () => {
        const { join } = get();
        const link = linkById(join.pid);
        // Withdraw a reply nobody used yet; keep a live connection.
        if (link && link.state !== "connected" && link.state !== "disconnected") session.closeLink(link.pid);
        set({ join: JOIN_IDLE });
      },

      repair(pid) {
        session.closeLink(pid);
        const { invite, join } = get();
        if (join.pid === pid) set({ join: { ...JOIN_IDLE, draft: join.draft } });
        if (invite.pid === pid) set({ invite: INVITE_IDLE });
        set({ open: true, track: "invite" });
        void get().createInvite();
      },

      disconnect(pid) {
        disconnectLink(session, pid);
        const { invite, join } = get();
        if (invite.pid === pid) set({ invite: INVITE_IDLE });
        if (join.pid === pid) set({ join: JOIN_IDLE });
      },

      dismiss(pid) {
        session.closeLink(pid);
        const { invite, join } = get();
        if (invite.pid === pid) set({ invite: INVITE_IDLE });
        if (join.pid === pid) set({ join: { ...JOIN_IDLE, draft: join.draft } });
      },
    };
  });
}
