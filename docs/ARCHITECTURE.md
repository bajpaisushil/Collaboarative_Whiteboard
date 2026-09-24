# Weave — architecture & contracts

Weave is an **offline-first collaborative whiteboard that explains its own merges**.
Every browser tab is an independent replica (a "user"). Tabs talk over
`BroadcastChannel` (optionally upgraded to WebRTC DataChannels). There is **no server
and no database**: the only source of truth is each replica's operation log, persisted
to the tab's own `sessionStorage` so a reload keeps the tab's identity and history.

The hero feature: select any conflict and Weave shows *exactly why* two concurrent
edits were resolved the way they were — vector-clock proof of concurrency, the causal
space-time diagram, the decision trace of the merge rules, a live convergence check,
and counterfactuals ("with wall clocks, B would have won"; "under delete-wins, the
shape would be gone").

This document is the contract every module is built against. Type-level contracts live
in `src/lib/crdt/types.ts`, `src/lib/sync/protocol.ts` and `src/lib/session/types.ts`.
If code and this doc disagree, fix one of them — never leave them diverged.

---

## 1. Layering

```
src/lib/crdt/      pure, framework-free CRDT engine (no DOM, no timers, deterministic)
src/lib/sync/      transports, network simulator, anti-entropy sync engine, presence
src/lib/session/   WhiteboardSession: glues replica + sync + persistence; React store
src/components/    React UI (client components only)
src/app/           Next.js App Router routes: `/` (board), `/split` (two replicas side by side)
```

Rules:
- `lib/crdt` imports nothing from `sync`, `session`, React, or the DOM. It must be
  deterministic: the only source of nondeterminism is injected (`idGen`, `now`).
- `lib/sync` depends on `crdt` types and the `Replica` public API only.
- UI depends on `session` (and on `crdt` types / pure helpers such as `explainConflict`).
- Everything is client-side. Routes render a client component loaded with
  `next/dynamic(..., { ssr: false })` from inside a `"use client"` wrapper.

---

## 2. Identity, clocks, operations

### 2.1 Identifiers
- `ReplicaId` — random, e.g. `r7k3x9q2` (8 chars, `[a-z0-9]`). Never reused. Used for
  tie-breaking (plain string comparison, `<`).
- `label` — display letter (`A`, `B`, `C`…) picked at startup as the smallest letter no
  live peer is using; display only, never used for ordering. Colour derives from label.
- `OpId` — `${replica}:${counter}` where `counter` is that replica's 1-based op sequence.
- `ShapeId` — `sh_${opId of the creating op}` (unique, deterministic).
- `CharId` — `${opId}.${index}` for the i-th character of a `text.insert` op.
- `TxnId` — `${replica}:t${n}`; groups the ops of one user action (the undo unit).

### 2.2 Lamport clock
Each replica keeps an integer `lamport`.
- Local op: `lamport = lamport + 1`; the op carries that value.
- Integrating any op (remote or local): `lamport = max(lamport, op.lamport)`.

Consequence (the Lamport property): if `a → b` (a happened-before b) then
`a.lamport < b.lamport`. So the **canonical order** `(lamport, replica)` is a total order
that is a linear extension of causality. Every prefix of the canonical order is a
consistent cut.

### 2.3 Vector clock
`VectorClock = Record<ReplicaId, number>` (missing entry = 0).
- A replica's clock `vc` counts, per replica, how many of its ops have been integrated.
- A local op increments `vc[self]`; the op carries a copy of the **full** vc *including
  itself* (`op.vc[op.replica] === op.counter`).
- `compare(a, b)` → `'equal' | 'before' | 'after' | 'concurrent'`
  (`before` ⇔ a ≤ b component-wise and a ≠ b).
- For ops: `x → y` ⇔ `x.vc ≤ y.vc` and x ≠ y ⇔ `x.counter <= y.vc[x.replica]`.
  `x ∥ y` (concurrent) ⇔ neither happened-before the other.

Lamport orders; vector clocks *detect concurrency*. Lamport alone cannot tell
"B saw A" from "B didn't see A" — that is exactly what the explainer demonstrates.

### 2.4 Operation envelope
```ts
Op = {
  id, replica, counter, lamport, vc,       // identity + causality
  meta: { txn, cause, wallTime, offline?, label?, undoes? },
  kind: 'shape.create' | 'shape.update' | 'shape.delete'
      | 'text.insert' | 'text.delete' | 'snapshot.mark',
  ...payload
}
```
`meta.wallTime` is **informational only** — never used for ordering. The explainer
contrasts it with Lamport order ("wall clocks lie"). `meta.offline` records whether the
authoring tab was offline when the op was made.

Payloads:
| kind            | payload                                                        |
|-----------------|----------------------------------------------------------------|
| `shape.create`  | `shapeId, shapeType, props` (complete `ShapeProps`)            |
| `shape.update`  | `shapeId, props` (partial; `{}` = keep-alive/restore)          |
| `shape.delete`  | `shapeId`                                                      |
| `text.insert`   | `shapeId, after: CharId \| null, text` (chars chain after each other) |
| `text.delete`   | `shapeId, chars: CharId[]`                                     |
| `snapshot.mark` | `snapshotId, name, shapes: ShapeView[]` (visible state at mark time) |

Ops are immutable once created and are JSON-serialisable.

---

## 3. The CRDT (document model)

The document is a map `ShapeId → ShapeRecord`. The state is a pure function of the
*set* of integrated ops: integrating the same set in any causally-valid order yields a
byte-identical `DocState` (checked by property tests and by the live state hash).

### 3.1 Per-property LWW registers
Each shape property (`x`, `y`, `w`, `h`, `points`, `stroke`, `fill`, `strokeWidth`,
`opacity`, `fontSize`, `z`) is an independent last-writer-wins register stamped with
`{opId, lamport, replica}`. A write replaces the register iff its stamp is greater in
canonical order `(lamport, replica)`. Because canonical order extends causality, a
causally-later write always wins; only **concurrent** writes are resolved by the
tie-break — and those are the conflicts we surface.

Different properties merge independently: A recolours while B moves → both apply.

### 3.2 Deletion: observed-remove, update-wins
A shape keeps two antichains (sets of maximal elements under happened-before):
`writers` (create/update/text ops, each with its vc) and `deletes` (delete ops + vc).

```
alive ⇔ ∃ w ∈ writers such that no d ∈ deletes has w.vc ≤ d.vc
```
A delete removes only what it has *observed*. An edit made concurrently with a delete
(e.g. offline) resurrects the shape: **update-wins**. Undo of a delete is simply a new
`shape.update {}` (causally after the delete → unobserved → alive).

Counterfactual policy used only by the explainer, never for real state:
`aliveDeleteWins ⇔ deletes = ∅ ∨ ∃ w ∈ writers dominating every d ∈ deletes`.

Registers survive deletion (a resurrected shape keeps its latest values).

### 3.3 Text: RGA sequence CRDT
`sticky` and `text` shapes carry an RGA. Each character is a node
`{id: CharId, ch, after, lamport, replica, opId, deleted}`.
- Insert: the op's chars form a chain: char 0 after `op.after`, char i after char i−1.
- Order: tree where each node's children are the nodes inserted `after` it; children are
  visited in **descending** `(lamport, replica)` order (newer inserts sit closer to their
  anchor); document order = pre-order DFS from the virtual root (`after = null`).
  Chars of one op share the op's lamport; they never compete (each has a unique parent).
- Delete: tombstone (`deleted = true`), idempotent. Inserting after a tombstone is legal.
- Local editing diffs old vs new visible text (common prefix/suffix) into at most one
  `text.delete` + one `text.insert` per keystroke.

### 3.4 Z-order
`z` is an LWW register (float). "Bring to front" sets `z = max(z)+1`. Render order is
`(z, shapeId)`.

### 3.5 State-based merge
`mergeDocs(a, b)` joins two `DocState`s: register-wise max stamp, antichain union of
writers/deletes, RGA node union (tombstone = OR), vc = pointwise max. It is used when a
peer is behind a compacted base (snapshot sync). Law (property-tested):
`mergeDocs(state(S1), state(S2)) ≡ state(S1 ∪ S2)`.

---

## 4. Operation log & causal delivery

`OpLog` stores every integrated op (deduplicated by `OpId`) with two views:
arrival order (local integration order) and canonical order.

`CausalBuffer` holds received ops whose dependencies are missing. An op `o` from `r`
is **ready** when `vc[r] === o.counter − 1` and `vc[k] ≥ o.vc[k]` for every `k ≠ r`.
Ready ops are integrated; the buffer re-checks until a fixpoint. Duplicates and
already-integrated ops are dropped. This makes the sync layer free to deliver
out-of-order, duplicated or lossy streams (the network simulator does all three).

`opsSince(vc)` returns the ops a peer with clock `vc` lacks
(`op.counter > vc[op.replica]`), in canonical order — always causally safe to apply.

---

## 5. Conflicts (deterministic, derived from the log)

Conflicts are a pure function of the log + doc, so every converged replica shows the
**same** conflict list with the same ids.

### 5.1 `concurrent-write`
For one shape, one property, and one pair of replicas (r1, r2): let S1, S2 be their
ops writing that property. A pair `(x ∈ S1, y ∈ S2)` is reported iff `x ∥ y`, `x` is the
latest op in S1 concurrent with `y`, and `y` is the latest op in S2 concurrent with `x`
("mutually maximal"). Pairs with the same `(x, y)` across properties are grouped into one
conflict with `props: PropKey[]`. `winner` = greater canonical stamp.
`status = 'live'` if the winner is still the register's current value for at least one
of those props, else `'superseded'` (someone later wrote over both, e.g. "adopt").

### 5.2 `delete-vs-edit`
Same mutual-maximality rule between a `shape.delete` and a keep-alive op (create/update/
text) from different replicas that are concurrent. Under update-wins the edit prevails:
`winner` = the edit. `live` while the shape is alive and the edit is still unobserved by
every delete.

### 5.3 `concurrent-text`
For one text shape: build a graph whose nodes are text ops and whose edges join
concurrent text ops from different replicas. Each connected component containing ≥2
replicas is one conflict (`ops` = all ops of the component). The explainer shows the
merged string coloured by author and, for every pair that inserted after the same
anchor, which went first and why.

Conflict ids are deterministic: `${kind}:${shapeId}:${sorted op ids joined by '|'}`
(for `concurrent-text`, the canonically-smallest op id of the component).

---

## 6. Explanations (the hero feature)

`explainConflict(conflict, ctx)` returns a fully structured `Explanation` (no UI strings
assembled in components beyond formatting):
1. `question` — auto-generated, e.g. "Why is the sticky note amber?".
2. `sides` — for each op: author label/colour, op id, lamport, vc, wall time, offline flag,
   the values it wrote (before/after), cause.
3. `vcProof` — row per replica: `a[r]`, `b[r]`, relation (`<`, `=`, `>`), plus verdict and
   the replicas each side had seen that the other hadn't.
4. `steps` — the decision trace. For writes: (1) same property? (2) causally ordered? (VC)
   (3) higher Lamport wins (4) replica-id tie-break (marked `skipped` if not needed).
   For delete-vs-edit: (1) did the delete observe the edit? (2) policy update-wins.
   For text: per-anchor sibling ordering rule.
5. `outcome` — winner, resulting value(s), what was discarded.
6. `convergence` — the engine actually re-materialises the affected shape with the two
   ops applied in both orders (A→B and B→A) on top of their common causal past and
   reports both hashes + `equal`.
7. `counterfactuals` — wall-clock order ("would have picked B"), delete-wins policy,
   "if B had synced first" (same result: order-independence), etc.
8. `causalPast` — op ids in each side's causal past, for highlighting in the space-time
   diagram.

---

## 7. Undo / redo (local, selective, compensating)

Undo never removes ops from the log; it emits **new** compensating ops (cause `undo`/`redo`)
in a new txn, so it merges like any other edit.
- The `UndoManager` records, for every local user txn, each op plus the values it
  overwrote (`prev`) captured at creation time.
- Undo of `shape.update` restores `prev[p]` for each prop `p` **only if the register's
  current winner was written by this replica**; if another replica wrote it since, `p` is
  skipped and reported ("Undo skipped fill — B changed it after you").
- Undo of `shape.create` → `shape.delete`. Undo of `shape.delete` → `shape.update {}`.
- Undo of `text.insert` → `text.delete` of those chars still visible. Undo of
  `text.delete` → `text.insert` of the same string anchored after the **last deleted
  char** (tombstone), which places it exactly where it was.
- Redo = undo of the undo txn. Any new user txn clears the redo stack.
- Remote ops never enter the local stacks.

---

## 8. Snapshots, checkpoints, compaction, time travel

- **Named snapshots** are ops (`snapshot.mark`) so every tab sees them. The payload holds
  the visible `ShapeView[]` at mark time, making preview/restore self-contained.
  *Restore* diffs current vs snapshot and emits one txn of ordinary ops (undoable,
  mergeable with concurrent edits).
- **Checkpoints** (internal): cached `DocState` every N ops of canonical order for fast
  time-travel; invalidated when an op lands before them (merges weave history).
- **Time travel**: the history ribbon scrubs the canonical order; every prefix is a
  consistent cut. The canvas becomes read-only while scrubbing.
- **Causal stability**: an op is *stable* when every known peer's vc covers it.
  The log view shades stable ops. `compact()` folds stable ops into `base: DocState` and
  drops them from the log (conflicts over compacted ops are marked "compacted").
  A peer whose vc does not cover `baseVc` is sent a `snapshot` message (full `DocState`)
  and merges it with `mergeDocs`.

---

## 9. Sync protocol (see `src/lib/sync/protocol.ts`)

Channel name: `weave:${room}` (room from `?room=`, default `lobby`).

| message      | when / purpose |
|--------------|----------------|
| `hello`      | on start and on every reconnect; carries vc, label, stateHash, instance nonce |
| `ops`        | live broadcast of new local ops; or targeted catch-up (`to`) |
| `sync-req`   | "send me what I lack" — carries requester vc |
| `snapshot`   | full DocState for a peer behind our compacted base |
| `heartbeat`  | every ~1.5 s: vc + stateHash (anti-entropy, stability, convergence badge) |
| `presence`   | cursor, in-progress stroke, drag preview, selection, editing target (~30 Hz, never logged) |
| `bye`        | tab closing |
| `rtc-*`      | WebRTC signalling (offer/answer/ice) when the WebRTC upgrade is on |

Anti-entropy: on any `hello`/`heartbeat`, if the peer lacks ops we have → send them
(targeted); if the peer has ops we lack → `sync-req`. Ops stuck in the causal buffer for
>2 s trigger a `sync-req`. This repairs drops, reordering, and offline gaps with one
mechanism.

**Offline** is a local switch in the network simulator: all traffic in and out is dropped
(not queued — the log *is* the queue). Going online sends `hello`; both sides exchange
what the other lacks; the session emits a **MergeReport** (ops received, new conflicts,
resurrections) that drives the reconnect animation.

**Network chaos** (simulator): latency, jitter, drop rate, duplicate rate — to show the
causal buffer and anti-entropy converge anyway.

**WebRTC upgrade**: BroadcastChannel is always used for discovery/signalling. If both
sides enable WebRTC, they negotiate an `RTCDataChannel` ("perfect negotiation"; the
replica with the smaller id is polite) and route that link's traffic over it; otherwise
fall back to BroadcastChannel. Each peer row shows its link transport.

**Duplicate tabs**: "Duplicate tab" copies `sessionStorage`, cloning a replica id. Each
tab instance has a random nonce; if a `hello` arrives with our replica id and a
different nonce, the instance with the greater nonce forks: new replica id, same log.
The old id is never used to author ops again by the forked tab.

**Convergence badge**: each heartbeat carries `stateHash` (hash of canonical DocState).
When our vc equals a peer's vc and hashes match → "Converged with B".

---

## 10. UI concept

- The whole tab is framed in the replica's colour ("You are Tab A"). Offline = animated
  hatched frame + "Diverging" banner with a count of unsynced ops.
- Top bar: identity, big Online/Offline switch (shortcut `\`), network-chaos popover,
  peers (status + link transport), live Lamport counter and vector clock chips,
  convergence badge with state hash.
- Left rail: select, pan, pen, rectangle, ellipse, arrow, sticky, text, eraser; colours,
  stroke width.
- Canvas (SVG): infinite pan/zoom, dot grid, remote cursors/strokes/drags/selections,
  conflict halos on shapes, ghost of the losing value when a conflict is selected,
  authorship-coloured text.
- Right "Lens" panel: **Conflicts** (list → Explainer), **Causality** (space-time diagram
  of the whole history), **Log** (virtualised op log: lamport, vc, kind, cause, buffered/
  stable badges), **Snapshots**.
- Bottom **History ribbon**: every op a tick in replica colour, conflicts as diamonds,
  snapshots as flags, offline stretches hatched; scrub = time travel.
- Reconnect → **Merge report** card: "Merged 9 ops from B · 2 conflicts · 1 resurrection
  → Explain".
- `/split`: two iframes (Tab A | Tab B) in one window on a fresh room, plus a scenario
  director that scripts classic conflicts.
