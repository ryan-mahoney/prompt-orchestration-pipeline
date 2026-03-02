You are a principal software architect producing an implementation specification for a TypeScript + Bun project. Your input is a verified SpecOps analysis document that describes **what** a module does. Your output describes **how** to build it in TypeScript on Bun, as a flat sequence of deterministic engineering tasks that can each be executed in isolation.

Read the analysis document at **ANALYSIS_FILE** below. Also read the project's engineering standards (`docs/engineering-standards.md`) and agent conventions (`AGENTS.md`). These three documents together define the constraints for your specification.

Also read the other analysis file from the same director for added context, but only create a spec for the current analysis module.

Write the resulting implementation spec to **OUTPUT_FILE**.

DO NOT IMPLEMENT THIS SPEC, just save it disk.

---

## Target Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun
- **Testing:** `bun test`
- **SSE:** Bun-native `text/event-stream` responses using `ReadableStream` — not Express middleware
- **HTTP:** Prefer Bun's native `Bun.serve()` or the project's chosen server abstraction over Express where feasible
- **Subprocess management:** Bun's native `Bun.spawn` / `Bun.spawnSync`
- **File I/O:** Bun's native `Bun.file()` / `Bun.write()` where applicable
- **Package management:** `bun install`

When Bun provides a native, more performant, or simpler API for something the original JS module did via a third-party library or Node.js built-in, the spec should prefer the Bun-native approach and call out the migration explicitly.

---

## Output Format

Produce a markdown document with the following sections. Every section is required — if a section has nothing to say, include it with "N/A" rather than omitting it.

### 1. Qualifications

List the technical domains and expertise required to implement this module. Examples: TypeScript generics, Bun subprocess APIs, SSE protocol, SQLite, AST traversal, React hooks. Be specific to what this module actually needs — do not list generic skills.

### 2. Problem Statement

In 2–4 sentences, describe the gap this implementation fills. Reference the analysis document's Purpose & Responsibilities and frame it as: "The system requires [capability]. The existing JS implementation provides this via [approach]. This spec defines the TypeScript replacement."

### 3. Goal

One sentence. What artifact does this spec produce when fully implemented? Example: "A TypeScript module at `src/core/orchestrator.ts` that provides identical behavioral contracts to the analyzed JS module, runs on Bun, and passes all acceptance criteria below."

### 4. Architecture

Describe the internal structure of the TypeScript module:

- **Files to create** — list every file path under `src/` with a one-line description of its responsibility.
- **Key types and interfaces** — define the primary TypeScript types, interfaces, and discriminated unions. Use actual TypeScript syntax in fenced code blocks. These must cover:
  - All public API signatures (function parameters, return types)
  - All data structures that cross module boundaries (from the analysis doc's "Data Models & Structures")
  - All event/message types (from the analysis doc's "Public Interface" event-based interfaces)
  - State machine states as discriminated unions where applicable
- **Bun-specific design decisions** — where the implementation diverges from the JS original to leverage Bun APIs, describe the change and the rationale.
- **Dependency map** — which other `src/` modules this module imports from, and which external packages it requires (with versions if critical).

### 5. Acceptance Criteria

A numbered list of testable assertions. Each criterion must be:

- **Observable** — describes an outcome, not an implementation detail.
- **Derived from the analysis** — traceable to a behavioral contract, side effect, or invariant in the analysis document.
- **Automatable** — expressible as a `bun test` assertion.

Group criteria by concern (e.g., "Core behavior", "Error handling", "Concurrency", "SSE streaming"). Include edge cases and failure modes from the analysis doc's "Error Handling & Failure Modes" and "Edge Cases & Implicit Behavior" sections.

### 6. Notes

Capture anything that doesn't fit elsewhere:

- Design trade-offs and the rationale for choices made.
- Known risks or areas where the analysis flagged ambiguity (from "Open Questions & Ambiguities").
- Migration-specific concerns: behaviors that change intentionally in the TS version vs. behaviors that must remain identical.
- Dependencies on other modules being migrated first (or shims needed if they haven't been yet).
- Performance considerations specific to Bun.

### 7. Implementation Steps

A flat, numbered, sequential list of engineering tasks. Each task must be:

- **Deterministic** — one correct way to complete it, no judgment calls.
- **Minimal** — the smallest unit of work that produces a verifiable result.
- **Self-contained** — includes enough detail that a separate person or LLM context can implement it without reading other steps.
- **Forward-only** — no backward compatibility shims, no dual-mode code. Build for the target stack only.

For each step, provide:

1. **What to do** — the specific file(s) to create or modify and what to put in them.
2. **Why** — one sentence connecting this step to an acceptance criterion or architectural requirement.
3. **Type signatures** — if the step introduces or modifies a public API, include the TypeScript signature.
4. **Test** — the specific `bun test` assertion(s) to write that prove this step is complete. Name the test file and describe the test case(s). Do not describe manual testing. Do not describe running the full test suite.

**Do not include steps for:**

- Manual testing or QA
- Documentation updates
- Running the entire test suite
- Linting or formatting (assumed to be handled by CI)
- Git commits or PR creation

**Ordering principle:** Dependencies first. Types and interfaces → pure functions → stateful modules → I/O modules → integration wiring.

---

## Conventions to Follow

These are drawn from the project's `AGENTS.md` and engineering standards:

- Use `strict` TypeScript. No `any` without isolation and a comment explaining why.
- Push `null`/`undefined` to the perimeter. Internal domain types are non-nullable.
- Use `interface` for object shapes; `type` for unions, function types, mapped/conditional types.
- Use `import type { ... }` for type-only imports.
- Prefer discriminated unions for state machines and protocol messages.
- Prefer `satisfies` for configuration objects.
- Prefer Bun-native APIs (Bun.spawn, Bun.file, Bun.write, Bun.serve) over Node.js equivalents.
- Prefer Web-standard APIs (Fetch, Request/Response, ReadableStream) over Node-specific ones.
- SSE endpoints must: set correct headers, frame messages properly, send keep-alive pings, handle client disconnects via AbortSignal, and clean up resources.
- Subprocess spawning must: capture stdout/stderr, propagate exit codes, enforce timeouts, and terminate children on shutdown.
- Handle SIGINT/SIGTERM: stop accepting work, finish in-flight work, exit cleanly, no orphan processes.

---

## Module Variables

ANALYSIS_FILE:

OUTPUT_FILE:
