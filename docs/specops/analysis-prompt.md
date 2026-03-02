You are performing a SpecOps analysis — extracting a comprehensive, implementation-language-agnostic specification from an existing codebase. Your output will be reviewed by domain experts and used as the authoritative source of truth for a future reimplementation. Precision matters more than brevity.

Analyze the module identified by **MODULE_NAME** below. The source code to examine is listed in **SOURCE_FILES**. These variables are defined in the **Module Variables** section at the end of this document.

---

Produce a specification document in markdown with the following sections. Be exhaustive within each section. Where you are uncertain or the code is ambiguous, say so explicitly — do not infer silently.

## 1. Purpose & Responsibilities

What is this module's reason for existing? Describe:

- The problem it solves or the role it fills within the larger system.
- Its responsibilities — what it owns and is accountable for.
- Its boundaries — what it explicitly does NOT do that a reader might assume it does.
- If it acts as a coordination point, gateway, adapter, or transformer, name that pattern.

## 2. Public Interface

Document every entry point that other parts of the system can call or consume. For each:

- **Name** of the exported function, class, or constant.
- **Purpose** — one sentence on what it does.
- **Parameters** — name, expected shape/type, whether optional, and what it represents semantically (not just "a string" but "the unique job identifier assigned at creation time").
- **Return value** — shape/type and what it represents. If it returns a promise or deferred result, say so and describe what resolves/rejects.
- **Thrown errors or failure modes** — what can go wrong and how it surfaces.

If the module exposes an event-based interface (emits events, pushes to streams, writes to shared channels), document each event/message type with the same rigor as function signatures.

## 3. Data Models & Structures

Describe every significant data structure this module creates, consumes, or transforms:

- **Name** and purpose of the structure.
- **Fields** — name, type, optionality, semantic meaning, valid ranges or enumerations.
- **Lifecycle** — when is it created, how does it change over time, when is it discarded?
- **Ownership** — does this module own the structure, or does it receive it from elsewhere?
- **Serialization** — if the structure is persisted (to disk, database, network), describe the format and any serialization concerns (field ordering, encoding, schema versioning).

Pay special attention to any structures that cross module boundaries — these are the integration contracts.

## 4. Behavioral Contracts

Describe the observable behaviors and invariants that define correctness for this module. Think of these as the rules a reimplementation must honor:

- **Preconditions** — what must be true before calling into this module?
- **Postconditions** — what is guaranteed to be true after a successful operation?
- **Invariants** — what must always remain true while this module is operating?
- **Ordering guarantees** — does the module guarantee sequential processing, FIFO ordering, atomic operations, or idempotency?
- **Concurrency behavior** — can it be called concurrently? Does it serialize access internally? Are there race conditions the design explicitly addresses (or ignores)?

If existing tests encode behavioral expectations, reference what those tests validate and call out any behaviors you observe in code that are NOT covered by tests.

## 5. State Management

Describe any state this module holds or manages:

- **In-memory state** — maps, caches, queues, counters, singletons. What is their lifecycle? What triggers creation, mutation, and cleanup?
- **Persisted state** — files, database records, external stores. What is the schema? What are the read/write patterns? Is there any journaling, write-ahead logging, or crash recovery?
- **Shared state** — any state that is visible to or mutated by other modules. How is consistency maintained?

For each piece of state, describe what happens if the process crashes mid-operation. Is state recoverable? Corrupt? Lost?

## 6. Dependencies

### 6.1 Internal Dependencies

List every other module within this system that this module imports, calls, or depends on:

- **Module name** and what specifically is used from it (functions, classes, constants).
- **Nature of the dependency** — is it a hard compile-time dependency, a runtime lookup, a callback/plugin interface, or an injected dependency?
- **Coupling assessment** — how tightly is this module bound to the dependency? Could the dependency be replaced without changing this module's logic?

### 6.2 External Dependencies

List every third-party library or platform service this module uses:

- **Package/service name** and what it provides.
- **How it's used** — which specific capabilities are leveraged?
- **Replaceability** — is usage localized and wrappable, or deeply entwined?

### 6.3 System-Level Dependencies

Describe any assumptions about the runtime environment:

- File system layout, expected directories, permissions.
- Environment variables or configuration that must be present.
- Network services, ports, or external APIs.
- OS-level features (process spawning, signals, file watchers).

## 7. Side Effects & I/O

Catalog every way this module interacts with the world outside its own memory:

- **File system** — reads, writes, watches, directory creation, temp files, cleanup.
- **Network** — HTTP requests/responses, WebSocket connections, SSE streams.
- **Process management** — spawning child processes, signal handling, exit codes.
- **Logging & observability** — what gets logged, at what levels, in what format.
- **Timing & scheduling** — timers, intervals, debouncing, polling loops.

For each side effect, note whether it is synchronous or asynchronous, and what error handling exists.

## 8. Error Handling & Failure Modes

Describe how this module handles failure:

- **Error categories** — what types of errors can occur? (validation, I/O, timeout, external service, internal logic)
- **Propagation strategy** — does it throw/reject, return error codes, emit error events, log-and-continue, or retry?
- **Recovery behavior** — for each failure mode, what happens next? Is there graceful degradation, retry logic, circuit breaking, or fail-fast behavior?
- **Partial failure** — if a multi-step operation fails midway, what is the resulting state? Is there cleanup or rollback?
- **User/operator visibility** — how does a failure surface to the end user or system operator?

## 9. Integration Points & Data Flow

Describe how this module fits into the larger system's data flow:

- **Upstream** — who calls this module, and with what? What triggers its activation?
- **Downstream** — what does this module call or produce that other modules consume?
- **Data transformation** — how does data change shape as it passes through this module?
- **Control flow** — draw the path of execution through this module for its primary use cases. Name the key decision points and branches.

If this module participates in any system-wide patterns (event bus, middleware chain, plugin architecture, lifecycle hooks), describe its role in that pattern.

## 10. Edge Cases & Implicit Behavior

Document any behavior that is important but not obvious:

- Default values that silently shape behavior.
- Implicit ordering or timing assumptions.
- Feature flags, environment-dependent branches, or debug-only paths.
- Backward compatibility shims or workarounds for known issues.
- Anything where the code comment says "hack", "workaround", "TODO", or "FIXME".
- Any behavior you find surprising or that contradicts apparent design intent.

## 11. Open Questions & Ambiguities

List anything you could not determine from the code alone:

- Business rules that appear to encode policy decisions but lack explanation.
- Magic numbers or thresholds without documented rationale.
- Dead code paths that may or may not be intentional.
- Contradictions between code behavior and any existing documentation.
- Areas where you had to guess at intent — flag these clearly.

---

## Formatting Guidelines

- Use descriptive prose for narratives; use tables for structured data (parameters, fields, enumerations).
- Name specific entities (functions, structures, files, events) precisely as they appear in the source.
- Do NOT describe how to achieve any behavior in a specific programming language. Describe WHAT the behavior is.
- Where the implementation uses a well-known design pattern (Observer, Strategy, Middleware, etc.), name the pattern but describe the specific application.
- If a section has nothing to document, include it with a note saying "None identified" rather than omitting it — the absence of something (e.g., no error handling exists) is itself important information.

---

## Module Variables

MODULE_NAME:
SOURCE_FILES:
