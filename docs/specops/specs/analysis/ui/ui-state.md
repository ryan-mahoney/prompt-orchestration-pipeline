# Analysis Spec: `ui/state`

## 1. Purpose & Responsibilities

This module is a collection of loosely-coupled subsystems that collectively own the **server-side state layer** of the UI. Its responsibilities span:

- **In-memory change tracking** — maintaining a running log of file-system changes observed by the watcher (`state.js`).
- **Snapshot composition** — assembling a minimal, canonical representation of all known jobs for client bootstrap and API responses (`state-snapshot.js`).
- **File-system watching** — monitoring pipeline directories for real-time file changes and routing those changes to SSE broadcast and state updates (`watcher.js`).
- **Job change detection** — classifying file-system paths into job-relevant change categories (status, task, seed) so downstream consumers can react selectively (`job-change-detector.js`).
- **Analysis locking** — providing a process-wide mutex so only one pipeline analysis operation runs at a time (`lib/analysis-lock.js`).
- **Mention parsing** — extracting `@[display](id)` artifact references from chat messages for schema enrichment (`lib/mention-parser.js`).
- **Schema loading** — reading JSON Schema, sample data, and metadata files from disk for task creation prompt enrichment (`lib/schema-loader.js`).
- **SSE stream creation** — setting up Server-Sent Event response streams on Express response objects (`lib/sse.js`).
- **Task code review** — using an LLM to review and optionally correct generated task code (`lib/task-reviewer.js`).
- **Job list transformation** — aggregating, sorting, filtering, grouping, and projecting job lists for API consumption (`transformers/list-transformer.js`).
- **Job status transformation** — normalizing raw job payloads from disk into canonical job objects with computed status, progress, costs, and pipeline metadata (`transformers/status-transformer.js`).

**Boundaries:** This module does NOT:
- Persist state to disk (it reads from disk but does not write job data).
- Own the SSE broadcast/fan-out mechanism (that lives in `sse-enhancer.js` and `sse-broadcast.js`).
- Own the job reading or scanning logic (it delegates to `job-scanner.js` and `job-reader.js`).
- Execute pipeline runs or manage the orchestrator lifecycle.

**Pattern:** The module acts as a **data transformation and observation layer** — it observes file-system events, transforms raw disk data into canonical shapes, and provides in-memory coordination primitives (locks, state).

---

## 2. Public Interface

### `state.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `getState()` | Returns a shallow copy of the current in-memory state. | None | `{ updatedAt: string, changeCount: number, recentChanges: ChangeEntry[], watchedPaths: string[] }` | None |
| `recordChange(path, type)` | Records a file change event into the in-memory state. Prepends to `recentChanges` (FIFO, capped at 10), increments `changeCount`, updates `updatedAt`. | `path`: the file path that changed; `type`: change classification (`'created'`, `'modified'`, or `'deleted'`) | Updated state (shallow copy, same shape as `getState()`) | None |
| `reset()` | Resets state to initial values. Preserves `watchedPaths` but clears `changeCount` and `recentChanges`. | None | `void` | None |
| `setWatchedPaths(paths)` | Sets the list of directories being watched. Replaces existing watched paths entirely. | `paths`: array of directory path strings | `void` | None |

### `state-snapshot.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `composeStateSnapshot(options?)` | Pure function that composes a minimal snapshot object from provided data (no I/O). | `options.jobs`: array of job-like objects (optional); `options.meta`: metadata object or version string (optional); `options.transformJob`: custom normalization function (optional) | `{ jobs: NormalizedJob[], meta: { version: string, lastUpdated: string } }` | None (defensive; handles missing/malformed input gracefully) |
| `buildSnapshotFromFilesystem(deps?)` | Async function that reads jobs from disk, transforms them, deduplicates, sorts, and returns a canonical snapshot. | `deps.listAllJobs`: `() => { current: string[], complete: string[] }`; `deps.readJob`: `(id, location) => ReadResult`; `deps.transformMultipleJobs`: `(results) => Job[]`; `deps.now`: `() => Date`; `deps.paths`: resolved PATHS object. All optional — falls back to dynamic imports. | `Promise<{ jobs: SnapshotJob[], meta: { version: string, lastUpdated: string } }>` | Throws `Error` if required dependencies (`listAllJobs`, `readJob`, `transformMultipleJobs`) are neither injected nor importable. Individual job read failures are caught and logged as warnings. |

### `watcher.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `start(paths, onChange, options)` | Starts a chokidar file watcher on the given paths. Debounces change events and invokes `onChange` with batched changes. Also detects job-specific changes and routes them to `sseEnhancer`. Detects `registry.json` changes and invalidates config cache. | `paths`: array of directory paths; `onChange`: callback receiving `ChangeEntry[]`; `options.baseDir`: base directory for path normalization (required); `options.debounceMs`: debounce interval in ms (default 200) | `{ _chokidarWatcher, _debounceTimer, close: () => Promise<void> }` | Throws `Error` if `options.baseDir` is not provided. |
| `stop(watcher)` | Stops a running watcher instance by calling its `close()` method. | `watcher`: watcher instance returned by `start` | `Promise<void>` | None (no-ops on null/undefined input) |

### `job-change-detector.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `detectJobChange(filePath)` | Given a file path, determines whether it belongs to a job and classifies the change category. | `filePath`: absolute or relative file path string | `{ jobId: string, category: 'status'\|'task'\|'seed', filePath: string }` or `null` if not a job-related path | None |
| `getJobLocation(filePath)` | Extracts the lifecycle location from a pipeline-data path. | `filePath`: absolute or relative file path string | `'current'\|'complete'\|'pending'\|'rejected'` or `null` | None |

### `lib/analysis-lock.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `acquireLock(pipelineSlug)` | Attempts to acquire the singleton analysis lock. | `pipelineSlug`: non-empty string pipeline identifier | `{ acquired: true }` or `{ acquired: false, heldBy: string }` | Throws `Error` if `pipelineSlug` is not a non-empty string. |
| `releaseLock(pipelineSlug)` | Releases the analysis lock. Only the holder can release it. | `pipelineSlug`: the pipeline that holds the lock | `void` | Throws `Error` if no lock is held, if `pipelineSlug` is invalid, or if the lock is held by a different pipeline. |
| `getLockStatus()` | Returns the current lock state. | None | `{ pipelineSlug: string, startedAt: Date }` or `null` | None |

### `lib/mention-parser.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `parseMentions(messages)` | Extracts unique filenames from `@[display](id)` mentions in an array of chat messages. | `messages`: array of `{ role: string, content: string }` | `string[]` — unique filenames (the `id` portion of mentions) | None |

### `lib/schema-loader.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `loadSchemaContext(pipelineSlug, fileName)` | Loads a JSON Schema file, sample data file, and optional meta file for a given artifact filename within a pipeline. | `pipelineSlug`: pipeline identifier; `fileName`: artifact filename (e.g. `"analysis-output.json"`) | `Promise<{ fileName, schema: object, sample: object, meta?: object } \| null>` — returns `null` on any error (missing files, parse errors, pipeline not found) | None (all errors caught internally, returns `null`) |
| `buildSchemaPromptSection(contexts)` | Builds a markdown-formatted section from an array of schema contexts for inclusion in a system prompt. | `contexts`: array of schema context objects | `string` — markdown content, or empty string if no contexts | None |

### `lib/sse.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `streamSSE(res)` | Sets SSE headers on an Express response and returns a sender/closer object. | `res`: Express response object | `{ send(event: string, data: any): void, end(): void }` | None |

### `lib/task-reviewer.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `reviewAndCorrectTask(code, guidelines)` | Sends task code and pipeline guidelines to an LLM for review. Returns the original code if `NO_CHANGES_NEEDED`, otherwise returns the LLM's corrected output with markdown fences stripped. | `code`: task source code string; `guidelines`: pipeline task guidelines string | `Promise<string>` — corrected code or original code | Propagates any error from the LLM call (`createHighLevelLLM().chat()`). |

### `transformers/list-transformer.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `getStatusPriority(status)` | Maps a job status string to a numeric priority (higher = higher priority). | `status`: string | `number` (4=running, 3=error, 2=pending, 1=complete, 0=unknown) | None |
| `sortJobs(jobs)` | Sorts jobs by status priority descending, then `createdAt` ascending, then id ascending. Filters out invalid jobs (missing id, status, or createdAt). | `jobs`: array of job objects | Sorted array (new array, does not mutate input) | None |
| `aggregateAndSortJobs(currentJobs, completeJobs)` | Merges current and complete job lists with current-wins deduplication, then sorts via `sortJobs`. | `currentJobs`, `completeJobs`: arrays of job objects | Sorted, deduplicated array | Catches and logs internal errors; returns `[]` on failure. |
| `groupJobsByStatus(jobs)` | Groups jobs into buckets: `{ running: [], error: [], pending: [], complete: [] }`. Unknown statuses are silently dropped. | `jobs`: array of job objects | `{ running: Job[], error: Job[], pending: Job[], complete: Job[] }` | None |
| `getJobListStats(jobs)` | Computes aggregate statistics: total count, by-status counts, by-location counts, and floor-averaged progress. | `jobs`: array of job objects (default `[]`) | `{ total: number, byStatus: Record<string, number>, byLocation: Record<string, number>, averageProgress: number }` | None |
| `filterJobs(jobs, searchTerm, options)` | Filters jobs by case-insensitive search term (matches title or id) and optional `status`/`location` filters. Preserves original order. | `jobs`: array; `searchTerm`: string (default `""`); `options.status`: filter by status; `options.location`: filter by location | Filtered array | None |
| `transformJobListForAPI(jobs, options)` | Projects job objects to API-safe shape with controlled field inclusion, cost summaries (zeroed if absent), and optional pipeline metadata enrichment. | `jobs`: array (default `[]`); `options.includePipelineMetadata`: boolean (default `true`) | Array of API-shaped job objects | None |
| `getAggregationStats(currentJobs, completeJobs, aggregatedJobs)` | Computes aggregation diagnostics: total input, total output, duplicates, efficiency percentage, status and location distributions. | Three arrays (all default `[]`) | `{ totalInput, totalOutput, duplicates, efficiency, statusDistribution, locationDistribution }` | None |

### `transformers/status-transformer.js`

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `computeJobStatus(tasksInput, existingProgress?)` | Computes canonical job status and progress from a tasks object. Emits `console.warn` for unknown task states. | `tasksInput`: object keyed by task name with `{ state }` values; `existingProgress`: optional pre-calculated progress number | `{ status: string, progress: number }` | None (returns `{ status: 'pending', progress: 0 }` for invalid input) |
| `transformTasks(rawTasks)` | Normalizes raw task input (object or array) into canonical keyed object. Preserves timing metadata, files, errors, artifacts. | `rawTasks`: object or array of task objects | `Record<string, CanonicalTask>` | None (returns `{}` for invalid input; emits `console.warn` for invalid states) |
| `transformJobStatus(raw, jobId, location)` | Transforms a single raw job payload into the canonical job object expected by UI and API. Computes status from tasks, calculates costs, derives pipeline metadata. | `raw`: raw job JSON object; `jobId`: directory-derived job identifier; `location`: lifecycle bucket string | Canonical job object or `null` for invalid input | None (emits `console.warn` for job ID mismatches) |
| `transformMultipleJobs(jobReadResults)` | Transforms an array of job read results, filtering out failed reads (`ok !== true`). Logs `"Transforming N jobs"` for observability. | `jobReadResults`: array of `{ ok, data, jobId, location }` read result envelopes | Array of canonical job objects | None |
| `getTransformationStats(readResults, transformedJobs)` | Computes transformation diagnostics: read counts, success rates, status distribution. | `readResults`: array of read results; `transformedJobs`: array of transformed jobs | `{ totalRead, successfulReads, successfulTransforms, failedTransforms, transformationRate, statusDistribution }` | None |

---

## 3. Data Models & Structures

### ChangeEntry

- **Purpose:** Represents a single file-system change event.
- **Fields:**
  | Field | Type | Optionality | Meaning |
  |-------|------|-------------|---------|
  | `path` | string | required | Normalized relative file path that changed |
  | `type` | string | required | One of `'created'`, `'modified'`, `'deleted'` |
  | `timestamp` | string (ISO 8601) | required | When the change was recorded |
- **Lifecycle:** Created in `recordChange()`, stored in `recentChanges` (capped at 10), discarded on `reset()` or when pushed out by newer entries.
- **Ownership:** Owned by `state.js`.
- **Serialization:** Not persisted. In-memory only.

### State Object (`state.js`)

- **Purpose:** Module-level singleton tracking aggregate file change state.
- **Fields:**
  | Field | Type | Meaning |
  |-------|------|---------|
  | `updatedAt` | string (ISO 8601) | Timestamp of most recent state mutation |
  | `changeCount` | number | Cumulative count of recorded changes (never resets except via `reset()`) |
  | `recentChanges` | ChangeEntry[] | Most recent changes, newest first, max 10 |
  | `watchedPaths` | string[] | Currently watched directory paths |
- **Lifecycle:** Created at module load time. Mutated by `recordChange`, `reset`, `setWatchedPaths`. Survives until process termination.
- **Ownership:** Owned and mutated exclusively by `state.js`.

### NormalizedJob (snapshot)

- **Purpose:** Minimal job representation for client bootstrap via `composeStateSnapshot`.
- **Fields:**
  | Field | Type | Meaning |
  |-------|------|---------|
  | `jobId` | string or null | Unique job identifier (coerced to string) |
  | `status` | string or null | Job status |
  | `title` | string or null | Human-readable job title |
  | `updatedAt` | string or null | Last update timestamp |
- **Lifecycle:** Created by `composeStateSnapshot`, consumed by client.
- **Ownership:** Produced by this module, consumed downstream.

### SnapshotJob (filesystem snapshot)

- **Purpose:** Richer job representation for the filesystem-based snapshot builder.
- **Fields:**
  | Field | Type | Meaning |
  |-------|------|---------|
  | `jobId` | string | Canonical job identifier |
  | `title` | string | Job title (defaults to `"Unnamed Job"`) |
  | `status` | string | Canonical status (defaults to `"pending"`) |
  | `progress` | number | Progress percentage 0–100 (defaults to 0) |
  | `createdAt` | string or null | Creation timestamp |
  | `updatedAt` | string or null | Last update timestamp |
  | `location` | string | Lifecycle bucket (`"current"` or `"complete"`, defaults to `"current"`) |
- **Lifecycle:** Created by `buildSnapshotFromFilesystem`, returned to caller.

### JobChange

- **Purpose:** Describes a detected job-related file change.
- **Fields:**
  | Field | Type | Meaning |
  |-------|------|---------|
  | `jobId` | string | The affected job's identifier |
  | `category` | string | `'status'` (tasks-status.json), `'task'` (anything under tasks/), or `'seed'` (seed.json) |
  | `filePath` | string | Normalized path starting with `pipeline-data/...` |
- **Lifecycle:** Created by `detectJobChange`, consumed by `sseEnhancer.handleJobChange`.
- **Ownership:** Produced by `job-change-detector.js`, consumed by watcher and SSE subsystem.

### LockState

- **Purpose:** Represents the current analysis lock holder.
- **Fields:**
  | Field | Type | Meaning |
  |-------|------|---------|
  | `pipelineSlug` | string | Identifier of the pipeline holding the lock |
  | `startedAt` | Date | When the lock was acquired |
- **Lifecycle:** Created on `acquireLock`, destroyed on `releaseLock`. Null when no lock is held.
- **Ownership:** Owned by `analysis-lock.js`.

### SchemaContext

- **Purpose:** Loaded schema, sample, and metadata for a referenced artifact file.
- **Fields:**
  | Field | Type | Optionality | Meaning |
  |-------|------|-------------|---------|
  | `fileName` | string | required | The artifact filename |
  | `schema` | object | required | Parsed JSON Schema |
  | `sample` | object | required | Parsed sample data |
  | `meta` | object | optional | Parsed metadata (if `{baseName}.meta.json` exists) |
- **Lifecycle:** Created by `loadSchemaContext`, consumed by `buildSchemaPromptSection`.

### CanonicalTask (status-transformer)

- **Purpose:** Normalized task object within a canonical job.
- **Fields:**
  | Field | Type | Optionality | Meaning |
  |-------|------|-------------|---------|
  | `state` | string | required | Normalized task state (via `normalizeTaskState`) |
  | `name` | string | required | Task display name |
  | `files` | object | required | Normalized task files (via `normalizeTaskFiles`) |
  | `startedAt` | any | optional | When task execution started |
  | `endedAt` | any | optional | When task execution ended |
  | `attempts` | any | optional | Number of execution attempts |
  | `executionTimeMs` | number | optional | Execution duration in milliseconds |
  | `refinementAttempts` | any | optional | Number of refinement attempts |
  | `stageLogPath` | string | optional | Path to stage log file |
  | `errorContext` | any | optional | Error context metadata |
  | `currentStage` | string | optional | Currently executing stage name |
  | `failedStage` | string | optional | Stage where failure occurred |
  | `artifacts` | any | optional | Task artifacts |
  | `error` | object or null | optional | Normalized error object `{ message, ... }` |
- **Lifecycle:** Created by `transformTasks`, embedded in canonical job objects.

### Canonical Job Object (status-transformer)

- **Purpose:** The fully-normalized job representation consumed by UI and API layers.
- **Key Fields:**
  | Field | Type | Meaning |
  |-------|------|---------|
  | `id` | string | Job identifier (API-facing) |
  | `jobId` | string | Job identifier (backward-compat) |
  | `name` | string | Job title (API-facing) |
  | `title` | string | Job title (backward-compat) |
  | `status` | string | Derived from task states |
  | `progress` | number | Pre-calculated progress value |
  | `createdAt` | string or null | ISO timestamp |
  | `updatedAt` | string or null | ISO timestamp |
  | `location` | string or null | Lifecycle bucket |
  | `tasks` | Record<string, CanonicalTask> | Normalized tasks |
  | `files` | object | Normalized job-level files |
  | `costs` | object | Formatted cost data from token usage |
  | `pipeline` | string | optional | Pipeline identifier |
  | `pipelineLabel` | string | optional | Human-readable pipeline label |
  | `pipelineConfig` | object | optional | Preserved if present in raw data |
  | `current` | any | optional | Current stage cursor |
  | `currentStage` | any | optional | Current stage name |
  | `warnings` | string[] | optional | Transformation warnings (e.g. ID mismatches) |

### API Job Object (list-transformer)

- **Purpose:** Projected job object for API responses with controlled field inclusion.
- **Key Fields:** `jobId`, `title`, `status`, `progress`, `createdAt`, `updatedAt`, `location`, `tasks` (slim), `files` (if present), `current`, `currentStage`, `costsSummary` (always present, zeroed if absent), `pipelineSlug`, `pipeline`, `pipelineLabel`.
- **Notable:** `costsSummary` is always included with a zeroed structure even when the job has no cost data.

---

## 4. Behavioral Contracts

### Preconditions

- `watcher.start()` requires `options.baseDir` to be a non-empty string.
- `acquireLock()` and `releaseLock()` require `pipelineSlug` to be a non-empty string.
- `releaseLock()` requires the lock to be currently held by the specified pipeline.
- `buildSnapshotFromFilesystem()` requires `listAllJobs`, `readJob`, and `transformMultipleJobs` to be available (either injected or importable).

### Postconditions

- After `recordChange()`, `state.changeCount` is incremented by exactly 1 and `recentChanges` contains the new entry at index 0.
- After `reset()`, `changeCount` is 0, `recentChanges` is empty, but `watchedPaths` is preserved.
- After `acquireLock()` succeeds, `getLockStatus()` returns the lock holder.
- After `releaseLock()` succeeds, `getLockStatus()` returns `null`.
- `composeStateSnapshot()` always returns `{ jobs: [], meta: {...} }` shape, never throws.
- `aggregateAndSortJobs()` always returns an array (empty on error).
- `transformJobListForAPI()` always includes a `costsSummary` on each output job.

### Invariants

- `recentChanges` never exceeds `MAX_RECENT_CHANGES` (10) entries.
- At most one analysis lock is held at any time (singleton mutex).
- `getState()` returns a shallow copy — mutations to the returned object do not affect internal state.
- `setWatchedPaths()` stores a copy of the input array.
- `detectJobChange()` only recognizes paths matching `pipeline-data/{current|complete|pending|rejected}/{jobId}/...` and validates job IDs against `[A-Za-z0-9-_]+`.
- Job deduplication in `aggregateAndSortJobs` and `buildSnapshotFromFilesystem` gives precedence to "current" over "complete".

### Ordering Guarantees

- `recentChanges` is maintained in reverse chronological order (newest first, FIFO with prepend).
- `sortJobs` sorts by status priority (descending) → `createdAt` (ascending) → id (ascending).
- `buildSnapshotFromFilesystem` sorts by location weight (current=0, complete=1) → status priority → updatedAt (descending) → id (ascending).
- Watcher events are debounced and batched, so individual event ordering within a batch is insertion order but delivery timing is coalesced.

### Concurrency Behavior

- `state.js` uses module-level mutable state — not thread-safe, but acceptable in a single-threaded event loop.
- `analysis-lock.js` uses module-level mutable state — same single-threaded assumption.
- `buildSnapshotFromFilesystem` reads all jobs concurrently via `Promise.all`.
- The watcher debounce mechanism accumulates events during the debounce window and flushes as a batch.

---

## 5. State Management

### In-Memory State

| State | Location | Lifecycle | Cleanup |
|-------|----------|-----------|---------|
| `state` object | `state.js` module scope | Created at module load; mutated by `recordChange`, `reset`, `setWatchedPaths` | `reset()` clears changes; no cleanup on process exit |
| `currentLock` | `analysis-lock.js` module scope | `null` at load; set by `acquireLock`, cleared by `releaseLock` | No automatic cleanup — if process crashes with lock held, it is simply lost |
| `debounceTimer` + `pendingChanges` | `watcher.js` closure per watcher instance | Created per `start()` call; cleared on `close()` | `close()` clears timer and pending changes |
| Chokidar watcher instance | `watcher.js` closure | Created per `start()` call; closed on `close()` | `watcher.close()` releases OS file handles |

### Persisted State

This module reads from the file system but does not write job state. Specifically:
- `buildSnapshotFromFilesystem` reads from `pipeline-data/{current,complete}/` directories.
- `loadSchemaContext` reads from `{pipelineDir}/schemas/` directory.
- The watcher observes file system changes but does not write.

### Shared State

- The `state.js` singleton is implicitly shared across all importers within the same process.
- The `analysis-lock.js` singleton is process-wide shared state.
- Both are vulnerable to process crash — no recovery mechanism exists. State is simply reinitialized on restart.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | Used By | What's Used | Coupling |
|--------|---------|-------------|----------|
| `job-change-detector.js` | `watcher.js` | `detectJobChange` | Moderate — watcher calls detector for every file event |
| `sse-enhancer.js` | `watcher.js` | `sseEnhancer.handleJobChange` | Moderate — watcher pushes job changes to SSE enhancer |
| `core/logger.js` | `watcher.js` | `createLogger` | Low — logging utility |
| `core/config.js` | `watcher.js` | `resetConfig` (dynamic import) | Low — only used for registry.json change detection |
| `core/config.js` | `schema-loader.js` | `getPipelineConfig` | Moderate — needed to resolve pipeline directory paths |
| `llm/index.js` | `task-reviewer.js` | `createHighLevelLLM` | Moderate — LLM creation abstraction |
| `providers/base.js` | `task-reviewer.js` | `stripMarkdownFences` | Low — utility function |
| `utils/pipelines.js` | `list-transformer.js`, `status-transformer.js` | `derivePipelineMetadata` | Moderate — pipeline metadata enrichment |
| `utils/task-files.js` | `status-transformer.js` | `normalizeTaskFiles` | Low — file normalization utility |
| `utils/token-cost-calculator.js` | `status-transformer.js` | `calculateJobCosts`, `formatCostDataForAPI` | Moderate — cost computation |
| `config/statuses.js` | `status-transformer.js` | `VALID_TASK_STATES`, `normalizeTaskState`, `deriveJobStatusFromTasks`, `TaskState` | High — defines canonical task/job status semantics |
| `job-scanner.js` | `state-snapshot.js` (lazy import fallback) | `listAllJobs` | Low — injected or lazy-loaded |
| `job-reader.js` | `state-snapshot.js` (lazy import fallback) | `readJob` | Low — injected or lazy-loaded |
| `config-bridge.js` | `state-snapshot.js` (lazy import) | `PATHS`, `Constants.STATUS_ORDER` | Low — lazy-loaded for sorting config |
| `transformers/status-transformer.js` | `state-snapshot.js` (lazy import fallback) | `transformMultipleJobs` | Low — injected or lazy-loaded |

### 6.2 External Dependencies

| Package | Used By | Capability | Replaceability |
|---------|---------|------------|----------------|
| `chokidar` | `watcher.js` | Cross-platform file system watching | Localized to `watcher.js`; could be replaced with any FS watcher API |
| `node:path` | `watcher.js`, `schema-loader.js` | Path manipulation | Standard library |
| `node:fs` (promises) | `schema-loader.js` | File reading | Standard library |

### 6.3 System-Level Dependencies

- **File system layout:** Expects `pipeline-data/{current,complete,pending,rejected}/{jobId}/` directory structure. Expects `pipeline-config/registry.json` at the project root level. Expects `{pipelineDir}/schemas/{baseName}.schema.json` and `.sample.json` for schema loading.
- **OS features:** File system watching via OS-level inotify/FSEvents/kqueue (through chokidar).
- **Runtime:** Single-threaded event loop assumed for in-memory state safety.

---

## 7. Side Effects & I/O

### File System

| Operation | Location | Sync/Async | Error Handling |
|-----------|----------|------------|----------------|
| Directory watching (read-only) | `watcher.js` | Async (event-driven) | Chokidar handles internally; watcher logs errors via logger |
| Read job data files | `state-snapshot.js` (via `readJob` dep) | Async | Individual read failures caught, logged as warnings, skipped |
| Read schema/sample/meta JSON files | `schema-loader.js` | Async | All errors caught, returns `null` |
| Dynamic import of `core/config.js` to call `resetConfig` | `watcher.js` | Async | Caught; logged as error if fails |

### Network

- `lib/sse.js` writes SSE-formatted data to an Express HTTP response stream. Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- `lib/task-reviewer.js` makes an LLM API call via `createHighLevelLLM().chat()`.

### Logging & Observability

- `watcher.js` uses `createLogger("Watcher")` for debug and info-level logging of file events.
- `lib/sse.js` uses `console.log` with `[sse]` prefix for stream lifecycle events.
- `status-transformer.js` uses `console.warn` for unknown/invalid task states and job ID mismatches. Uses `console.log` for `"Transforming N jobs"` progress.
- `list-transformer.js` uses `console.error` for aggregation failures.

### Timing & Scheduling

- `watcher.js` uses `setTimeout`/`clearTimeout` for debouncing file change events (default 200ms window).
- No other timers, intervals, or polling loops.

---

## 8. Error Handling & Failure Modes

### `state.js`
No error handling — operations are simple in-memory mutations that cannot fail under normal conditions.

### `state-snapshot.js`
- **Missing dependencies:** `buildSnapshotFromFilesystem` throws synchronously if `listAllJobs`, `readJob`, or `transformMultipleJobs` cannot be resolved.
- **Individual job read failures:** Caught in per-job try/catch, logged as `console.warn`, and included in results as error envelopes (`{ ok: false, code, message }`). These are filtered out by `transformMultipleJobs`.
- **Empty results:** Returns `{ jobs: [], meta }` rather than throwing.

### `watcher.js`
- **Missing baseDir:** Throws `Error` synchronously from `start()`.
- **Registry.json reload failure:** Caught and logged via `logger.error`. Does not propagate — watcher continues operating.
- **Chokidar errors:** Delegated to chokidar's internal error handling.

### `job-change-detector.js`
No error handling needed — pure regex-based classification. Returns `null` for unrecognized paths.

### `analysis-lock.js`
- **Invalid input:** Throws `Error` with descriptive message.
- **Release without lock:** Throws `Error`.
- **Release by wrong holder:** Throws `Error`.

### `schema-loader.js`
- All errors (missing files, JSON parse errors, pipeline config errors) caught in a single try/catch. Returns `null`.

### `task-reviewer.js`
- Empty or no-changes LLM responses cause the original code to be returned unchanged.
- LLM call failures propagate to the caller (no internal catch).

### `list-transformer.js`
- `aggregateAndSortJobs` wraps all logic in try/catch, returns `[]` on error, logs via `console.error`.
- All other functions are defensive: invalid input produces empty results rather than exceptions.

### `status-transformer.js`
- Invalid raw input to `transformJobStatus` returns `null`.
- Invalid tasks input to `computeJobStatus` returns `{ status: 'pending', progress: 0 }`.
- Unknown task states trigger `console.warn` but do not throw.

---

## 9. Integration Points & Data Flow

### Upstream (Who Calls This Module)

- **UI Server endpoints** call `composeStateSnapshot`, `buildSnapshotFromFilesystem` for client bootstrap and state API.
- **UI Server** calls `watcher.start()` during server initialization to begin file monitoring.
- **Endpoint handlers** call `acquireLock`/`releaseLock` to serialize pipeline analysis operations.
- **Task creation endpoints** call `parseMentions` and `loadSchemaContext`/`buildSchemaPromptSection` for prompt enrichment.
- **Task save endpoints** call `reviewAndCorrectTask` for LLM-based code review.
- **Job list endpoints** call `aggregateAndSortJobs`, `filterJobs`, `transformJobListForAPI` to serve job data.
- **Job reader pipeline** calls `transformMultipleJobs` and `transformJobStatus` to normalize raw disk data.
- **SSE endpoints** use `streamSSE` to establish event streams.

### Downstream (What This Module Calls)

- `watcher.js` → `job-change-detector.detectJobChange()` → `sseEnhancer.handleJobChange()`
- `watcher.js` → `core/config.resetConfig()` (dynamic, on registry.json changes)
- `state-snapshot.js` → `job-scanner.listAllJobs()`, `job-reader.readJob()`, `status-transformer.transformMultipleJobs()`
- `schema-loader.js` → `core/config.getPipelineConfig()`
- `task-reviewer.js` → `llm/index.createHighLevelLLM()` → LLM API
- `status-transformer.js` → `config/statuses.*`, `utils/task-files.*`, `utils/token-cost-calculator.*`, `utils/pipelines.*`
- `list-transformer.js` → `utils/pipelines.derivePipelineMetadata()`

### Data Transformation Flow

1. **File change → State update:** Raw FS path → normalized relative path → `ChangeEntry` → `state.recentChanges`
2. **File change → Job event:** Raw FS path → `detectJobChange()` → `JobChange` → `sseEnhancer.handleJobChange()`
3. **Disk → Snapshot:** `listAllJobs()` → `readJob()` per ID → `transformMultipleJobs()` → dedupe → sort → map to `SnapshotJob` → `{ jobs, meta }`
4. **Raw job → Canonical job:** Raw JSON → `transformTasks()` → `computeJobStatus()` → `calculateJobCosts()` → `derivePipelineMetadata()` → Canonical Job Object
5. **Canonical jobs → API response:** Canonical jobs → `aggregateAndSortJobs()` → `filterJobs()` → `transformJobListForAPI()` → API Job Objects

### System Patterns

- The watcher participates in the **Observer pattern** — it observes file system events and notifies the SSE subsystem and state manager.
- The analysis lock implements a simple **Mutex pattern** for serializing pipeline analysis.
- The transformers implement a **Pipeline/Chain pattern** — raw data flows through successive transformation stages (normalize tasks → compute status → compute costs → enrich metadata).
- `buildSnapshotFromFilesystem` uses **Dependency Injection** for testability — all collaborators can be injected or fall back to lazy imports.

---

## 10. Edge Cases & Implicit Behavior

- **`state.js` uses module-level mutable state.** Multiple imports within the same process share the same singleton. This is intentional for a single-server deployment but would break under multi-process or worker-thread architectures.

- **`reset()` preserves `watchedPaths`.** The reset function intentionally keeps the watched paths list intact while clearing all change tracking data.

- **`composeStateSnapshot` tolerates extremely varied input shapes.** It attempts to extract job IDs from `jobId`, `id`, `uid`, `job_id`, or `jobID` fields. Similarly for status (`status`, `state`, `s`) and title (`title`, `name`, `summary`). This defensive normalization accommodates legacy or inconsistent data formats.

- **`buildSnapshotFromFilesystem` uses lazy dynamic imports** for `job-scanner.js`, `job-reader.js`, `status-transformer.js`, and `config-bridge.js`. This avoids circular dependency issues at boot time and makes the module independently testable.

- **Watcher ignores `.git`, `node_modules`, `dist` directories** and `_task_root` subdirectories within task trees. These are hardcoded ignore patterns.

- **Watcher skips "modified" events for files under `pipeline-data/.../files/`** — these are considered noisy (log file updates) and only creation events are propagated for this path pattern.

- **Watcher detects `pipeline-config/registry.json` changes** (both add and modify events) and dynamically imports `core/config.js` to call `resetConfig()`, invalidating the config cache. This provides live config reload without server restart.

- **`detectJobChange` validates job IDs** against `[A-Za-z0-9-_]+`. Paths with job IDs containing other characters are silently ignored.

- **`detectJobChange` recognizes four lifecycle directories** (`current`, `complete`, `pending`, `rejected`) but only three change categories (`status`, `task`, `seed`). Files not matching these categories (e.g., a top-level `config.json` within a job directory) return `null`.

- **`transformJobStatus` dual-names fields** for backward compatibility: `id`/`jobId` and `name`/`title` are both set on the output object to satisfy both API consumers and legacy UI code.

- **Cost summary is always present** in `transformJobListForAPI` output — if the job has no cost data, a zeroed structure with all fields set to `0` is included.

- **`STATUS_ORDER` fallback in `buildSnapshotFromFilesystem`:** If `configBridge.Constants.STATUS_ORDER` is not available, a hardcoded fallback `["error", "running", "complete", "pending"]` is used for sorting priority.

- **`aggregateAndSortJobs` catches all exceptions** — any internal error results in an empty array return rather than propagating.

- **`sortJobs` filters out invalid jobs** (missing id, status, or createdAt) before sorting. This means input jobs with missing required fields are silently dropped from the output.

- **`getJobListStats` uses `Math.floor`** for average progress, not `Math.round`. This means progress is always rounded down.

- **`reviewAndCorrectTask` returns the original code** when the LLM response is empty or contains `NO_CHANGES_NEEDED` anywhere in the trimmed content (uses `includes`, not exact match).

---

## 11. Open Questions & Ambiguities

- **`state.js` vs `state-snapshot.js` relationship is unclear.** Both manage "state" but serve different purposes. `state.js` tracks file change events while `state-snapshot.js` builds job snapshots. There is no cross-reference between them. It is ambiguous whether `state.js` is still actively used or if it has been partially superseded by snapshot-based approaches.

- **`MAX_RECENT_CHANGES = 10` lacks documented rationale.** It is unclear why 10 was chosen as the cap for recent changes.

- **`composeStateSnapshot` meta field handling is unusual.** When `options.meta` is a non-object (e.g., a string), the entire value is used as `version`. This means `composeStateSnapshot({ meta: "2" })` produces `{ version: "2", lastUpdated: "..." }`. The intent behind this dual interpretation is not documented.

- **`lib/sse.js` vs `src/ui/sse.js` naming overlap.** There is a `lib/sse.js` (the file analyzed here) and a top-level `src/ui/sse.js` and `src/ui/sse-broadcast.js`. The relationship and delineation between these three SSE-related files could be confusing.

- **`lib/sse.js` uses `console.log` directly** while `watcher.js` uses the structured `createLogger`. This inconsistency in logging strategy across files in the same subsystem may be intentional (the SSE helper is minimal) or an oversight.

- **`task-reviewer.js` error propagation is not symmetrical.** LLM call failures propagate as exceptions, but an LLM response containing malformed code (after `stripMarkdownFences`) is silently returned as the "corrected" code. There is no validation that the LLM output is syntactically valid.

- **`buildSnapshotFromFilesystem` sorts by a `STATUS_ORDER` that differs from `list-transformer.js`'s `getStatusPriority`.** The snapshot builder uses `["error", "running", "complete", "pending"]` while the list transformer uses numeric priorities `{running: 4, error: 3, pending: 2, complete: 1}`. These encode different priority orderings for the same statuses. Whether this is intentional (different contexts require different sort orders) or an inconsistency is unclear.

- **`transformJobStatus` outputs both `id`/`name` and `jobId`/`title`.** The comment says "API expects 'id' not 'jobId'" but both are included. It is unclear when the `id`/`name` convention will fully replace `jobId`/`title`, or if both must be maintained permanently.

- **`getJobLocation` recognizes `pending` and `rejected` locations** but `buildSnapshotFromFilesystem` only reads from `current` and `complete`. Jobs in `pending` or `rejected` directories are not included in snapshots. Whether this is intentional (only active jobs shown) or a gap is not documented.

- **`TaskState` is imported but not used** in `status-transformer.js`. It may be imported for type documentation purposes or could be dead code.
