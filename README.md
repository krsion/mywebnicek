# MyDenicek: Local-First Collaborative Document Editor

**Author**: Bc. Ondřej Krsička  
**Supervisor**: Mgr. Tomáš Petříček, Ph.D.  
**Course**: NPRG070 — Research Project, Charles University, Faculty of Mathematics and Physics

## About

MyDenicek is a **local-first collaborative document editor** for tagged document trees. It builds on the concepts from the original [Denicek](https://tomasp.net/academic/papers/denicek/) system by Tomáš Petříček, which introduced a computational substrate for document-oriented end-user programming.

The core research contribution is a **custom OT-based CRDT** that uses an event DAG with vector clocks and operational transformation of selector paths to achieve strong eventual consistency. Unlike the original Denicek (which used path-based OT without replication), MyDenicek is designed from the ground up for real-time multi-peer collaboration with automatic conflict resolution.

The project is split across two repositories: this one contains the **web application** (React 19 + Fluent UI), sync server, and all documentation, while the core CRDT engine lives in [mydenicek-core](https://github.com/krsion/mydenicek-core) and is published on JSR as [`@mydenicek/core`](https://jsr.io/@mydenicek/core).

## Live Demo

- **Web Application**: https://krsion.github.io/MyDenicek/
- **Sync Server**: `wss://mydenicek-sync-prod.azurewebsites.net`

Open in multiple browser tabs or windows to collaborate in real-time. Changes sync automatically via WebSocket.

## Documentation

- [Technical Documentation](docs/tech-docs.md) — architecture, CRDT design, implementation details
- [User Manual](docs/user-manual.md) — getting started, features, keyboard shortcuts
- [Formative Examples](docs/formative-examples.md) — worked examples demonstrating the CRDT core

## Project Structure

### Repositories

- **[MyDenicek](https://github.com/krsion/MyDenicek)** (this repo) — React 19 + Fluent UI web application, sync server, documentation
- **[mydenicek-core](https://github.com/krsion/mydenicek-core)** — Core CRDT engine published on JSR as `@mydenicek/core`

### Architecture

```
apps/
  mywebnicek/                    # React 19 + Fluent UI web app
  mydenicek-sync-server/         # WebSocket sync server (Loro)
packages/
  mydenicek-core/                # Core CRDT logic (Loro wrapper)
  mydenicek-react/               # React hooks/context
  mydenicek-mcp/                 # MCP integration
  mydenicek-integration-tests/   # Cross-package integration tests
```

**DenicekDocument** (`packages/mydenicek-core/src/DenicekDocument.ts`)
- Entry point for all document operations
- Wraps Loro internals (no Loro types exposed publicly)
- Provides: mutations via `change()`, undo/redo, export/import, subscriptions, history, replay

**DenicekModel** (`packages/mydenicek-core/src/DenicekModel.ts`)
- Facade for read/write operations, created inside `change()` callbacks
- Delegates to: NodeReader, NodeWriter, NodeCreator, NodeWrapper, SelectionLogic

## References

### Original Denicek Paper

- Petříček, T. "Denicek: Computational Substrate for Document-Oriented End-User Programming." UIST 2025.
- DOI: https://doi.org/10.1145/3746059.3747646
- Project page: https://tomasp.net/academic/papers/denicek/

### Specification & Proposal

- [Specification PDF](specification/specification.pdf)
- [Project Proposal PDF](proposal/proposal.pdf)

## Design Decisions & Considerations

### 1. Why are nodes indexed by ID instead of Path?

If we identified nodes by path (e.g., `doc.body.children[2]`), we would face the **"Shifting Index"** problem. For example, if Alice wraps a `<b>` tag in an `<article>` while Bob concurrently renames that same `<b>` to `<strong>`, a path-based approach often results in malformed nesting. The original [Denicek](https://dl.acm.org/doi/10.1145/3746059.3747646) relies on path-based Operational Transformation (OT), which we avoid by using CRDTs.

By using unique IDs, we address the object itself regardless of where it moves in the tree. This aligns with the approach taken in [Martin Kleppmann's JSON CRDT](https://ieeexplore.ieee.org/abstract/document/7909007).

### 2. Why is "Wrap" not supported as a single operation?

The "wrap" operation (create a new parent element and move an existing node into it) was intentionally removed from the system. **Wrap is a compound operation** (create + move), and compound operations cannot be made atomic in local-first software due to the CAP theorem.

**The Problem:**
When two users concurrently wrap the same node, both create wrapper elements and attempt to move the target. After sync:
- One wrapper "wins" the move (gets the child)
- The other wrapper becomes an orphaned empty element

The orphaned wrapper cannot be automatically cleaned up because it is **observationally indistinguishable** from an intentionally created empty element. Any cleanup algorithm would risk deleting legitimate user data.

**The Solution:**
Instead of wrap, users can:
1. **Create** a new parent element manually
2. **Move** the target node into it using Ctrl+X/Ctrl+V (cut/paste)

This decomposition ensures each operation is atomic and conflict-free. Move operations use Last-Writer-Wins (LWW) resolution, which is well-defined and predictable.

See `docs/design/compound-operation-decomposition.md` for the full theoretical analysis, including proofs based on the CAP theorem and CALM theorem.

### 3. Why are nodes stored in a Dictionary (Map) and not a List?

Storing nodes in a list of objects—e.g., `[{id: "A", ...}, {id: "B", ...}]`—allows for duplicate entries of the same ID during concurrent inserts, making updates computationally expensive (requiring O(N) searches).

A Dictionary (`Record<string, Node>`) enforces uniqueness by ID and allows O(1) access. However, because JSON dictionaries are unordered, we store the order of nodes separately in the `children[]` array of the parent element. Note that there could be duplicate IDs in the `children[]` array caused by concurrent adds of the same node.

### 4. Why does DenicekDocument provide a read-only API instead of exposing the Tree directly?

Internally, the document is stored as a `LoroTree`—Loro's native movable tree CRDT that handles concurrent structural edits, move operations, and conflict resolution automatically.

The `DenicekDocument` class provides a **read-only public API** that:
- **Hides CRDT internals**: No Loro types are exposed; applications work with plain TypeScript objects
- **Enables O(1) lookup**: Internal index maps allow efficient node, parent, and children lookups
- **Prevents direct mutation**: Users access data through methods (`getNode()`, `getChildIds()`) instead of property access
- **Simplifies rendering**: React components receive a stable view for efficient diffing
- **Encapsulates internal structure**: The nested tree representation can change without breaking consumers

### 5. Why is node ordering local (per parent) rather than global?

We only need to know the relative order of *siblings* when rendering or editing. A global ordering system would require maintaining a complex mapping of `Global Index <-> Local Index`. By storing order only within the `children` array of `ElementNode`, we simplify the implementation significantly without losing functionality.

### 6. Why Loro instead of Automerge?

The project initially explored Automerge but migrated to Loro for several reasons:
- **Native tree support:** Loro provides `LoroTree` with built-in move and parent-child operations
- **Better conflict resolution:** Native tree conflict resolution handles concurrent structural edits
- **Performance:** Loro's architecture provides efficient incremental updates
- **Active development:** Loro is actively maintained with good TypeScript support

See [README-legacy-automerge.md](./README-legacy-automerge.md) for the previous Automerge-based design.

## Behavior During Concurrent Edits

The following table outlines how the system resolves specific concurrent operations:

| Concurrent Operations | Resolution Behavior | Logic |
| :--- | :--- | :--- |
| **Move (A) vs Move (B)** | **One Move Wins** | Last-Writer-Wins (LWW) determines the final parent. See Loro's movable tree CRDT. |
| **Add Child vs Add Child** | **Both Added** | `addChild` generates a random unique ID. Both nodes appear in the parent's children list. |
| **Rename Tag vs Rename Tag** | **One Tag Wins** | Last-Writer-Wins (LWW) on the `tag` property. |
| **Edit Value vs Edit Value** | **One Value Wins** | LWW on the `value` property. |
| **Delete vs Delete** | **Node Deleted** | Idempotent operation. Node is removed regardless of which delete arrives first. |
| **Move vs Delete** | **Delete Wins** | If a node is deleted, any concurrent move operations are ignored. |
| **Add Child vs Rename Tag** | **Success** | The child is added to the element, which now has a new tag name. |
| **Add Child vs Edit** | **Unreachable** | `Add child` operation is allowed only for `ElementNodes`, while `Edit` operation is allowed only for `ValueNodes`. |
| **Rename Tag vs Edit** | **Unreachable** | `Rename Tag` operation is allowed only for `ElementNodes`, while `Edit` operation is allowed only for `ValueNodes`. |

## Recording/Replay (Programming by Demonstration)

Patches are recorded with generalized node IDs (`$0`, `$1`, etc.). During replay, `$0` is bound to a new starting node, enabling recorded actions to be applied elsewhere. See `DenicekDocument.replay()`.

## Development

### Commands
```bash
npm run dev                            # Start sync server + web app concurrently
npm run dev -w mywebnicek              # Web app only (Vite dev server at localhost:5174)
npm run dev -w @mydenicek/sync-server  # Sync server only (port 3001)

npm run build -w @mydenicek/core    # Build core library (must build before web app)
npm run build -w mywebnicek            # Build web app

npm run test --workspaces              # All tests (unit + E2E)
npm test -w @mydenicek/core         # Core unit tests (Vitest)
npm run test -w mywebnicek             # E2E tests (Playwright)
```

## Implementation Status

```
Core Library (FR-01 to FR-13):     13/13 fully implemented
MyWebnicek UI (FR-14 to FR-24):    9/11 full, 2 partial
Non-functional (NFR-01 to NFR-09):  6/9 full, 3 partial

Overall: ~95% feature-complete
```
