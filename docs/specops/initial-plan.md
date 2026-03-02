# SpecOps: JavaScript → TypeScript Migration Plan

## Context

This project (Prompt Orchestration Pipeline / POP) is a mature ~152-file JavaScript codebase with:

- 17 core runtime modules (orchestrator, pipeline-runner, task-runner, etc.)
- 48 UI files (Express server, 13 endpoints, React client)
- 8 LLM provider integrations
- 5 CLI modules, 10 task-analysis files, 23 React components
- 136 existing test files, 15 docs

We're applying the SpecOps method to systematically extract specifications from the existing JS system, verify them, then build a TypeScript replacement incrementally using the Strangler Fig pattern.

**Migration strategy**: Strangler Fig — build `src/` alongside `src-legacy/`, migrate module-by-module, keep both runnable.
**Spec granularity**: Per-subsystem, with finer granularity for compound subsystems (core/, ui/).

---

## Phase 1: Foundation Setup

### 1.1 Create `AGENTS.md` (Legacy Analysis Agent)

- AI instruction set for analyzing the existing JS codebase
- Best practices, conventions, and patterns used in the current system
- Key architectural decisions (file-system job queue, 11-stage lifecycle, serialized status writes, symlink bridge, process isolation)
- Coding style guide (ESM modules, JSDoc patterns, Express middleware conventions)
- Location: project root `AGENTS.md`

### 1.2 Create spec directory structure

```
docs/specs/
├── analysis/          # Phase 2 output: what the system does today
│   ├── core/          # Per-module specs for core subsystem
│   ├── ui/            # Split: server, client, state, SSE
│   ├── providers/     # LLM provider abstraction
│   ├── cli/           # CLI commands
│   ├── task-analysis/ # AST parsing subsystem
│   ├── components/    # React UI components
│   ├── config/        # Configuration system
│   └── utils/         # Shared utilities
└── implementation/    # Phase 4 output: how to build it in TS
```

---

## Phase 2: Discovery & Specification Generation

Generate analysis specs per subsystem. Each spec captures:

- Purpose and responsibilities
- Public API surface (exports, function signatures, return types)
- Data models / type shapes flowing through the module
- Side effects (file I/O, process spawning, SSE broadcasts)
- Dependencies (internal and external)
- Error handling patterns
- Behavioral contracts (what tests validate)

### Spec breakdown (~15-18 documents):

**core/ (5-6 specs — per-module for high-complexity files)**

1. `orchestrator.md` — File watcher, job spawning, process management
2. `pipeline-runner.md` — Job execution, task sequencing, state transitions
3. `task-runner.md` — 11-stage lifecycle, context object, stage contracts
4. `file-io.md` — TaskFileIO interface, directory structure, artifact/log/tmp operations
5. `batch-runner.md` — Concurrent execution, SQLite state, retry logic
6. `status-writer.md` — Atomic writes, serialized queue, status schema

**ui/ (3-4 specs — grouped by concern)** 7. `ui-server.md` — Express app, middleware, endpoint registry, SSE system 8. `ui-client.md` — React app, hooks, routing, API client 9. `ui-state.md` — State management, watcher, job scanning, change detection 10. `ui-components.md` — React component catalog, props contracts, Radix primitives

**Other subsystems (1 spec each)** 11. `providers.md` — Base provider class, provider implementations, unified LLM interface 12. `cli.md` — Commands, argument parsing, process re-execution 13. `task-analysis.md` — AST parsing, extractors (stages, artifacts, LLM calls), enrichers 14. `config.md` — Configuration loading, priority chain, path resolution, model registry 15. `utils.md` — DAG, duration, formatting, ID generation, token cost calculator

---

## Phase 3: Verification

- Review each analysis spec against the actual source code
- Cross-reference against existing test files to validate behavioral claims
- Flag any undocumented behaviors, edge cases, or implicit contracts
- Mark specs as "verified" once reviewed
- This is the gate before moving to implementation specs

---

## Phase 4: Implementation Specification

### 4.1 Create `AGENTS.md` v2 (TypeScript Build Agent)

- New instruction set for building the TS system
- TypeScript conventions (strict mode, interface-first design, discriminated unions)
- Module boundary contracts
- Testing requirements per module
- Location: replaces or supplements root `AGENTS.md`

### 4.2 Translate analysis specs → implementation specs

For each verified analysis spec in `docs/specs/analysis/`, create a corresponding implementation spec in `docs/specs/implementation/` that:

- Defines TypeScript interfaces and types
- Specifies module exports and function signatures with TS types
- Identifies where to leverage TS features (discriminated unions for status, generics for stage pipeline, etc.)
- Notes any design improvements enabled by the migration (e.g., stricter config validation, typed event emitters)
- Preserves behavioral contracts from analysis specs

---

## Phase 5: Strangler Fig Implementation

### 5.1 Initialize TypeScript project

- Create `src/` with `tsconfig.json`
- Set up build tooling (likely keep Vite + add ts support)
- Configure path aliases to match existing structure

### 5.2 Migration order (dependency-directed, leaf modules first)

1. **config/** + **utils/** — No internal dependencies, pure functions
2. **providers/** + **llm/** — External API wrappers
3. **core/file-io** → **core/status-writer** — Foundation I/O layer
4. **core/task-runner** → **core/pipeline-runner** → **core/orchestrator** — Runtime chain
5. **core/batch-runner** — Parallel execution
6. **task-analysis/** — AST tooling
7. **cli/** — Command layer
8. **ui/ server + endpoints** — Express backend
9. **ui/ client + components** — React frontend (JSX → TSX)

### 5.3 Per-module migration cycle

For each module:

1. Build TS implementation from implementation spec
2. Port or write tests targeting the TS module
3. Validate behavioral equivalence against analysis spec
4. Wire into the running system (update imports progressively)

---

## Phase 6: Retirement

- Once all modules are migrated and tests pass against `src/`
- Remove `src-legacy/`
- Update all build scripts, CI, and configuration
- Archive analysis specs (they remain as documentation)

---

## What we do first

1. Create `AGENTS.md` with legacy system analysis instructions
2. Create `docs/specs/analysis/` directory structure
3. Begin generating analysis specs, starting with `core/` subsystem

---

## Key files to reference

- `src/core/orchestrator.js` — Job coordination
- `src/core/pipeline-runner.js` — Job execution
- `src/core/task-runner.js` — 11-stage lifecycle
- `src/core/file-io.js` — File I/O interface
- `src/core/batch-runner.js` — Concurrent processing
- `src/core/status-writer.js` — Atomic status management
- `src/ui/server.js` — Express server entry
- `src/ui/express-app.js` — Route registration
- `src/providers/base.js` — Provider base class
- `src/llm/index.js` — Unified LLM abstraction
- `src/cli/index.js` — CLI entry point
- `src/task-analysis/parser.js` — AST parser
- `src/config/` — All 4 config files
- `docs/current-architecture.md` — Existing architecture doc
- `docs/engineering-standards.md` — Existing code standards

## Verification

- Each analysis spec should be reviewable against the source module it describes
- Implementation specs should be type-checkable (interfaces compile)
- Each migrated TS module should pass equivalent tests from the existing test suite
- End-to-end: `bun run demo:all` should work with progressively more TS modules wired in
