# Implementation Specification: `core/status-writer`

**Analysis source:** `docs/specs/analysis/core/status-writer.md`

---

## 1. Qualifications

- TypeScript strict mode (interfaces, discriminated unions, generic `Map` types, index signatures)
- Bun file I/O APIs (`Bun.file()`, `Bun.write()`)
- Node.js-compatible filesystem operations (`node:fs/promises` for `rename`, `unlink`, `mkdir`, `readdir`)
- Atomic file write pattern (temp-file + rename)
- Promise-based write serialization (per-key queuing via `Map<string, Promise>`)
- JSON parsing, serialization, and schema auto-healing
- Path security validation (traversal prevention)
- SSE event emission via logger abstraction

---

## 2. Problem Statement

The system requires serialized, atomic, validated writes to the per-job `tasks-status.json` status document — the single source of truth for job state, per-task progress, file manifests, and metadata. The existing JS implementation provides this via a promise-queue-per-jobDir pattern with temp-file-then-rename atomic writes, schema auto-healing, and SSE event emission on each successful write. This spec defines the TypeScript replacement, leveraging Bun-native file I/O where applicable while preserving the serialization and atomicity guarantees.

---

## 3. Goal

A TypeScript module at `src/core/status-writer.ts` (with a companion `src/core/status-initializer.ts`) that provides identical behavioral contracts to the analyzed JS modules — serialized atomic writes, schema validation with auto-healing, task-level updates, reset operations, artifact initialization, and SSE event emission — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/core/status-writer.ts` | Serialized atomic read-modify-write of `tasks-status.json`, schema validation, reset operations, artifact initialization, SSE event emission. |
| `src/core/status-initializer.ts` | Filesystem scanner that produces a snapshot decorator function to populate artifact references from the `files/artifacts/` directory. |

### Key types and interfaces

```typescript
/** Overall job state enum values. */
type JobState = "pending" | "running" | "done" | "failed";

/** Per-task execution state enum values. */
type TaskState = "pending" | "running" | "done" | "failed";

/** File manifest tracking artifacts, logs, and temporary files. */
interface FilesManifest {
  artifacts: string[];
  logs: string[];
  tmp: string[];
}

/** Per-task state entry within the status snapshot. */
interface TaskEntry {
  state?: TaskState;
  currentStage?: string | null;
  failedStage?: string;
  error?: string;
  attempts?: number;
  refinementAttempts?: number;
  tokenUsage?: unknown[];
  startedAt?: string;
  endedAt?: string;
  files?: FilesManifest;
  [key: string]: unknown;
}

/** Root-level status snapshot persisted to tasks-status.json. */
interface StatusSnapshot {
  id: string;
  state: JobState;
  current: string | null;
  currentStage: string | null;
  lastUpdated: string;
  progress?: number;
  tasks: Record<string, TaskEntry>;
  files: FilesManifest;
  lifecycleBlockReason?: string;
  lifecycleBlockTaskId?: string;
  lifecycleBlockOp?: string;
  [key: string]: unknown;
}

/** Update function signature for writeJobStatus. */
type StatusUpdateFn = (snapshot: StatusSnapshot) => StatusSnapshot | void;

/** Task update function signature for updateTaskStatus. */
type TaskUpdateFn = (task: TaskEntry) => TaskEntry | void;

/** Reset options shared across reset functions. */
interface ResetOptions {
  clearTokenUsage?: boolean;
}

/** Upload artifact descriptor for initializeJobArtifacts. */
interface UploadArtifact {
  filename: string;
  content: string;
}

/** Pipeline descriptor consumed by initializeStatusFromArtifacts. */
interface PipelineDescriptor {
  tasks: Array<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Return type of initializeStatusFromArtifacts — a decorator function. */
type ArtifactApplyFn = (snapshot: StatusSnapshot) => StatusSnapshot;

/** SSE event types emitted by this module. */
type StatusEvent =
  | { type: "state:change"; payload: { path: string; id: string; jobId: string } }
  | { type: "task:updated"; payload: { jobId: string; taskId: string; task: TaskEntry } }
  | { type: "lifecycle_block"; payload: { jobId: string; taskId: string; op: string; reason: string } };
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| `Bun.file(path).text()` replaces `fs.readFile(path, "utf-8")` for status reads | Bun-native file reading, more idiomatic and performant. |
| `Bun.write(path, content)` replaces `fs.writeFile` for temp file writes | Bun-native file writing. |
| `Bun.file(path).exists()` replaces `fs.access` check in `readJobStatus` | Simpler boolean existence check, eliminates redundant access-then-read pattern. |
| `rename` kept from `node:fs/promises` | Bun does not expose a native rename API; `node:fs/promises` rename is fully supported in Bun and required for atomic file operations. |
| `mkdir` and `readdir` kept from `node:fs/promises` | Standard filesystem operations fully supported in Bun. |

### Dependency map

| Source | Import | Purpose |
|--------|--------|---------|
| `../config/statuses` | `TaskState` | `PENDING` and `DONE` constants for reset and progress operations |
| `./logger` | `createJobLogger` | Structured logging and SSE event emission via `.sse()` method |
| `node:fs/promises` | `rename`, `unlink`, `mkdir`, `readdir` | Atomic rename, temp file cleanup, directory operations |
| `node:path` | `join`, `basename`, `isAbsolute` | Path construction and security validation |

---

## 5. Acceptance Criteria

### Core write behavior

1. `writeJobStatus(jobDir, updateFn)` reads `tasks-status.json` from `jobDir`, applies `updateFn` to the validated snapshot, validates the result, sets `lastUpdated`, and writes the result atomically (temp file + rename).
2. If `tasks-status.json` does not exist or contains invalid JSON, a default snapshot is created with `id` derived from `basename(jobDir)`, `state: "pending"`, `current: null`, `currentStage: null`, empty `tasks`, and default `files` manifest.
3. After a successful write, the returned promise resolves to the final validated snapshot.
4. `lastUpdated` is set to an ISO 8601 timestamp on every write.
5. The status file is serialized as JSON with 2-space indentation.
6. If `updateFn` mutates the snapshot in place and returns `undefined`, the mutated input is used. If it returns a non-undefined value, that value is used.
7. Unknown/extra fields in the snapshot are preserved through read-write round-trips.

### Write serialization

8. Concurrent calls to `writeJobStatus` for the same `jobDir` are serialized — at most one read-modify-write cycle is in progress per job directory at any time.
9. Concurrent calls to `writeJobStatus` for different `jobDir` values execute independently.
10. Writes are processed in FIFO order for a given `jobDir`.

### Atomic writes

11. The file is written to a temp file (`tasks-status.json.tmp.<timestamp>.<random>`) and then renamed to `tasks-status.json`.
12. If the write or rename fails, the temp file is cleaned up (best-effort) and the original file is unchanged.

### Read behavior

13. `readJobStatus(jobDir)` returns the validated snapshot, or `null` if the file is missing, contains invalid JSON, or cannot be read.
14. `readJobStatus` does not participate in the write queue — it reads directly from disk.

### Schema validation and auto-healing

15. `validateStatusSnapshot` ensures all required fields exist with correct types: `id` (string), `state` (string, defaults to `"pending"`), `current` (string or null), `currentStage` (string or null), `lastUpdated` (string), `tasks` (object, defaults to `{}`), `files` (object with `artifacts`, `logs`, `tmp` arrays).
16. Missing or malformed fields are auto-healed to canonical defaults without throwing.
17. `files` sub-fields (`artifacts`, `logs`, `tmp`) are auto-healed to empty arrays if missing or not arrays.

### Task-level updates

18. `updateTaskStatus(jobDir, taskId, taskUpdateFn)` atomically updates a single task within the snapshot.
19. If the task does not exist, it is auto-created as an empty object before applying `taskUpdateFn`.
20. `updateTaskStatus` emits a `task:updated` SSE event with `{ jobId, taskId, task }` payload.

### Reset operations

21. `resetJobFromTask(jobDir, fromTask, options?)` resets root-level `state` to `"pending"`, `current` and `currentStage` to `null`, sets `progress` to 0, recalculates `progress` based on tasks marked `"done"` before any reset occurs, then resets all tasks at or after `fromTask` (by insertion order): `state` to `"pending"`, `currentStage` to `null`, removes `failedStage` and `error`, resets `attempts` and `refinementAttempts` to 0, optionally clears `tokenUsage`. Preserves `files.*` arrays.
22. `resetJobToCleanSlate(jobDir, options?)` resets every task unconditionally using the same field-level reset as `resetJobFromTask`. Preserves `files.*` arrays.
23. `resetSingleTask(jobDir, taskId, options?)` resets only the target task: `state` to `"pending"`, `currentStage` to `null`, removes `failedStage` and `error`, resets `attempts` and `refinementAttempts` to 0. Does not modify root-level `state`, `current`, or `currentStage`. Creates the task if absent.
24. `clearTokenUsage` option defaults to `true` for all reset functions.

### SSE event emission

25. `writeJobStatus` emits a `state:change` SSE event after every successful write with `{ path, id, jobId }`.
26. If the snapshot contains `lifecycleBlockReason`, `writeJobStatus` also emits a `lifecycle_block` SSE event with `{ jobId, taskId, op, reason }`.
27. SSE emission failures are caught and logged — they never cause the write to fail.

### Artifact initialization

28. `initializeJobArtifacts(jobDir, uploadArtifacts?)` creates `files/` and `files/artifacts/` directories, validates each filename against path traversal rules, and writes valid artifacts to disk.
29. Invalid filenames (containing `..`, `\`, starting with `/`, or empty) are logged and skipped without throwing.
30. Entries missing a `filename` field are skipped without throwing.

### Status initializer

31. `initializeStatusFromArtifacts({ jobDir, pipeline })` reads the `files/artifacts/` directory and returns an `apply(snapshot)` function that populates `snapshot.files.artifacts` and the first task's `files.artifacts` with discovered filenames, deduplicated.
32. If the artifacts directory does not exist or is unreadable, a no-op function is returned.

### Parameter validation

33. All exported functions throw immediately with a descriptive message if `jobDir` is not a non-empty string.
34. `writeJobStatus` throws if `updateFn` is not a function.
35. `updateTaskStatus` throws if `taskId` is not a non-empty string or `taskUpdateFn` is not a function.
36. `initializeJobArtifacts` throws if `uploadArtifacts` is provided and is not an array.
37. `initializeStatusFromArtifacts` throws if `pipeline` is not an object.

### Error handling

38. If `updateFn` throws, the error is wrapped as `"Update function failed: <message>"` and propagated.
39. Filesystem errors during atomic write are propagated to the caller.
40. `readJobStatus` catches all errors and returns `null` with a console warning.
41. Temp file cleanup errors are silently ignored.

### Path security

42. `validateFilePath` rejects filenames containing `..`, `\`, or starting with `/` (absolute paths). Returns `false` for invalid paths and logs the violation.

---

## 6. Notes

### Design trade-offs

- **Write queue uses `Map<string, Promise>` (in-memory only):** No cross-process locking. This is sufficient because only one process writes to a given `jobDir`. The atomic rename provides crash safety for the file itself — the queue only prevents interleaved writes within the same process.
- **Write queue entries are never removed:** The original JS module has this behavior. In practice the number of unique `jobDir` values is small (bounded by the number of jobs processed in a process lifetime). The memory overhead per entry is one resolved promise reference — negligible. Implementing cleanup would add complexity for minimal gain.
- **`readJobStatus` bypasses the write queue:** This is a deliberate choice from the original design. Reads may see slightly stale data if a write is queued, but this avoids read operations blocking behind slow writes. Callers that need consistency should use `writeJobStatus` with a read-only update function.
- **`updateTaskStatus` has its own write path:** It does not delegate to `writeJobStatus` — it has independent serialization logic and emits `task:updated` instead of `state:change`. This asymmetry is preserved from the original to maintain behavioral compatibility.
- **`validateStatusSnapshot` mutates in place:** The validator modifies the input object. This is intentional — the snapshot passes through validation on both read and write paths, and the mutations ensure self-healing of malformed data without requiring callers to handle a new return value.

### Known risks

- **`resetJobFromTask` progress calculation quirk:** Progress is calculated from done-task count *before* resetting tasks, so the written progress may not match post-reset task states. Preserved as-is for behavioral compatibility — fixing this would be a behavior change that should be decided separately.
- **`resetJobFromTask` relies on `Object.keys` insertion order:** Task ordering is determined by JS object key insertion order. This is stable in modern engines but is an implicit contract. If task ordering needs to be explicit, a future migration could add a `taskOrder` array.
- **No schema versioning:** The status file has no version field. Schema evolution relies on the auto-healing validator to apply defaults for new fields. This is acceptable for the current scope but could become fragile if the schema diverges significantly.
- **`lifecycleBlock*` fields lifecycle unclear:** These fields trigger SSE emission but are never cleared by this module. Callers must manage their lifecycle. The TS implementation preserves this behavior.

### Migration-specific concerns

- **`status-initializer.js` verbose `console.log` logging:** The original uses `console.log` with `[STATUS_INIT]` prefix. The TS version should use `createJobLogger` for consistency with the structured logging approach used in `status-writer.ts`.
- **`readJobStatus` redundant `fs.access` call eliminated:** The original calls `fs.access` before `fs.readFile`. The TS version uses `Bun.file(path).exists()` only if needed, or simply attempts the read and catches `ENOENT` — avoiding the redundant filesystem call.
- **`TaskState` constants vs string literals:** The TS version uses the `TaskState` enum from `config/statuses` for `PENDING` and `DONE` comparisons (matching the original's import), but the `StatusSnapshot` types use string literal unions for clarity. These are compatible as long as the enum values match the literal strings.

### Dependencies on other modules

- Depends on `config/statuses` (`TaskState` enum) being migrated or shimmed.
- Depends on `core/logger` (`createJobLogger`) being migrated or shimmed — specifically the `.sse()` method for event broadcasting.
- The SSE registry (`ui/sse`) is accessed indirectly through the logger — no direct import needed.

### Performance considerations

- `Bun.file().text()` and `Bun.write()` are expected to be faster than their `node:fs` equivalents for the JSON file sizes involved (typically <100KB).
- The write queue serializes per-jobDir, so high-frequency status updates from task runners will queue. This is by design — correctness over throughput.

---

## 7. Implementation Steps

### Step 1: Define types and interfaces

**What:** Create `src/core/status-writer.ts` with all type definitions: `JobState`, `TaskState` (local type alias), `FilesManifest`, `TaskEntry`, `StatusSnapshot`, `StatusUpdateFn`, `TaskUpdateFn`, `ResetOptions`, `UploadArtifact`, and the `STATUS_FILENAME` constant (`"tasks-status.json"`).

**Why:** All subsequent steps depend on these types. Types-first ordering per spec conventions.

**Type signatures:**

```typescript
type JobState = "pending" | "running" | "done" | "failed";

interface FilesManifest {
  artifacts: string[];
  logs: string[];
  tmp: string[];
}

interface TaskEntry {
  state?: string;
  currentStage?: string | null;
  failedStage?: string;
  error?: string;
  attempts?: number;
  refinementAttempts?: number;
  tokenUsage?: unknown[];
  startedAt?: string;
  endedAt?: string;
  files?: FilesManifest;
  [key: string]: unknown;
}

interface StatusSnapshot {
  id: string;
  state: JobState;
  current: string | null;
  currentStage: string | null;
  lastUpdated: string;
  progress?: number;
  tasks: Record<string, TaskEntry>;
  files: FilesManifest;
  lifecycleBlockReason?: string;
  lifecycleBlockTaskId?: string;
  lifecycleBlockOp?: string;
  [key: string]: unknown;
}

type StatusUpdateFn = (snapshot: StatusSnapshot) => StatusSnapshot | void;
type TaskUpdateFn = (task: TaskEntry) => TaskEntry | void;

interface ResetOptions {
  clearTokenUsage?: boolean;
}

interface UploadArtifact {
  filename: string;
  content: string;
}

const STATUS_FILENAME = "tasks-status.json";
```

**Test:** `tests/core/status-writer.test.ts` — import all exported types and the `STATUS_FILENAME` constant. Assert `STATUS_FILENAME === "tasks-status.json"`.

---

### Step 2: Implement `validateFilePath`

**What:** Add `validateFilePath(filename: string): boolean` to `src/core/status-writer.ts`. Returns `false` and logs to `console.error` if the filename: is empty or not a string, contains `..`, contains `\`, or starts with `/`. Returns `true` otherwise.

**Why:** Acceptance criterion 42. Required by `initializeJobArtifacts` (Step 9) and must be defined before it.

**Type signature:**

```typescript
function validateFilePath(filename: string): boolean
```

**Test:** `tests/core/status-writer.test.ts` — assert: (1) `validateFilePath("report.txt")` returns `true`; (2) `validateFilePath("../etc/passwd")` returns `false`; (3) `validateFilePath("path\\file")` returns `false`; (4) `validateFilePath("/absolute/path")` returns `false`; (5) `validateFilePath("")` returns `false`; (6) `validateFilePath("subdir/file.txt")` returns `true` (relative paths without traversal are valid).

---

### Step 3: Implement `createDefaultStatus` and `validateStatusSnapshot`

**What:** Add `createDefaultStatus(jobDir: string): StatusSnapshot` — returns a new snapshot with `id` set to `basename(jobDir)`, `state: "pending"`, `current: null`, `currentStage: null`, `lastUpdated` set to current ISO timestamp, `tasks: {}`, and `files: { artifacts: [], logs: [], tmp: [] }`.

Add `validateStatusSnapshot(snapshot: unknown, jobDir: string): StatusSnapshot` — takes an unknown value, ensures it is an object (falls back to `createDefaultStatus` if not), then auto-heals each required field: `id` (preserve if string, else set from basename), `state` (preserve if string, else `"pending"`), `current` (preserve if string or null, else `null`), `currentStage` (preserve if string or null, else `null`), `lastUpdated` (preserve if string, else current timestamp), `tasks` (preserve if object, else `{}`), `files` (preserve if object, then heal sub-arrays). Returns the healed snapshot, mutating the input in place.

**Why:** Acceptance criteria 2, 15, 16, 17. Required by all read and write operations.

**Type signatures:**

```typescript
function createDefaultStatus(jobDir: string): StatusSnapshot
function validateStatusSnapshot(snapshot: unknown, jobDir: string): StatusSnapshot
```

**Test:** `tests/core/status-writer.test.ts` — (1) `createDefaultStatus("/jobs/abc")` produces snapshot with `id: "abc"`, `state: "pending"`, etc. (2) `validateStatusSnapshot({}, "/jobs/xyz")` produces a fully valid snapshot with defaults. (3) `validateStatusSnapshot({ state: "running", extra: "preserved" }, "/jobs/xyz")` preserves `state: "running"` and `extra: "preserved"`. (4) `validateStatusSnapshot({ files: { artifacts: "bad" } }, "/jobs/xyz")` heals `files.artifacts` to `[]`. (5) `validateStatusSnapshot(null, "/jobs/xyz")` returns a default snapshot. (6) `validateStatusSnapshot({ current: 42 }, "/jobs/xyz")` heals `current` to `null`.

---

### Step 4: Implement `atomicWrite`

**What:** Add `atomicWrite(filePath: string, content: string): Promise<void>` to `src/core/status-writer.ts`. Generates a temp file path as `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`. Writes `content` to the temp file using `Bun.write()`. Renames the temp file to `filePath` using `rename()` from `node:fs/promises`. On any error, attempts to delete the temp file (via `unlink`, ignoring cleanup errors) and re-throws.

**Why:** Acceptance criteria 11, 12. The foundation for all write operations.

**Type signature:**

```typescript
async function atomicWrite(filePath: string, content: string): Promise<void>
```

**Test:** `tests/core/status-writer.test.ts` — (1) write content to a temp directory, assert the target file contains the correct content and no `.tmp.*` files remain. (2) Simulate a rename failure (e.g., target directory doesn't exist), assert the temp file is cleaned up and the error is thrown.

---

### Step 5: Implement `writeJobStatus`

**What:** Add `writeJobStatus(jobDir: string, updateFn: StatusUpdateFn): Promise<StatusSnapshot>` to `src/core/status-writer.ts`. Validates parameters (throw if `jobDir` is not a non-empty string, throw if `updateFn` is not a function). Maintains a module-level `writeQueues: Map<string, Promise<StatusSnapshot>>`. Chains a new operation onto the queue for `jobDir`:

1. Read `tasks-status.json` via `Bun.file(statusPath).text()` — on any error (ENOENT, parse failure), use `createDefaultStatus(jobDir)`.
2. Parse JSON and validate via `validateStatusSnapshot`.
3. Call `updateFn(snapshot)` in a try/catch — wrap errors as `"Update function failed: <message>"`.
4. If `updateFn` returned non-undefined, use the returned value; otherwise use the mutated input.
5. Re-validate the result via `validateStatusSnapshot`.
6. Set `lastUpdated` to `new Date().toISOString()`.
7. Call `atomicWrite` with `JSON.stringify(snapshot, null, 2)`.
8. Emit `state:change` SSE event via `createJobLogger`. Catch and log SSE errors.
9. If `snapshot.lifecycleBlockReason` is truthy, emit `lifecycle_block` SSE event. Catch and log.
10. Return the snapshot.

**Why:** Acceptance criteria 1–7, 8–10, 25–27, 33, 34, 38, 39.

**Type signature:**

```typescript
export function writeJobStatus(jobDir: string, updateFn: StatusUpdateFn): Promise<StatusSnapshot>
```

**Test:** `tests/core/status-writer.test.ts` — (1) first write to a new job creates `tasks-status.json` with default fields plus the update. (2) Second write reads existing file, applies update, preserves previous fields. (3) `updateFn` returning a new object uses that object. (4) `updateFn` mutating in place (returning undefined) uses the mutated input. (5) Invalid `jobDir` throws `"jobDir must be a non-empty string"`. (6) Non-function `updateFn` throws `"updateFn must be a function"`. (7) Throwing `updateFn` propagates as `"Update function failed: ..."`. (8) `lastUpdated` is refreshed on every write. (9) Concurrent writes to the same `jobDir` are serialized (second write sees first write's result). (10) Writes to different `jobDir` values are independent.

---

### Step 6: Implement SSE emission in `writeJobStatus`

**What:** After the atomic write in `writeJobStatus`, emit SSE events using `createJobLogger(basename(jobDir)).sse()`:

- Always emit `state:change` with `{ path: statusPath, id: snapshot.id, jobId: basename(jobDir) }`.
- If `snapshot.lifecycleBlockReason` is truthy, also emit `lifecycle_block` with `{ jobId: basename(jobDir), taskId: snapshot.lifecycleBlockTaskId, op: snapshot.lifecycleBlockOp, reason: snapshot.lifecycleBlockReason }`.
- Wrap each emission in try/catch — log errors, never propagate.

**Why:** Acceptance criteria 25, 26, 27.

**Test:** `tests/core/status-writer.test.ts` — (1) Mock the logger's `.sse()` method. Write a status. Assert `state:change` was emitted with correct payload. (2) Write a status with `lifecycleBlockReason` set. Assert both `state:change` and `lifecycle_block` events were emitted. (3) Mock `.sse()` to throw. Assert the write still succeeds and the error is logged.

---

### Step 7: Implement `readJobStatus`

**What:** Add `readJobStatus(jobDir: string): Promise<StatusSnapshot | null>` to `src/core/status-writer.ts`. Validates `jobDir` (throw if not a non-empty string). Attempts to read and parse `tasks-status.json` via `Bun.file(statusPath).text()`. On success, validates via `validateStatusSnapshot` and returns the result. On any error (file not found, invalid JSON, I/O error), logs a warning to `console.warn` and returns `null`.

**Why:** Acceptance criteria 13, 14, 33, 40.

**Type signature:**

```typescript
export function readJobStatus(jobDir: string): Promise<StatusSnapshot | null>
```

**Test:** `tests/core/status-writer.test.ts` — (1) Reading a valid `tasks-status.json` returns the validated snapshot. (2) Reading from a non-existent directory returns `null`. (3) Reading a file with invalid JSON returns `null`. (4) The returned snapshot has auto-healed fields. (5) Invalid `jobDir` throws `"jobDir must be a non-empty string"`.

---

### Step 8: Implement `updateTaskStatus`

**What:** Add `updateTaskStatus(jobDir: string, taskId: string, taskUpdateFn: TaskUpdateFn): Promise<StatusSnapshot>` to `src/core/status-writer.ts`. Validates parameters (throw on invalid `jobDir`, `taskId`, or `taskUpdateFn`). Uses its own write serialization (shares the same `writeQueues` map as `writeJobStatus`): reads the status file, validates, ensures `snapshot.tasks[taskId]` exists (auto-create as `{}`), calls `taskUpdateFn(task)` — if it returns non-undefined, uses the return value; otherwise uses the mutated input. Sets `lastUpdated`, writes atomically. Emits `task:updated` SSE event with `{ jobId: basename(jobDir), taskId, task: snapshot.tasks[taskId] }`. Returns the full snapshot.

**Why:** Acceptance criteria 18, 19, 20, 33, 35.

**Type signature:**

```typescript
export function updateTaskStatus(jobDir: string, taskId: string, taskUpdateFn: TaskUpdateFn): Promise<StatusSnapshot>
```

**Test:** `tests/core/status-writer.test.ts` — (1) Updating an existing task modifies only that task's fields. (2) Updating a non-existent task auto-creates it. (3) Invalid `jobDir` throws. (4) Invalid `taskId` throws. (5) Non-function `taskUpdateFn` throws. (6) `task:updated` SSE event is emitted with correct payload.

---

### Step 9: Implement `resetJobFromTask`

**What:** Add `resetJobFromTask(jobDir: string, fromTask: string, options?: ResetOptions): Promise<StatusSnapshot>` to `src/core/status-writer.ts`. Validates `jobDir` and `fromTask`. Uses `writeJobStatus` internally to perform the reset atomically:

1. Set root `state` to `"pending"`, `current` to `null`, `currentStage` to `null`.
2. Set `progress` to 0.
3. Count tasks with `state === "done"` across all tasks (before any reset) and recalculate `progress` as `(doneCount / totalCount) * 100`.
4. Find the index of `fromTask` in `Object.keys(snapshot.tasks)`.
5. For each task at that index or later: set `state` to `"pending"`, `currentStage` to `null`, delete `failedStage`, delete `error`, set `attempts` to 0, set `refinementAttempts` to 0. If `options.clearTokenUsage !== false`, set `tokenUsage` to `[]`.
6. Preserve all `files.*` arrays on all tasks.

**Why:** Acceptance criteria 21, 24, 33.

**Type signature:**

```typescript
export function resetJobFromTask(jobDir: string, fromTask: string, options?: ResetOptions): Promise<StatusSnapshot>
```

**Test:** `tests/core/status-writer.test.ts` — (1) Set up a snapshot with 4 tasks (A: done, B: done, C: failed, D: pending). Call `resetJobFromTask(jobDir, "C")`. Assert: A and B are unchanged, C and D are reset to pending with cleared fields, root state is pending. (2) Assert `progress` reflects pre-reset done count. (3) Assert `files` arrays on all tasks are preserved. (4) With `clearTokenUsage: false`, assert `tokenUsage` is preserved on reset tasks. (5) Invalid `jobDir` or `fromTask` throws.

---

### Step 10: Implement `resetJobToCleanSlate`

**What:** Add `resetJobToCleanSlate(jobDir: string, options?: ResetOptions): Promise<StatusSnapshot>` to `src/core/status-writer.ts`. Validates `jobDir`. Delegates to `writeJobStatus` with an update function that resets every task unconditionally using the same field-level reset as `resetJobFromTask`. Also resets root `state` to `"pending"`, `current` and `currentStage` to `null`, `progress` to 0.

**Why:** Acceptance criteria 22, 24, 33.

**Type signature:**

```typescript
export function resetJobToCleanSlate(jobDir: string, options?: ResetOptions): Promise<StatusSnapshot>
```

**Test:** `tests/core/status-writer.test.ts` — (1) Set up a snapshot with multiple tasks in various states. Call `resetJobToCleanSlate`. Assert all tasks are reset, root state is pending, progress is 0. (2) Assert `files` arrays on all tasks are preserved. (3) With `clearTokenUsage: false`, `tokenUsage` is preserved. (4) Invalid `jobDir` throws.

---

### Step 11: Implement `resetSingleTask`

**What:** Add `resetSingleTask(jobDir: string, taskId: string, options?: ResetOptions): Promise<StatusSnapshot>` to `src/core/status-writer.ts`. Validates `jobDir` and `taskId`. Uses `writeJobStatus` internally. Auto-creates the task if absent. Resets only the target task: `state` to `"pending"`, `currentStage` to `null`, deletes `failedStage` and `error`, sets `attempts` and `refinementAttempts` to 0, optionally clears `tokenUsage`. Does not modify root-level `state`, `current`, `currentStage`, or `progress`. Does not modify other tasks.

**Why:** Acceptance criteria 23, 24, 33, 35.

**Type signature:**

```typescript
export function resetSingleTask(jobDir: string, taskId: string, options?: ResetOptions): Promise<StatusSnapshot>
```

**Test:** `tests/core/status-writer.test.ts` — (1) Reset a failed task; assert only that task is reset, other tasks and root fields are unchanged. (2) Reset a non-existent task; assert the task is created with pending state. (3) Assert `files` on the task is preserved. (4) `clearTokenUsage: false` preserves `tokenUsage`. (5) Invalid `jobDir` or `taskId` throws.

---

### Step 12: Implement `initializeJobArtifacts`

**What:** Add `initializeJobArtifacts(jobDir: string, uploadArtifacts?: UploadArtifact[]): Promise<void>` to `src/core/status-writer.ts`. Validates `jobDir` (throw if not non-empty string). If `uploadArtifacts` is provided, validate it is an array (throw if not). Defaults to `[]`. Creates `<jobDir>/files/` and `<jobDir>/files/artifacts/` directories via `mkdir({ recursive: true })`. Iterates over each artifact: skip if no `filename` field, skip if `validateFilePath` returns false, otherwise write `content` to `<jobDir>/files/artifacts/<filename>` via `Bun.write()`.

**Why:** Acceptance criteria 28, 29, 30, 33, 36.

**Type signature:**

```typescript
export function initializeJobArtifacts(jobDir: string, uploadArtifacts?: UploadArtifact[]): Promise<void>
```

**Test:** `tests/core/status-writer.test.ts` — (1) Pass two valid artifacts; assert both files exist in `files/artifacts/`. (2) Pass an artifact with `filename: "../escape.txt"`; assert it is skipped and the other valid artifacts are written. (3) Pass an entry with no `filename`; assert it is skipped. (4) Call with no artifacts; assert directories are created but empty. (5) Invalid `jobDir` throws. (6) Non-array `uploadArtifacts` throws.

---

### Step 13: Implement `initializeStatusFromArtifacts`

**What:** Create `src/core/status-initializer.ts`. Export `initializeStatusFromArtifacts({ jobDir, pipeline }: { jobDir: string; pipeline: PipelineDescriptor }): Promise<ArtifactApplyFn>`. Validates `jobDir` and `pipeline`. Reads the `<jobDir>/files/artifacts/` directory via `readdir`. On error (ENOENT or other), return a no-op function `(snapshot) => snapshot`. On success, return a function that:

1. Ensures `snapshot.files.artifacts` exists as an array.
2. Adds discovered filenames to `snapshot.files.artifacts`, deduplicated via `Set`.
3. Locates the first task in `pipeline.tasks` by its `id`.
4. Ensures `snapshot.tasks[firstTaskId].files.artifacts` exists as an array.
5. Adds discovered filenames to that task's artifacts, deduplicated via `Set`.
6. Returns the modified snapshot.

Use `createJobLogger` for logging instead of raw `console.log`.

**Why:** Acceptance criteria 31, 32, 33, 37.

**Type signatures:**

```typescript
export function initializeStatusFromArtifacts(opts: {
  jobDir: string;
  pipeline: PipelineDescriptor;
}): Promise<ArtifactApplyFn>
```

**Test:** `tests/core/status-initializer.test.ts` — (1) Create a `files/artifacts/` directory with two files. Call `initializeStatusFromArtifacts`. Apply the returned function to a snapshot with an empty first task. Assert `snapshot.files.artifacts` contains both filenames and `snapshot.tasks[firstTaskId].files.artifacts` contains both filenames. (2) Call with a non-existent artifacts directory; assert the returned function is a no-op (snapshot unchanged). (3) Call twice with same directory; assert no duplicate filenames. (4) Invalid `jobDir` throws. (5) Invalid `pipeline` throws.

---

### Step 14: Export public API

**What:** Ensure `src/core/status-writer.ts` exports the following named exports: `writeJobStatus`, `readJobStatus`, `updateTaskStatus`, `resetJobFromTask`, `resetJobToCleanSlate`, `resetSingleTask`, `initializeJobArtifacts`. Ensure `src/core/status-initializer.ts` exports `initializeStatusFromArtifacts`. Export all public types: `StatusSnapshot`, `TaskEntry`, `FilesManifest`, `StatusUpdateFn`, `TaskUpdateFn`, `ResetOptions`, `UploadArtifact`.

**Why:** Establishes the module's public API surface and ensures type exports are available to downstream consumers.

**Type signatures:** All signatures defined in prior steps.

**Test:** `tests/core/status-writer.test.ts` — import each exported function and type. Assert all functions are defined and are functions (`typeof fn === "function"`).

---

### Step 15: Write serialization integration test

**What:** Write an integration test that validates write serialization under concurrency. Launch 10 concurrent `writeJobStatus` calls to the same `jobDir`, each incrementing a counter field. After all resolve, assert: (1) the counter equals 10, (2) all 10 writes produced distinct `lastUpdated` values or the same value (depending on timing), (3) the file on disk contains the final state. Also launch 5 concurrent writes to two different `jobDir` values (10 total) and assert each directory's counter is independently correct.

**Why:** Validates acceptance criteria 8, 9, 10 under realistic concurrency.

**Test:** `tests/core/status-writer.integration.test.ts` — as described. Use `Bun.tempdir` or `mkdtemp` for filesystem isolation.
