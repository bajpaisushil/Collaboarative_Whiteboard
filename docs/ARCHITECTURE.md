# Weave — architecture & contracts

Weave is an **offline-first collaborative whiteboard that explains its own merges**.
Every browser tab is an independent replica (a "user"). Tabs on one computer talk over
`BroadcastChannel`; different computers pair directly over WebRTC with copy-paste codes. There
is **no server and no database**: the only source of truth is each replica's operation log, persisted
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
src/lib/sync/      protocol, BroadcastChannel + WebRTC transports, router, network simulator
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
| `text.undelete` | `shapeId, chars: CharId[]` (re-show exact chars: undo, snapshot restore) |
| `snapshot.mark` | `snapshotId, name, cut` (causal cut; state materialised on demand) |

Ops are immutable once created and are JSON-serialisable. Every op is sanitised at creation
(finite numbers, `-0 → 0`, coordinates rounded to 2 decimals, no `undefined` keys) and
JSON-cloned before it is integrated locally, so BroadcastChannel (structured clone), JSON
transports and `sessionStorage` all see byte-identical ops. Received ops are validated
structurally and dropped if malformed. A local op's counter is always `vc[self] + 1` and its
Lamport time `max(lamport, maxLamport) + 1`.

---

## 3. The CRDT (document model)

The document is a map `ShapeId → ShapeRecord`. The state is a pure function of the
*set* of integrated ops: integrating the same set in any causally-valid order yields a
byte-identical `DocState` (checked by property tests and by the live state hash).

### 3.1 LWW registers (coupled geometry is one register)
Each shape has last-writer-wins registers stamped with `{opId, lamport, replica}`:
`bounds` (`{x, y, w, h}` — coupled geometry, so a concurrent move and resize resolve
atomically instead of producing a shape neither user made), `points`, `stroke`, `fill`,
`strokeWidth`, `opacity`, `fontSize`, `z`. A write replaces the register iff its stamp is
greater in canonical order `(lamport, replica, counter)`. `Tx.update` fills missing bounds
fields from the current value and skips registers whose value would not change. Because canonical order extends causality, a
causally-later write always wins; only **concurrent** writes are resolved by the
tie-break — and those are the conflicts we surface.

Different properties merge independently: A recolours while B moves → both apply.

### 3.2 Deletion: observed-remove, update-wins
A shape keeps two antichains (sets of maximal elements under happened-before):
`writers` (create / update / text.insert / text.undelete — **not** text.delete, so a
concurrent backspace can't resurrect a deleted note) and `deletes`.

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
- Visibility is observed-remove, like shapes: each char has `shows` (its insert + any
  `text.undelete`) and `hides` (`text.delete`) antichains; visible ⇔ some show was not
  observed by any hide. Undo of a delete re-shows the *exact* chars (same ids, same place).
  Inserting after a hidden char is legal.
- Local editing derives edits from `beforeinput` (index-based `insertText` / `deleteText`);
  a prefix/suffix diff (`setText`) is the fallback for IME composition and paste-replace.

### 3.4 Z-order
`z` is an LWW register (float). "Bring to front" sets `z = max(z)+1`. Render order is
`(z, shapeId)`.

### 3.5 Determinism & the state hash
`applyOp` is an idempotent, monotone join; ShapeRecords are immutable values (replaced, never
mutated). `stateHash` = hash of the canonical JSON of every record (keys sorted, antichains
sorted by op id, zero vc entries omitted) plus the vc and Lamport high-water mark
(`DocState.maxLamport`). Equal vc + equal hash ⇒ converged; equal vc + different hash would
mean an identity collision and is shown as an alarm. Property tests check that random
multi-replica histories delivered in random causal orders (with duplicates) always produce
the same hash, the same conflicts, and an incremental state equal to a replay from scratch.

---

## 4. Operation log & causal delivery

`OpLog` stores every integrated op (deduplicated) in canonical order, indexed by shape and by
replica. An op is already integrated ⇔ `op.counter ≤ vc[op.replica]` (checked before the log);
a known id arriving with different content is reported as an identity collision.

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
Per anchor: two concurrent `text.insert` ops from different replicas that inserted right
after the same char (mutually maximal per replica pair). Only their relative order was
decided (newer first); both texts are kept. Typing elsewhere in the note is not a conflict.

Conflict ids are deterministic: `${kind}:${shapeId}:${opA}|${opB}` (text adds the anchor).
Because mutual maximality depends on which ops have arrived, an id can be *replaced* under
partial delivery (A's older op is superseded by A's newer one); `lineageKey`
(`kind:shape:replica pair:register|anchor`) is stable across that, and the UI re-resolves a
focused conflict by lineage. Conflicts also carry `txns` (to group "A's Move 10 shapes vs
B's Recolour 10 shapes" into one card), `valuesEqual` (benign) and `resolvedBy`.

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
6. `convergence` — the engine actually re-materialises the affected shape from
   `(↓a ∪ ↓b) \ {a, b}` (both causal pasts, so every anchor/create exists) and then applies
   the two ops in both orders, reporting both hashes + `equal`.
7. `counterfactuals` — wall-clock order ("would have picked B"), delete-wins policy,
   "if B had synced first" (same result: order-independence), etc.
8. `causalPast` — op ids in each side's causal past, for highlighting in the space-time
   diagram.

---

## 7. Undo / redo (local, selective, compensating)

Undo never removes ops from the log; it emits **new** compensating ops (cause `undo`/`redo`)
in a new txn, so it merges like any other edit. Entries record *semantic inverses*:
`props` (register, op id, value, prev), `kill`, `revive`, `text-hide`, `text-show`.
- Register restore is keyed on **op identity**: restore only if the op being undone still
  holds the register; the restored value is what the register would hold *without that op*
  (max-stamp write among the other ops). So a later or concurrent edit by someone else is
  never clobbered; it is skipped and reported ("skipped colour — B changed it after you").
- `kill` ⇄ `revive` (`shape.delete` ⇄ `shape.update {}`), `text-hide` ⇄ `text-show`
  (`text.delete` ⇄ `text.undelete` of the exact chars; chars someone else also deleted are
  skipped). Redo applies the recorded inverse of the inverse.
- Any new user txn clears the redo stack. Remote ops never enter the local stacks. A fork
  (duplicate tab) clears the stacks.

---

## 8. Snapshots, checkpoints, stability, time travel

- **Named snapshots** are ops (`snapshot.mark`) so every tab sees them. The payload is a
  causal cut (a vector clock, a few bytes); the state at that cut is materialised on
  demand. *Restore* diffs current vs snapshot state and emits one txn of ordinary ops —
  register writes, revives, deletes, and `text.delete`/`text.undelete` of exact chars —
  undoable and mergeable with concurrent edits.
- **Checkpoints** (internal): cached `DocState` every N ops of canonical order for fast
  time-travel; invalidated when an op lands before them (merges weave history).
- **Time travel**: scrubbing is anchored to an op id (the canonical prefix ending at it) so
  the frame doesn't jump when merges insert older ops; snapshot previews use causal cuts.
  Every prefix is a consistent cut. The canvas is read-only while scrubbing.
- **Causal stability**: an op is *stable* when every known replica's last vc covers it
  (shaded in the loom). Log compaction is intentionally not implemented: it would destroy
  the history that explanations are built from, and demo-scale logs are small.

---

## 9. Sync protocol (see `src/lib/sync/protocol.ts`)

Channel name: `weave:${room}` (room from `?room=`, default `lobby`).

| message      | when / purpose |
|--------------|----------------|
| `hello`      | on start and on every reconnect; carries vc, label, stateHash, instance nonce |
| `ops`        | live broadcast of new local ops; or targeted catch-up (`to`) |
| `sync-req`   | "send me what I lack" — carries requester vc |
| `heartbeat`  | every ~1.5 s: vc + stateHash + visibility (anti-entropy, stability, convergence badge) |
| `presence`   | cursor, in-progress stroke, drag preview, selection, editing target (~30 Hz, never logged) |
| `bye`        | tab closing |

Anti-entropy: on any `hello`/`heartbeat`, if the peer lacks ops we have → send them
(targeted, chunked), suppressing repeat pushes while an earlier one is still in flight. Ops
stuck in the causal buffer for >2 s trigger a `sync-req`. This repairs drops, reordering,
duplicates and offline gaps with one mechanism. Hidden tabs (throttled timers) report
`visible: false` and show as *idle*, not gone; a tab that becomes visible re-syncs.

**Offline** is a local switch in the network simulator: all traffic in and out is dropped
(not queued — the log *is* the queue). Going online sends `hello`; both sides exchange
what the other lacks. A **merge window** opens on reconnect (or when a peer returns) and
closes when clocks match; it emits one **MergeReport** per side (ops received, own ops
delivered, before/after of changed shapes, new conflicts, resurrections) that drives the
reconnect choreography in both tabs.

**Network chaos** (simulator): latency, jitter, drop rate, duplicate rate — to show the
causal buffer and anti-entropy converge anyway.

**Transports**: BroadcastChannel reaches the tabs on this computer (and the two in-process
panes of `/split`). **WebRTC DataChannels** reach other computers, paired without any server:
the inviter's offer and the invitee's answer travel as copy-paste codes (`W1.z.<base64url>` =
deflate-compressed session description with every ICE candidate — no trickle, so each side
hands over exactly one code; invite links carry it in the URL *fragment* so it never reaches
a server). A public STUN server only helps the two computers discover their addresses; no
board data passes through it (strict NATs may need a TURN server via `?ice=`). A `LinkRouter`
sends every message on every open path; all message types are idempotent, so a peer reachable
both ways is harmless, and replicas behind a link that aren't directly paired (the other
computer's other tabs) converge transitively through anti-entropy. The cable switch and
network chaos wrap the router, so "offline" cuts every path. Large messages are chunked and
reassembled; sends apply backpressure. If a link dies, edits keep working offline and merge
after re-pairing.

**Offline loading**: a service worker (production only, https/localhost) serves `/` and
`/split` network-first with a cached fallback, and `/_next/static` cache-first, so after one
online visit the app itself loads with no network.

**Identity**: before a session becomes `ready`, it takes a Web Locks lease
`weave:rid:<replicaId>` for its lifetime. "Duplicate tab" / `window.open` clones copy
`sessionStorage` (and so the replica id); the clone can't get the lease and forks — new
replica id and label, same log, cleared undo stacks — before authoring anything. Without
Web Locks, a per-instance nonce on every message is the fallback. Local ops are persisted
synchronously *before* they are broadcast (write-ahead), so a reload can never re-author an
op id with different content. Sessions live in a `globalThis` registry with refcounts, so
React StrictMode double-mounts and Fast Refresh never create two live sessions for one
(room, pane). Storage is namespaced per pane (`weave:v2:<room>:<pane>`), so the two panes of
`/split` (one document, one sessionStorage) never share state.

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
- `/split`: two independent sessions (Tab A | Tab B) in one window on a fresh room, with a
  director's "seam" between them: live divergence counters, scripted scenarios, a guided
  tour, and the shared explainer.
