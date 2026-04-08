# Design Decisions

**Project**: mywebnicek  
**Author**: Bc. Ondřej Krsička  
**Supervisor**: Mgr. Tomáš Petříček, Ph.D.

This document explains the rationale behind key architectural choices in mywebnicek.

---

## 1. Why OT-based Event DAG instead of a third-party CRDT library?

The project initially explored Automerge, then Loro, before implementing a custom OT-based event DAG. The custom approach was chosen because:

- **Full control over conflict semantics.** Third-party CRDTs impose their own conflict resolution policies (e.g., Loro uses Last-Writer-Wins for maps and a movable tree CRDT for structure). With a custom OT engine, we define exactly how concurrent structural edits (rename, wrap, delete) interact.
- **Selector-based addressing.** The original Denicek uses slash-separated selectors (e.g., `"items/0/name"`) with wildcard expansion. CRDTs like Loro use opaque node IDs. Implementing OT directly on selectors preserves the Denicek programming model.
- **Deterministic convergence via replay.** All peers replay the same set of events in deterministic topological order. OT transforms selectors during replay so that concurrent structural edits compose correctly. This is validated by property-based testing and a random fuzzer.
- **Zero external dependencies.** The core engine (`@mydenicek/core`) is pure TypeScript with no runtime dependencies, making it portable across Deno, Node, and browser environments.

See [README-legacy-automerge.md](../README-legacy-automerge.md) for the previous Automerge-based design.

## 2. Why selector paths instead of node IDs?

The Denicek model addresses nodes by **selector paths** like `"root/items/2/name"` rather than opaque UUIDs. This is a deliberate design choice from the original Denicek paper:

- **Selectors are human-readable.** A developer or user can understand `"items/*/title"` without looking up IDs.
- **Wildcards enable bulk operations.** The selector `"items/*"` addresses all children of a list, enabling operations like "capitalize every title" in a single edit.
- **Structural edits transform selectors.** When a concurrent rename changes `"items"` to `"talks"`, OT transforms all selectors that reference `"items"` to `"talks"`. This is the core of the convergence mechanism.

The UI layer uses an **adapter** (`DocumentAdapter`) that maps between selector paths and stable UUIDs for React rendering. The UUIDs are stored as `$id` fields in each record, so they survive tree restructuring.

## 3. Why is "Wrap" decomposed into create + move?

The "wrap" operation (create a new parent element and move an existing node into it) is a **compound operation**. In a distributed system, compound operations cannot be made atomic — the two sub-operations may interleave with concurrent edits.

**The Problem:**
When two users concurrently wrap the same node, both create wrapper elements and attempt to move the target. After sync:
- One wrapper "wins" the move (gets the child)
- The other wrapper becomes an orphaned empty element

The orphaned wrapper cannot be automatically cleaned up because it is **observationally indistinguishable** from an intentionally created empty element.

**The Solution:**
The mywebnicek-core engine supports `wrapRecord` and `wrapList` as *single atomic events* with dedicated OT rules. The OT transformation ensures that concurrent wraps on the same node are resolved deterministically — only one wrap succeeds, and the other becomes a no-op conflict that is reported to the user.

See [compound-operation-decomposition.md](design/compound-operation-decomposition.md) for the full theoretical analysis.

## 4. Why does DenicekDocument hide CRDT internals?

The `DenicekDocument` class provides a **read-only public API** that hides the underlying CRDT engine:

- **No CRDT types exposed.** Applications work with plain TypeScript interfaces (`NodeData`, `ElementNodeData`, etc.), not internal CRDT structures.
- **O(1) lookup.** Internal index maps (id→node, id→parent, id→children) allow efficient access without tree traversal.
- **Stable React rendering.** The ID-based API produces stable keys for React component diffing.
- **Engine independence.** The adapter pattern means the underlying CRDT can change (as happened when migrating from Loro to the custom OT engine) without breaking the UI.

## 5. Document model: records, lists, primitives, references

The CRDT models documents as tagged trees with four node types:

| Node Type | Description | Example |
|-----------|-------------|---------|
| **Record** | Named fields with a structural tag | `{ $tag: "div", class: "container", title: "Hello" }` |
| **List** | Ordered sequence of child nodes | `{ $tag: "items", $items: [node1, node2] }` |
| **Primitive** | Scalar value (string, number, boolean) | `"Hello World"`, `42`, `true` |
| **Reference** | Pointer to another node via selector | `{ $ref: "../sibling/value" }` |

This model is richer than JSON (tags, references) but simpler than XML (no mixed content). It directly supports the Denicek programming model where documents are both data and program.

## 6. Conflict resolution strategy

| Concurrent Operations | Resolution | Mechanism |
|:---|:---|:---|
| **Set vs Set** (same primitive) | One value wins | Deterministic tie-breaking by event ID |
| **Add vs Add** (same field) | One wins | First in topological order persists |
| **Rename vs Rename** (same field) | Both applied | OT transforms the second rename's selector |
| **Delete vs Edit** (same subtree) | Delete wins | Edit becomes a no-op; reported as conflict |
| **Wrap vs Wrap** (same node) | One wins | OT transforms the second wrap; conflict reported |
| **Add child vs Add child** | Both added | Each add targets a different field/position |

All conflicts are **deterministic** — every peer reaches the same state regardless of event delivery order. Conflicts are surfaced via `denicek.conflicts` for user review.

## 7. Sync protocol: drain/applyRemote

Synchronization uses a simple event-exchange protocol:

1. **Local edits** produce events buffered in a pending queue.
2. `drain()` returns and clears pending events for transmission.
3. `applyRemote(event)` ingests a remote event, buffering out-of-order events until their causal dependencies arrive.
4. `eventsSince(remoteFrontiers)` returns events unknown to a peer, enabling incremental catch-up.

This protocol is transport-agnostic — it works over WebSocket, HTTP polling, or peer-to-peer channels.

## 8. Recording and replay (Programming by Demonstration)

Edit events are recorded with their event IDs. During replay:
- `replayEditFromEventId(eventId, newTarget)` re-applies an edit to a different selector.
- `repeatEditsFrom(target)` replays a sequence of edits (e.g., all steps recorded for a "button").
- Batch replay excludes same-batch events from retargeting each other, preventing cascading transformations.

This enables **user-programmable buttons**: record a sequence of edits, attach them to an action node, and replay them on demand with different targets.
