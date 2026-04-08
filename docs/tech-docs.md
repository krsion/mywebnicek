# Technical Documentation

**Project**: MyDenicek — Local-First Collaborative Document Editor  
**Course**: NPRG070, Charles University, Faculty of Mathematics and Physics  
**Author**: Bc. Ondřej Krsička  
**Supervisor**: Mgr. Tomáš Petříček, Ph.D.  
**Repositories**:
- Core engine: [krsion/mydenicek-core](https://github.com/krsion/mydenicek-core) — published on JSR as `@mydenicek/core`
- Web application: [krsion/MyDenicek](https://github.com/krsion/MyDenicek)

---

## 1. Abstract

MyDenicek is a local-first collaborative document editor that enables real-time co-editing of tagged document trees with automatic conflict resolution. The project extends the original Denicek system — a computational substrate for document-oriented end-user programming — with a production-quality implementation that supports offline editing, undo/redo, recording/replay of editing sessions, and a formula engine for computed values.

The core contribution is a **custom OT-based event DAG** that achieves strong eventual consistency without relying on third-party CRDT libraries. Each peer records edits as events in a causal directed acyclic graph ordered by vector clocks, with hand-written operational transformation rules for structural edits (rename, wrap, unwrap, delete, copy). Deterministic topological replay ensures that all peers converge to the same document state regardless of event delivery order. The approach is validated through property-based convergence testing and a standalone random fuzzer.

The system is split into two repositories: `mydenicek-core` (a pure TypeScript CRDT engine with zero external dependencies) and `MyDenicek` (a React 19 + Fluent UI web application providing the user-facing editor). Both repositories are open-source and deployed live.

---

## 2. Introduction

### 2.1 Purpose

This document provides a comprehensive technical description of the MyDenicek system: its architecture, design decisions, algorithms, testing strategy, and deployment. It is written for reviewers and researchers familiar with distributed systems, CRDTs, and collaborative editing.

### 2.2 Scope

The documentation covers:
- The `@mydenicek/core` library (CRDT engine, document model, edit operations, formula engine)
- The `@mydenicek/sync-server` package (WebSocket sync protocol)
- The `MyDenicek` web application (React UI, Loro-based CRDT integration)
- Testing methodology (unit tests, property-based tests, random fuzzer, Playwright E2E)
- Deployment (Azure App Service, GitHub Pages, CI/CD)

### 2.3 Background — Original Denicek System

MyDenicek builds upon the Denicek system described in:

> Petříček, T. "Denicek: Computational Substrate for Document-Oriented End-User Programming." UIST 2025. [DOI: 10.1145/3746059.3747646](https://doi.org/10.1145/3746059.3747646)  
> Project page: [https://tomasp.net/academic/papers/denicek/](https://tomasp.net/academic/papers/denicek/)

The original Denicek defines:
- A **tagged document tree** where nodes are records (named fields), lists (ordered children), primitives (scalar values), and references (pointers to other nodes).
- A **selector language** for addressing nodes via slash-separated paths with wildcard (`*`) expansion.
- **Operational transformation** for resolving concurrent structural edits.
- **Programming by demonstration** where user edits are recorded and replayed as generalized scripts.

MyDenicek's core engine is a faithful reimplementation of this architecture adapted for a causal DAG (rather than a linear OT log), with added support for undo/redo, formula evaluation, reference integrity, and event graph compaction.

---

## 3. System Overview

### 3.1 Two-Repository Architecture

The project is split into two independent repositories with complementary roles:

**mydenicek-core** (`@mydenicek/core` on JSR)  
A pure TypeScript CRDT engine with zero external runtime dependencies. It implements the event DAG, document model, edit operations, operational transformation, undo/redo, formula engine, and sync protocol. It is published on the JSR (JavaScript Registry) and can be consumed by any Deno, Node.js, or browser application.

**MyDenicek** (web application)  
A React 19 monorepo that provides a polished collaborative document editor. It uses Loro CRDTs (via `loro-crdt` v1.9.0) as its internal CRDT substrate and wraps them with a `DenicekDocument` class that hides Loro internals behind a clean TypeScript API. The UI is built with Fluent UI v9 components and deployed to GitHub Pages.

> **Note on the two CRDT approaches**: The two repositories implement different CRDT strategies. The core engine (`mydenicek-core`) uses a custom OT-based event DAG with path-based selectors — a direct descendant of the original Denicek paper's architecture. The web application (`MyDenicek`) uses Loro CRDTs with ID-addressed nodes — the approach originally prescribed by the project specification. This dual implementation is itself a research contribution: it allows comparison of both approaches and demonstrates the trade-offs between OT-based and pure-CRDT architectures for document-oriented editing. See Section 5.1 for a detailed comparison.

### 3.2 Technology Stack

| Component | mydenicek-core | MyDenicek (UI) |
|---|---|---|
| **Runtime** | Deno 2.x | Node.js (npm workspaces) |
| **Language** | TypeScript (strict) | TypeScript ~5.9.3 (strict) |
| **CRDT strategy** | Custom OT-based event DAG | Loro CRDTs (loro-crdt v1.9.0) |
| **UI framework** | — | React 19.2 + Fluent UI v9.72 |
| **Build tool** | Deno workspaces | Vite (rolldown-vite v7.2.2) |
| **Testing** | Deno test + fast-check | Vitest + Playwright 1.57 |
| **Linting** | deno lint + deno fmt | ESLint 9 + typescript-eslint |
| **Package registry** | JSR (`jsr:@mydenicek/core`) | npm (private workspace) |
| **Sync server** | Deno HTTP + WebSocket | Node.js + WebSocket + Azure Blob Storage |
| **Deployment** | JSR publish | GitHub Pages (app), Azure App Service (sync server) |

### 3.3 Main Features

1. **Collaborative editing** — Multiple peers edit the same document concurrently. Edits are recorded as events in a causal DAG and converge deterministically.
2. **Conflict resolution** — Concurrent structural edits (rename, wrap, delete) are resolved via operational transformation. Value conflicts use deterministic replay order (effectively last-writer-wins by topological position).
3. **Undo/redo** — Every edit type has a `computeInverse(preDoc)` method. Undo appends the inverse as a regular DAG event, ensuring remote peers converge on the undone state automatically.
4. **Recording/replay** — User edits produce stable event IDs that can be stored and replayed. Replay walks the full causal history, transforming the replayed edit through every later structural change (renamed, wrapped, or reindexed targets).
5. **Formula engine** — Formula nodes (tagged records with `$tag` starting with `"x-formula"`) support 15 built-in operations (sum, product, concat, etc.) with `$ref` argument resolution, nested evaluation, cycle detection, and extensibility via `registerFormulaOperation()`.
6. **Offline-first** — The event DAG naturally supports offline editing. Events are buffered locally and synced when connectivity returns.
7. **Reference integrity** — References (`{ $ref: "path" }`) are automatically rewritten during structural edits and validated against missing targets.
8. **Event graph compaction** — The DAG can be compacted once all peers acknowledge the current frontier, collapsing history into a new initial document.

---

## 4. Architecture & Design

### 4.1 CRDT Approach: OT-based Event DAG

The `mydenicek-core` engine achieves strong eventual consistency through three mechanisms:

1. **Causal DAG with vector clocks**: Each event stores a `VectorClock` — a `Record<string, number>` mapping peer IDs to sequence numbers. The clock's `dominates(other)` method determines causal ordering: if `A.clock.dominates(B.clock)`, then A happened after B. Two events are concurrent if neither clock dominates the other.

2. **Deterministic topological replay**: The `EventGraph.computeTopologicalOrder()` method uses Kahn's algorithm with a `BinaryHeap` tie-breaker (sorted by `EventId.compareTo`, which orders lexicographically by peer then by sequence number). This produces a unique total order from any partial order, ensuring all peers materialize the same document.

3. **Operational transformation on selectors**: During replay, each event's edit is resolved against all previously applied concurrent edits via `Event.resolveAgainst(applied, doc)`. For each concurrent prior edit, the current edit's selector is transformed through the prior's structural change. If transformation removes the target entirely, the edit becomes a `NoOpEdit` (surfaced as a conflict).

This differs from pure CRDTs (Automerge, Loro, Yjs) in a fundamental way: rather than encoding each operation as a CRDT operation that commutes by construction, edits are standard imperative mutations that are made to commute through explicit transformation rules. This aligns with the original Denicek paper and gives precise control over how structural edits interact.

**Key classes:**

| Class | File | Responsibility |
|---|---|---|
| `Denicek` | `core/denicek.ts` | Public API: editing, undo/redo, sync, formulas |
| `EventGraph` | `core/event-graph.ts` | Stores events, computes topological order, materializes document |
| `Event` | `core/event.ts` | Holds ID, parents, edit, clock; resolves against concurrent edits |
| `VectorClock` | `core/vector-clock.ts` | Tracks causality; `dominates`, `merge`, `tick` |
| `EventId` | `core/event-id.ts` | Peer + sequence number; deterministic `compareTo` |
| `Edit` (abstract) | `core/edits/base.ts` | Base class: `apply`, `transformSelector`, `computeInverse`, `withTarget` |
| `Selector` | `core/selector.ts` | Path parsing, wildcard matching, index shifting |

### 4.2 Document Model

The document is a tree of four node types:

| Node Type | Class | Plain representation | Description |
|---|---|---|---|
| **Record** | `RecordNode` | `{ $tag: "...", field: value, ... }` | Tagged object with named fields |
| **List** | `ListNode` | `{ $tag: "...", $items: [...] }` | Tagged array of ordered children |
| **Primitive** | `PrimitiveNode` | `string \| number \| boolean` | Scalar leaf value |
| **Reference** | `ReferenceNode` | `{ $ref: "path" }` | Pointer to another node via selector |

**Selectors** address nodes via slash-separated paths:

| Pattern | Meaning | Example |
|---|---|---|
| `"title"` | Direct field access | Root's `title` field |
| `"items/0/name"` | Nested path with list index | First item's name |
| `"items/*/status"` | Wildcard | All items' status fields |
| `"!0"` | Strict index | Position 0, not shifted by concurrent inserts |
| `".."` | Parent navigation | Used in relative references |

The `Selector` class (`core/selector.ts`) parses paths, matches prefixes (accounting for wildcard/index equivalence), and shifts numeric indices for list operations. Field names are validated to exclude reserved segments (`*`, `..`, canonical integers, strict indices).

### 4.3 Component Architecture

#### Core Library (`mydenicek-core`)

```
packages/core/
├── core.ts              # Public API exports
├── core/
│   ├── denicek.ts       # Denicek class (peer entry point)
│   ├── event-graph.ts   # Event DAG: store, order, materialize
│   ├── event.ts         # Event: id, parents, edit, clock, resolve
│   ├── event-id.ts      # EventId: peer + seq
│   ├── vector-clock.ts  # VectorClock: causality tracking
│   ├── selector.ts      # Selector: path parsing, matching, shifting
│   ├── formula-engine.ts # Formula evaluation, operation registry
│   ├── nodes.ts         # Re-exports all node types
│   ├── nodes/
│   │   ├── base.ts          # Abstract Node class
│   │   ├── record-node.ts   # RecordNode
│   │   ├── list-node.ts     # ListNode
│   │   ├── primitive-node.ts # PrimitiveNode
│   │   ├── reference-node.ts # ReferenceNode
│   │   ├── from-plain.ts    # Node.fromPlain() factory
│   │   └── plain.ts         # Plain type definitions
│   └── edits/
│       ├── base.ts          # Abstract Edit, NoOpEdit, CompositeEdit
│       ├── record-edits.ts  # RecordAddEdit, RecordDeleteEdit, RecordRenameFieldEdit
│       ├── list-edits.ts    # ListPushBack/Front, ListPopBack/Front
│       ├── tree-edits.ts    # UpdateTagEdit, WrapRecordEdit, WrapListEdit, CopyEdit
│       ├── unwrap-edits.ts  # UnwrapRecordEdit, UnwrapListEdit (inverse of wrap)
│       └── value-edits.ts   # ApplyPrimitiveEdit (with extensible primitive edit registry)
├── tests/
│   ├── core/                # 8 unit test files
│   ├── formative/           # 6 domain scenario tests
│   └── core-properties.test.ts  # Property-based convergence tests
└── tools/
    └── core-random-fuzzer.ts    # Standalone random fuzzer
```

#### Sync Server (`@mydenicek/sync-server`)

```
packages/sync-server/
├── mod.ts         # Package entry point
├── server.ts      # createSyncServer(): Deno HTTP + WebSocket
├── room.ts        # SyncRoom: per-room Denicek peer for event relay
├── client.ts      # SyncClient: WebSocket client with auto-sync
├── protocol.ts    # Message types (hello, sync request/response, error)
└── tests/         # Sync protocol tests
```

#### React Integration (`@mydenicek/react` in MyDenicek repo)

```
packages/mydenicek-react/
├── src/
│   ├── DenicekProvider.tsx    # React context provider
│   ├── useDenicekDocument.ts  # Document read/write hooks
│   ├── useSelection.ts       # Node selection management
│   ├── useFormulaViewMode.ts  # Formula display mode
│   └── constants.ts           # Shared constants
```

#### Web Application (`mywebnicek` in MyDenicek repo)

```
apps/mywebnicek/
├── src/                # React 19 + Fluent UI application
├── tests/              # 5 Playwright E2E test files
└── playwright.config.ts
```

### 4.4 Specification Divergence

The original project specification prescribed Loro CRDTs as the synchronization substrate. The `mydenicek-core` implementation diverged to a custom OT-based event DAG. Key divergences:

| Aspect | Specification | Implementation | Justification |
|---|---|---|---|
| **CRDT substrate** | Loro (Rust/WASM) | Custom OT event DAG | Denicek's selector-based editing model maps naturally to OT; Loro's ID-based addressing requires a translation layer |
| **Node addressing** | Unique IDs (`TreeID`) | Path-based selectors | Selectors are the native addressing mode in the Denicek paper; wildcards and relative paths are first-class |
| **Text editing** | `LoroText` with splice | Atomic value replacement | Character-level CRDT not implemented; primitives are replaced whole |
| **Undo/redo** | Loro's undo manager | Inverse events in the DAG | Custom approach: each `Edit` computes its own inverse; inverses are regular events that sync automatically |
| **Runtime** | Node.js + npm | Deno 2.x | Built-in TypeScript, formatter, linter, test runner |
| **Dependencies** | Loro (2 MB WASM) | Zero external CRDT deps | Pure TypeScript; no WASM compatibility concerns |
| **Package registry** | npm | JSR | Deno-native registry with first-class TypeScript support |

The MyDenicek web application repository still uses Loro CRDTs, making it possible to compare both approaches empirically. See the [specification divergence document](https://github.com/krsion/mydenicek-core/blob/main/docs/specification-divergence.md) for a requirement-by-requirement mapping.

---

## 5. Key Design Decisions

### 5.1 OT-based Event DAG vs Pure CRDTs

The most significant architectural decision was choosing an OT-based event DAG over pure CRDTs (Loro, Automerge). The rationale:

1. **Selector-based programming model**: The Denicek editing model addresses nodes by path selectors (`"items/*/status"`). In a CRDT like Loro, nodes are addressed by opaque unique IDs (`TreeID`). Mapping selectors onto IDs requires a translation layer that hides the tree CRDT's actual semantics. With the custom OT approach, selectors are the native addressing mode.

2. **Structural edit transformation**: Denicek supports structural edits (rename fields, wrap nodes, update tags) that rewrite the tree's shape. These are not natively modeled by Loro containers. The original Denicek paper achieves convergence through OT on these structural edits — hand-written transformation rules that rewrite concurrent selectors. A custom event DAG gives precise control over these rules.

3. **Replay and retargeting**: The `resolveReplayEdit()` method walks the full causal history, transforming a replayed edit's selector through every later structural change. This exact retargeting is central to the Denicek's programming-by-demonstration model and has no equivalent in Loro's event system.

4. **Convergence provability**: Deterministic topological replay with explicit `resolveAgainst()` OT means convergence is provable from the edit transformation rules alone. The property-based tests and random fuzzer verify this empirically across thousands of concurrent edit scenarios.

5. **Zero dependencies**: The core library is pure TypeScript with no WASM, no native modules, and trivial bundle size. This eliminates the browser compatibility risks flagged in the specification.

### 5.2 Selector-based Addressing

Selectors are ordered paths of segments (`SelectorSegment = string | number`):

**Parsing** (`Selector.parse`): Slash-separated strings are parsed into segment arrays. Canonical non-negative integers become `number` segments (list indices). `*` and `..` are reserved string segments. Strict indices (`!0`, `!1`, ...) are string segments that preserve their coordinate across concurrent insertions (unlike dynamic indices that shift).

**Wildcard expansion**: When a list node encounters a `*` segment during navigation, it returns all children. This enables batch edits like `doc.set("items/*/done", true)` that target every item's `done` field in a single event.

**Prefix matching** (`Selector.matchPrefix`): Determines whether one selector is a prefix of another, accounting for wildcard-index equivalence. Used by OT to determine whether a structural edit affects a concurrent edit's target.

**Index shifting** (`Selector.shiftIndex`): When a concurrent list operation inserts or removes an item, later selectors that traverse the same list must shift their indices. The `shiftIndex` method adjusts numeric segments above a threshold by a delta. Strict indices (`!n`) are exempt from shifting.

### 5.3 Conflict Resolution Strategy

Conflict resolution operates at two levels:

**Structural conflicts (OT)**: Each structural edit type implements `transformSelector(sel: Selector): SelectorTransform`, which returns either a rewritten selector (`{ kind: "mapped", selector }`) or a removal signal (`{ kind: "removed" }`). During replay, `Event.resolveAgainst()` transforms the current edit's selector through every concurrent prior edit's transformation. If any transformation removes the selector, the edit becomes a `NoOpEdit` surfaced as a conflict node.

Examples of structural conflict resolution:
- **Concurrent rename + edit**: If Alice renames field `"name"` to `"title"` while Bob edits `"name"`, Bob's edit is retargeted to `"title"`.
- **Concurrent wrap + edit**: If Alice wraps `"x"` in a record as `"x/inner"` while Bob edits `"x"`, Bob's edit is retargeted to `"x/inner"`.
- **Concurrent delete + edit**: If Alice deletes `"x"` while Bob edits `"x"`, Bob's edit becomes a `NoOpEdit` (conflict).
- **Concurrent list insert + index reference**: If Alice pushes to `"items"` while Bob references `"items/2"`, Bob's index is shifted to account for Alice's insertion.

**Value conflicts (deterministic replay order)**: Concurrent primitive value edits to the same path are applied in topological order. The last edit in the deterministic ordering wins. This is effectively last-writer-wins with a deterministic definition of "last" (the EventId-based tie-breaking in Kahn's algorithm).

**Reference integrity**: Edits that would remove a node targeted by a `$ref` are blocked with a `ProtectedTargetError`. Edits that insert references to non-existent targets are blocked with a `MissingReferenceTargetError`. After concurrent transformation, these checks are re-validated; violations become `NoOpEdit` conflicts.

### 5.4 Compound Operation Decomposition

A key design insight (documented in detail in [`docs/design/compound-operation-decomposition.md`](https://github.com/krsion/MyDenicek/blob/main/docs/design/compound-operation-decomposition.md)) is that **compound operations cannot be atomic in local-first software**.

The "wrap" operation illustrates this: `wrap(X, tag)` is secretly `add(wrapper) + move(X, wrapper)`. When two peers concurrently wrap the same node, both wrappers are created (creates never conflict) but only one move wins (LWW). The losing peer's wrapper becomes an empty orphan. This orphan is **observationally indistinguishable** from a legitimately created empty node, making automatic cleanup impossible.

This impossibility follows from the **CAP theorem**: local-first software requires partition tolerance and availability (AP), but transactions require strong consistency (CP). By the **CALM theorem**, detecting transaction failure requires coordination (non-monotonic reasoning), which is unavailable during partitions.

**Solution in mydenicek-core**: Wrap operations (`wrapRecord`, `wrapList`) are implemented as single atomic events that create the wrapper and reparent the child in one step within the event DAG. The OT rules handle concurrent wraps explicitly. This works because the OT layer can reason about the combined structural change, unlike a CRDT that must decompose into independent operations.

**Solution in MyDenicek (UI)**: Wrap is decomposed into explicit `addChild` + `move` primitives. The user performs two visible steps, making the conflict behavior transparent.

### 5.5 Formula Engine

The formula engine (`core/formula-engine.ts`) evaluates computed values within the document tree.

**Formula nodes** are tagged records with `$tag` starting with `"x-formula"`, an `operation` field (string), and an `args` field (a list node). Example:

```json
{
  "$tag": "x-formula",
  "operation": "sum",
  "args": { "$tag": "args", "$items": [{ "$ref": "../a" }, { "$ref": "../b" }] }
}
```

**Evaluation**: `evaluateFormulaNode()` resolves each argument — primitives pass through, `$ref` arguments are resolved against the document tree (supporting wildcards for multi-value expansion), and nested formula nodes are evaluated recursively. Cycle detection uses a `visiting: Set<string>` path set. Max recursion depth is 100.

**15 built-in operations**: `sum`, `product`, `mod`, `round`, `floor`, `ceil`, `abs`, `concat`, `uppercase`, `lowercase`, `capitalize`, `trim`, `length`, `replace`, `countChildren`.

**Extensibility**: `registerFormulaOperation(name, fn)` allows custom operations. The `Denicek.recomputeFormulas()` method evaluates all formulas and writes results back into the document as regular edit events.

---

## 6. Implementation Details

### 6.1 Event Graph

The `EventGraph` class manages the core data structures:

**Storage**: Events are stored in a `Map<string, Event>` keyed by formatted event IDs (`"peer:seq"`). The frontier (set of events with no children) is maintained as a sorted `EventId[]` array.

**Event creation** (`createEvent`):
1. The new event's parents are the current frontier IDs.
2. A new `VectorClock` is created by merging all parent clocks and ticking the local peer's component.
3. The event is validated against the causal state (the edit must be applicable to the document materialized at the parent frontier).
4. The event is inserted, updating the frontier.

**Topological ordering** (`computeTopologicalOrder`):
1. Compute the causal past from the frontier (all ancestor events reachable by parent traversal).
2. Build in-degree counts and child adjacency lists.
3. Run Kahn's algorithm with a `BinaryHeap` priority queue ordered by `EventId.compareTo` (lexicographic peer, then sequence number).
4. This produces a deterministic total order from any DAG shape, ensuring all peers agree on replay sequence.

The topological order is cached (`cachedOrder`) and invalidated when new events are inserted.

**Materialization** (`materialize`):
1. Clone the initial document.
2. Iterate through the topological order.
3. For each event, call `event.resolveAgainst(applied, doc)` to transform it through concurrent predecessors.
4. If the result is a `NoOpEdit`, record it as a conflict; otherwise, apply it and record as applied.
5. Return the document and conflict list.

**Out-of-order ingestion** (`ingestEvents`):
Remote events may arrive out of causal order. The ingestion pipeline:
1. Merge incoming events with the existing buffer, deduplicating by ID.
2. For each pending event, count missing parents and identify causally ready events.
3. Insert ready events (those whose parents are all known), decrementing dependents.
4. Remaining events stay buffered (max 10,000).

**Compaction** (`compact`):
When all peers have acknowledged the current frontier, the DAG can be collapsed:
1. Verify provided frontiers match the current frontier exactly.
2. Verify no out-of-order events are buffered.
3. Materialize the current document.
4. Replace the initial document with the materialized state.
5. Clear all events, frontiers, and caches.

### 6.2 Operational Transformation

OT is implemented via two abstract methods on `Edit`:

**`transformSelector(sel: Selector): SelectorTransform`** — Given a selector from a concurrent edit, returns either the rewritten selector or a removal signal. Each structural edit type implements this differently:

- **`RecordRenameFieldEdit`**: If the selector traverses the renamed field, the field segment is rewritten to the new name. If the new name already existed as a different field, the selector is removed (the concurrent edit's target was overwritten).

- **`RecordDeleteEdit`**: If the selector's prefix matches the deleted path, the selector is removed.

- **`WrapRecordEdit`**: If the selector matches the wrapped target, an extra segment (the wrapper's field name) is inserted after the target prefix. This retargets concurrent edits into the new wrapper.

- **`WrapListEdit`**: Similar to wrap-record but inserts an index `0` (the wrapped node becomes the sole item in a new list).

- **`UnwrapRecordEdit`** / **`UnwrapListEdit`**: The inverse of wrap. If the selector traverses the unwrapped wrapper's interior, the wrapper segment is removed. Used by undo.

- **`ListPushBackEdit`** / **`ListPushFrontEdit`**: Shifts concurrent numeric indices in the same list. Push-front shifts all indices up by 1; push-back does not shift (new item is at the end).

- **`ListPopBackEdit`** / **`ListPopFrontEdit`**: Shifts concurrent indices down and removes any selector pointing at the removed position.

- **`CopyEdit`**: The most complex transformer. When a concurrent edit targets a node that was copied, the copy edit produces a `CompositeEdit` containing both the original edit and a mirrored edit targeting the copy destination. This "managed copy" ensures that concurrent changes to the original propagate to the copy.

**`resolveAgainst(applied, doc)`** on `Event`:
For each previously applied event that is concurrent with the current event (neither clock dominates the other), the current edit is transformed through the prior's `transformLaterConcurrentEdit()`. After all transformations, if the edit cannot be applied to the current document state, it becomes a `NoOpEdit`.

### 6.3 Undo/Redo

Undo/redo is implemented as a peer-local stack of event IDs:

**Undo** (`Denicek.undo()`):
1. Pop the most recent event ID from `undoStack`.
2. Materialize the document at the event's parent frontier (the state just before the edit).
3. Call `event.edit.computeInverse(preDoc)` to produce the inverse edit.
4. Commit the inverse edit as a new event in the DAG.
5. Push the original event ID onto `redoStack`.

**Redo** (`Denicek.redo()`):
1. Pop from `redoStack`.
2. Commit the original edit again as a new event.
3. Push onto `undoStack`.

**Inverse edits** are defined for every edit type:
- `RecordAddEdit` → `RecordDeleteEdit`
- `RecordDeleteEdit` → `RecordAddEdit` (with the deleted subtree cloned from pre-edit state)
- `RecordRenameFieldEdit` → `RecordRenameFieldEdit` (with swapped from/to)
- `WrapRecordEdit` → `UnwrapRecordEdit`
- `WrapListEdit` → `UnwrapListEdit`
- `ListPushBackEdit` → `ListPopBackEdit`
- `ListPushFrontEdit` → `ListPopFrontEdit`
- `ApplyPrimitiveEdit("set")` → `ApplyPrimitiveEdit("set")` with the old value
- `UpdateTagEdit` → `UpdateTagEdit` with the old tag

Because inverse events are regular DAG events, they synchronize to remote peers automatically. All peers converge on the undone state through normal replay.

### 6.4 Sync Protocol

The sync protocol uses WebSocket connections with a simple message-based protocol:

**Message types** (defined in `packages/sync-server/protocol.ts`):

| Message | Direction | Fields | Purpose |
|---|---|---|---|
| `hello` | Server → Client | `roomId` | Confirms connection, triggers initial sync |
| `sync` (request) | Client → Server | `roomId`, `frontiers`, `events` | Sends local events and declares known frontier |
| `sync` (response) | Server → Client | `roomId`, `frontiers`, `events` | Returns events unknown to the client |
| `error` | Server → Client | `message` | Error notification |

**Server architecture** (`packages/sync-server/server.ts`):
- Room-based isolation: each document has a `roomId`. Clients connect to `ws://host/sync?room=<id>`.
- Each room maintains a `SyncRoom` — a headless `Denicek` peer (`room-<id>`) that ingests all events.
- On receiving a `sync` request: ingest the client's events into the room peer, compute events since the client's frontier, respond with those events.
- Broadcast: after responding to the originating client, forward new events to all other connected clients in the same room.
- Persistence: events are serialized to JSON files (one per room). Writes are queued sequentially with atomic rename to prevent corruption.

**Client architecture** (`packages/sync-server/client.ts`):
- `SyncClient` manages a WebSocket connection with configurable auto-sync interval (default: 1000ms).
- `syncNow()` creates a sync request using the client's current frontier and known server frontiers, then sends it.
- On receiving a sync response, the client applies remote events via `Denicek.applyRemote()` and updates its known server frontiers.
- `onRemoteChange` callback allows the UI to react to incoming changes.

**Incremental sync**: The `eventsSince(remoteFrontiers)` method computes the causal past of the current frontier, subtracts the causal past of the remote frontiers, and returns only the difference. This ensures each sync exchange transfers only new events.

### 6.5 Recording & Replay

Recording and replay implement the Denicek paper's "programming by demonstration" model:

**Recording**: Every `Denicek.commit()` call returns the formatted event ID (`"peer:seq"`) of the newly created event. Application code can store these IDs as a "recording" — a sequence of edit steps.

**Replay** has three modes:

1. **`replayEditFromEventId(eventId, target)`** — Explicit retargeting: takes the edit from an existing event and applies it to a different selector. The caller chooses the new target.

2. **`repeatEditFromEventId(eventId)`** — Automatic retargeting: replays the edit at its original selector, but transformed through all later structural changes in the DAG. This handles renamed, wrapped, or reindexed targets automatically.

3. **`repeatEditsFrom(target)`** — Batch replay: reads a list of `{ eventId: string }` records from the document tree and replays them all. All source edits are resolved before any are committed, so multi-step structural recipes replay correctly without interfering with each other.

**Retargeting algorithm** (`EventGraph.resolveReplayEdit`):
1. Replay the full topological order up to the source event, collecting all applied edits.
2. At the source event, capture the resolved edit (after concurrent OT).
3. Continue replaying subsequent events. For each structural edit after the source, transform the captured edit through it.
4. The final transformed edit accounts for all structural changes between the original recording and the current document state.

---

## 7. Testing Strategy

### 7.1 Unit Tests

The core library has **8 unit test files** in `packages/core/tests/core/`:

| File | Coverage |
|---|---|
| `basic.test.ts` | Document creation, field operations, list operations, serialization |
| `concurrency.test.ts` | Two-peer and three-peer concurrent edits, all structural conflict types |
| `copy-and-tags.test.ts` | Copy edit semantics, managed-copy OT, tag operations |
| `errors-and-replay.test.ts` | Error conditions, event replay, retargeting |
| `selectors-and-references.test.ts` | Selector parsing, wildcard expansion, reference resolution, reference integrity |
| `undo-redo.test.ts` | 39 tests covering undo/redo for all edit types, multi-peer convergence |
| `formula-engine.test.ts` | 41 tests: all built-in operations, nested formulas, cycle detection, error handling |
| `formula-integration.test.ts` | 9 tests: formula evaluation within full Denicek documents |

### 7.2 Formative Tests (Domain Scenarios)

Six domain-specific scenario tests in `packages/core/tests/formative/` validate end-to-end workflows:

| File | Scenario |
|---|---|
| `hello-world-formative.test.ts` | Basic document creation and editing |
| `todo-formative.test.ts` | Todo list with add/delete/rename operations |
| `conference-list-formative.test.ts` | Conference attendee list with collaborative editing |
| `conference-budget-formative.test.ts` | Budget spreadsheet with formulas |
| `counter-formative.test.ts` | Counter with formula-based computed values |
| `traffic-accidents-formative.test.ts` | Data table with aggregation formulas |

These tests simulate realistic user workflows and verify that the CRDT produces correct results in practical scenarios.

### 7.3 Property-Based Testing (fast-check)

The `packages/core/tests/core-properties.test.ts` file uses property-based testing to verify the core convergence invariant:

**Convergence property**: Given N peers that each apply a random sequence of edits, after full bidirectional sync, all peers must produce identical materialized documents. This property is tested with:

- Random edit generation (all edit types: add, delete, rename, set, pushBack, pushFront, popBack, popFront, updateTag, wrapRecord, wrapList, copy)
- Random peer counts (2–4 peers)
- Random edit sequences (5–20 edits per peer)
- Random sync orderings (partial sync, full sync, delayed sync)

The test framework generates thousands of random scenarios per run, providing high confidence in convergence correctness.

### 7.4 Random Fuzzer

The `packages/core/tools/core-random-fuzzer.ts` is a standalone long-running fuzzer that continuously:
1. Creates N random peers with random initial documents.
2. Generates random concurrent edit sequences.
3. Syncs all peers in random order.
4. Verifies convergence.
5. Reports any divergence as a failing test case with full reproduction data.

Run with: `deno run packages/core/tools/core-random-fuzzer.ts`

### 7.5 E2E Tests (Playwright)

The MyDenicek web application has 5 Playwright test files in `apps/mywebnicek/tests/`:

| File | Coverage |
|---|---|
| `bulk_actions.spec.ts` | Multi-select and bulk rename of elements |
| `undo_redo.spec.ts` | Undo/redo for node add/remove operations |
| `recording.spec.ts` | Recording and replay (currently skipped due to DOM interaction issues) |
| `named_params.spec.ts` | Named parameter functionality |
| `history_debug.spec.ts` | History debugging interface |

Configuration: tests run against `http://localhost:5174/MyDenicek/` on Chromium, Firefox, and WebKit. In CI, tests run sequentially with 2 retries; locally, they run in parallel.

---

## 8. Installation & Deployment

### 8.1 Local Development Setup

**mydenicek-core** (Deno):

```bash
# Clone the repository
git clone https://github.com/krsion/mydenicek-core.git
cd mydenicek-core

# Install dependencies (Deno auto-manages, but for npm compat packages):
deno install

# Format, lint, type-check, test:
deno task fmt          # Format all files
deno task lint         # Lint all packages
deno task check        # Type-check all packages
deno task test         # Run all tests
deno task build        # Build runnable apps (playground + mywebnicek)

# Run property tests:
deno task property-test

# Run the random fuzzer:
deno task random-fuzzer

# Start the sync server:
deno task sync-server
```

**MyDenicek** (Node.js):

```bash
# Clone the repository
git clone https://github.com/krsion/MyDenicek.git
cd MyDenicek

# Install dependencies:
npm ci

# Build the core library first:
npm run build -w @mydenicek/core

# Start development (sync server + web app concurrently):
npm run dev

# Or run individually:
npm run dev -w mywebnicek              # Web app at localhost:5174
npm run dev -w @mydenicek/sync-server  # Sync server at port 3001

# Run tests:
npm run test --workspaces              # All tests
npm test -w @mydenicek/core            # Core unit tests (Vitest)
npm run test -w mywebnicek             # E2E tests (Playwright)
```

### 8.2 Azure Deployment

**Sync server** (mydenicek-core): Deployed via `deno run --allow-net --allow-read --allow-write --allow-env apps/sync-server/main.ts`. Supports optional file-based persistence via `--persistence-path`.

**Sync server** (MyDenicek): Deployed to Azure App Service (`mydenicek-sync-prod.azurewebsites.net`). Uses Azure Blob Storage for event persistence. Deployment is triggered by changes to `apps/mydenicek-sync-server/` or manual dispatch.

**Web application**: Deployed to GitHub Pages at `https://krsion.github.io/MyDenicek/`. Live demo connects to the Azure sync server via `wss://mydenicek-sync-prod.azurewebsites.net`.

### 8.3 CI/CD Pipelines

**mydenicek-core**: Uses Deno's built-in task runner. CI runs `deno task fmt:check`, `deno task check`, `deno task test`, and `deno task build`.

**MyDenicek** has 4 GitHub Actions workflows:

| Workflow | Trigger | Steps |
|---|---|---|
| **Unit Tests** (`unit-tests.yml`) | Push/PR to main | `npm ci` → core unit tests (Vitest) |
| **Playwright** (`playwright.yml`) | Push to main | Build core → install browsers → run E2E → upload report |
| **Deploy Sync Server** (`deploy-sync-server.yml`) | Sync server changes or manual | Build → prepare dist → deploy to Azure App Service |
| **Deploy Pages** (`deploy-pages.yml`) | Push to main | Build core → build app → unit tests → deploy to GitHub Pages |

---

## 9. Limitations & Future Work

### 9.1 Current Limitations

1. **No character-level text editing**: `PrimitiveNode` replaces values atomically. There is no collaborative text CRDT (e.g., Fugue/RGA) for character-level splice operations. This means concurrent edits to the same text field result in one value winning rather than merging.

2. **No move operation**: The `moveNode` operation (reparenting a node to a different location in the tree) is not implemented in the core engine. This is intentional — the original Denicek paper does not include move, and move semantics in a path-based OT system introduce significant complexity.

3. **No generalized patch variables**: The specification defines `$0`, `$1`, ... variable placeholders for making recorded scripts portable across structural contexts. The current event-ID-based replay achieves the same goal for interactive use but ties scripts to specific event history.

4. **Action node button rendering**: Action nodes should render as clickable buttons in the UI. Currently they render as normal records.

5. **Limited node selection in UI**: Click-to-select and keyboard navigation (arrows, Tab) in the rendered tree are partially implemented.

### 9.2 Features Beyond Specification

The implementation includes capabilities not in the original specification:

| Feature | Description |
|---|---|
| **Property-based convergence testing** | Random fuzzer and fast-check verify convergence across thousands of random scenarios |
| **Managed-copy OT** | `CopyEdit` creates mirror edits that propagate concurrent changes to copy destinations |
| **Event graph compaction** | `compact()` collapses the DAG once all peers acknowledge the frontier |
| **Strict index segments** | `!0` notation preserves list coordinates across concurrent insertions |
| **Reference integrity** | References are automatically rewritten during structural edits; removals of referenced nodes are blocked |
| **Formula engine** | 15 built-in operations with cycle detection, nested evaluation, and extensibility |
| **Unwrap edits** | `UnwrapRecordEdit` and `UnwrapListEdit` provide correct OT-aware inverses for wrap operations |
| **CompositeEdit** | Internal replay artifact for managed-copy: bundles a primary edit with mirrored effects |

### 9.3 Future Directions

1. **Character-level text CRDT**: Add a `TextNode` type backed by a text CRDT (Fugue/RGA) or implement `splice` as a `registerPrimitiveEdit` with index transformation through concurrent edits.

2. **Performance optimization for large documents**: The current O(n) full replay on materialization could be improved with incremental materialization that caches intermediate states.

3. **Awareness/presence**: Show which peers are currently editing and their cursor/selection positions via lightweight presence messages on the sync protocol.

4. **Conflict UI**: Surface `NoOpEdit` conflicts in the UI so users can understand and resolve them.

5. **Schema validation**: Define and enforce document schemas (which tags are allowed, which fields are required) as part of the document model.
