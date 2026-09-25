"use client";
/**
 * "Connect another computer": serverless WebRTC pairing by copy-paste.
 *
 *   Invite (this computer starts)          Join (this computer received an invite)
 *   1 Create invite                        1 Paste the invite link or code
 *   2 Send the link                        2 Send the reply code back
 *   3 Paste their reply code → connected   3 Wait until they paste it → connected
 *
 * Live link state comes from the session (state.rtc.links); the pairing store only
 * remembers which link each track created, so closing the dialog never loses progress.
 *
 * Accessibility: one polite live region (Announcer) speaks each state change; errors are
 * role="alert". When a step's control unmounts (the button you pressed turns into a
 * spinner), focus moves to the next step's main control instead of falling to <body>.
 */
import clsx from "clsx";
import { ArrowRightLeft, CircleCheck, Laptop, MailOpen, Plus, RotateCw, Send, Unplug } from "lucide-react";
import { useCallback, useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { RtcLinkInfo, SessionState } from "@/lib/session/types";
import { useSessionState } from "@/lib/session/react";
import { threadColor } from "@/lib/ui/colors";
import { extractPairingCode } from "@/lib/sync/rtc-codec";
import { Dialog } from "@/components/ui/Dialog";
import { ThreadBadge } from "@/components/ui/ThreadBadge";
import { inviteLink, joinPath } from "../params";
import { selectLabel, selectRoom } from "../selectors";
import { LinkList } from "./LinkList";
import { PAIRING_TITLE, remoteLabelIn, remoteName, selectBridgeLabel, selectRtcAvailable } from "./links";
import { Busy, CodeBox, FIELD, InlineError, PRIMARY_BTN, QUIET_BTN, SECONDARY_BTN, Step, type StepState } from "./parts";
import { usePairing, useRequiredPairingStore } from "./PairingProvider";
import type { IceMode, PairingTrack } from "./store";

function Param({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap font-mono text-[11.5px]">{children}</span>;
}

/** The one calm sentence about what travels where — honest about `?ice=`. */
const DESCRIPTION: Record<IceMode, ReactNode> = {
  default:
    "Computers connect directly (WebRTC). No server stores your board — a public STUN server only helps the two computers find each other.",
  none: (
    <>
      Computers connect directly (WebRTC). No server stores your board — and with <Param>?ice=none</Param> no STUN server is
      used either, so both computers must be on the same network.
    </>
  ),
  custom: (
    <>
      Computers connect directly (WebRTC). No server stores your board — the STUN/TURN servers from <Param>?ice=</Param> only
      help the two computers reach each other.
    </>
  ),
};

export function PairingDialog() {
  const open = usePairing((s) => s.open);
  const track = usePairing((s) => s.track);
  const ice = usePairing((s) => s.ice);
  const store = useRequiredPairingStore();
  const available = useSessionState(selectRtcAvailable);

  return (
    // `display: contents` keeps the Dialog positioned against the pane; data-own-keys tells
    // the canvas/loom shortcuts to leave arrows, Delete and Enter to the dialog.
    <div className="contents" data-own-keys="">
      <Dialog
        open={open}
        onClose={() => store.getState().closeDialog()}
        title={<span className="font-serif text-[24px] font-normal leading-none tracking-[-0.01em]">{PAIRING_TITLE}</span>}
        description={DESCRIPTION[ice]}
        className="max-w-[600px]"
      >
        <div className="@container space-y-5" data-pairing-dialog="">
          <Announcer />
          {available ? (
            <>
              <LinkedThroughBridge />
              <TrackSwitch track={track} />
              {track === "invite" ? <InviteTrack /> : <JoinTrack />}
            </>
          ) : (
            <InlineError icon={Unplug}>
              This browser can’t make direct connections (WebRTC is unavailable or turned off), so this board can only sync
              with tabs on this computer.
            </InlineError>
          )}
          <LinkList />
          <p className="flex items-start gap-2 border-t border-dashed border-line pt-4 text-[12px] leading-snug text-ink-2">
            <Unplug aria-hidden className="mt-px size-3.5 shrink-0 text-muted" />
            <span>
              If the connection drops, keep working — edits merge after you re-pair.{" "}
              <span className="text-muted">Only this tab links directly; your other tabs on this computer sync through it.</span>
            </span>
          </p>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * This tab has no link of its own, but another tab here does (a bridge): the board already
 * syncs with the other computer through it. Say so, so pairing again isn't the only option.
 */
function LinkedThroughBridge() {
  const bridge = useSessionState(selectBridgeLabel);
  if (!bridge) return null;
  return (
    <p className="flex items-start gap-2 rounded-[12px] bg-[color-mix(in_oklab,var(--ok)_8%,var(--panel))] px-3 py-2.5 text-[12.5px] leading-snug text-ink-2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ok)_30%,transparent)]" data-pairing-bridge="">
      <Laptop aria-hidden className="mt-px size-4 shrink-0 text-ok" strokeWidth={1.9} />
      <span>
        <span className="font-medium text-ink">This board is already linked to another computer</span> through Tab {bridge}, another tab
        on this computer — your edits reach it through that tab. Pair this tab too only if you want a second, direct link.
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ track switch */

const TRACKS: { id: PairingTrack; icon: typeof Send; title: string; sub: string }[] = [
  { id: "invite", icon: Send, title: "Invite a computer", sub: "This computer starts" },
  { id: "join", icon: MailOpen, title: "Join an invite", sub: "You received a link or code" },
];

function TrackSwitch({ track }: { track: PairingTrack }) {
  const store = useRequiredPairingStore();
  const label = useSessionState(selectLabel);
  const color = threadColor(label);
  return (
    <div role="group" aria-label="How are you connecting?" className="grid grid-cols-2 gap-2 @max-[420px]:grid-cols-1">
      {TRACKS.map((t) => {
        const on = t.id === track;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            aria-controls="pairing-track"
            onClick={() => store.getState().setTrack(t.id)}
            className={clsx(
              "flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition-[background-color,border-color] duration-150",
              on ? "border-transparent" : "border-line hover:bg-panel-2",
            )}
            style={on ? { background: `color-mix(in oklab, ${color} 9%, var(--panel))`, boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
          >
            <Icon aria-hidden className={clsx("size-4 shrink-0", !on && "text-muted")} style={on ? { color } : undefined} strokeWidth={1.9} />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight text-ink">{t.title}</span>
              <span className="block text-[11.5px] leading-tight text-muted">{t.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function useLink(pid: string | null): RtcLinkInfo | null {
  const select = useCallback((s: SessionState) => (pid ? (s.rtc.links.find((l) => l.pid === pid) ?? null) : null), [pid]);
  return useSessionState(select);
}

function useRemoteLabel(link: RtcLinkInfo | null): string | null {
  const replica = link?.remoteReplica ?? null;
  const frozen = link?.remoteLabel ?? null;
  const select = useCallback((s: SessionState) => remoteLabelIn(s, { remoteReplica: replica, remoteLabel: frozen }), [replica, frozen]);
  return useSessionState(select);
}

/**
 * When the step changes, focus its main control (`[data-step-focus]`, else the track itself)
 * — but only if focus was lost (the pressed button unmounted) or is parked on the dialog.
 * Never steals focus from a control the user is on.
 */
function useStepFocus(ref: RefObject<HTMLElement | null>, stepKey: string) {
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const active = document.activeElement;
      const dialog = root.closest('[role="dialog"]');
      const parked = !active || active === document.body || !active.isConnected || active === root || active === dialog;
      if (!parked) return;
      (root.querySelector<HTMLElement>("[data-step-focus]") ?? root).focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(id);
  }, [ref, stepKey]);
}

/** One sentence per state for screen readers (errors speak for themselves as alerts). */
function describe(phase: string, link: RtcLinkInfo | null, remote: string | null, track: PairingTrack): string {
  if (phase === "creating" || phase === "accepting") return "Preparing a direct connection. This takes a few seconds.";
  if (phase !== "ready" || !link) return "";
  const who = remoteName(remote);
  switch (link.state) {
    case "gathering":
    case "waiting-answer":
      return "Invite ready. Copy the link, send it to the other computer, then paste their reply code here.";
    case "connecting":
      return track === "join"
        ? "Reply code ready. Copy it and send it back to the computer that invited you."
        : `Connecting to ${who}…`;
    case "connected":
      return `Connected to ${who}.`;
    case "disconnected":
      return `The connection to ${who} was interrupted. Trying to recover…`;
    default:
      return "";
  }
}

function Announcer() {
  const track = usePairing((s) => s.track);
  const phase = usePairing((s) => (s.track === "invite" ? s.invite.phase : s.join.phase));
  const pid = usePairing((s) => (s.track === "invite" ? s.invite.pid : s.join.pid));
  const link = useLink(pid);
  const remote = useRemoteLabel(link);
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-pairing-status="">
      {describe(phase, link, remote, track)}
    </p>
  );
}

function Connected({ label }: { label: string | null }) {
  const store = useRequiredPairingStore();
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[12px] bg-[color-mix(in_oklab,var(--ok)_9%,var(--panel))] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ok)_35%,transparent)]"
      data-pairing-connected=""
    >
      {label ? <ThreadBadge label={label} size="md" status="online" /> : <Laptop aria-hidden className="size-5 text-ok" />}
      {/* A floor on the text's width: in a narrow dialog "Done" wraps below instead of squeezing it. */}
      <div className="min-w-[9rem] flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          Connected to {remoteName(label)}
          <CircleCheck aria-hidden className="size-4 text-ok" strokeWidth={2.25} />
        </p>
        <p className="text-[12px] text-ink-2">Edits now sync both ways between the two computers.</p>
      </div>
      <button type="button" data-step-focus="" className={clsx(SECONDARY_BTN, "ml-auto")} onClick={() => store.getState().closeDialog()}>
        Done
      </button>
    </div>
  );
}

/** Submit on ⌘/Ctrl+Enter; a pasted code submits by itself. */
function useCodeField(submit: (text: string) => void, setDraft: (text: string) => void) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(e.currentTarget.value);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text");
    if (!extractPairingCode(text)) return;
    e.preventDefault();
    setDraft(text.trim());
    submit(text.trim());
  };
  return { onKeyDown, onPaste };
}

function stepState(done: boolean, active: boolean): StepState {
  return done ? "done" : active ? "active" : "todo";
}

function closedMessage(remote: string | null, remoteClosed = false): string {
  if (remoteClosed) return `${capitalName(remote)} disconnected this link on their computer. Pair again any time to sync.`;
  return `The connection to ${remoteName(remote)} closed — the other computer may have reloaded or closed the page.`;
}

function capitalName(remote: string | null): string {
  const n = remoteName(remote);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function DeadEnd({ message, action, hint, failed }: { message: string; action: ReactNode; hint?: ReactNode; failed: boolean }) {
  return (
    <>
      <InlineError>{message}</InlineError>
      {hint && <p className="text-[12px] text-ink-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">{action}</div>
      <p className="text-[11.5px] leading-snug text-muted">
        Both computers keep every edit.
        {failed && " Behind strict firewalls a direct link may need a TURN server — see “Two computers” in the README."}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ invite track */

function InviteTrack() {
  const store = useRequiredPairingStore();
  const flow = usePairing((s) => s.invite);
  const room = useSessionState(selectRoom);
  const label = useSessionState(selectLabel);
  const color = threadColor(label);
  const link = useLink(flow.pid);
  const remote = useRemoteLabel(link);
  const rootRef = useRef<HTMLDivElement>(null);
  const api = () => store.getState();

  const ready = flow.phase === "ready" && !!link;
  const state = link?.state;
  const waiting = ready && (state === "waiting-answer" || state === "gathering");
  const answered = ready && !waiting;
  const connected = state === "connected";
  // A working link stays in "Links to other computers"; this tab can still invite another one.
  const linked = connected || state === "disconnected";
  const url = ready && flow.code ? inviteLink(window.location, room, flow.code) : null;
  const field = useCodeField(
    (t) => void api().completeInvite(t),
    (t) => api().setInviteDraft(t),
  );
  // Once they're typing or fixing a reply, the reply field is the step's home; before that, "Copy link".
  const replyFirst = !!flow.replyError || flow.draft.length > 0;
  useStepFocus(rootRef, `invite:${flow.phase}:${ready ? state : "-"}:${flow.error ? "e" : ""}`);

  return (
    <div id="pairing-track" ref={rootRef} tabIndex={-1} className="outline-none" data-track="invite">
      <ol aria-label="Invite another computer">
        <Step n={1} title="Create an invite" state={stepState(ready, !ready)} color={color}>
          {flow.phase === "creating" ? (
            <Busy>Preparing a direct connection… (a few seconds)</Busy>
          ) : ready ? (
            !answered ? (
              <button type="button" className={QUIET_BTN} onClick={() => void api().createInvite()}>
                <RotateCw aria-hidden className="size-3" />
                Make a new invite
              </button>
            ) : (
              linked && (
                <button type="button" className={QUIET_BTN} onClick={() => void api().createInvite()} data-invite-another="">
                  <Plus aria-hidden className="size-3" />
                  Invite another computer
                </button>
              )
            )
          ) : (
            <>
              <p className="text-[12.5px] text-ink-2">
                A one-time invite for this tab (<span className="font-medium text-ink">Tab {label}</span>). Works wherever the
                two computers can reach each other.
              </p>
              <button type="button" data-step-focus="" className={PRIMARY_BTN} onClick={() => void api().createInvite()}>
                <Send aria-hidden className="size-3.5" />
                {flow.error ? "Try again" : "Create invite"}
              </button>
              {flow.error && <InlineError>{flow.error}</InlineError>}
            </>
          )}
        </Step>

        <Step n={2} title="Send the invite" state={stepState(answered, waiting)} color={color}>
          {url && waiting && (
            <>
              <CodeBox
                value={url}
                label="Invite link"
                actions={[
                  { id: "link", label: "Copy link", what: "Invite link", text: url, primary: true, stepFocus: !replyFirst },
                  { id: "code", label: "Copy code", what: "Invite code", text: flow.code! },
                ]}
              />
              <p className="text-[12.5px] text-ink-2">
                Send this to the other computer (chat, email…). They open the link — or paste it under{" "}
                <span className="font-medium text-ink">Join an invite</span>.
              </p>
            </>
          )}
        </Step>

        <Step n={3} title="Paste their reply code" state={stepState(connected, ready && !connected)} color={color} last>
          {ready && link && <InviteStatus link={link} remote={remote} field={field} replyFirst={replyFirst} />}
        </Step>
      </ol>
    </div>
  );
}

function InviteStatus({
  link,
  remote,
  field,
  replyFirst,
}: {
  link: RtcLinkInfo;
  remote: string | null;
  field: ReturnType<typeof useCodeField>;
  replyFirst: boolean;
}) {
  const store = useRequiredPairingStore();
  const flow = usePairing((s) => s.invite);
  const api = () => store.getState();

  switch (link.state) {
    case "gathering":
    case "waiting-answer":
      return (
        <>
          <label htmlFor="pairing-reply" className="block text-[12.5px] text-ink-2">
            When they open the invite, their computer shows a reply code. Paste it here.
          </label>
          <textarea
            id="pairing-reply"
            rows={3}
            value={flow.draft}
            spellCheck={false}
            autoComplete="off"
            placeholder="Paste their reply code"
            aria-invalid={flow.replyError ? true : undefined}
            aria-describedby={flow.replyError ? "pairing-reply-error" : undefined}
            data-step-focus={replyFirst ? "" : undefined}
            onChange={(e) => api().setInviteDraft(e.target.value)}
            {...field}
            className={FIELD}
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* aria-disabled, not disabled: a disabled button would drop keyboard focus. */}
            <button
              type="button"
              className={clsx(PRIMARY_BTN, flow.completing && "opacity-60")}
              aria-disabled={flow.completing || undefined}
              onClick={() => void api().completeInvite()}
            >
              <ArrowRightLeft aria-hidden className="size-3.5" />
              Connect
            </button>
            {flow.completing && <Busy>Checking the code…</Busy>}
          </div>
          {flow.replyError && (
            <div id="pairing-reply-error">
              <InlineError>{flow.replyError}</InlineError>
            </div>
          )}
        </>
      );
    case "connecting":
      return <Busy>Connecting to {remoteName(remote)}… (usually a second or two)</Busy>;
    case "connected":
      return <Connected label={remote} />;
    case "disconnected":
      return <Busy>The connection to {remoteName(remote)} was interrupted — trying to recover…</Busy>;
    case "failed":
    case "closed":
      return (
        <DeadEnd
          failed={link.state === "failed"}
          message={link.error ?? (link.state === "closed" ? closedMessage(remote, link.remoteClosed) : "The connection failed.")}
          action={
            <button type="button" data-step-focus="" className={PRIMARY_BTN} onClick={() => api().repair(link.pid)}>
              <RotateCw aria-hidden className="size-3.5" />
              Re-pair
            </button>
          }
        />
      );
  }
}

/* ------------------------------------------------------------------ join track */

function JoinTrack() {
  const store = useRequiredPairingStore();
  const flow = usePairing((s) => s.join);
  const label = useSessionState(selectLabel);
  const color = threadColor(label);
  const link = useLink(flow.pid);
  const remote = useRemoteLabel(link);
  const rootRef = useRef<HTMLDivElement>(null);
  const api = () => store.getState();

  const ready = flow.phase === "ready" && !!link;
  const state = link?.state;
  const connected = state === "connected";
  const dead = state === "failed" || state === "closed";
  const field = useCodeField(
    (t) => void api().acceptInvite(t),
    (t) => api().setJoinDraft(t),
  );
  useStepFocus(rootRef, `join:${flow.phase}:${ready ? state : "-"}:${flow.mismatch ? "m" : ""}${flow.error ? "e" : ""}`);

  return (
    <div id="pairing-track" ref={rootRef} tabIndex={-1} className="outline-none" data-track="join">
      <ol aria-label="Join an invite from another computer">
        <Step
          n={1}
          // Both computers are often "Tab A" until the link settles their letters: say which is which.
          title={ready ? `Invite from ${remoteName(remote)}${connected ? "" : " on another computer"}` : "Paste the invite"}
          state={stepState(ready, !ready)}
          color={color}
        >
          {flow.phase === "accepting" ? (
            <Busy>Preparing a direct connection… (a few seconds)</Busy>
          ) : ready ? (
            !connected && (
              <button type="button" className={QUIET_BTN} onClick={() => api().resetJoin()}>
                Use a different invite
              </button>
            )
          ) : (
            <>
              <label htmlFor="pairing-invite" className="block text-[12.5px] text-ink-2">
                Paste the invite link or code you were sent. (Opening the invite link does this for you.)
              </label>
              <textarea
                id="pairing-invite"
                rows={3}
                value={flow.draft}
                spellCheck={false}
                autoComplete="off"
                placeholder="Paste an invite link or code"
                aria-invalid={flow.error ? true : undefined}
                aria-describedby={flow.error ? "pairing-invite-error" : undefined}
                data-step-focus={flow.mismatch ? undefined : ""}
                onChange={(e) => api().setJoinDraft(e.target.value)}
                {...field}
                className={FIELD}
              />
              <button type="button" className={PRIMARY_BTN} onClick={() => void api().acceptInvite()}>
                <ArrowRightLeft aria-hidden className="size-3.5" />
                Join
              </button>
              {flow.error && (
                <div id="pairing-invite-error">
                  <InlineError>{flow.error}</InlineError>
                </div>
              )}
              {flow.mismatch && <RoomSwitch room={flow.mismatch.room} code={flow.mismatch.code} />}
            </>
          )}
        </Step>

        <Step
          n={2}
          title="Send your reply code back"
          state={stepState(ready && (connected || state === "disconnected"), ready && state === "connecting")}
          color={color}
        >
          {ready && flow.reply && state === "connecting" && (
            <>
              <CodeBox
                value={flow.reply}
                label="Reply code"
                actions={[{ id: "reply", label: "Copy reply code", what: "Reply code", text: flow.reply, primary: true, stepFocus: true }]}
              />
              <p className="text-[12.5px] text-ink-2">
                Send this back to the computer that invited you — they paste it to finish. They need to paste it within
                about 3 minutes; after that, make a new one.
              </p>
            </>
          )}
        </Step>

        <Step n={3} title="Wait for them to paste it" state={stepState(connected, ready && !connected)} color={color} last>
          {ready && state === "connecting" && <Busy>Waiting for them to paste your reply code…</Busy>}
          {connected && <Connected label={remote} />}
          {state === "disconnected" && <Busy>The connection to {remoteName(remote)} was interrupted — trying to recover…</Busy>}
          {ready && dead && (
            <DeadEnd
              failed={state === "failed"}
              message={link.error ?? closedMessage(remote, link.remoteClosed)}
              hint={
                state === "failed"
                  ? "If they hadn’t pasted your reply yet, make a new one and send it again — or start over with an invite from this computer."
                  : undefined
              }
              action={
                <>
                  {state === "failed" && (
                    <button type="button" data-step-focus="" className={PRIMARY_BTN} onClick={() => void api().retryJoin()}>
                      <RotateCw aria-hidden className="size-3.5" />
                      Make a new reply code
                    </button>
                  )}
                  <button
                    type="button"
                    data-step-focus={state === "failed" ? undefined : ""}
                    className={SECONDARY_BTN}
                    onClick={() => api().repair(link.pid)}
                  >
                    <Send aria-hidden className="size-3.5" />
                    Re-pair from this computer
                  </button>
                </>
              }
            />
          )}
        </Step>
      </ol>
    </div>
  );
}

function RoomSwitch({ room, code }: { room: string; code: string }) {
  return (
    <div className="space-y-2 rounded-[12px] border border-dashed border-line-2 bg-panel-2 px-3 py-2.5">
      <p className="text-[12.5px] text-ink-2">
        This invite is for another board, <span className="font-mono text-ink">{room}</span>. This tab is showing a different
        one.
      </p>
      <button
        type="button"
        data-step-focus=""
        className={PRIMARY_BTN}
        onClick={() => window.location.assign(joinPath(window.location, room, code))}
      >
        <ArrowRightLeft aria-hidden className="size-3.5" />
        Switch to that board
      </button>
    </div>
  );
}
