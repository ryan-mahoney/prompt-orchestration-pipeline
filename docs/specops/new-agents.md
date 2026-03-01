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
- Orchestration: pipelines may spawn subprocesses, but production-style “keep it running” should be handled by a supervisor (systemd/supervisord) rather than ad-hoc scripts.

If the repo contradicts these assumptions (pnpm instead of bun, node instead of bun, etc.), follow the repo’s actual scripts—but keep the rules below.

---

## 2) Commands (preferred)

### Dependencies

- `bun install`
  - Prefer Bun’s lockfile behavior (keep lockfiles consistent).

### Run / build / test

- `bun run <script>` (or `bun <file>` for a single entrypoint)
- `bun test`

### Lint / format / typecheck

Follow the repo’s scripts. If unclear, default to:

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

### 3.2 Type design rules (the “Effective TypeScript” posture)

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
- Treat new lint warnings as bugs; do not “paper over” with disabling rules unless necessary and justified.

---

## 4) Bun best practices (how we run code)

- Prefer Bun equivalents:
  - `bun install` (not `npm/pnpm/yarn install`)
  - `bun test` (not `jest/vitest` directly unless the repo uses them)
  - `bun run` (not `node`, not `ts-node`)
- Prefer Web-standard APIs when possible (Fetch, Request/Response, ReadableStream).
- When using subprocesses:
  - prefer Bun’s native spawn APIs if the repo already uses Bun;
  - otherwise follow the repo’s existing approach.

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
  - “connects and receives first event”
  - “reconnects / retry honored (client-side)”
  - “server stops producing on disconnect”
  - “keep-alive frames appear at expected cadence”

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

- Prefer explicit concurrency limits (e.g., “max N workers”).
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
