/**
 * The merge card says who *brought* the edits: their authors, not the tab we happened to hear
 * them through. Behind a bridge tab (another computer's paired tab), the edit usually comes from
 * one of that computer's other tabs.
 */
import { describe, expect, it } from "vitest";
import { Replica } from "@/lib/crdt/replica";
import type { MergeReport, SessionState, WhiteboardSessionApi } from "@/lib/session/types";
import { buildMergeCardModel } from "../MergeCard";

describe("merge card attribution", () => {
  it("credits the author of the received edits, and still names the tabs we rejoined", () => {
    let t = 1;
    const now = () => ++t;
    const me = new Replica({ replica: "rme", label: "C", now });
    const author = new Replica({ replica: "rauthor", label: "B", now });
    author.transact((tx) => void tx.create({ type: "rect", props: { x: 0, y: 0, w: 1, h: 1 } }), { offline: true });
    const res = me.receive(author.opsSince({}));
    const report: MergeReport = {
      id: "m1",
      at: 1,
      direction: "rejoined",
      peers: ["rbridge", "rauthor"], // heard directly: the bridge; through it: the author
      vcBefore: {},
      vcAfter: me.getView().vc,
      receivedOpIds: res.applied.map((o) => o.id),
      sentCount: 1,
      changed: [],
      newConflicts: [],
      resurrected: [],
      apartMs: 3000,
    };
    const state = {
      replica: "rme",
      label: "C",
      peers: [
        { replica: "rbridge", label: "A" },
        { replica: "rauthor", label: "B" },
      ],
    } as unknown as SessionState;
    const session = { replica: me, getState: () => state } as unknown as WhiteboardSessionApi;
    const model = buildMergeCardModel(report, session)!;
    expect(model.title).toBe("Rejoined A and B after 3s");
    expect(model.facts.map((f) => f.text)).toContain("B brought 1");
    expect(model.facts.map((f) => f.text)).not.toContain("A and B brought 1");
  });
});
