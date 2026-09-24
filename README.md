# Weave — the whiteboard that explains its merges

An **offline-first collaborative whiteboard** where every browser tab is a separate user.
Pull a tab's cable, keep drawing in both, plug it back in — and Weave merges everything
deterministically, then shows you **exactly why** each conflict was resolved the way it was.

No server. No database. Tabs talk over `BroadcastChannel`; each tab's operation log lives in
its own `sessionStorage`.

```
Tab A                    Tab B
  │                        │
  ├── draw ────────────────┤
  │                        │
  ├── offline              │
  │                        │
  │                     draw
  │                        │
  └─────── reconnect ──────┘
             ↓
   merge + "Why?" explainer
```

## Try it

```bash
npm install
npm run dev          # http://localhost:3000
```

- **Split view** — open `/split`: two users side by side in one window, plus a director's
  desk with scripted scenarios (colour clash, offline marathon, delete vs edit, typing
  together, move vs resize, undo after merge) and a 60-second guided tour.
- **Two real tabs** — open `/` and press **Open Tab B** (or open the same URL in a second
  tab). Unplug one tab with the cable switch (`\`), edit the same shape in both, plug back
  in, and click the knot.

## What's inside (all hand-written, no CRDT library)

| Requirement | Where | Notes |
|---|---|---|
| Operation log | `src/lib/crdt/oplog.ts` | Deduplicated, canonical `(lamport, replica, counter)` order, indexed by shape and replica; causal buffer for out-of-order delivery |
| Lamport clocks | `src/lib/crdt/replica.ts` | Tick on local ops, fast-forward on receipt; high-water mark kept in the document |
| Vector clocks | `src/lib/crdt/vector-clock.ts` | Detect concurrency (Lamport can't); O(1) happened-before via counters |
| CRDT merging | `src/lib/crdt/document.ts`, `rga.ts` | LWW registers (coupled geometry is one `bounds` register), observed-remove deletes (*update wins*), RGA text with observed-remove characters |
| Undo / redo | `src/lib/crdt/undo.ts` | Local, selective, compensating ops; never clobbers someone else's later or concurrent edit, and tells you what it skipped |
| Snapshots | `replica.ts` | Named snapshots are shared ops holding a causal cut; preview any cut; restore as ordinary (undoable, mergeable) edits; time travel over the canonical history |
| Conflict visualisation | `src/lib/crdt/conflicts.ts`, `explain.ts`, `src/components/why` | Deterministic conflicts (identical ids in every tab), knots on the canvas, ghosts of the losing value, and the explainer |
| Communication | `src/lib/sync` | BroadcastChannel + anti-entropy; a network simulator for offline, latency, jitter, drops, duplicates and clock drift |

### The explainer

Pick any knot and Weave answers the question in plain language first, then proves it:

1. **The verdict**: *"Why is this sticky note teal, not vermilion?"* with a filmstrip:
   before → A's version → B's version → result.
2. **Were they really simultaneous?** Seen-dots (vector clocks without the jargon) show
   which edits each side had seen.
3. **Who wins, and why?** The decision trace: same property → not causally ordered →
   higher Lamport counter wins → (tie) fixed replica-id coin toss.
4. **Would every tab agree?** The engine re-materialises the shape with the two edits applied
   in both orders and compares state fingerprints.
5. **What if…** Counterfactuals drawn as ghosts on the canvas: trust wall clocks (use the
   clock-drift slider to see why not), delete-wins, reversed tie-break, other arrival order.
6. **For engineers**: raw vector clocks, stamps and op JSON.

## Architecture

`docs/ARCHITECTURE.md` is the full design contract. The short version:

```
src/lib/crdt/     pure, deterministic CRDT engine (no DOM, no React)
src/lib/sync/     protocol, BroadcastChannel/in-memory transports, network simulator
src/lib/session/  WhiteboardSession: replica + sync + peers + presence + persistence + identity
src/components/   React UI (canvas, why/explainer, loom/history, app shell, split view)
src/app/          Next.js App Router: `/` (board) and `/split`
```

Hard cases it handles:
- **Duplicated tabs** (which copy `sessionStorage` and so the replica id): a Web Locks lease
  makes the copy fork to a new identity before it can author anything.
- **Reloads**: ops are written to storage *before* they're broadcast, so a reload never
  re-authors an op id.
- **React StrictMode and Fast Refresh**: a ref-counted session registry.
- **Hidden tabs** (throttled timers) show as idle, not gone, and re-sync when they become visible.

## Tests

```bash
npm test            # vitest: engine unit + fast-check property tests + session/sync
npm run typecheck
npm run lint
npm run build
npm run test:e2e    # Playwright: two real tabs (run `npm run build` first)
```

The property tests generate random 3-replica histories (creates, moves, resizes, recolours,
deletes, typing, erasing, undo/redo) with random partial, out-of-order, duplicated delivery.
They assert:
- all replicas converge to the same state hash and the same conflict list;
- incremental state equals a replay from scratch;
- the Lamport property holds;
- every explanation's order-independence check passes.

## Stack

Next.js 16 (App Router) · React 19.2 · TypeScript · Tailwind CSS 4 · zustand · motion ·
perfect-freehand · Vitest + fast-check · Playwright.
