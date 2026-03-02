# SpecOps Analysis: `core/status-writer`

**SOURCE_FILES:**
- `src/core/status-writer.js`
- `src/core/status-initializer.js`

---

## 1. Purpose & Responsibilities

This module is the **authoritative writer and guardian of job status state**. It owns the `tasks-status.json` file — the single status document per job that records overall job state, per-task progress, file manifests, and metadata.

**Problem it solves:** Multiple parts of the system need to update job status concurrently (the orchestrator advancing stages, task runners recording completion, the UI reading snapshots). Without serialization, concurrent writes would corrupt the JSON file or produce lost updates. This module provides serialized, atomic, validated writes to that file.

**Responsibilities:**

- **Atomic persistence** — writes `tasks-status.json` using a temp-file-then-rename pattern so readers never see a partial write.
- **Write serialization** — maintains a per-job promise queue so concurrent callers are serialized; no two writes to the same job directory overlap.
- **Schema validation** — enforces the required shape of the status snapshot on both read and write, auto-healing malformed or missing fields to canonical defaults.
- **Read access** — provides a validated read path that returns `null` on missing/corrupt files rather than throwing.
- **Task-level updates** — offers a convenience function to atomically update a single task's fields within the snapshot.
- **Job reset operations** — provides multiple reset strategies (full clean-slate, from-a-specific-task-onward, single-task) used by restart/retry flows.
- **SSE event emission** — after each successful write, emits real-time SSE events (`state:change`, `task:updated`, `lifecycle_block`) so the UI can react to status changes without polling.
- **Artifact initialization** — writes uploaded artifact files into the job's filesystem and updates the status snapshot to track them.
- **Path security** — validates filenames to prevent path traversal, absolute paths, and other injection vectors when handling artifact uploads.

**Boundaries — what it does NOT do:**

- Does not compute or derive job-level status from task states (that logic lives elsewhere, e.g., in `config/statuses.js`).
- Does not decide *what* status transitions are valid — callers are responsible for passing correct state values.
- Does not manage the job directory lifecycle (creation, movement between pending/current/complete buckets).
- Does not read or write any file other than `tasks-status.json` and artifact files within the job directory.

**Pattern:** This module acts as a **serialized gateway** (Repository + Unit of Work) for a single JSON document, with an optimistic-read / serialize-write concurrency model.

The companion file `status-initializer.js` acts as a **factory/decorator** — it reads the filesystem to discover artifact files and returns a function that can be applied to a status snapshot to populate artifact references. It does not write anything; it produces a transformation function for use with `writeJobStatus`.

---

## 2. Public Interface

### `writeJobStatus(jobDir, updateFn)` — `status-writer.js`

- **Purpose:** Atomically read-modify-write the `tasks-status.json` file for a given job.
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. The basename is used as the job ID. |
| `updateFn` | function | Yes | A callback `(snapshot) => void | snapshot`. Receives the current (validated) status snapshot. May mutate it in place or return a new object. If it returns `undefined`, the mutated input is used. |

- **Return value:** `Promise<Object>` — resolves to the final validated snapshot after the write completes.
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
  - `"updateFn must be a function"` — if `updateFn` is not a function.
  - `"Update function failed: <message>"` — if the update callback throws.
  - Propagates filesystem errors from the atomic write (e.g., permission denied).
- **SSE side effects:** Emits `state:change` event after every successful write. Conditionally emits `lifecycle_block` if the snapshot contains a `lifecycleBlockReason` field.

### `readJobStatus(jobDir)` — `status-writer.js`

- **Purpose:** Read and validate `tasks-status.json`, returning `null` on any read failure.
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. |

- **Return value:** `Promise<Object | null>` — the validated status snapshot, or `null` if the file does not exist, contains invalid JSON, or cannot be read.
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
  - All other errors are caught and result in a `null` return with a console warning.

### `updateTaskStatus(jobDir, taskId, taskUpdateFn)` — `status-writer.js`

- **Purpose:** Convenience wrapper to atomically update a single task's fields within the status snapshot.
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. |
| `taskId` | string | Yes | The unique identifier of the task to update. |
| `taskUpdateFn` | function | Yes | A callback `(task) => void | task`. Receives the task object (auto-created if absent). May mutate or return a replacement. |

- **Return value:** `Promise<Object>` — the full updated status snapshot.
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
  - `"taskId must be a non-empty string"` — if `taskId` is falsy or not a string.
  - `"taskUpdateFn must be a function"` — if `taskUpdateFn` is not a function.
- **SSE side effects:** Emits `task:updated` event with `{ jobId, taskId, task }` payload.

### `resetJobFromTask(jobDir, fromTask, options?)` — `status-writer.js`

- **Purpose:** Reset a job from a specific task onward, preserving earlier completed tasks. Used for partial restarts.
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. |
| `fromTask` | string | Yes | Task identifier to restart from (inclusive — this task and all after it are reset). |
| `options.clearTokenUsage` | boolean | No (default `true`) | Whether to clear `tokenUsage` arrays on reset tasks. |

- **Return value:** `Promise<Object>` — the updated status snapshot.
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
  - `"fromTask must be a non-empty string"` — if `fromTask` is falsy or not a string.
- **Behavior:** Resets root-level `state` to `PENDING`, `current`/`currentStage` to `null`, sets `progress` to 0, then recalculates `progress` based on ALL tasks currently marked `DONE` (before any reset occurs). For each task at or after `fromTask` in insertion order: resets `state` to `PENDING`, clears `currentStage`, removes `failedStage` and `error`, resets `attempts` and `refinementAttempts` to 0, optionally clears `tokenUsage`. Preserves `files.*` arrays. **Note:** The progress calculation counts done tasks before resetting, so the final progress value may not reflect the post-reset task states (see §10 for details).

### `resetJobToCleanSlate(jobDir, options?)` — `status-writer.js`

- **Purpose:** Reset a job and all its tasks to initial state. Used for full restarts.
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. |
| `options.clearTokenUsage` | boolean | No (default `true`) | Whether to clear `tokenUsage` arrays on all tasks. |

- **Return value:** `Promise<Object>` — the updated status snapshot.
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
- **Behavior:** Identical to `resetJobFromTask` but resets *every* task unconditionally. Preserves `files.*` arrays.

### `resetSingleTask(jobDir, taskId, options?)` — `status-writer.js`

- **Purpose:** Reset a single task to pending state without modifying any other tasks or root-level fields (except `lastUpdated`).
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. |
| `taskId` | string | Yes | Task identifier to reset. |
| `options.clearTokenUsage` | boolean | No (default `true`) | Whether to clear `tokenUsage` array on the target task. |

- **Return value:** `Promise<Object>` — the updated status snapshot.
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
  - `"taskId must be a non-empty string"` — if `taskId` is falsy or not a string.
- **Behavior:** Creates the task object if it does not exist. Resets `state` to `PENDING`, `currentStage` to `null`, removes `failedStage` and `error`, resets `attempts` and `refinementAttempts` to 0. Does **not** modify root-level `state`, `current`, or `currentStage`.

### `initializeJobArtifacts(jobDir, uploadArtifacts?)` — `status-writer.js`

- **Purpose:** Write uploaded artifact files to the job's `files/artifacts/` directory on disk.
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. |
| `uploadArtifacts` | Array<{filename, content}> | No (default `[]`) | Array of objects each containing a `filename` (relative path) and `content` (file content to write). |

- **Return value:** `Promise<void>`
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
  - `"uploadArtifacts must be an array"` — if not an array.
- **Behavior:** Creates `files/` and `files/artifacts/` directories if needed. Validates each filename against path traversal rules. Skips (does not throw on) invalid filenames or entries missing a filename. Writes each valid artifact to disk.

### `initializeStatusFromArtifacts({ jobDir, pipeline })` — `status-initializer.js`

- **Purpose:** Scan the job's `files/artifacts/` directory and produce a function that populates artifact references in a status snapshot.
- **Parameters:**

| Name | Type | Required | Semantic Meaning |
|------|------|----------|-----------------|
| `jobDir` | string | Yes | Absolute path to the job directory. |
| `pipeline` | Object | Yes | Pipeline configuration object. Must have a `tasks` array property; the first element identifies which task receives artifact references. |

- **Return value:** `Promise<Function>` — an `apply(snapshot) => snapshot` function. When called, it adds discovered artifact filenames to `snapshot.files.artifacts` (deduplicated) and to the first task's `files.artifacts` (deduplicated). Returns a no-op function if the artifacts directory does not exist or is unreadable.
- **Thrown errors:**
  - `"jobDir must be a non-empty string"` — if `jobDir` is falsy or not a string.
  - `"pipeline must be an object"` — if `pipeline` is falsy or not an object.

---

## 3. Data Models & Structures

### Status Snapshot (root-level `tasks-status.json`)

The primary data structure this module owns. One file per job.

| Field | Type | Required | Semantic Meaning |
|-------|------|----------|-----------------|
| `id` | string | Yes | Job identifier, derived from the job directory's basename. |
| `state` | string (enum) | Yes | Overall job state. One of `"pending"`, `"running"`, `"done"`, `"failed"`. Auto-healed to `"pending"` if missing or non-string. |
| `current` | string \| null | Yes | ID of the currently executing task, or `null` if no task is active. Auto-healed to `null` if non-string and non-null. |
| `currentStage` | string \| null | Yes | ID of the currently executing stage within the current task, or `null`. Auto-healed to `null` if non-string and non-null. |
| `lastUpdated` | string (ISO 8601) | Yes | Timestamp of the last write. Automatically set on every write operation. Auto-healed if missing. |
| `progress` | number \| undefined | No | Percentage progress (0–100). Optional; preserved through read/write round-trips but not validated or auto-healed. |
| `tasks` | Object<string, TaskEntry> | Yes | Map of task ID → task state object. Auto-healed to `{}` if missing or non-object. |
| `files` | FilesManifest | Yes | Manifest of associated files. Auto-healed if missing or malformed. |
| `lifecycleBlockReason` | string \| undefined | No | If present, triggers emission of a `lifecycle_block` SSE event. |
| `lifecycleBlockTaskId` | string \| undefined | No | Task ID associated with the lifecycle block. |
| `lifecycleBlockOp` | string \| undefined | No | Operation that caused the lifecycle block. |

**Lifecycle:** Created on first `writeJobStatus` call for a job directory. Updated throughout job execution. Survives process restarts (persisted to disk). May be reset by the reset functions.

**Ownership:** This module is the sole writer. Other modules read it via `readJobStatus` or by directly reading the JSON file.

**Serialization:** JSON with 2-space indentation. Written atomically via temp-file + rename.

### TaskEntry (per-task within `tasks` map)

| Field | Type | Required | Semantic Meaning |
|-------|------|----------|-----------------|
| `state` | string (enum) | No | Task execution state: `"pending"`, `"running"`, `"done"`, `"failed"`. |
| `currentStage` | string \| null | No | Currently executing stage within this task. |
| `failedStage` | string | No | Stage where failure occurred. Removed on reset. |
| `error` | string | No | Error message. Removed on reset. |
| `attempts` | number | No | Number of execution attempts. Reset to 0 on reset. |
| `refinementAttempts` | number | No | Number of refinement attempts. Reset to 0 on reset. |
| `tokenUsage` | Array | No | Array of token usage records. Optionally cleared on reset. |
| `startedAt` | string (ISO 8601) | No | When the task started. Set by callers, not by this module. |
| `endedAt` | string (ISO 8601) | No | When the task completed. Set by callers, not by this module. |
| `files` | FilesManifest | No | Per-task file manifest. Populated by the status initializer for the first task. |

**Note:** The TaskEntry shape is loosely defined — callers may add arbitrary fields. The module does not validate task-level fields beyond ensuring the task object exists.

### FilesManifest

| Field | Type | Required | Semantic Meaning |
|-------|------|----------|-----------------|
| `artifacts` | Array<string> | Yes | List of artifact filenames. Auto-healed to `[]`. |
| `logs` | Array<string> | Yes | List of log filenames. Auto-healed to `[]`. |
| `tmp` | Array<string> | Yes | List of temporary filenames. Auto-healed to `[]`. |

---

## 4. Behavioral Contracts

### Preconditions

- `jobDir` must be a non-empty string pointing to an existing directory (for write operations; reads tolerate missing directories).
- `updateFn` / `taskUpdateFn` must be synchronous functions (they are not awaited).

### Postconditions

- After `writeJobStatus` resolves: `tasks-status.json` exists on disk with valid JSON, all required fields are present and correctly typed, and `lastUpdated` reflects the write time.
- After any reset function resolves: the affected tasks have `state: "pending"`, `currentStage: null`, `attempts: 0`, `refinementAttempts: 0`, and no `failedStage` or `error` fields. `files.*` arrays are untouched.
- After `initializeJobArtifacts` resolves: valid artifact files exist in `<jobDir>/files/artifacts/`. Invalid filenames are silently skipped.

### Invariants

- **Write serialization:** For a given `jobDir`, at most one read-modify-write cycle is in progress at any time. Concurrent calls are queued via promise chaining.
- **Atomic writes:** The file is never in a partially written state visible to readers. The temp-file-then-rename pattern ensures this on POSIX-compliant filesystems.
- **Schema self-healing:** Every snapshot passing through `validateStatusSnapshot` will have all required fields with valid types, regardless of what was on disk.
- **SSE emission is non-fatal:** If SSE broadcasting fails, the write still succeeds. Errors are logged but swallowed.

### Ordering Guarantees

- Writes to the same `jobDir` are strictly serialized in call order (FIFO promise queue).
- Writes to *different* `jobDir` values are fully independent and may execute concurrently.

### Concurrency Behavior

- The module can be called concurrently from multiple async contexts. The per-job write queue serializes access to the same file.
- There is no locking mechanism beyond the in-memory promise chain — if the process crashes, the queue is lost, but the file is either in its previous state or the new state (atomic rename).
- `readJobStatus` does **not** participate in the write queue — it reads directly from disk. This means a read may see a slightly stale snapshot if a write is queued but not yet flushed. This is a deliberate design choice (reads are non-blocking).

### Test Coverage

Existing tests (`status-writer.test.js`, `status-writer.single-task.test.js`) validate:
- Default status creation on first write.
- Atomic read-modify-write cycle (including temp file + rename pattern).
- Preservation of existing fields across updates.
- Update function returning new object vs. mutating in place.
- Parameter validation (jobDir, updateFn, taskId, taskUpdateFn).
- Error propagation from update function.
- Temp file cleanup on write failure.
- `readJobStatus` returning `null` for missing files, invalid JSON.
- Schema auto-healing of malformed data.
- `updateTaskStatus` creating and updating tasks.
- `progress` field preservation through round-trips (various numeric values, null, undefined).
- Preservation of unknown/extra fields.
- SSE emission on write (including `state:change` event payload format).
- Graceful handling of SSE broadcast failures.
- **Note:** There is a test bug in `status-writer.test.js` — the test "emits state:change event when updateTaskStatus is called" expects `state:change` but the actual `updateTaskStatus` implementation emits `task:updated`. This test may be passing erroneously or may fail depending on test execution order.
- `resetSingleTask` behavior: resets only target task, respects `clearTokenUsage`, creates task if absent, preserves other tasks and files.

**Not covered by tests:** `resetJobFromTask`, `resetJobToCleanSlate`, `initializeJobArtifacts`, `validateFilePath`, `initializeStatusFromArtifacts`, and the `lifecycle_block` SSE emission path.

---

## 5. State Management

### In-Memory State

| State | Type | Lifecycle | Purpose |
|-------|------|-----------|---------|
| `writeQueues` | `Map<string, Promise>` | Module-level singleton. Entries are created on first write to a `jobDir`. The `.finally()` cleanup in the promise chain keeps the map entry alive even after completion — entries are never explicitly removed. | Serializes concurrent writes to the same job directory. Each entry is the tail of a promise chain. |

**Crash behavior:** If the process crashes, the write queue is lost. No in-flight write will have completed its rename (the temp file may remain on disk as an orphan). The `tasks-status.json` file itself is either in its pre-write state or its post-write state — never partially written.

**Memory concern:** The `writeQueues` map grows monotonically — entries are never removed. For long-running processes handling many jobs, this could constitute a slow memory leak (each entry is a resolved promise reference). In practice the overhead is minimal (one Map entry per unique `jobDir`).

### Persisted State

| File | Location | Schema | Read/Write Pattern |
|------|----------|--------|--------------------|
| `tasks-status.json` | `<jobDir>/tasks-status.json` | Status Snapshot (see §3) | Read-modify-write. Always read entirely, modified in memory, written atomically. No partial updates. |
| Artifact files | `<jobDir>/files/artifacts/<filename>` | Arbitrary content | Write-once by `initializeJobArtifacts`. Not modified after creation. |
| Temp files | `<jobDir>/tasks-status.json.tmp.<timestamp>.<random>` | Same as `tasks-status.json` | Transient. Written then immediately renamed. Cleaned up on write failure. |

### Shared State

- `tasks-status.json` is read by other modules (UI state, job reader, etc.) directly from disk. Consistency is maintained by the atomic write pattern — readers see either the old or new version, never a partial write.
- The `sseRegistry` (from `../ui/sse.js`) is shared global state accessed via lazy dynamic import. This module writes to it (broadcasts) but does not own it.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What's Used | Nature | Coupling |
|--------|------------|--------|----------|
| `config/statuses.js` | `TaskState` enum (`PENDING`, `RUNNING`, `DONE`, `FAILED`) | Hard import, compile-time. | Moderate — uses `TaskState.PENDING` and `TaskState.DONE` as constants. Could be replaced with string literals without logic changes. |
| `core/logger.js` | `createJobLogger` function | Hard import, compile-time. | Moderate — used for structured logging and SSE event emission. The logger's `.sse()` method is the mechanism for broadcasting status changes. Replacing the logger would require matching the SSE broadcast interface. |
| `ui/sse.js` | `sseRegistry` (via logger's lazy import) | Indirect runtime dependency through the logger module. | Loose — accessed lazily; gracefully handles absence. |

### 6.2 External Dependencies

| Package | What It Provides | Usage | Replaceability |
|---------|-----------------|-------|---------------|
| `node:fs/promises` | Async filesystem operations | `readFile`, `writeFile`, `rename`, `unlink`, `mkdir`, `access`, `readdir` | Core runtime API — not replaceable but interface is standard across runtimes. |
| `node:path` | Path manipulation | `join`, `basename`, `isAbsolute` | Core runtime API — standard across runtimes. |

### 6.3 System-Level Dependencies

- **File system layout:** Expects `<jobDir>/` to exist as a writable directory. Creates `<jobDir>/files/` and `<jobDir>/files/artifacts/` subdirectories as needed.
- **POSIX rename atomicity:** The atomic write pattern relies on `rename()` being atomic on the target filesystem. This is guaranteed on most POSIX filesystems (ext4, APFS, etc.) but not on all network filesystems.
- **No environment variables** are directly consumed by this module.
- **No network services** are directly accessed (SSE emission is delegated to the logger/registry).

---

## 7. Side Effects & I/O

### File System

| Operation | Target | Sync/Async | Error Handling |
|-----------|--------|------------|----------------|
| Read `tasks-status.json` | `<jobDir>/tasks-status.json` | Async | Returns default on ENOENT/SyntaxError; throws on other errors. |
| Write temp file | `<jobDir>/tasks-status.json.tmp.<ts>.<rand>` | Async | Propagates errors; cleans up temp file on failure. |
| Rename temp → target | Temp → `tasks-status.json` | Async | Propagates errors. |
| Delete temp on failure | Temp file | Async | Ignores cleanup errors. |
| Create directories | `<jobDir>/files/`, `<jobDir>/files/artifacts/` | Async (recursive) | Propagates errors. |
| Write artifact files | `<jobDir>/files/artifacts/<filename>` | Async | Propagates errors (per-file). |
| Read artifacts directory | `<jobDir>/files/artifacts/` | Async | Returns no-op function on ENOENT; logs other errors. |
| Check file existence | `<jobDir>/tasks-status.json` (via `fs.access`) | Async | Caught; ENOENT returns null. |

### Logging & Observability

- Uses `createJobLogger("StatusWriter", jobId)` for all logging.
- Logs errors from update function execution, SSE emission failures.
- `status-initializer.js` logs directly to `console.log` and `console.error` with `[STATUS_INIT]` prefix (does not use the structured logger).
- `readJobStatus` logs warnings to `console.warn` for invalid JSON or read failures.
- `validateFilePath` logs to `console.error` for security violations.

### SSE Events Emitted

| Event Type | Trigger | Payload |
|------------|---------|---------|
| `state:change` | Every successful `writeJobStatus` call | `{ path, id, jobId }` |
| `task:updated` | Every successful `updateTaskStatus` call | `{ jobId, taskId, task }` |
| `lifecycle_block` | `writeJobStatus` when snapshot has `lifecycleBlockReason` | `{ jobId, taskId, op, reason }` |

### Timing & Scheduling

- No timers, intervals, or polling loops.
- Timestamps use `Date.now()` for temp file naming and `new Date().toISOString()` for `lastUpdated` fields.

---

## 8. Error Handling & Failure Modes

### Error Categories

| Category | Source | Handling |
|----------|--------|----------|
| Parameter validation | Callers passing invalid arguments | Throws immediately with descriptive message. |
| Filesystem I/O | Read/write/rename failures | Propagated to caller (except in `readJobStatus` which returns `null`). |
| JSON parse errors | Corrupt `tasks-status.json` | On write path: returns default status and overwrites. On read path: returns `null` with console warning. |
| Update function errors | Caller's callback throws | Wrapped in `"Update function failed: <message>"` and propagated. |
| SSE emission errors | Broadcast failures | Caught and logged; never propagated. Write still succeeds. |
| Path security violations | Invalid artifact filenames | Logged and skipped; does not throw or fail the batch. |

### Propagation Strategy

- **Validation errors:** Throw synchronously (immediately reject the returned promise).
- **I/O errors:** Reject the returned promise (propagated through the write queue chain).
- **SSE errors:** Log-and-continue. The write is considered successful regardless.
- **Malformed data on disk:** Self-heal by applying defaults (write path) or return null (read path).

### Partial Failure

- If `atomicWrite` fails after writing the temp file but before renaming, the temp file is cleaned up (best-effort) and the original `tasks-status.json` remains unchanged.
- If an update function mutates the snapshot but then throws, the mutation is discarded (the write does not proceed).
- In `initializeJobArtifacts`, invalid entries are skipped individually — valid entries in the same batch are still written.

### Recovery

- After a crash, `tasks-status.json` is in a consistent state (either pre-write or post-write). Orphaned `.tmp.*` files may exist but do not affect operation.
- Corrupt JSON is self-healed on the next write (defaults are applied).

---

## 9. Integration Points & Data Flow

### Upstream (Who Calls This Module)

- **Orchestrator / Task Runner** — calls `writeJobStatus` and `updateTaskStatus` to record state transitions as tasks progress through stages.
- **Job control endpoints (UI server)** — calls `resetJobFromTask`, `resetJobToCleanSlate`, `resetSingleTask` to handle user-initiated restarts.
- **Upload endpoints (UI server)** — calls `initializeJobArtifacts` to persist uploaded files.
- **Pipeline runner / Orchestrator** — calls `initializeStatusFromArtifacts` at job startup to populate artifact references in the initial snapshot.
- **UI state / Job reader modules** — calls `readJobStatus` to read current status for display.

### Downstream (What This Module Produces)

- **`tasks-status.json` on disk** — consumed by any module that reads job status.
- **SSE events** — consumed by the UI client via the SSE transport layer. Events trigger real-time UI updates.
- **Artifact files on disk** — consumed by task runners as input data.

### Data Transformation

- **Inbound:** Receives a mutation function from the caller. The function operates on a validated snapshot.
- **Outbound:** Produces a validated, timestamped JSON document on disk plus SSE event payloads.
- The `initializeStatusFromArtifacts` function transforms filesystem state (directory listing) into snapshot mutations (artifact filename arrays).

### Control Flow — Primary Write Path

1. Caller invokes `writeJobStatus(jobDir, updateFn)`.
2. Module looks up or creates the write queue promise for `jobDir`.
3. Chains a new operation onto the queue:
   a. Read `tasks-status.json` (or create default if missing/corrupt).
   b. Validate the snapshot structure (auto-heal).
   c. Execute `updateFn(snapshot)`.
   d. If `updateFn` returned an object, use it; otherwise use the mutated input.
   e. Re-validate the resulting snapshot.
   f. Set `lastUpdated` to current timestamp.
   g. Atomic write: write temp file → rename to target.
   h. Emit `state:change` SSE event.
   i. If `lifecycleBlockReason` is present, emit `lifecycle_block` SSE event.
4. Return the final snapshot to the caller.

---

## 10. Edge Cases & Implicit Behavior

- **Default `id` derivation:** The job ID is implicitly derived from `path.basename(jobDir)`, not from any field in the status file. If the status file already contains a different `id`, it is preserved (not overwritten by the basename). The `createDefaultStatus` function sets `id` from the basename, but subsequent reads preserve whatever `id` is in the file. The validator does not check or enforce the `id` field.

- **Update function return semantics:** If `updateFn` returns `undefined` (i.e., mutates in place and returns nothing), the mutated input object is used. If it returns any non-undefined value (including `null` or a new object), that returned value is used. This means returning `null` would cause a validation error ("Status snapshot must be an object").

- **Write queue never shrinks:** The `writeQueues` Map entries are never deleted. The `.finally(() => {})` callback is a no-op — it was likely intended for cleanup but does not actually remove the entry. Over time, the map accumulates one entry per unique `jobDir`.

- **`resetJobFromTask` ordering assumption:** Uses `Object.keys(snapshot.tasks).indexOf(taskId)` to determine task ordering. This relies on JavaScript's object key insertion order, which is stable in modern engines but is an implicit assumption rather than an explicit sequence.

- **`readJobStatus` redundant `fs.access` call:** Calls `fs.access(statusPath)` before `fs.readFile` — the access check is redundant since `readFile` will throw `ENOENT` anyway. This is a minor performance concern, not a correctness issue.

- **`validateStatusSnapshot` mutates its input:** The validation function modifies the input object in place (setting defaults for missing fields). This is intentional but could surprise callers who expect it to be pure.

- **Status initializer verbose logging:** `status-initializer.js` logs extensively to `console.log` (artifact counts, filenames, final state). This diagnostic logging bypasses the structured logger and would appear in production output.

- **Artifact deduplication in initializer:** Uses `Set`-based deduplication when adding artifact filenames, preventing duplicates even if the function is called multiple times.

- **`resetJobFromTask` progress recalculation quirk:** The function calculates `progress` by counting all `DONE` tasks across the *entire* tasks map *before* resetting any of them. Then it resets tasks from `fromTask` onward. So the progress value reflects pre-reset state, but the tasks themselves are then reset. The final written snapshot has a progress value that may not match the actual task states after reset.

---

## 11. Open Questions & Ambiguities

1. **Write queue memory leak:** The `writeQueues` Map grows without bound. It is unclear whether this is intentional (perhaps the set of job directories is small enough that it doesn't matter) or an oversight. There is no documentation explaining the expected cardinality of concurrent job directories.

2. **`resetJobFromTask` progress calculation:** As noted in §10, the progress is calculated before resetting tasks, producing a potentially misleading value. It's unclear whether this is intentional (showing "progress at time of reset") or a bug (should reflect post-reset state).

3. **`lifecycleBlockReason` / `lifecycleBlockTaskId` / `lifecycleBlockOp`:** These fields trigger SSE event emission but are not documented anywhere. Their lifecycle (when set, when cleared) is entirely determined by callers. It's unclear whether they should be cleared after emission or persist in the snapshot.

4. **`updateTaskStatus` does not emit `state:change`:** Unlike `writeJobStatus`, the `updateTaskStatus` function has its own write queue logic and emits `task:updated` instead of `state:change`. It does not use `writeJobStatus` internally. This means UI listeners for `state:change` will not be notified of task-level updates made via `updateTaskStatus`. It's unclear whether this asymmetry is intentional.

5. **No test coverage for several exported functions:** `resetJobFromTask`, `resetJobToCleanSlate`, `initializeJobArtifacts`, and `initializeStatusFromArtifacts` have no dedicated test coverage. The `lifecycle_block` SSE emission path is also untested.

6. **Status initializer assigns artifacts only to first task:** `initializeStatusFromArtifacts` places artifact references on `pipeline.tasks[0]`. If the pipeline has a different intended recipient for uploaded artifacts, this assumption would be incorrect. The rationale for "first task" is not documented.

7. **`validateFilePath` blocks backslashes unconditionally:** The path validator rejects any filename containing `\`. This prevents Windows-style paths but could also reject legitimate filenames containing backslashes on POSIX systems (though such filenames are rare and generally ill-advised).

8. **No schema versioning:** The `tasks-status.json` format has no version field. If the schema evolves, there is no migration mechanism — the auto-healing validator silently applies current defaults to old schemas.
