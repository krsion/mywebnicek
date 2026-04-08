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
- [Design Decisions](docs/design-decisions.md) — rationale for key architectural choices

## Project Structure

### Repositories

- **[MyDenicek](https://github.com/krsion/MyDenicek)** (this repo) — React 19 + Fluent UI web application, sync server, documentation
- **[mydenicek-core](https://github.com/krsion/mydenicek-core)** — Core CRDT engine published on JSR as `@mydenicek/core`

### Architecture

```
apps/
  mywebnicek/                    # React 19 + Fluent UI web app
  mydenicek-sync-server/         # WebSocket sync server
packages/
  mydenicek-core/                # Document adapter (wraps @mydenicek/core)
  mydenicek-react/               # React hooks/context
  mydenicek-mcp/                 # MCP integration
  mydenicek-integration-tests/   # Cross-package integration tests
```

The **CRDT engine** (`@mydenicek/core` on JSR) models documents as tagged trees of records, lists, primitives, and references, addressed by selector paths. The **document adapter** (`packages/mydenicek-core/`) bridges the selector-based CRDT API to the ID-based tree API the React UI expects.

## References

### Original Denicek Paper

- Petříček, T. "Denicek: Computational Substrate for Document-Oriented End-User Programming." UIST 2025.
- DOI: https://doi.org/10.1145/3746059.3747646
- Project page: https://tomasp.net/academic/papers/denicek/

### Specification & Proposal

- [Specification PDF](specification/specification.pdf)
- [Project Proposal PDF](proposal/proposal.pdf)

## Development

### Commands
```bash
npm run dev                            # Start sync server + web app concurrently
npm run dev -w mywebnicek              # Web app only (Vite dev server)
npm run dev -w @mydenicek/sync-server  # Sync server only

npm run build -w @mydenicek/document   # Build document adapter
npm run build -w mywebnicek            # Build web app

npm run test --workspaces              # All tests
npm test -w @mydenicek/document        # Core unit tests (Vitest)
```
