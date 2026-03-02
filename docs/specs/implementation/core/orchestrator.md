# Implementation Specification: `core/orchestrator`

**Analysis source:** `docs/specs/analysis/core/orchestrator.md`

---

## 1. Qualifications

- TypeScript strict mode (interfaces, discriminated unions, generics for Map types)
- Bun subprocess APIs (`Bun.spawn`, `Subprocess` type, signal handling)
- Bun file I/O APIs (`Bun.file()`, `Bun.write()`)
- Node.js-compatible filesystem operations (`node:fs/promises` for `rename`, `mkdir`, `access`)
- Filesystem watching (chokidar API surface: `add`, `ready`, `error`, `close` events)
- POSIX process signals (`SIGTERM`, `SIGKILL`) and graceful shutdown patterns
- JSON parsing and serialization
- Regular expressions for filename validation
- Async/await control flow with concurrent event handling

---

## 2. Problem Statement

The system requires a top-level coordinator that watches for new pipeline execution requests (seed files), validates them, scaffolds job directories, and spawns isolated pipeline runner processes. The existing JS implementation provides this via `startOrchestrator()` using chokidar for file watching, `child_process.spawn` for runner dispatch, and temporary `process.env` mutation for config resolution. This spec defines the TypeScript replacement, eliminating the `process.env.PO_ROOT` race condition and the hardcoded `PO_DEFAULT_PROVIDER: "mock"` by passing configuration directly through environment variables at spawn time.

---

## 3. Goal

A TypeScript module at `src/core/orchestrator.ts` that provides identical behavioral contracts to the analyzed JS module — directory initialization, seed file watching, job scaffolding, and child process management — runs on Bun with `Bun.spawn`, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/core/orchestrator.ts` | Top-level orchestrator: directory resolution, seed watching, job scaffolding, runner spawning, graceful shutdown. |

### Key types and interfaces

```typescript
import type { Subprocess } from "bun";

/** Options for starting the orchestrator. */
interface OrchestratorOptions {
  /** Root directory for pipeline data. Normalized to canonical pipeline-data/ root. */
  dataDir: string;
  /** Injection point for process spawner. Defaults to Bun.spawn. */
  spawn?: SpawnFn;
  /** Injection point for filesystem watcher factory. Defaults to chokidar.watch. */
  watcherFactory?: WatcherFactory;
}

/** Handle returned by startOrchestrator for lifecycle control. */
interface OrchestratorHandle {
  stop: () => Promise<void>;
}

/** Resolved canonical directory paths for the pipeline data lifecycle. */
interface ResolvedDirs {
  dataDir: string;
  pending: string;
  current: string;
  complete: string;
}

/** Parsed seed file content (fields consumed by orchestrator). */
interface SeedData {
  name?: string;
  pipeline: string;
  [key: string]: unknown;
}

/** Initial job status written to tasks-status.json. */
interface JobStatusInit {
  id: string;
  name: string;
  pipeline: string;
  createdAt: string;
  state: "pending";
  tasks: Record<string, never>;
}

/** Structured start log entry. */
interface StartLogEntry {
  jobId: string;
  pipeline: string;
  timestamp: string;
  seedSummary: {
    name: string;
    pipeline: string;
    keys: string[];
  };
}

/** Minimal watcher interface matching chokidar's used surface. */
interface Watcher {
  on(event: "add", cb: (path: string) => void): Watcher;
  on(event: "ready", cb: () => void): Watcher;
  on(event: "error", cb: (err: Error) => void): Watcher;
  close(): Promise<void>;
}

/** Factory function that creates a filesystem watcher. */
type WatcherFactory = (path: string, options: Record<string, unknown>) => Watcher;

/**
 * Spawn function signature matching Bun.spawn's used surface.
 * Throws synchronously on spawn failure (e.g. binary not found, permission denied).
 * Callers must catch spawn errors distinctly from child exit failures.
 */
type SpawnFn = (cmd: string[], options: {
  env: Record<string, string>;
  stdin: "ignore";
  stdout: "inherit";
  stderr: "inherit";
}) => ChildHandle;

/** Result of a child process exit, capturing all diagnostic fields. */
interface ChildExitResult {
  /** Exit code, or null if terminated by signal. */
  code: number | null;
  /** Signal name (e.g. "SIGTERM"), or null if exited normally. */
  signal: string | null;
  /** Completion classification: "success" (code 0), "failure" (non-zero code), or "signal" (killed). */
  completionType: "success" | "failure" | "signal";
}

/** Minimal child process handle for tracking. */
interface ChildHandle {
  readonly pid: number;
  /** Resolves with structured exit details when the process terminates. */
  readonly exited: Promise<ChildExitResult>;
  kill(signal?: number): void;
}

/** Seed filename regex. Captures jobId from {jobId}-seed.json. */
// const SEED_PATTERN = /^([A-Za-z0-9-_]+)-seed\.json$/;
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| `Bun.spawn` replaces `child_process.spawn` | Bun-native subprocess API returns a `Subprocess` with an `exited` promise, eliminating the need for `exit`/`error` event listeners. Simpler lifecycle tracking. |
| `Bun.file(path).text()` replaces `fs.readFile(path, "utf-8")` | Bun-native file reading, more idiomatic. |
| `Bun.write(path, content)` replaces `fs.writeFile(path, content)` | Bun-native file writing. |
| `Bun.file(path).exists()` replaces `fs.access(path)` catch pattern | Simpler boolean check for file existence (idempotency guard). |
| Environment passed directly at spawn time | Eliminates the `process.env.PO_ROOT` mutation race condition. Config is resolved before spawn and passed via the `env` option. |
| `PO_DEFAULT_PROVIDER` sourced from config | Replaces the hardcoded `"mock"` value with `getConfig().llm.defaultProvider`. |

### Dependency map

| Source | Import | Purpose |
|--------|--------|---------|
| `./config` | `getConfig`, `getPipelineConfig` | Resolve pipeline registry and config values. Both must accept an explicit `root` parameter so config can be resolved without reading `process.env.PO_ROOT`. |
| `./logger` | `createLogger` | Structured logging |
| `./file-io` | `createTaskFileIO`, `generateLogName` | Write structured start log |
| `../config/log-events` | `LogEvent` | `LogEvent.START` constant |
| `../cli/self-reexec` | `buildReexecArgs` | Construct spawn command for runner |
| `./status-initializer` | `initializeStatusFromArtifacts` | Optional status bootstrapping (dynamic import) |
| `chokidar` | `watch` | Default filesystem watcher (external, injected) |
| `node:path` | `join`, `parse`, `basename` | Path manipulation |
| `node:fs/promises` | `mkdir`, `rename` | Directory creation, atomic file move |

---

## 5. Acceptance Criteria

### Core behavior

1. `startOrchestrator({ dataDir })` creates `pending/`, `current/`, and `complete/` directories under the resolved data root, creating them recursively if they do not exist.
2. `startOrchestrator` resolves only after the watcher emits `ready`, guaranteeing the watcher is operational before the caller proceeds.
3. The returned `OrchestratorHandle` has a `stop()` method that closes the watcher, terminates all active child processes, and resolves when cleanup is complete.
4. When a file matching `{jobId}-seed.json` appears in `pending/`, the orchestrator reads its JSON content, moves it to `current/{jobId}/seed.json`, creates `current/{jobId}/tasks/`, writes `tasks-status.json`, writes a start log, and spawns a pipeline runner process.
5. Non-matching filenames in `pending/` are logged as warnings and left in place.
6. Invalid JSON in a seed file causes a warning to be logged (including the filename and parse error message) and the file is left in `pending/` without further processing.
7. If `current/{jobId}/seed.json` already exists (idempotency guard), the seed is skipped without error.
8. If the job ID is already in the `running` map, the seed is skipped without error.

### Status initialization

9. `tasks-status.json` is written with fields: `id` (from seed filename), `name` (from `seed.name` or `jobId`), `pipeline`, `createdAt` (ISO 8601), `state: "pending"`, `tasks: {}`. Serialized as pretty-printed JSON (2-space indent).
10. If `initializeStatusFromArtifacts` is available and succeeds, the status is enriched with artifact data. If it fails, a warning is logged and the job proceeds with the base status.

### Subprocess management

11. The pipeline runner is spawned with environment variables: `PO_ROOT`, `PO_DATA_DIR`, `PO_PENDING_DIR`, `PO_CURRENT_DIR`, `PO_COMPLETE_DIR`, `PO_PIPELINE_SLUG`, and `PO_DEFAULT_PROVIDER` (sourced from config, not hardcoded).
12. `stdin` is `"ignore"`, `stdout` and `stderr` are `"inherit"`.
13. Active child processes are tracked in the `running` map by job ID.
14. When a child process exits (via `exited` promise resolving to `ChildExitResult`), it is removed from the `running` map and exit details are logged: `code` (number or null), `signal` (string or null), and `completionType` (`"success"`, `"failure"`, or `"signal"`).
15. On child spawn error (synchronous throw from `SpawnFn`), the error is logged distinctly from exit failures and the child is not added to (or is removed from) the `running` map.

### Graceful shutdown

16. `stop()` sends `SIGTERM` to all active children and starts a 500ms grace period per child. If a child's `exited` promise resolves before the timeout, the timeout is cleared (no SIGKILL sent). If a child has not exited after 500ms, `SIGKILL` is sent. After `SIGKILL`, `stop()` waits on the child's `exited` promise unconditionally — if the process still doesn't terminate (kernel-level zombie), the promise is raced against a final 1000ms timeout, after which the child is considered abandoned and logged as a warning.
17. `stop()` closes the filesystem watcher.
18. `stop()` resolves only after all children have exited (or been abandoned per criterion 16) and the watcher is closed. After `stop()` resolves, the `running` map is empty.

### Error handling

19. `startOrchestrator` throws immediately if `dataDir` is falsy.
20. A watcher `error` event before `ready` rejects the startup promise.
21. Failed file moves are logged as errors and re-thrown from `handleSeedAdd`.
22. Missing `pipeline` field in seed data throws from `spawnRunner`, caught by the watcher handler.
23. Pipeline config lookup failure throws from `spawnRunner`, caught by the watcher handler.

### Directory normalization

24. `resolveDirs` accepts the project root, `pipeline-data/`, or `pipeline-data/pending/` as input and produces the same canonical `{ dataDir, pending, current, complete }` result.

### Concurrency

25. Multiple seeds arriving concurrently are each processed independently; no seed blocks another.
26. Environment variables are not mutated on the parent process — all config is resolved and passed directly via the spawn `env` option, eliminating the `process.env.PO_ROOT` race condition.

---

## 6. Notes

### Design trade-offs

- **Chokidar retained as default watcher:** Bun's `fs.watch` (via `node:fs`) is available but lacks chokidar's cross-platform stability, `ignoreInitial` semantics, and glob filtering. Since chokidar is already injected via `watcherFactory`, keeping it as the default preserves reliability. The typed `Watcher` interface allows future replacement.
- **`Bun.spawn` `exited` promise vs event listeners:** The JS original used `child.on("exit")` and `child.on("error")` callbacks. `Bun.spawn` returns a `Subprocess` with an `exited` promise, which simplifies lifecycle tracking to a single `.then()` chain per child. The default spawn wrapper transforms the raw exit code into a `ChildExitResult` (reading `exitCode` and `signalCode` from the subprocess) so callers get structured `code`, `signal`, and `completionType` fields. Spawn failures (e.g. binary not found) throw synchronously and are caught distinctly from child exit. The `ChildHandle` interface abstracts this to support testing.
- **No `process.env` mutation:** The JS original temporarily set `process.env.PO_ROOT` so `getConfig()` and `getPipelineConfig()` would resolve correctly. This created a race condition with concurrent seeds. The TS version resolves config once before spawning and passes all values via the child's `env` option. **Prerequisite:** `getConfig` and `getPipelineConfig` must accept an explicit `root: string` parameter so config can be resolved deterministically without reading `process.env.PO_ROOT`. If the `core/config` module is not yet migrated with this root-aware API, a shim must be provided that accepts `root` and returns config resolved against that path. Without this, the race condition is not actually eliminated — it is merely moved.

### Known risks

- **`awaitWriteFinish: false`:** The watcher fires immediately on file detection. A partially-written seed file may produce invalid JSON. The try/catch around JSON parse handles this, but there is no retry — the file stays in `pending/` without being re-watched (chokidar won't re-emit `add` for an existing file). This matches the JS behavior.
- **Orphaned jobs in `current/`:** If the orchestrator crashes after moving a seed but before spawning, the job remains in `current/` with no active runner. There is no automatic recovery. This is a known gap from the analysis.
- **`ignoreInitial: false`** means existing files in `pending/` are processed on startup. This is intentional for crash recovery of seeds that arrived while down.

### Migration-specific concerns

- **`PO_DEFAULT_PROVIDER` no longer hardcoded to `"mock"`:** The TS version reads from `getConfig().llm.defaultProvider`. This is an intentional behavior change — the JS original always set `"mock"`, which was identified as a bug/testing artifact.
- **`testMode` parameter removed (approved breaking change):** The analysis identified `testMode` as having no meaningful behavioral effect. The TS version drops it. Testability is achieved through the `spawn` and `watcherFactory` injection points. Any callers passing `testMode` must be updated to remove the argument.
- **Default export removed (approved breaking change):** The JS module had both named and default exports. The TS version exports only `startOrchestrator` as a named export, per the project convention of preferring named exports. Any callers using `import orchestrator from ...` must switch to `import { startOrchestrator } from ...`.

### Dependencies on other modules

- Depends on `core/config` (`getConfig`, `getPipelineConfig`) being migrated or shimmed. Both functions must accept an explicit `root: string` parameter to eliminate the `process.env.PO_ROOT` race condition.
- Depends on `core/logger` (`createLogger`) being migrated or shimmed.
- Depends on `core/file-io` (`createTaskFileIO`, `generateLogName`) being migrated or shimmed.
- Depends on `config/log-events` (`LogEvent`) being migrated or shimmed.
- Depends on `cli/self-reexec` (`buildReexecArgs`) being migrated or shimmed.
- `core/status-initializer` is dynamically imported; absence is non-fatal.

---

## 7. Implementation Steps

### Step 1: Define types and interfaces

**What:** Create `src/core/orchestrator.ts` with all type definitions: `OrchestratorOptions`, `OrchestratorHandle`, `ResolvedDirs`, `SeedData`, `JobStatusInit`, `StartLogEntry`, `Watcher`, `WatcherFactory`, `SpawnFn`, `ChildHandle`, and the `SEED_PATTERN` regex constant.

**Why:** All subsequent steps depend on these types. Types-first ordering per spec conventions.

**Type signatures:**

```typescript
export interface OrchestratorOptions {
  dataDir: string;
  spawn?: SpawnFn;
  watcherFactory?: WatcherFactory;
}

export interface OrchestratorHandle {
  stop: () => Promise<void>;
}

interface ResolvedDirs {
  dataDir: string;
  pending: string;
  current: string;
  complete: string;
}

interface SeedData {
  name?: string;
  pipeline: string;
  [key: string]: unknown;
}

interface JobStatusInit {
  id: string;
  name: string;
  pipeline: string;
  createdAt: string;
  state: "pending";
  tasks: Record<string, never>;
}

interface StartLogEntry {
  jobId: string;
  pipeline: string;
  timestamp: string;
  seedSummary: {
    name: string;
    pipeline: string;
    keys: string[];
  };
}

interface Watcher {
  on(event: "add", cb: (path: string) => void): Watcher;
  on(event: "ready", cb: () => void): Watcher;
  on(event: "error", cb: (err: Error) => void): Watcher;
  close(): Promise<void>;
}

type WatcherFactory = (path: string, options: Record<string, unknown>) => Watcher;

/**
 * Spawn function signature matching Bun.spawn's used surface.
 * Throws synchronously on spawn failure (e.g. binary not found, permission denied).
 * Callers must catch spawn errors distinctly from child exit failures.
 */
type SpawnFn = (cmd: string[], options: {
  env: Record<string, string>;
  stdin: "ignore";
  stdout: "inherit";
  stderr: "inherit";
}) => ChildHandle;

/** Result of a child process exit, capturing all diagnostic fields. */
interface ChildExitResult {
  /** Exit code, or null if terminated by signal. */
  code: number | null;
  /** Signal name (e.g. "SIGTERM"), or null if exited normally. */
  signal: string | null;
  /** Completion classification: "success" (code 0), "failure" (non-zero code), or "signal" (killed). */
  completionType: "success" | "failure" | "signal";
}

interface ChildHandle {
  readonly pid: number;
  /** Resolves with structured exit details when the process terminates. */
  readonly exited: Promise<ChildExitResult>;
  kill(signal?: number): void;
}

const SEED_PATTERN = /^([A-Za-z0-9-_]+)-seed\.json$/;
```

**Test:** `tests/core/orchestrator.test.ts` — assert `SEED_PATTERN` matches valid seed filenames (`"my-job-seed.json"` → captures `"my-job"`) and rejects invalid ones (`"foo.json"`, `"seed.json"`, `"bad name-seed.json"`).

---

### Step 2: Implement `resolveDirs`

**What:** Add the `resolveDirs(dataDir: string): ResolvedDirs` function to `src/core/orchestrator.ts`. It normalizes the input path — detecting if `pipeline-data` already appears in the path and stripping trailing segments beyond it — then returns `{ dataDir, pending, current, complete }` with canonical paths.

**Why:** Acceptance criterion 24 (directory normalization).

**Type signature:**

```typescript
function resolveDirs(dataDir: string): ResolvedDirs
```

**Test:** `tests/core/orchestrator.test.ts` — three cases: (1) passing project root produces `{root}/pipeline-data` as `dataDir`; (2) passing `pipeline-data/` directly produces the same result; (3) passing `pipeline-data/pending/` produces the same result. Assert `pending`, `current`, `complete` are correct subdirectories.

---

### Step 3: Implement `startOrchestrator` — directory initialization and watcher setup

**What:** Implement the `startOrchestrator` function shell: validate `dataDir` (throw if falsy), call `resolveDirs`, create `pending/`, `current/`, `complete/` directories via `mkdir({ recursive: true })`, create the watcher via `watcherFactory` (defaulting to `chokidar.watch`) with options `{ ignoreInitial: false, depth: 0, awaitWriteFinish: false }` watching `pending/*.json`, and return a promise that resolves with `{ stop }` when the watcher emits `ready`, or rejects on watcher `error` before `ready`.

**Why:** Acceptance criteria 1, 2, 19, 20.

**Type signature:**

```typescript
export function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle>
```

**Test:** `tests/core/orchestrator.test.ts` — (1) calling with falsy `dataDir` throws; (2) calling with a valid `dataDir` and a mock `watcherFactory` that emits `ready` resolves with an object containing `stop`; (3) a mock watcher that emits `error` before `ready` rejects the promise. Assert directories are created.

---

### Step 4: Implement `handleSeedAdd` — seed validation, parsing, and idempotency

**What:** Add the `handleSeedAdd` function. On watcher `add` event: extract filename from path, test against `SEED_PATTERN`, warn and return on non-match. Read file with `Bun.file(path).text()`, parse JSON in a try/catch (log a warning with the filename and parse error on invalid JSON, then return). Check idempotency: if `jobId` is in the `running` map, return. If `current/{jobId}/seed.json` exists (via `Bun.file().exists()`), return. Wire `handleSeedAdd` into the watcher's `add` event in `startOrchestrator`.

**Why:** Acceptance criteria 4, 5, 6, 7, 8.

**Type signature:**

```typescript
async function handleSeedAdd(
  filePath: string,
  dirs: ResolvedDirs,
  running: Map<string, ChildHandle>,
  logger: ReturnType<typeof createLogger>,
  opts: OrchestratorOptions
): Promise<void>
```

**Test:** `tests/core/orchestrator.test.ts` — (1) non-matching filename logs warning and returns without action; (2) invalid JSON logs a warning (with filename and error message) and returns; (3) seed with jobId already in `running` map returns; (4) seed with existing `current/{jobId}/seed.json` returns.

---

### Step 5: Implement job scaffolding — move seed, create directories, write status

**What:** Extend `handleSeedAdd` to: move seed from `pending/` to `current/{jobId}/seed.json` via `rename`, create `current/{jobId}/tasks/` via `mkdir({ recursive: true })`, write `tasks-status.json` with `JobStatusInit` fields using `Bun.write()` (pretty-printed, 2-space indent). Optionally call `initializeStatusFromArtifacts` via dynamic `import()` — catch and warn on failure.

**Why:** Acceptance criteria 4, 9, 10.

**Test:** `tests/core/orchestrator.test.ts` — set up a temp directory with a valid seed file in `pending/`. Call `handleSeedAdd`. Assert: (1) seed file no longer in `pending/`; (2) seed file exists at `current/{jobId}/seed.json` with identical content; (3) `current/{jobId}/tasks/` directory exists; (4) `tasks-status.json` exists with correct fields (`id`, `name`, `pipeline`, `createdAt`, `state: "pending"`, `tasks: {}`).

---

### Step 6: Implement start log writing

**What:** After status initialization, write a structured start log entry via `createTaskFileIO` and `writeLog`. The log contains `jobId`, `pipeline`, `timestamp`, and `seedSummary` (with `name`, `pipeline`, and `keys` from the seed object). Use `generateLogName` with `LogEvent.START` and write in `replace` mode.

**Why:** Acceptance criterion 4 (start log component).

**Test:** `tests/core/orchestrator.test.ts` — after processing a seed, assert a log file exists in the job's log directory containing the expected `StartLogEntry` fields as JSON.

---

### Step 7: Implement `spawnRunner` — config resolution and child spawning

**What:** Add `spawnRunner` function. Resolve `PO_ROOT` from the already-resolved `dirs.dataDir`. Call `getPipelineConfig(seed.pipeline, root)` with the explicit root — throw if pipeline slug is missing from seed or not in registry. Assemble environment variables: `PO_ROOT`, `PO_DATA_DIR`, `PO_PENDING_DIR`, `PO_CURRENT_DIR`, `PO_COMPLETE_DIR`, `PO_PIPELINE_SLUG`, `PO_DEFAULT_PROVIDER` (from `getConfig().llm.defaultProvider`). Call `buildReexecArgs` to construct the spawn command. Spawn via `opts.spawn` (defaulting to a wrapper around `Bun.spawn`). Add child to `running` map. Chain `.exited.then()` to remove from `running` and log exit details.

**Why:** Acceptance criteria 11, 12, 13, 14, 15, 22, 23, 26.

**Type signature:**

```typescript
async function spawnRunner(
  jobId: string,
  seed: SeedData,
  dirs: ResolvedDirs,
  running: Map<string, ChildHandle>,
  logger: ReturnType<typeof createLogger>,
  spawn: SpawnFn
): Promise<void>
```

**Test:** `tests/core/orchestrator.test.ts` — inject a mock `spawn` function that returns a `ChildHandle` with a controllable `exited` promise resolving to `ChildExitResult`. Process a seed with a valid pipeline slug. Assert: (1) `spawn` was called with correct env vars (no hardcoded `"mock"` for `PO_DEFAULT_PROVIDER`); (2) the child was added to the `running` map; (3) after the mock child's `exited` resolves with `{ code: 0, signal: null, completionType: "success" }`, the entry is removed from `running` and exit details are logged. Also test: (4) missing `seed.pipeline` throws; (5) unregistered pipeline slug throws; (6) mock `spawn` that throws synchronously logs the spawn error distinctly and does not add to `running`.

---

### Step 8: Implement `stop` — graceful shutdown

**What:** Implement the `stop()` function returned by `startOrchestrator`. Close the watcher. For each child in the `running` map: send `SIGTERM` and race the child's `exited` promise against a 500ms timeout. If `exited` wins, clear the timeout (no SIGKILL). If the timeout wins, send `SIGKILL` and wait on `exited` again, raced against a final 1000ms timeout. If the child is still not exited after SIGKILL + 1000ms, log a warning and treat it as abandoned. After all children are resolved or abandoned, clear the `running` map. `stop()` resolves only after all cleanup is complete.

**Why:** Acceptance criteria 3, 16, 17, 18.

**Type signature:**

```typescript
// returned as part of OrchestratorHandle
stop: () => Promise<void>
```

**Test:** `tests/core/orchestrator.test.ts` — start orchestrator with a mock watcher and spawn a mock child. Call `stop()`. Assert: (1) watcher's `close()` was called; (2) child received SIGTERM; (3) if mock child exits before 500ms, no SIGKILL is sent and timeout is cleared; (4) if mock child does not exit within 500ms, SIGKILL is sent; (5) `running` map is empty after `stop()` resolves; (6) if mock child never exits even after SIGKILL, `stop()` still resolves after the 1000ms abandon timeout and logs a warning.

---

### Step 9: Wire default `spawn` wrapper around `Bun.spawn`

**What:** Create a default `SpawnFn` implementation that wraps `Bun.spawn`. Map the `ChildHandle` interface to `Bun.Subprocess`: `pid` maps directly, `kill(signal)` maps to `subprocess.kill(signal)`, and `exited` maps to the subprocess's `exited` promise transformed into a `ChildExitResult` — reading `subprocess.exitCode` and `subprocess.signalCode` after the promise resolves to populate `code`, `signal`, and `completionType`.

**Why:** Acceptance criterion 11 (Bun-native spawning) and providing a production default when no `spawn` option is injected.

**Type signature:**

```typescript
function createDefaultSpawn(): SpawnFn
```

**Test:** `tests/core/orchestrator.test.ts` — integration test: call `createDefaultSpawn()`, spawn a trivial process (`echo hello`), assert `pid` is a number and `exited` resolves to `{ code: 0, signal: null, completionType: "success" }`.

---

### Step 10: Integration test — full seed-to-spawn lifecycle

**What:** Write an integration test that exercises the full lifecycle: create a temp directory structure, write a valid seed file to `pending/`, start the orchestrator with mock `spawn` and a real chokidar watcher (or mock watcher that simulates `add` + `ready`), wait for spawn to be called, verify all side effects (seed moved, directories created, status written, log written, child spawned with correct env), then call `stop()` and verify cleanup.

**Why:** End-to-end validation that all steps work together. Covers acceptance criteria 1–18 in combination.

**Test:** `tests/core/orchestrator.integration.test.ts` — full lifecycle test as described. Use `Bun.tempdir` for filesystem isolation.
