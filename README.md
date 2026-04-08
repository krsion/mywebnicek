# mywebnicek: Local-First Collaborative Document Editor

**Author**: Bc. Ondřej Krsička  
**Supervisor**: Mgr. Tomáš Petříček, Ph.D.  
**Course**: NPRG070 — Research Project, Charles University, Faculty of Mathematics and Physics

## About

mywebnicek is a **local-first collaborative document editor** for tagged document trees. It builds on the original [Denicek](https://tomasp.net/academic/papers/denicek/) system by Tomáš Petříček, extending it with real-time multi-peer collaboration via a custom OT-based CRDT.

The core CRDT uses an event DAG with vector clocks and operational transformation of selector paths to achieve strong eventual consistency. Documents are modeled as tagged trees of records, lists, primitives, and references — addressed by filesystem-style selectors like `/header/title/text`.

## Live Demo

https://krsion.github.io/mywebnicek/

## Repositories

| Repo | Description | Published as |
|------|-------------|-------------|
| **[mywebnicek](https://github.com/krsion/mywebnicek)** (this) | Web application (Deno + Vite + React) | GitHub Pages |
| **[mydenicek-core](https://github.com/krsion/mydenicek-core)** | CRDT engine + React hook + sync server | [`@mydenicek/core`](https://jsr.io/@mydenicek/core), [`@mydenicek/react`](https://jsr.io/@mydenicek/react) on JSR |

## Documentation

- [Technical Documentation](docs/tech-docs.md) — architecture, CRDT design, implementation details
- [User Manual](docs/user-manual.md) — getting started, features, keyboard shortcuts
- [Formative Examples](docs/formative-examples.md) — worked examples demonstrating the CRDT core
- [Design Decisions](docs/design-decisions.md) — rationale for key architectural choices

## Project Structure

```
deno.json              # Deno config with JSR + npm imports
vite.config.ts         # Vite build (deno + react plugins)
index.html             # Entry point
src/
  main.tsx             # App bootstrap
  App.tsx              # Layout: header + rendered doc + command bar
  CommandBar.tsx       # Terminal-style command input with path completion
  RenderedDocument.tsx # Renders materialized tree as HTML
  initializeDocument.ts# Sample document (counter, todo list, conferences)
docs/                  # Markdown documentation
specification/         # Project specification (PDF + LaTeX)
proposal/              # Project proposal (PDF + LaTeX)
```

## Development

```bash
deno task dev          # Start Vite dev server
deno task build        # Production build → dist/
deno task preview      # Preview production build
deno task lint         # Lint with deno lint
deno task fmt          # Format with deno fmt
```

## References

- Petříček, T. "Denicek: Computational Substrate for Document-Oriented End-User Programming." UIST 2025.  
  DOI: https://doi.org/10.1145/3746059.3747646 · [Project page](https://tomasp.net/academic/papers/denicek/)
- [Specification PDF](specification/specification.pdf)
- [Project Proposal PDF](proposal/proposal.pdf)
