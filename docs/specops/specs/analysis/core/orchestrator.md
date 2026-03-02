# SpecOps Analysis: `core/orchestrator`

**Source files:** `src/core/orchestrator.js`

---

## 1. Purpose & Responsibilities

The orchestrator is the system's top-level job intake and dispatch coordinator. It solves the problem of detecting new pipeline execution requests (seeds) and reliably launching isolated pipeline runner processes for each one.

**Responsibilities:**

- Establishing and maintaining the canonical directory structure for the pipeline data lifecycle (`pending/`, `current/`, `complete/`).
- Watching the `pending/` directory for new seed files.
- Validating seed filenames against a strict naming convention.
- Moving accepted seed files from `pending/` into a per-job working directory under `current/`.
- Initializing the job's status file (`tasks-status.json`) with metadata from the seed.
- Optionally bootstrapping the status file with pre-existing artifact data via the status initializer.
- Writing a structured orchestrator-level start log for each job.
- Spawning a child process (the pipeline runner) for each accepted job, passing the correct environment.
- Tracking active child processes and providing a `stop()` method for graceful shutdown.

**Boundaries:**

- The orchestrator does **not** execute pipeline tasks itself — it delegates entirely to the spawned pipeline runner.
- It does **not** move jobs from `current/` to `complete/`; the pipeline runner owns that lifecycle transition.
- It does **not** write completion or error logs on child exit, explicitly to avoid race conditions with the pipeline runner's own filesystem operations.
- It does **not** parse or interpret the pipeline definition; it resolves the pipeline config and passes the slug to the runner via environment variables.

**Pattern:** Coordinator / Supervisor — watches for work, dispatches to workers, and manages worker lifecycle.

---

## 2. Public Interface

### `startOrchestrator(opts)`

- **Purpose:** Initializes the directory structure, starts the file watcher, and returns a handle for stopping the orchestrator.
- **Parameters:**

| Name | Shape | Optional | Semantic Meaning |
|---|---|---|---|
| `opts.dataDir` | string | **Required** | The root directory for pipeline data. May be the project root, the `pipeline-data/` root, or even `pipeline-data/pending/` — the orchestrator normalizes it. |
| `opts.spawn` | function (same signature as `child_process.spawn`) | Yes | Injection point for the process spawner. Defaults to Node's `child_process.spawn`. |
| `opts.watcherFactory` | function (same signature as `chokidar.watch`) | Yes | Injection point for the filesystem watcher. Defaults to `chokidar.watch`. |
| `opts.testMode` | boolean | Yes | Passed through to `spawnRunner`. In the current implementation it has no meaningful behavioral effect beyond documenting test intent; both test and non-test paths still spawn and return the child immediately. Defaults to `false`. |

- **Return value:** `Promise<{ stop: () => Promise<void> }>` — resolves once the watcher is ready. The returned object contains a `stop` function for graceful shutdown.
- **Thrown errors:**
  - Throws immediately if `opts.dataDir` is falsy.
  - The watcher's `error` event rejects the startup promise if it fires before `ready`.

### Default Export

The module also has a default export: `{ startOrchestrator }` — an object wrapping the named export.

---

## 3. Data Models & Structures

### Resolved Directories Object

- **Purpose:** Canonical paths for the three pipeline lifecycle directories.
- **Fields:**

| Field | Type | Meaning |
|---|---|---|
| `dataDir` | string | Normalized root of `pipeline-data/` |
| `pending` | string | `{dataDir}/pending` — intake directory for seed files |
| `current` | string | `{dataDir}/current` — active job working directories |
| `complete` | string | `{dataDir}/complete` — finished job archives |

- **Lifecycle:** Created once during `startOrchestrator` initialization. Immutable thereafter.
- **Ownership:** Owned by the orchestrator; passed by reference to `spawnRunner`.

### Seed File

- **Purpose:** A JSON file dropped into `pending/` that triggers job creation.
- **Filename contract:** Must match the pattern `^([A-Za-z0-9-_]+)-seed\.json$`. The captured group becomes the `jobId`.
- **Fields (consumed by orchestrator):**

| Field | Type | Optional | Meaning |
|---|---|---|---|
| `name` | string | Yes | Human-readable job name. Falls back to `jobId` if absent. |
| `pipeline` | string | **Required** | The pipeline slug identifying which pipeline definition to execute. |

- **Lifecycle:** Read from `pending/`, then atomically moved to `current/{jobId}/seed.json`. The orchestrator does not modify its content.
- **Ownership:** External — created by whatever submits work to the system.

### Job Status Object (`tasks-status.json`)

- **Purpose:** Initial status record written to the job's working directory.
- **Fields (as initialized by orchestrator):**

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The job ID extracted from the seed filename |
| `name` | string | From `seed.name`, falling back to `jobId` |
| `pipeline` | string | Pipeline slug from `seed.pipeline` |
| `createdAt` | string (ISO 8601) | Timestamp of job creation |
| `state` | string | Always initialized to `"pending"` |
| `tasks` | object (empty `{}`) | Placeholder for the pipeline runner to populate |

- **Lifecycle:** Created by the orchestrator if it does not already exist. May be immediately updated by `initializeStatusFromArtifacts`. Subsequently owned and mutated by the pipeline runner.
- **Serialization:** Written as pretty-printed JSON (2-space indent).

### Start Log Entry

- **Purpose:** Structured log written to the job's log directory recording orchestrator-level job initiation.
- **Fields:**

| Field | Type | Meaning |
|---|---|---|
| `jobId` | string | The job identifier |
| `pipeline` | string | Pipeline slug |
| `timestamp` | string (ISO 8601) | When the job was started |
| `seedSummary.name` | string | Seed name |
| `seedSummary.pipeline` | string | Pipeline slug (duplicated for summary) |
| `seedSummary.keys` | string[] | Top-level keys present in the seed object |

- **Serialization:** Pretty-printed JSON (2-space indent), written via `fileIO.writeLog` in `replace` mode.

### Running Map

- **Purpose:** In-memory registry of active child processes, keyed by job ID.
- **Type:** `Map<string, ChildProcess>`
- **Lifecycle:** Entries added when a runner is spawned, removed on child `exit` or `error` events, cleared entirely on `stop()`.

---

## 4. Behavioral Contracts

### Preconditions

- `dataDir` must be a non-falsy string.
- The filesystem must be writable at the resolved `pending/`, `current/`, and `complete/` paths (or their parents must allow creation).

### Postconditions

- After `startOrchestrator` resolves, the three lifecycle directories exist.
- The file watcher is active and will process any `.json` files already present in `pending/` (due to `ignoreInitial: false`).
- For each valid seed file processed: the seed is moved to `current/{jobId}/seed.json`, a `tasks-status.json` is initialized, a start log is written, and a child process is spawned.

### Invariants

- A job ID can only have one active child process at a time. The `isJobActive` check and the `fs.access` check on the destination path enforce idempotency.
- The `running` map accurately reflects which child processes are alive — entries are removed on both `exit` and `error` events.
- The `PO_ROOT` environment variable is temporarily set during `spawnRunner` and restored in a `finally` block, ensuring no permanent mutation of the parent process's environment.

### Ordering Guarantees

- Seed files are processed in the order the watcher emits `add` events. However, since `handleSeedAdd` is asynchronous and there is no queue or serialization mechanism, concurrent processing of multiple seeds is possible. Each seed's processing is independent.
- The watcher startup blocks on the `ready` event before `startOrchestrator` resolves, guaranteeing the watcher is operational before the caller proceeds.

### Concurrency Behavior

- Multiple seeds can be processed concurrently. Each `handleSeedAdd` invocation is mostly independent, but there is shared mutable state in both the `running` map and the temporary mutation of `process.env.PO_ROOT` inside `spawnRunner`.
- The idempotency checks (`isJobActive` and `fs.access` on destination) reduce duplicate processing, but there is a real TOCTOU window between the existence check and the `moveFile` call. Filesystem `rename` is atomic on the same filesystem, which prevents partial moves, but it does not serialize competing handlers.

---

## 5. State Management

### In-Memory State

- **`running` (Map<string, ChildProcess>):** Tracks active child processes by job ID. Created at orchestrator startup, mutated on spawn and child exit/error, cleared on `stop()`. This is the only significant in-memory state.
- **`watcher` (chokidar instance):** Holds the file system watcher. Closed on `stop()`.

### Persisted State

The orchestrator creates and writes the following to disk:

1. **Directory structure:** `pending/`, `current/`, `current/{jobId}/`, `current/{jobId}/tasks/`.
2. **`current/{jobId}/seed.json`:** Moved (renamed) from `pending/`.
3. **`current/{jobId}/tasks-status.json`:** Initialized status file.
4. **Log files:** Written via `fileIO.writeLog` into the job's log directory.

### Crash Recovery

- If the process crashes after moving the seed but before spawning the runner, the job directory exists in `current/` with a status file but no active process. There is no automatic recovery mechanism — the job would remain in `current/` in a `pending` state.
- If the process crashes during `moveFile`, the rename operation is atomic on POSIX systems, so the seed is either in `pending/` or `current/` — not lost.
- The `ignoreInitial: false` watcher option means existing files in `pending/` are re-detected on restart, but seeds already moved to `current/` are not re-processed (due to the `fs.access` check on the destination).

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | Used Exports | Nature | Coupling |
|---|---|---|---|
| `core/config` | `getConfig`, `getPipelineConfig` | Hard import | Moderate — relies on config shape for pipeline registry lookup |
| `core/logger` | `createLogger` | Hard import | Low — only uses the logging interface |
| `core/file-io` | `createTaskFileIO`, `generateLogName` | Hard import | Moderate — uses the file I/O abstraction for log writing |
| `config/log-events` | `LogEvent` | Hard import | Low — only uses `LogEvent.START` constant |
| `cli/self-reexec` | `buildReexecArgs` | Hard import | Low — used only to construct spawn arguments |
| `core/status-initializer` | `initializeStatusFromArtifacts` | Dynamic import (`import()`) | Low — dynamically loaded, failure is non-fatal |

### 6.2 External Dependencies

| Package | Purpose | Usage | Replaceability |
|---|---|---|---|
| `chokidar` | Filesystem watching | Watches `pending/*.json` for new seed files | Replaceable — injected via `watcherFactory` parameter; any watcher with compatible `on('add')` / `on('ready')` / `close()` interface works |
| `node:fs/promises` | Filesystem operations | Reading files, writing JSON, creating directories, renaming files, checking file access | Standard library — fundamental dependency |
| `node:path` | Path manipulation | Joining, parsing, normalizing filesystem paths | Standard library — fundamental dependency |
| `node:child_process` | Process spawning | Spawning pipeline runner processes | Standard library — injected via `spawn` parameter for testability |

### 6.3 System-Level Dependencies

- **File system layout:** Expects a writable directory tree. The `pending/`, `current/`, and `complete/` directories are created automatically.
- **Environment variables:** Reads `PO_ROOT` from the environment (and temporarily mutates it during spawn). Sets `PO_ROOT`, `PO_DATA_DIR`, `PO_PENDING_DIR`, `PO_CURRENT_DIR`, `PO_COMPLETE_DIR`, `PO_PIPELINE_SLUG`, and `PO_DEFAULT_PROVIDER` for child processes.
- **Process management:** Relies on POSIX signal semantics (`SIGTERM`, `SIGKILL`) for graceful child shutdown.

---

## 7. Side Effects & I/O

### File System

| Operation | Description | Sync/Async | Error Handling |
|---|---|---|---|
| `mkdir` (recursive) | Creates `pending/`, `current/`, `complete/`, and per-job `tasks/` directories | Async | Implicit — `recursive: true` is idempotent |
| `readFile` | Reads seed JSON from `pending/` | Async | Silently ignores invalid JSON (returns without processing) |
| `rename` | Moves seed from `pending/` to `current/{jobId}/seed.json` | Async | Logs error and re-throws |
| `writeFile` | Writes `tasks-status.json` | Async | Not explicitly handled (will propagate) |
| `access` | Checks if `current/{jobId}/seed.json` already exists (idempotency guard) | Async | Catch-and-continue (absence is the expected case) |
| `writeLog` | Writes structured start log via file I/O abstraction | Async | Not explicitly handled |
| `chokidar.watch` | Watches `pending/*.json` for file additions | Async (event-driven) | Watcher errors logged; startup errors reject the promise |

### Process Management

| Operation | Description |
|---|---|
| `spawn` | Spawns a child process for the pipeline runner with configured environment variables. stdio: stdin ignored, stdout/stderr inherited. |
| `child.kill('SIGTERM')` | Sent during `stop()` for graceful shutdown. |
| `child.kill('SIGKILL')` | Sent 500ms after SIGTERM if the child hasn't exited (force kill). |

### Logging & Observability

The orchestrator logs via the `createLogger("Orchestrator")` instance at these points:

- **warn:** Non-matching seed filenames, missing pipeline slug in registry, artifact initialization failure.
- **error:** Failed file moves, missing pipeline slug in seed, pipeline lookup failure, spawn errors, seed handling failures.
- **log:** Pipeline runner exit (with exit code, signal, and completion type).

### Timing & Scheduling

- A 500ms `setTimeout` is used during `stop()` to escalate from SIGTERM to SIGKILL if the child process hasn't terminated.
- The chokidar watcher has `awaitWriteFinish: false`, meaning it fires `add` events immediately without waiting for file writes to stabilize.

---

## 8. Error Handling & Failure Modes

### Error Categories & Handling

| Failure | Category | Propagation | Recovery |
|---|---|---|---|
| Missing `dataDir` | Validation | Throws synchronously | Fail-fast — caller must provide |
| Watcher error during startup | I/O | Rejects the startup promise | Fail-fast |
| Invalid seed JSON | I/O | Silently ignored (return without processing) | File left in `pending/` for manual intervention |
| Non-matching seed filename | Validation | Logged as warning, silently skipped | File left in `pending/` |
| Seed already active (duplicate) | Logic | Silently skipped (idempotent) | No action needed |
| File move failure | I/O | Logged and re-thrown from `handleSeedAdd`; caught by the `watcher.on("add")` promise handler | Logged, seed may remain in `pending/` |
| Missing pipeline slug in seed | Validation | Throws from `spawnRunner`; caught by the `watcher.on("add")` promise handler | Job not started; logged |
| Pipeline config lookup failure | Configuration | Throws from `spawnRunner`; caught by the `watcher.on("add")` promise handler | Job not started; logged |
| Status initializer failure | I/O / Logic | Caught and logged as warning | Non-fatal — job proceeds with base status |
| Child spawn error | Process | Caught by `error` event handler; child removed from `running` map | Job effectively orphaned — no retry |
| Child non-zero exit | Process | Logged with exit code and signal | No retry — job remains in `current/` or `complete/` depending on runner behavior |

### Partial Failure

If `handleSeedAdd` fails after moving the seed but before spawning the runner, the job directory exists in `current/` with initialized files but no active process. There is no rollback or cleanup mechanism.

### User/Operator Visibility

All failures are surfaced through structured logger output. There is no direct user notification mechanism — operators must monitor logs.

---

## 9. Integration Points & Data Flow

### Upstream

- **External job submitters** create seed files in the `pending/` directory. This is the sole entry point — the orchestrator is entirely event-driven via filesystem watching.
- **CLI / UI** may call `startOrchestrator` programmatically to launch the orchestrator process.

### Downstream

- **Pipeline runner** (spawned as a child process) receives the job ID as a CLI argument and all necessary paths/configuration via environment variables (`PO_ROOT`, `PO_DATA_DIR`, `PO_PIPELINE_SLUG`, etc.).
- **Status initializer** is optionally invoked to pre-populate the status file from existing artifacts.
- **File I/O subsystem** is used for writing structured logs.

### Data Transformation

```
Seed file (pending/{jobId}-seed.json)
  → Parsed JSON
  → Validated (filename pattern + pipeline slug presence)
  → Moved to current/{jobId}/seed.json
  → Status object created (tasks-status.json)
  → Status optionally enriched from artifacts
  → Start log written
  → Child process spawned with environment config
```

### Control Flow (Primary Use Case: Seed Arrival)

1. Chokidar emits `add` event for a new file in `pending/`.
2. `handleSeedAdd` validates the filename against the regex pattern.
3. Seed JSON is read and parsed.
4. Idempotency checks: is the job already in the `running` map? Does `current/{jobId}/seed.json` already exist?
5. Seed file is atomically moved to `current/{jobId}/seed.json`.
6. `tasks/` directory is created.
7. `tasks-status.json` is initialized (and optionally enriched from artifacts).
8. Orchestrator-level start log is written.
9. `spawnRunner` is called:
   a. `PO_ROOT` is temporarily set on `process.env`.
   b. Pipeline configuration is validated and resolved.
   c. Environment variables are assembled.
   d. `buildReexecArgs` constructs the spawn command.
   e. Child process is spawned and registered in the `running` map.
   f. `exit` and `error` handlers are attached.
   g. `PO_ROOT` is restored in a `finally` block.

---

## 10. Edge Cases & Implicit Behavior

- **`dataDir` normalization:** The `resolveDirs` function is remarkably tolerant of input variation. It detects if `pipeline-data` already appears in the provided path and strips any trailing segments beyond it. This means callers can pass the project root, the `pipeline-data/` directory, or even `pipeline-data/pending/` and get the same canonical result.

- **`ignoreInitial: false`:** The watcher processes files already present in `pending/` at startup, not just newly created ones. This provides crash recovery for seeds that arrived while the orchestrator was down.

- **`awaitWriteFinish: false`:** The watcher fires immediately on file detection without waiting for writes to complete. This means a partially-written seed file could be read. The JSON parse try/catch handles this — invalid JSON is silently ignored, but the file remains in `pending/` with no retry mechanism.

- **Hardcoded `PO_DEFAULT_PROVIDER: "mock"`:** The environment passed to child processes always sets `PO_DEFAULT_PROVIDER` to `"mock"`. This appears to be a testing artifact that would force all spawned runners to use a mock LLM provider. This is likely a bug or an oversight that should be addressed before production use.

- **`process.env.PO_ROOT` mutation:** The `spawnRunner` function temporarily mutates the global `process.env.PO_ROOT` so that `getConfig()` and `getPipelineConfig()` resolve correctly for the job being spawned. This is restored in a `finally` block. If multiple seeds are processed concurrently, there is a potential race condition where one spawn's `PO_ROOT` could affect another's config resolution.

- **500ms SIGKILL escalation:** The timeout for escalating from SIGTERM to SIGKILL is hardcoded to 500ms. There is no configuration for this grace period.

- **No completion logging on exit:** The orchestrator explicitly does **not** write completion logs when a child exits, with a code comment explaining this is to avoid race conditions with the pipeline runner's own filesystem operations (the runner moves the job directory before exiting).

---

## 11. Open Questions & Ambiguities

1. **`PO_DEFAULT_PROVIDER: "mock"` is hardcoded** in the child environment. Is this intentional for all orchestrator-spawned jobs, or is it a leftover from testing? If production jobs should use real providers, this value should come from configuration.

2. **Concurrent `PO_ROOT` mutation:** The temporary mutation of `process.env.PO_ROOT` in `spawnRunner` creates a shared-state race condition if multiple seeds arrive simultaneously. While `getConfig` and `getPipelineConfig` likely read `PO_ROOT` synchronously during the same tick, this pattern is fragile.

3. **No retry for failed seeds:** If a seed file has valid JSON but processing fails (e.g., pipeline config not found), the seed is consumed (potentially moved) but the job is not started. There is no retry mechanism, dead-letter queue, or cleanup to move the seed back to `pending/`.

4. **Orphaned jobs in `current/`:** If the orchestrator crashes after writing status but before spawning, or if a child crashes without the pipeline runner moving the job to `complete/`, jobs can remain in `current/` indefinitely. There is no watchdog or cleanup mechanism for this scenario.

5. **`testMode` parameter:** The `testMode` flag's actual behavioral difference is minimal — in both modes, `spawnRunner` returns the child immediately. The flag may have been intended for more differentiated behavior that was never implemented, or the two code paths may have converged over time.

6. **Default export vs named export:** The module exports `startOrchestrator` as both a named export and as a property of the default export object. It is unclear which form downstream consumers are expected to use, and whether the default export exists for backward compatibility.

7. **Watcher `depth: 0`:** The watcher is configured with `depth: 0`, restricting it to immediate children of `pending/`. This is presumably intentional (seeds should be flat files, not nested), but this constraint is not documented or enforced elsewhere.
