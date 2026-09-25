import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Two computers = two ISOLATED browser contexts: no shared BroadcastChannel, no shared
 * storage, so the only way they can reach each other is the WebRTC link paired through the
 * "Connect another computer" dialog (copy-paste codes, no server). `?ice=none` keeps ICE to
 * host candidates, so nothing leaves this machine.
 */

type Link = { pid: string; role: string; state: string };
type Peer = { replica: string; label: string; status: string; transport: string };
type Snap = {
  ready: boolean;
  replica: string;
  label: string;
  shapes: number;
  live: number;
  pending: number;
  hash: string;
  online: boolean;
  links: Link[];
  peers: Peer[];
};

interface DebugSession {
  getState(): { ready: boolean; replica: string; label: string; network: { online: boolean }; rtc: { links: Link[] }; peers: Peer[] };
  replica: { getView(): { shapes: unknown[]; conflicts: { status: string; valuesEqual: boolean }[]; stateHash: string; pending: unknown[] } };
}

async function snap(page: Page, room: string): Promise<Snap | null> {
  return page.evaluate((key) => {
    const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: DebugSession }> }).__weaveSessions;
    const s = reg?.get(key)?.session;
    if (!s) return null;
    const st = s.getState();
    const v = s.replica.getView();
    return {
      ready: st.ready,
      replica: st.replica,
      label: st.label,
      shapes: v.shapes.length,
      live: v.conflicts.filter((c) => c.status === "live" && !c.valuesEqual).length,
      pending: v.pending.length,
      hash: v.stateHash,
      online: st.network.online,
      links: st.rtc.links.map((l) => ({ pid: l.pid, role: l.role, state: l.state })),
      peers: st.peers.map((p) => ({ replica: p.replica, label: p.label, status: p.status, transport: p.transport })),
    };
  }, `${room}:main`);
}

async function run<T>(page: Page, room: string, body: string): Promise<T> {
  return page.evaluate(
    ([key, b]) => {
      const reg = (globalThis as unknown as { __weaveSessions?: Map<string, { session: unknown }> }).__weaveSessions;
      return new Function("session", b)(reg?.get(key)?.session);
    },
    [`${room}:main`, body] as const,
  ) as Promise<T>;
}

async function waitReady(page: Page, room: string) {
  await expect.poll(async () => (await snap(page, room))?.ready ?? false, { timeout: 20_000 }).toBe(true);
}

/** A fresh, isolated "computer" (its own profile: storage, BroadcastChannel, service worker). */
async function newComputer(browser: Browser, errors: string[], name: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${String(e)}`));
  return { context, page };
}

test.describe("two computers over WebRTC", () => {
  test("pair through the dialog, sync, merge offline edits, and survive a reload", async ({ browser }) => {
    test.setTimeout(120_000);
    const room = `e2e-rtc-${Date.now().toString(36)}`;
    const errors: string[] = [];
    const one = await newComputer(browser, errors, "computer 1");
    const two = await newComputer(browser, errors, "computer 2");
    const a = one.page;
    const b = two.page;

    try {
      await a.goto(`/?room=${room}&ice=none`);
      await b.goto(`/?room=${room}&ice=none`);
      await waitReady(a, room);
      await waitReady(b, room);

      // Isolated contexts really are two computers: nothing reaches B without the link.
      await run(a, room, `session.transact(tx=>{ tx.create({type:"rect", props:{x:40,y:40,w:60,h:40}}) }, {label:"Before pairing"})`);
      await b.waitForTimeout(1000);
      expect((await snap(b, room))!.shapes).toBe(0);

      /* ---------------------------------------------------------- 1. invite (computer 1) */
      await a.bringToFront();
      const connect = a.getByRole("button", { name: /^Connect another computer/ });
      await expect(connect).toBeEnabled();
      await expect(connect).not.toHaveAttribute("aria-disabled", "true");
      await connect.click();
      const dialogA = a.getByRole("dialog");
      await expect(dialogA).toBeVisible();
      await expect(dialogA.getByText("?ice=none", { exact: true })).toBeVisible(); // honest wording for the LAN mode
      await dialogA.getByRole("button", { name: "Create invite" }).click();

      const inviteBox = dialogA.getByLabel("Invite link");
      await expect(inviteBox).toBeVisible({ timeout: 20_000 });
      const invite = await inviteBox.inputValue();
      const inviteUrl = new URL(invite);
      expect(inviteUrl.searchParams.get("room")).toBe(room);
      expect(inviteUrl.hash).toMatch(/^#join=W1\./);
      expect(inviteUrl.hash).toContain("ice=none");
      await expect.poll(async () => (await snap(a, room))!.links.map((l) => `${l.role}:${l.state}`)).toEqual(["inviter:waiting-answer"]);

      /* ---------------------------------------------------------- 2. open the link (computer 2) */
      await b.bringToFront();
      await b.goto(invite);
      await waitReady(b, room);
      const dialogB = b.getByRole("dialog");
      await expect(dialogB).toBeVisible();
      const replyBox = dialogB.getByLabel("Reply code");
      await expect(replyBox).toBeVisible({ timeout: 20_000 });
      const reply = await replyBox.inputValue();
      expect(reply).toMatch(/^W1\./);
      // Accepted once, then the code leaves the address bar (the ice override stays).
      await expect.poll(() => b.evaluate(() => location.hash)).not.toContain("join=");
      expect(await b.evaluate(() => location.hash)).toContain("ice=none");
      expect((await snap(b, room))!.links.map((l) => `${l.role}:${l.state}`)).toEqual(["invitee:connecting"]);

      /* ---------------------------------------------------------- 3. paste the reply (computer 1) */
      await a.bringToFront();
      await dialogA.getByPlaceholder("Paste their reply code").fill(reply);
      await dialogA.getByRole("button", { name: "Connect", exact: true }).click();

      // The visible "Connected to Tab X" card, and the same news for screen readers.
      for (const dialog of [dialogA, dialogB]) {
        await expect(dialog.locator("[data-pairing-connected]")).toContainText(/Connected to /, { timeout: 30_000 });
        await expect(dialog.locator("[data-pairing-status]")).toHaveText(/^Connected to .+\.$/);
      }
      await expect.poll(async () => (await snap(a, room))!.links.map((l) => l.state), { timeout: 15_000 }).toEqual(["connected"]);
      await expect.poll(async () => (await snap(b, room))!.links.map((l) => l.state), { timeout: 15_000 }).toEqual(["connected"]);
      // The top-bar badge counts the computer.
      await expect(a.getByRole("button", { name: /1 computer connected/ })).toBeVisible();

      // What A drew before pairing catches up over the link.
      await expect.poll(async () => (await snap(b, room))!.shapes, { timeout: 15_000 }).toBe(1);

      /* ---------------------------------------------------------- 4. a sticky crosses over */
      const id = await run<string>(
        a,
        room,
        `let id=""; session.transact(tx=>{ id = tx.create({type:"sticky", props:{x:420,y:260,w:220,h:170,fill:"#ffe58a"}, text:"Plan"}) }, {label:"Add sticky"}); return id;`,
      );
      await expect.poll(async () => (await snap(b, room))!.shapes, { timeout: 15_000 }).toBe(2);
      await expect(b.getByText("Plan").first()).toBeVisible();

      // Close both dialogs (the modal covers the top bar).
      await dialogA.getByRole("button", { name: "Done" }).click();
      await expect(dialogA).toBeHidden();
      await b.bringToFront();
      await dialogB.getByRole("button", { name: "Done" }).click();
      await expect(dialogB).toBeHidden();

      /* ---------------------------------------------------------- 5. unplug B, both recolour */
      const cableB = b.getByRole("switch", { name: "Online" });
      await cableB.click();
      await expect(cableB).toHaveAttribute("aria-checked", "false");
      expect((await snap(b, room))!.online).toBe(false);

      await run(a, room, `session.transact(tx=>tx.update(${JSON.stringify(id)}, {fill:"#ffc2a8"}), {label:"Recolour"})`);
      await run(b, room, `session.transact(tx=>tx.update(${JSON.stringify(id)}, {fill:"#b8ecd9"}), {label:"Recolour"})`);
      await b.waitForTimeout(1000);
      expect((await snap(a, room))!.hash).not.toBe((await snap(b, room))!.hash);
      // Unplugging only stops traffic: the WebRTC link itself stays up.
      expect((await snap(b, room))!.links.map((l) => l.state)).toEqual(["connected"]);

      /* ---------------------------------------------------------- 6. plug back in → converge */
      await cableB.click();
      await expect(cableB).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(
          async () => {
            const [sa, sb] = [(await snap(a, room))!, (await snap(b, room))!];
            return { same: sa.hash === sb.hash, liveA: sa.live, liveB: sb.live, pending: sa.pending + sb.pending, shapes: [sa.shapes, sb.shapes] };
          },
          { timeout: 20_000 },
        )
        .toEqual({ same: true, liveA: 1, liveB: 1, pending: 0, shapes: [2, 2] });

      /* ---------------------------------------------------------- 7. reload B */
      const before = (await snap(b, room))!;
      await b.reload();
      await waitReady(b, room);
      // The reloaded page says its link ended (instead of silently showing "Just you")…
      await expect(b.getByText(/Your link to Tab .+ on another computer ended when this page reloaded/)).toBeVisible({ timeout: 10_000 });
      // …and A stops claiming B is there as soon as its link closes (not after minutes as "idle").
      await expect
        .poll(async () => (await snap(a, room))!.peers.filter((p) => p.replica === before.replica).map((p) => p.status), { timeout: 10_000 })
        .toEqual(["unreachable"]);
      await expect(a.getByRole("button", { name: /^In sync with/ })).toHaveCount(0);
      // Give a stray re-accept every chance to happen before checking it didn't.
      await b.waitForTimeout(2500);
      const after = (await snap(b, room))!;
      expect(await b.evaluate(() => location.hash)).not.toContain("join=");
      expect(after.links).toEqual([]);
      await expect(b.getByRole("dialog")).toHaveCount(0);
      // The board survived: same shapes, same state, the knot still there.
      expect(after.shapes).toBe(before.shapes);
      expect(after.hash).toBe(before.hash);
      expect(after.live).toBe(1);
      await expect(b.getByText("Plan").first()).toBeVisible();

      // A still has exactly its one link — nothing new was created — and notices it closed.
      await expect.poll(async () => (await snap(a, room))!.links.map((l) => l.state), { timeout: 30_000 }).toEqual(["closed"]);

      expect(errors).toEqual([]);
    } finally {
      await one.context.close();
      await two.context.close();
    }
  });

  test("three tabs on two computers: the tabs behind the bridge see each other, and a disconnect is reported as one", async ({ browser }) => {
    test.setTimeout(120_000);
    const room = `e2e-rtc3-${Date.now().toString(36)}`;
    const errors: string[] = [];
    const one = await newComputer(browser, errors, "computer 1 tab A");
    const two = await newComputer(browser, errors, "computer 2");
    const a1 = one.page;
    const a2 = await one.context.newPage(); // same computer: shares BroadcastChannel with a1
    a2.on("pageerror", (e) => errors.push(`computer 1 tab B: ${String(e)}`));
    const c = two.page;

    try {
      for (const p of [a1, a2, c]) {
        await p.goto(`/?room=${room}&ice=none`);
        await waitReady(p, room);
      }
      // Each computer on its own: c is "Tab A" just like a1.
      await expect.poll(async () => [(await snap(a1, room))!.label, (await snap(a2, room))!.label].sort().join()).toBe("A,B");
      expect((await snap(c, room))!.label).toBe("A");

      /* ---------------------------------------------------------- pair a1 ↔ c through the dialog */
      await a1.bringToFront();
      await a1.getByRole("button", { name: /^Connect another computer/ }).click();
      const dialogA = a1.getByRole("dialog");
      await dialogA.getByRole("button", { name: "Create invite" }).click();
      const invite = await dialogA.getByLabel("Invite link").inputValue();
      await c.bringToFront();
      await c.goto(invite);
      await waitReady(c, room);
      const dialogC = c.getByRole("dialog");
      // Before the link settles both are "Tab A": the joiner is told which one is the other computer.
      await expect(dialogC.getByText(/Invite from Tab A on another computer/)).toBeVisible({ timeout: 20_000 });
      const reply = await dialogC.getByLabel("Reply code").inputValue();
      await expect(dialogC.getByText(/within about 3 minutes/)).toBeVisible();
      await a1.bringToFront();
      await dialogA.getByPlaceholder("Paste their reply code").fill(reply);
      await dialogA.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(dialogA.locator("[data-pairing-connected]")).toBeVisible({ timeout: 30_000 });

      /* ---------------------------------------------------------- every tab sees every tab, unique letters */
      const view = async () => {
        const snaps = [(await snap(a1, room))!, (await snap(a2, room))!, (await snap(c, room))!];
        const ids = snaps.map((x) => x.replica);
        return {
          letters: new Set(snaps.map((x) => x.label)).size,
          // what each tab calls each other tab, and whether it's online
          seen: snaps.map((x) => ids.filter((id) => id !== x.replica).map((id) => x.peers.find((p) => p.replica === id)?.status ?? "missing")),
          agree: snaps.every((x) => x.peers.every((p) => snaps.find((y) => y.replica === p.replica)?.label === p.label)),
        };
      };
      await expect.poll(view, { timeout: 20_000 }).toEqual({
        letters: 3,
        seen: [
          ["online", "online"],
          ["online", "online"],
          ["online", "online"],
        ],
        agree: true,
      });
      // a2 (not paired itself) reaches c over WebRTC through a1, and its dialog says so.
      const cId = (await snap(c, room))!.replica;
      expect((await snap(a2, room))!.peers.find((p) => p.replica === cId)?.transport).toBe("webrtc");
      await a2.bringToFront();
      // (Either a1 or c re-picked its letter when they met — whichever has the greater id.)
      const bridgeLetter = (await snap(a1, room))!.label;
      await a2.getByRole("button", { name: `Connect another computer — Linked to another computer through Tab ${bridgeLetter}` }).click();
      await expect(a2.getByRole("dialog").locator("[data-pairing-bridge]")).toContainText("already linked to another computer");
      await a2.keyboard.press("Escape");
      await expect(a2.getByRole("dialog")).toBeHidden();

      // Edits from the non-bridge tab reach the other computer, and back.
      await run(a2, room, `session.transact(tx=>{ tx.create({type:"sticky", props:{x:420,y:260,w:220,h:170,fill:"#ffe58a"}, text:"From tab B"}) }, {label:"Add sticky"})`);
      await run(c, room, `session.transact(tx=>{ tx.create({type:"sticky", props:{x:720,y:260,w:220,h:170,fill:"#b8ecd9"}, text:"From computer 2"}) }, {label:"Add sticky"})`);
      await expect.poll(async () => [(await snap(a1, room))!.shapes, (await snap(a2, room))!.shapes, (await snap(c, room))!.shapes], { timeout: 15_000 }).toEqual([2, 2, 2]);

      /* ---------------------------------------------------------- the connected tab can invite another computer */
      await a1.bringToFront();
      const firstInvite = invite;
      await dialogA.getByRole("button", { name: "Invite another computer" }).click();
      const secondBox = dialogA.getByLabel("Invite link");
      await expect(secondBox).toBeVisible({ timeout: 20_000 });
      expect(await secondBox.inputValue()).not.toBe(firstInvite);
      await expect.poll(async () => (await snap(a1, room))!.links.map((l) => `${l.role}:${l.state}`).sort()).toEqual(["inviter:connected", "inviter:waiting-answer"]);
      // Withdraw it again: only the working link stays.
      await dialogA.getByRole("button", { name: /^Cancel the link with/ }).click();
      await expect.poll(async () => (await snap(a1, room))!.links.map((l) => l.state)).toEqual(["connected"]);

      /* ---------------------------------------------------------- deliberate disconnect */
      await dialogA.getByRole("button", { name: /^Disconnect / }).click();
      await c.bringToFront();
      await expect(c.getByText(/^Tab [A-Z] disconnected$/)).toBeVisible({ timeout: 10_000 });
      await expect(c.getByText(/disconnected this link on their computer/)).toBeVisible();
      // Both computers stop showing the other side's tabs as there — right away.
      const [a1Id, a2Id] = [(await snap(a1, room))!.replica, (await snap(a2, room))!.replica];
      await expect
        .poll(async () => (await snap(c, room))!.peers.filter((p) => p.replica === a1Id || p.replica === a2Id).map((p) => p.status), { timeout: 5_000 })
        .toEqual(["unreachable", "unreachable"]);
      await expect.poll(async () => (await snap(a2, room))!.peers.find((p) => p.replica === cId)?.status, { timeout: 5_000 }).toBe("unreachable");

      expect(errors).toEqual([]);
    } finally {
      await one.context.close();
      await two.context.close();
    }
  });
});
