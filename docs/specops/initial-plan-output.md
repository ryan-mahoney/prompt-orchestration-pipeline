**Original file:** `initial-plan.md`

---

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
docs/specops/specs/
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

For each verified analysis spec in `docs/specops/specs/analysis/`, create a corresponding implementation spec in `docs/specops/specs/implementation/` that:

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
2. Create `docs/specops/specs/analysis/` directory structure
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

---

## Phase 1 — Setup

These prompts bootstrap the development environment: agent instructions and TypeScript infrastructure.

---

### 3. Make Agents Prompt

**Role:** Instructs an LLM to research best practices and create a comprehensive AGENTS.md file covering TypeScript, Bun.js, SSE, and pipeline orchestration conventions.

**Original file:** `make-agents-prompt.md`

---

Consider who are the leading experts in:

- Typescript best practices
- Bun.js best practices
- Bun.js SSE implementation
- pipeline orchestration using background processes

Then, search online for existing AGENTS.md that pertain to:

- Typescript best practices
- Bun.js best practices
- Bun.js SSE implementation
- pipeline orchestration using background processes

Then, based on the recommended best practices of the experts and your research into existing AGENTS.md files, create a new AGENTS.md that includes all of these best practices rolled into one new AGENTS.md file

---

### 4. New Agents (Notes)

**Role:** The generated AGENTS.md output. Contains the operating manual for coding agents: non-negotiables, stack assumptions, commands, TypeScript practices, Bun practices, SSE rules, pipeline orchestration guidelines, and agent workflow.

**Original file:** `new-agents.md`

---

# AGENTS.md

This file is the operating manual for coding agents working in this repository.

Principle: **make small, verifiable changes**, and keep the system **deterministic, observable, and easy to stop**.

---

## 0) Non-negotiables

- **Do not start long-running background processes** (dev servers, watchers, daemons) unless the user explicitly asks.
  - If a workflow requires multiple terminals or watch mode, **tell the user exactly what to run** and what output to expect.
  - Rationale: avoids runaway processes and keeps the user in control (common AGENTS.md convention).
- **Never run interactive commands** (anything that prompts for input).
  - Instead: ask the user to run it and paste the output / selections.
- **Never bypass git hooks** (`--no-verify`) unless the user explicitly requests it.
- **Never commit secrets**. If you suspect secrets exist, stop and tell the user.

---

## 1) Stack assumptions

- Language: **TypeScript**
- Runtime/tooling default: **Bun** (install / run / test)
- Realtime streaming: **Server-Sent Events (SSE)** using `text/event-stream`
- Orchestration: pipelines may spawn subprocesses, but production-style "keep it running" should be handled by a supervisor (systemd/supervisord) rather than ad-hoc scripts.

If the repo contradicts these assumptions (pnpm instead of bun, node instead of bun, etc.), follow the repo's actual scripts—but keep the rules below.

---

## 2) Commands (preferred)

### Dependencies

- `bun install`
  - Prefer Bun's lockfile behavior (keep lockfiles consistent).

### Run / build / test

- `bun run <script>` (or `bun <file>` for a single entrypoint)
- `bun test`

### Lint / format / typecheck

Follow the repo's scripts. If unclear, default to:

- `bun run lint`
- `bun run format`
- `bun run typecheck`

**During development:** run typecheck frequently (every few edits) rather than after large refactors.

---

## 3) TypeScript best practices (how we write code)

### 3.1 Compiler posture

- Use `strict` TypeScript. Prefer fixing types over weakening them.
- Avoid `any`. If absolutely necessary:
  - isolate it,
  - explain why in a comment,
  - and prefer `unknown` + narrowing where possible.

### 3.2 Type design rules (the "Effective TypeScript" posture)

- **Push `null`/`undefined` to the perimeter**:
  - Parse/validate at boundaries (I/O, env, network), then keep internal domain types non-nullable.
- Prefer **discriminated unions** for state machines and protocol messages.
- Prefer `satisfies` for exported configuration objects to validate shape without losing inferred literal types.

### 3.3 Interfaces vs types

- Use `interface` for object shapes that are extended/implemented.
- Use `type` for unions, function types, mapped/conditional types.

### 3.4 Imports

- Use `import type { ... }` for type-only imports.
- Keep import layers clean:
  1. external deps
  2. internal modules
  3. type-only imports

### 3.5 Linting

- Use ESLint with `typescript-eslint` and enable a recommended/strict baseline.
- Treat new lint warnings as bugs; do not "paper over" with disabling rules unless necessary and justified.

---

## 4) Bun best practices (how we run code)

- Prefer Bun equivalents:
  - `bun install` (not `npm/pnpm/yarn install`)
  - `bun test` (not `jest/vitest` directly unless the repo uses them)
  - `bun run` (not `node`, not `ts-node`)
- Prefer Web-standard APIs when possible (Fetch, Request/Response, ReadableStream).
- When using subprocesses:
  - prefer Bun's native spawn APIs if the repo already uses Bun;
  - otherwise follow the repo's existing approach.

---

## 5) SSE (Server-Sent Events) implementation rules

### 5.1 Protocol correctness

When implementing an SSE endpoint:

- Set headers:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`
- SSE message framing:
  - messages are UTF-8 text
  - each message is separated by a blank line
  - each data line starts with `data:`
  - optional fields: `id:`, `event:`, `retry:`

### 5.2 Keep-alives and disconnect handling

- Send periodic keep-alive comments (e.g. `: ping\n\n`) to prevent idle timeouts.
- Always handle client disconnects:
  - wire an AbortSignal / connection close signal
  - stop timers
  - close streams
  - release references (important for long-lived connections).

### 5.3 Streaming mechanics

- Prefer a `ReadableStream` that yields **small chunks**.
- Avoid buffering entire responses in memory.
- Keep writes serialized (avoid interleaving partial frames).

### 5.4 Testing SSE

- Include at least:
  - "connects and receives first event"
  - "reconnects / retry honored (client-side)"
  - "server stops producing on disconnect"
  - "keep-alive frames appear at expected cadence"

---

## 6) Pipeline orchestration + background processes

### 6.1 Default approach

- Pipelines should be **foreground by default** and exit with meaningful codes.
- If something must run long-lived:
  - in development: user runs it in a separate terminal (agent provides instructions).
  - in production: use a process manager (systemd/supervisord/Kubernetes/etc.).

### 6.2 Spawning subprocesses safely

If you spawn child processes:

- Capture `stdout`/`stderr` (or explicitly discard with justification).
- Propagate exit codes.
- Enforce timeouts for steps that can hang.
- Use deterministic working directories and explicit env vars (avoid relying on shell state).
- Prefer structured logs (prefix per step, include PID, include duration).

### 6.3 Shutdown / signals

- Handle `SIGINT` and `SIGTERM`:
  - stop accepting new work
  - allow in-flight work to finish
  - then exit cleanly
- Ensure child processes are terminated on shutdown (no orphans).

### 6.4 Concurrency policy

- Prefer explicit concurrency limits (e.g., "max N workers").
- Make side-effectful steps idempotent.
- Use lock files or OS-level locking for shared resources.

---

## 7) Agent workflow (how to work here)

- Make **small, reviewable diffs**.
- After every few edits, run the fastest validation:
  - typecheck first
  - then lint
  - then targeted tests
- If you change public APIs:
  - update types
  - update callers
  - add/adjust tests
  - update docs/examples

When unsure, ask the user for the preferred tradeoff (strictness vs speed), but still keep changes minimal and validated.

---
