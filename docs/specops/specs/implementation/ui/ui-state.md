# Implementation Specification: `ui/state`

**Analysis source:** `docs/specs/analysis/ui/ui-state.md`

---

## 1. Qualifications

- TypeScript strict mode (discriminated unions, generic constraints, mapped types)
- Bun file I/O (`Bun.file()` for JSON reads in schema-loader and snapshot builder)
- Bun-native filesystem watching (chokidar as cross-platform abstraction, evaluated against Bun's `fs.watch`)
- Server-Sent Events protocol (SSE framing, headers, `ReadableStream`-based response construction)
- In-memory state management (module-level singletons, shallow-copy immutability)
- Mutex/lock patterns (single-holder process-wide lock)
- Debounce/batch patterns (timer-based event coalescing)
- LLM API integration (chat-based code review with response parsing)
- Data transformation pipelines (multi-stage normalization: raw disk data -> canonical job objects -> API projections)
- Regular expressions (path parsing, job ID extraction, mention syntax)
- JSON Schema handling (loading/parsing schema and sample files)
- Dependency injection (constructor/parameter-based for testability)

---

## 2. Problem Statement

The system requires a server-side state layer that tracks file-system changes, assembles job snapshots from disk, classifies file events into job-relevant categories, provides analysis locking, and transforms raw job data into canonical shapes for API and UI consumption. The existing JS implementation provides this via module-level singletons (`state.js`, `analysis-lock.js`), a chokidar-based watcher (`watcher.js`), pure transformation functions (`status-transformer.js`, `list-transformer.js`), and assorted utility modules (`mention-parser.js`, `schema-loader.js`, `sse.js`, `task-reviewer.js`). This spec defines the TypeScript replacement, migrating Express SSE helpers to Bun-native `ReadableStream` responses, replacing `node:fs` reads with `Bun.file()`, and enforcing strict types across all data transformation boundaries.

---

## 3. Goal

A TypeScript module rooted at `src/ui/state/` that provides identical behavioral contracts to the analyzed JS module — in-memory change tracking, filesystem snapshot composition, file-system watching with debounced batching, job change detection, analysis locking, mention parsing, schema loading, SSE stream creation, LLM-based task review, and job list/status transformation — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/ui/state/types.ts` | Shared type and interface definitions for all submodules. |
| `src/ui/state/index.ts` | Barrel re-export of the public API and types from all submodules. |
| `src/ui/state/change-tracker.ts` | In-memory change tracking: `getState()`, `recordChange()`, `reset()`, `setWatchedPaths()`. Replaces `state.js`. |
| `src/ui/state/snapshot.ts` | Snapshot composition: `composeStateSnapshot()` (pure) and `buildSnapshotFromFilesystem()` (async I/O). Replaces `state-snapshot.js`. |
| `src/ui/state/watcher.ts` | File-system watching: `startWatcher()`, `stopWatcher()`. Debounced batching, job change routing, registry reload. Replaces `watcher.js`. |
| `src/ui/state/job-change-detector.ts` | Pure path classification: `detectJobChange()`, `getJobLocation()`. Replaces `job-change-detector.js`. |
| `src/ui/state/analysis-lock.ts` | Process-wide mutex: `acquireLock()`, `releaseLock()`, `getLockStatus()`. Replaces `lib/analysis-lock.js`. |
| `src/ui/state/mention-parser.ts` | Mention extraction: `parseMentions()`. Replaces `lib/mention-parser.js`. |
| `src/ui/state/schema-loader.ts` | Schema/sample/meta loading: `loadSchemaContext()`, `buildSchemaPromptSection()`. Replaces `lib/schema-loader.js`. |
| `src/ui/state/sse-stream.ts` | SSE response stream factory: `createSSEStream()`. Replaces `lib/sse.js` with Bun-native `ReadableStream`. |
| `src/ui/state/task-reviewer.ts` | LLM-based code review: `reviewAndCorrectTask()`. Replaces `lib/task-reviewer.js`. |
| `src/ui/state/transformers/list-transformer.ts` | Job list operations: sort, aggregate, group, filter, stats, API projection. Replaces `transformers/list-transformer.js`. |
| `src/ui/state/transformers/status-transformer.ts` | Job status normalization: `computeJobStatus()`, `transformTasks()`, `transformJobStatus()`, `transformMultipleJobs()`, `getTransformationStats()`. Replaces `transformers/status-transformer.js`. |

### Key types and interfaces

```typescript
// ── Change Tracking ──

type ChangeType = 'created' | 'modified' | 'deleted';

interface ChangeEntry {
  path: string;
  type: ChangeType;
  timestamp: string; // ISO 8601
}

interface ChangeTrackerState {
  updatedAt: string;
  changeCount: number;
  recentChanges: ChangeEntry[];
  watchedPaths: string[];
}

// ── Snapshot ──

interface NormalizedJob {
  jobId: string | null;
  status: string | null;
  title: string | null;
  updatedAt: string | null;
}

interface SnapshotJob {
  jobId: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string | null;
  updatedAt: string | null;
  location: string;
}

interface SnapshotMeta {
  version: string;
  lastUpdated: string;
}

interface StateSnapshot {
  jobs: NormalizedJob[];
  meta: SnapshotMeta;
}

interface FilesystemSnapshot {
  jobs: SnapshotJob[];
  meta: SnapshotMeta;
}

interface ComposeSnapshotOptions {
  jobs?: unknown[];
  meta?: unknown;
  transformJob?: (job: unknown) => NormalizedJob;
}

interface SnapshotDeps {
  listAllJobs?: () => { current: string[]; complete: string[] };
  readJob?: (id: string, location: string) => Promise<JobReadResult>;
  transformMultipleJobs?: (results: JobReadResult[]) => CanonicalJob[];
  now?: () => Date;
  paths?: Record<string, string>;
}

// ── Watcher ──

interface WatcherOptions {
  baseDir: string;
  debounceMs?: number;
}

type WatcherOnChange = (changes: ChangeEntry[]) => void;

interface WatcherHandle {
  close: () => Promise<void>;
}

// ── Job Change Detection ──

type JobChangeCategory = 'status' | 'task' | 'seed';
type JobLocation = 'current' | 'complete' | 'pending' | 'rejected';

interface JobChange {
  jobId: string;
  category: JobChangeCategory;
  filePath: string;
}

// ── Analysis Lock ──

interface LockState {
  pipelineSlug: string;
  startedAt: Date;
}

type AcquireResult =
  | { acquired: true }
  | { acquired: false; heldBy: string };

// ── Mention Parsing ──

interface ChatMessage {
  role: string;
  content: string;
}

// ── Schema Loading ──

interface SchemaContext {
  fileName: string;
  schema: Record<string, unknown>;
  sample: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

// ── SSE Stream ──

interface SSEWriter {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

interface SSEStreamResult {
  response: Response;
  writer: SSEWriter;
}

// ── Task Reviewer ──
// reviewAndCorrectTask(code: string, guidelines: string): Promise<string>

// ── Status Transformer ──

interface ComputedStatus {
  status: string;
  progress: number;
}

interface CanonicalTask {
  state: string;
  name: string;
  files: { artifacts: string[]; logs: string[]; tmp: string[] };
  startedAt?: string | null;
  endedAt?: string | null;
  attempts?: number;
  executionTimeMs?: number;
  refinementAttempts?: number;
  stageLogPath?: string;
  errorContext?: unknown;
  currentStage?: string;
  failedStage?: string;
  artifacts?: unknown;
  error?: { message: string; [key: string]: unknown } | null;
}

interface CanonicalJob {
  id: string;
  jobId: string;
  name: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string | null;
  updatedAt: string | null;
  location: string | null;
  tasks: Record<string, CanonicalTask>;
  files: Record<string, unknown>;
  costs: Record<string, unknown>;
  pipeline?: string;
  pipelineLabel?: string;
  pipelineConfig?: Record<string, unknown>;
  current?: unknown;
  currentStage?: unknown;
  warnings?: string[];
}

interface JobReadResult {
  ok: boolean;
  data?: unknown;
  jobId: string;
  location: string;
  code?: string;
  message?: string;
}

interface TransformationStats {
  totalRead: number;
  successfulReads: number;
  successfulTransforms: number;
  failedTransforms: number;
  transformationRate: number;
  statusDistribution: Record<string, number>;
}

// ── List Transformer ──

interface JobListStats {
  total: number;
  byStatus: Record<string, number>;
  byLocation: Record<string, number>;
  averageProgress: number;
}

interface GroupedJobs {
  running: CanonicalJob[];
  error: CanonicalJob[];
  pending: CanonicalJob[];
  complete: CanonicalJob[];
}

interface CostsSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalInputCost: number;
  totalOutputCost: number;
}

interface APIJob {
  jobId: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string | null;
  updatedAt: string | null;
  location: string | null;
  tasks: Record<string, unknown>;
  files?: Record<string, unknown>;
  current?: unknown;
  currentStage?: unknown;
  costsSummary: CostsSummary;
  pipelineSlug?: string;
  pipeline?: string;
  pipelineLabel?: string;
}

interface AggregationStats {
  totalInput: number;
  totalOutput: number;
  duplicates: number;
  efficiency: number;
  statusDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
}

interface FilterOptions {
  status?: string;
  location?: string;
}

interface TransformOptions {
  includePipelineMetadata?: boolean;
}
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| **SSE via `ReadableStream` + `Response`** instead of Express `res` object | The analysis `lib/sse.js` sets headers on an Express response. The TS version returns a standard `Response` with `ReadableStream` body, compatible with `Bun.serve()` and the web-standard request/response model. |
| **`Bun.file()` for schema loading** instead of `node:fs/promises.readFile` | `schema-loader.js` uses `fs.promises.readFile`. Bun's `Bun.file().json()` and `Bun.file().text()` are more ergonomic and avoid manual JSON parsing. |
| **`node:path` retained** | Path manipulation (`join`, `relative`, `basename`, `extname`) has no Bun-native alternative. Standard library usage is fine. |
| **chokidar retained for file watching** | Bun's `fs.watch` is still experimental and lacks recursive watching, ignore patterns, and debounce. chokidar provides battle-tested cross-platform watching with the needed features. |
| **`console.warn`/`console.error` retained for observability** | The analysis shows the original uses `console.warn` for non-critical warnings (unknown task states, ID mismatches) and `createLogger` for watcher. Keep `createLogger` pattern for watcher; use `console.warn` for transformers as-is. |

### Dependency map

**Internal `src/` imports:**

| This module file | Imports from |
|-----------------|-------------|
| `watcher.ts` | `src/ui/state/job-change-detector.ts`, `src/ui/server/sse-enhancer.ts`, `src/core/logger.ts`, `src/core/config.ts` |
| `snapshot.ts` | `src/ui/server/job-scanner.ts`, `src/ui/server/job-reader.ts`, `src/ui/state/transformers/status-transformer.ts`, `src/ui/server/config-bridge.ts` |
| `schema-loader.ts` | `src/core/config.ts` |
| `task-reviewer.ts` | `src/providers/index.ts` (LLM creation), `src/providers/base.ts` (`stripMarkdownFences`) |
| `transformers/list-transformer.ts` | `src/utils/pipelines.ts` |
| `transformers/status-transformer.ts` | `src/config/statuses.ts`, `src/utils/task-files.ts`, `src/utils/token-cost-calculator.ts`, `src/utils/pipelines.ts` |

**External packages:**

| Package | Used by |
|---------|---------|
| `chokidar` (^4.x) | `watcher.ts` |

---

## 5. Acceptance Criteria

### Core behavior — Change Tracking

1. `getState()` returns a shallow copy of the current state; mutating the returned object does not affect internal state.
2. `recordChange(path, type)` increments `changeCount` by 1 and prepends the new `ChangeEntry` to `recentChanges`.
3. `recentChanges` never exceeds 10 entries; the oldest entry is evicted when the 11th is added.
4. `recentChanges` is maintained in reverse chronological order (newest first).
5. `reset()` clears `changeCount` to 0 and `recentChanges` to `[]`, but preserves `watchedPaths`.
6. `setWatchedPaths(paths)` replaces the stored paths entirely; mutating the input array afterward does not affect internal state.

### Core behavior — Snapshot Composition

7. `composeStateSnapshot()` with no arguments returns `{ jobs: [], meta: { version, lastUpdated } }`.
8. `composeStateSnapshot()` tolerates varied input shapes, extracting job IDs from `jobId`, `id`, `uid`, `job_id`, or `jobID` fields.
9. `composeStateSnapshot()` never throws, even with malformed input.
10. `composeStateSnapshot()` accepts a string for `options.meta` and uses it as the `version` value.
11. `buildSnapshotFromFilesystem()` throws if `listAllJobs`, `readJob`, or `transformMultipleJobs` are neither injected nor importable.
12. `buildSnapshotFromFilesystem()` reads all jobs concurrently via `Promise.all`.
13. `buildSnapshotFromFilesystem()` catches individual job read failures and logs them as warnings without throwing.
14. `buildSnapshotFromFilesystem()` deduplicates jobs with current-wins precedence over complete.
15. `buildSnapshotFromFilesystem()` sorts by location weight (current=0, complete=1) then status priority then updatedAt descending then id ascending.

### Core behavior — Job Change Detection

16. `detectJobChange()` returns `{ jobId, category, filePath }` for paths matching `pipeline-data/{current|complete|pending|rejected}/{jobId}/...`.
17. `detectJobChange()` returns `null` for non-job-related paths.
18. `detectJobChange()` validates job IDs against `[A-Za-z0-9-_]+`; paths with other characters return `null`.
19. `detectJobChange()` classifies `tasks-status.json` changes as `'status'`, paths under `tasks/` as `'task'`, and `seed.json` as `'seed'`.
20. `getJobLocation()` returns `'current'`, `'complete'`, `'pending'`, or `'rejected'` for matching paths, and `null` otherwise.

### Core behavior — Analysis Lock

21. `acquireLock()` returns `{ acquired: true }` when no lock is held.
22. `acquireLock()` returns `{ acquired: false, heldBy }` when a lock is already held.
23. `releaseLock()` clears the lock when called by the holder.
24. `releaseLock()` throws when no lock is held, when `pipelineSlug` is invalid, or when the lock is held by a different pipeline.
25. `acquireLock()` throws when `pipelineSlug` is not a non-empty string.
26. `getLockStatus()` returns the lock state or `null`.
27. At most one lock is held at any time (singleton mutex invariant).

### Core behavior — Mention Parsing

28. `parseMentions()` extracts unique filenames (the `id` portion) from `@[display](id)` patterns in message content.
29. `parseMentions()` returns an empty array for messages with no mentions.
30. `parseMentions()` deduplicates filenames.

### Core behavior — Schema Loading

31. `loadSchemaContext()` returns `{ fileName, schema, sample, meta? }` when schema and sample files exist.
32. `loadSchemaContext()` returns `null` on any error (missing files, parse errors, pipeline not found).
33. `buildSchemaPromptSection()` returns a markdown-formatted string from an array of schema contexts.
34. `buildSchemaPromptSection()` returns an empty string for empty or null input.

### Core behavior — SSE Stream

35. `createSSEStream()` returns a `Response` with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` headers.
36. The `writer.send(event, data)` method formats messages as valid SSE frames (`event:` + `data:` + blank line).
37. The `writer.close()` method clears the keep-alive interval and closes the stream.
38. A periodic `: ping` SSE comment is enqueued every 30 seconds as a keep-alive to detect dead connections and prevent proxy timeouts.
39. When an `AbortSignal` is provided and aborts, the keep-alive interval is cleared and the stream is closed.
40. `writer.send()` after close or abort is a silent no-op (does not throw).

### Core behavior — Task Reviewer

41. `reviewAndCorrectTask()` returns the original code when the LLM response, after trimming, equals `NO_CHANGES_NEEDED` exactly.
42. `reviewAndCorrectTask()` returns the LLM's corrected output with markdown fences stripped when changes are made.
43. `reviewAndCorrectTask()` propagates LLM call failures to the caller.

### Core behavior — Status Transformer

44. `computeJobStatus()` returns `{ status: 'pending', progress: 0 }` for invalid input.
45. `computeJobStatus()` correctly derives status from task states (all done = complete, any running = running, any error = error, else pending).
46. `transformTasks()` normalizes both object and array input into a keyed `Record<string, CanonicalTask>`.
47. `transformTasks()` returns `{}` for invalid input.
48. `transformJobStatus()` returns `null` for invalid raw input.
49. `transformJobStatus()` outputs both `id`/`name` and `jobId`/`title` for backward compatibility.
50. `transformJobStatus()` emits `console.warn` for job ID mismatches between raw data and the passed `jobId`.
51. `transformMultipleJobs()` filters out failed reads (`ok !== true`) before transforming.
52. `getTransformationStats()` correctly computes read counts, success rates, and status distribution.

### Core behavior — List Transformer

53. `sortJobs()` sorts by status priority (running=4, error=3, pending=2, complete=1) descending, then `createdAt` ascending, then id ascending.
54. `sortJobs()` filters out invalid jobs (missing id, status, or createdAt).
55. `aggregateAndSortJobs()` merges current and complete with current-wins deduplication.
56. `aggregateAndSortJobs()` returns `[]` on internal error.
57. `groupJobsByStatus()` returns `{ running, error, pending, complete }` buckets; unknown statuses are dropped.
58. `getJobListStats()` uses `Math.floor` for average progress.
59. `filterJobs()` performs case-insensitive matching on title and id.
60. `filterJobs()` supports optional `status` and `location` filters.
61. `transformJobListForAPI()` always includes a `costsSummary` with zeroed fields on each output job.
62. `getAggregationStats()` computes correct duplicate count, efficiency, and distributions.

### Watcher

63. `startWatcher()` throws if `options.baseDir` is not provided.
64. `startWatcher()` calls `setWatchedPaths()` on the change tracker with the provided paths at startup.
65. `startWatcher()` calls `recordChange()` on the change tracker for each accepted file event.
66. `startWatcher()` debounces file change events (default 200ms) and invokes `onChange` with batched `ChangeEntry[]`.
67. `startWatcher()` ignores `.git`, `node_modules`, `dist` directories and `_task_root` subdirectories.
68. `startWatcher()` skips `'modified'` events for files under `pipeline-data/.../files/`.
69. `startWatcher()` detects `pipeline-config/registry.json` changes and calls `resetConfig()`.
70. `startWatcher()` routes detected job changes to the SSE enhancer.
71. Flush steps execute in fixed order: `onChange` callback, then job-change routing, then config reload. Each step is awaited if async.
72. A failure in any flush step is caught and logged but does not prevent subsequent steps from executing.
73. `stopWatcher()` clears any pending debounce timer and closes the chokidar instance; no-ops on null input.

### Error handling

74. `composeStateSnapshot()` handles missing, null, or malformed input gracefully without throwing.
75. `buildSnapshotFromFilesystem()` throws synchronously if required dependencies are unresolvable.
76. `loadSchemaContext()` catches all errors and returns `null`.
77. `aggregateAndSortJobs()` catches all internal exceptions and returns `[]`.
78. All transformer functions produce empty/default results for invalid input rather than throwing.

---

## 6. Notes

### Design trade-offs

- **Module-level singletons for `change-tracker.ts` and `analysis-lock.ts`:** These rely on the single-threaded event loop assumption. This is acceptable for a single-server deployment but would need redesign for multi-process or worker-thread architectures. The analysis explicitly flags this.
- **`composeStateSnapshot` defensive field extraction:** The original tolerates `jobId`, `id`, `uid`, `job_id`, `jobID` as field names. This is preserved for backward compatibility with inconsistent data sources, though the TS version could tighten this once upstream data is normalized.
- **Dual-naming in `transformJobStatus` (`id`/`jobId`, `name`/`title`):** Maintained for backward compatibility. The analysis flags this as an open question — resolve when API consumers are migrated.
- **`STATUS_ORDER` inconsistency between snapshot builder and list transformer:** The snapshot uses `["error", "running", "complete", "pending"]` while the list transformer uses numeric priorities `{running: 4, error: 3, pending: 2, complete: 1}`. Both are preserved to match original behavior. Consolidation is recommended as a follow-up.

### Known risks and ambiguities

- **`state.js` vs `state-snapshot.js` purpose overlap:** The analysis notes it is unclear whether `state.js` change tracking is still actively used or superseded by snapshot-based approaches. Both are implemented; remove the unused one after integration testing confirms which path is exercised.
- **`lib/sse.js` vs top-level SSE modules:** The analysis notes naming overlap between `lib/sse.js`, `src/ui/sse.js`, and `src/ui/sse-broadcast.js`. The `lib/sse.js` replacement (`sse-stream.ts`) is scoped to creating individual SSE response streams. The broadcast/registry logic lives in `src/ui/server/`.
- **`TaskState` import in status-transformer:** The analysis flags that `TaskState` is imported but possibly unused. In the TS version, use the `TaskState` type/enum from `config/statuses` only where needed for type annotations; do not import without usage.

### Migration concerns

- **SSE response model change:** The original `streamSSE(res)` takes an Express response object and mutates it. The replacement `createSSEStream(signal?)` returns a new `Response` with a `ReadableStream` body and a `writer` for sending events. It also manages keep-alive pings and `AbortSignal`-based disconnect handling. Callers must adapt: instead of `streamSSE(res)`, they use `const { response, writer } = createSSEStream(request.signal)` and return `response` from the route handler.
- **`node:fs` to `Bun.file()`:** `schema-loader.js` uses `fs.promises.readFile` + `JSON.parse`. The replacement uses `Bun.file(path).json()` which handles both in one step. Error handling remains try/catch returning `null`.
- **chokidar version:** The original uses chokidar. Ensure chokidar v4.x is used (ESM-native, smaller). The API surface is similar.

### Dependencies on other modules

- **`src/ui/server/sse-enhancer.ts`** must exist before watcher integration (watcher routes job changes to the enhancer).
- **`src/ui/server/job-scanner.ts`** and **`src/ui/server/job-reader.ts`** must exist before `buildSnapshotFromFilesystem` can function without injected dependencies.
- **`src/config/statuses.ts`** must be migrated first — the status transformer depends heavily on `VALID_TASK_STATES`, `normalizeTaskState`, `deriveJobStatusFromTasks`.
- **`src/utils/task-files.ts`**, **`src/utils/token-cost-calculator.ts`**, **`src/utils/pipelines.ts`** must be available for the status and list transformers.
- **`src/providers/`** must provide `createHighLevelLLM` and `stripMarkdownFences` for the task reviewer.

### Performance considerations

- `buildSnapshotFromFilesystem` uses `Promise.all` for concurrent job reads. For large job counts, this could create memory pressure. Consider batching with a concurrency limit if job counts exceed ~500.
- Watcher debounce (200ms default) is intentionally conservative. For high-throughput file changes, this coalesces well and avoids SSE flooding.

---

## 7. Implementation Steps

### Step 1: Create type definitions

**What to do:** Create `src/ui/state/types.ts` with all type/interface exports from the Architecture section. This dedicated file is the single source of truth for shared types; no other submodule defines public interfaces.

**Why:** All subsequent steps depend on shared type definitions. A separate `types.ts` avoids circular re-exports that would occur if `index.ts` were both the barrel and the type source. Satisfies the ordering principle (types first).

**Type signatures:**

```typescript
// src/ui/state/types.ts
export type ChangeType = 'created' | 'modified' | 'deleted';
export interface ChangeEntry { path: string; type: ChangeType; timestamp: string; }
export interface ChangeTrackerState { updatedAt: string; changeCount: number; recentChanges: ChangeEntry[]; watchedPaths: string[]; }
export type JobChangeCategory = 'status' | 'task' | 'seed';
export type JobLocation = 'current' | 'complete' | 'pending' | 'rejected';
export interface JobChange { jobId: string; category: JobChangeCategory; filePath: string; }
export interface LockState { pipelineSlug: string; startedAt: Date; }
export type AcquireResult = { acquired: true } | { acquired: false; heldBy: string };
export interface ChatMessage { role: string; content: string; }
export interface SchemaContext { fileName: string; schema: Record<string, unknown>; sample: Record<string, unknown>; meta?: Record<string, unknown>; }
export interface SSEWriter { send: (event: string, data: unknown) => void; close: () => void; }
export interface SSEStreamResult { response: Response; writer: SSEWriter; }
export interface NormalizedJob { jobId: string | null; status: string | null; title: string | null; updatedAt: string | null; }
export interface SnapshotMeta { version: string; lastUpdated: string; }
export interface StateSnapshot { jobs: NormalizedJob[]; meta: SnapshotMeta; }
export interface SnapshotJob { jobId: string; title: string; status: string; progress: number; createdAt: string | null; updatedAt: string | null; location: string; }
export interface FilesystemSnapshot { jobs: SnapshotJob[]; meta: SnapshotMeta; }
// ... (remaining types from Architecture section)
```

**Test:** `tests/ui/state/types.test.ts` — Import all exported types from `src/ui/state/types.ts` and verify they are accessible. Create object literals satisfying each interface and verify via `satisfies` that the shapes match.

---

### Step 2: Implement change tracker

**What to do:** Create `src/ui/state/change-tracker.ts` implementing `getState()`, `recordChange()`, `reset()`, `setWatchedPaths()`.

**Why:** Foundational in-memory state module with no dependencies. Satisfies acceptance criteria 1-6.

**Type signatures:**

```typescript
export function getState(): ChangeTrackerState;
export function recordChange(path: string, type: ChangeType): ChangeTrackerState;
export function reset(): void;
export function setWatchedPaths(paths: string[]): void;
```

**Implementation details:**
- Module-level `const MAX_RECENT_CHANGES = 10`.
- `state` object at module scope, initialized with `updatedAt: new Date().toISOString()`, `changeCount: 0`, `recentChanges: []`, `watchedPaths: []`.
- `getState()` returns `{ ...state, recentChanges: [...state.recentChanges], watchedPaths: [...state.watchedPaths] }`.
- `recordChange()` creates a `ChangeEntry`, prepends to `recentChanges`, slices to `MAX_RECENT_CHANGES`, increments `changeCount`, updates `updatedAt`.
- `reset()` sets `changeCount = 0`, `recentChanges = []`, updates `updatedAt`. Preserves `watchedPaths`.
- `setWatchedPaths()` stores `[...paths]` (copy).

**Test:** `tests/ui/state/change-tracker.test.ts`
- `getState()` returns a shallow copy; mutating it does not affect internal state.
- `recordChange()` increments count and prepends entry.
- After 11 `recordChange` calls, `recentChanges.length` is 10 and the oldest entry is gone.
- `reset()` clears count and changes but preserves watched paths.
- `setWatchedPaths()` stores a copy; mutating the input array has no effect.

---

### Step 3: Implement job change detector

**What to do:** Create `src/ui/state/job-change-detector.ts` implementing `detectJobChange()` and `getJobLocation()`.

**Why:** Pure functions with no dependencies. Used by the watcher. Satisfies acceptance criteria 16-20.

**Type signatures:**

```typescript
export function detectJobChange(filePath: string): JobChange | null;
export function getJobLocation(filePath: string): JobLocation | null;
```

**Implementation details:**
- Path regex: `/pipeline-data\/(current|complete|pending|rejected)\/([A-Za-z0-9\-_]+)\/(.*)/`.
- Category classification: if remainder matches `tasks-status.json` -> `'status'`; if starts with `tasks/` -> `'task'`; if matches `seed.json` -> `'seed'`; else `null`.
- `getJobLocation()` extracts location portion from the regex match.
- Normalize input path to use forward slashes before matching.

**Test:** `tests/ui/state/job-change-detector.test.ts`
- `detectJobChange("pipeline-data/current/job-123/tasks-status.json")` returns `{ jobId: "job-123", category: "status", filePath: "pipeline-data/current/job-123/tasks-status.json" }`.
- `detectJobChange("pipeline-data/complete/job-123/tasks/task-a/output.json")` returns category `'task'`.
- `detectJobChange("pipeline-data/current/job-123/seed.json")` returns category `'seed'`.
- `detectJobChange("unrelated/path.txt")` returns `null`.
- `detectJobChange("pipeline-data/current/invalid chars!/file.json")` returns `null`.
- `getJobLocation("pipeline-data/rejected/job-1/file.txt")` returns `'rejected'`.
- `getJobLocation("other/path")` returns `null`.

---

### Step 4: Implement analysis lock

**What to do:** Create `src/ui/state/analysis-lock.ts` implementing `acquireLock()`, `releaseLock()`, `getLockStatus()`.

**Why:** Self-contained mutex with no dependencies. Satisfies acceptance criteria 21-27.

**Type signatures:**

```typescript
export function acquireLock(pipelineSlug: string): AcquireResult;
export function releaseLock(pipelineSlug: string): void;
export function getLockStatus(): LockState | null;
```

**Implementation details:**
- Module-level `let currentLock: LockState | null = null`.
- `acquireLock()`: validate `pipelineSlug` is non-empty string (throw otherwise). If `currentLock` is non-null, return `{ acquired: false, heldBy: currentLock.pipelineSlug }`. Otherwise set lock and return `{ acquired: true }`.
- `releaseLock()`: validate slug, throw if no lock held, throw if held by different pipeline. Clear lock.
- `getLockStatus()`: return `currentLock ? { ...currentLock } : null`.

**Test:** `tests/ui/state/analysis-lock.test.ts`
- Acquire succeeds when no lock held.
- Acquire fails when lock held, returns holder.
- Release clears the lock.
- Release throws when no lock, wrong holder, or invalid slug.
- `getLockStatus()` reflects current state.
- Acquire throws on empty string or non-string input.

---

### Step 5: Implement mention parser

**What to do:** Create `src/ui/state/mention-parser.ts` implementing `parseMentions()`.

**Why:** Pure function with no dependencies. Satisfies acceptance criteria 28-30.

**Type signatures:**

```typescript
export function parseMentions(messages: ChatMessage[]): string[];
```

**Implementation details:**
- Regex: `/@\[([^\]]*)\]\(([^)]+)\)/g`. Extract the `id` (capture group 2) from all matches across all message contents.
- Collect into a `Set<string>` for deduplication, return as array.

**Test:** `tests/ui/state/mention-parser.test.ts`
- Extracts filenames from `@[display](file.json)` syntax.
- Returns empty array for no mentions.
- Deduplicates repeated filenames.
- Handles multiple messages with multiple mentions each.

---

### Step 6: Implement SSE stream factory

**What to do:** Create `src/ui/state/sse-stream.ts` implementing `createSSEStream()`.

**Why:** Bun-native replacement for Express-based `streamSSE()`. No external dependencies. Satisfies acceptance criteria 35-40.

**Type signatures:**

```typescript
export function createSSEStream(signal?: AbortSignal): SSEStreamResult;
```

**Implementation details:**
- Create a `ReadableStream` with a controller reference captured in the outer scope.
- `writer.send(event, data)` enqueues `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` via the controller. If the stream is already closed (client disconnected), `send()` is a no-op.
- `writer.close()` clears the keep-alive interval and calls `controller.close()`.
- Start a periodic keep-alive timer (every 30 seconds) that enqueues `: ping\n\n` (SSE comment) to detect dead connections and prevent proxy timeouts.
- If an `AbortSignal` is provided, listen for its `abort` event. On abort, clear the keep-alive interval and close the controller. This handles client disconnection when the Bun request's `signal` is passed through.
- On `ReadableStream` cancel (pull-based disconnect detection), clear the keep-alive interval.
- Return a `Response` with the stream body and SSE headers.

**Test:** `tests/ui/state/sse-stream.test.ts`
- Returned response has correct `Content-Type`, `Cache-Control`, `Connection` headers.
- `writer.send("test", { key: "value" })` enqueues a correctly framed SSE message.
- `writer.close()` clears the keep-alive interval and closes the stream (no further writes possible).
- Keep-alive `: ping` comments are enqueued periodically (verify with a short interval override or timer mock).
- When `AbortSignal` aborts, the stream is closed and keep-alive is cleared.
- `writer.send()` after close/abort is a silent no-op (does not throw).

---

### Step 7: Implement status transformer

**What to do:** Create `src/ui/state/transformers/status-transformer.ts` implementing `computeJobStatus()`, `transformTasks()`, `transformJobStatus()`, `transformMultipleJobs()`, `getTransformationStats()`.

**Why:** Core data transformation used by snapshot builder and API endpoints. Depends on `src/config/statuses.ts`, `src/utils/task-files.ts`, `src/utils/token-cost-calculator.ts`, `src/utils/pipelines.ts`. Satisfies acceptance criteria 44-52.

**Type signatures:**

```typescript
export function computeJobStatus(tasksInput: unknown, existingProgress?: number): ComputedStatus;
export function transformTasks(rawTasks: unknown): Record<string, CanonicalTask>;
export function transformJobStatus(raw: unknown, jobId: string, location: string): CanonicalJob | null;
export function transformMultipleJobs(jobReadResults: JobReadResult[]): CanonicalJob[];
export function getTransformationStats(readResults: JobReadResult[], transformedJobs: CanonicalJob[]): TransformationStats;
```

**Implementation details:**
- `computeJobStatus()`: iterate task states, delegate to `deriveJobStatusFromTasks` from statuses module. Return `{ status: 'pending', progress: 0 }` for non-object input.
- `transformTasks()`: if array, convert to keyed object with synthetic names. Normalize each task's `state` via `normalizeTaskState`. Normalize `files` via `normalizeTaskFiles`. Preserve timing fields, error, artifacts.
- `transformJobStatus()`: return `null` for falsy/non-object input. Call `transformTasks`, `computeJobStatus`, `calculateJobCosts`, `derivePipelineMetadata`. Set both `id`/`name` and `jobId`/`title`. Warn on ID mismatch.
- `transformMultipleJobs()`: filter `ok === true`, map through `transformJobStatus`, filter nulls. Log count.
- `getTransformationStats()`: compute counts and rates.

**Test:** `tests/ui/state/transformers/status-transformer.test.ts`
- `computeJobStatus({})` returns `{ status: 'pending', progress: 0 }`.
- `computeJobStatus(null)` returns `{ status: 'pending', progress: 0 }`.
- `computeJobStatus` with all-done tasks returns `complete` status and 100 progress.
- `transformTasks` handles both object and array input.
- `transformTasks` returns `{}` for non-object input.
- `transformJobStatus` returns `null` for null/undefined/non-object.
- `transformJobStatus` sets both `id` and `jobId`.
- `transformMultipleJobs` filters out `ok: false` results.
- `getTransformationStats` computes correct counts.

---

### Step 8: Implement list transformer

**What to do:** Create `src/ui/state/transformers/list-transformer.ts` implementing `getStatusPriority()`, `sortJobs()`, `aggregateAndSortJobs()`, `groupJobsByStatus()`, `getJobListStats()`, `filterJobs()`, `transformJobListForAPI()`, `getAggregationStats()`.

**Why:** Job list operations for API responses. Depends on `src/utils/pipelines.ts`. Satisfies acceptance criteria 53-62.

**Type signatures:**

```typescript
export function getStatusPriority(status: string): number;
export function sortJobs(jobs: CanonicalJob[]): CanonicalJob[];
export function aggregateAndSortJobs(currentJobs: CanonicalJob[], completeJobs: CanonicalJob[]): CanonicalJob[];
export function groupJobsByStatus(jobs: CanonicalJob[]): GroupedJobs;
export function getJobListStats(jobs?: CanonicalJob[]): JobListStats;
export function filterJobs(jobs: CanonicalJob[], searchTerm?: string, options?: FilterOptions): CanonicalJob[];
export function transformJobListForAPI(jobs?: CanonicalJob[], options?: TransformOptions): APIJob[];
export function getAggregationStats(currentJobs?: CanonicalJob[], completeJobs?: CanonicalJob[], aggregatedJobs?: CanonicalJob[]): AggregationStats;
```

**Implementation details:**
- Priority map: `{ running: 4, error: 3, pending: 2, complete: 1 }`, default 0.
- `sortJobs()`: filter out jobs missing `id` or `status` or `createdAt`. Sort by priority desc, then `createdAt` asc, then `id` asc. Return new array.
- `aggregateAndSortJobs()`: wrap in try/catch, return `[]` on error. Merge with `Map<string, Job>` using `jobId` as key, current wins. Then `sortJobs`.
- `groupJobsByStatus()`: bucket into `running`, `error`, `pending`, `complete`. Drop unknown statuses.
- `getJobListStats()`: compute totals and averages with `Math.floor`.
- `filterJobs()`: case-insensitive match on `title`/`id`. Apply optional `status`/`location` filters.
- `transformJobListForAPI()`: project fields, ensure `costsSummary` is always present with zeroed defaults, optionally enrich pipeline metadata.
- `getAggregationStats()`: compute input/output/duplicates/efficiency/distributions.

**Test:** `tests/ui/state/transformers/list-transformer.test.ts`
- `getStatusPriority("running")` returns 4; `getStatusPriority("unknown")` returns 0.
- `sortJobs` filters invalid jobs and sorts correctly.
- `aggregateAndSortJobs` deduplicates with current-wins.
- `aggregateAndSortJobs` returns `[]` on thrown error (test via invalid input).
- `groupJobsByStatus` buckets correctly; unknown statuses dropped.
- `getJobListStats` uses `Math.floor` for average.
- `filterJobs` matches case-insensitively on title and id.
- `transformJobListForAPI` always includes zeroed `costsSummary`.

---

### Step 9: Implement schema loader

**What to do:** Create `src/ui/state/schema-loader.ts` implementing `loadSchemaContext()` and `buildSchemaPromptSection()`.

**Why:** File I/O module for loading JSON schema/sample data. Uses `Bun.file()`. Satisfies acceptance criteria 31-34.

**Type signatures:**

```typescript
export async function loadSchemaContext(pipelineSlug: string, fileName: string): Promise<SchemaContext | null>;
export function buildSchemaPromptSection(contexts: SchemaContext[]): string;
```

**Implementation details:**
- `loadSchemaContext()`: get pipeline config via `getPipelineConfig(pipelineSlug)`. Derive base name from `fileName`. Read `{pipelineDir}/schemas/{baseName}.schema.json` and `{baseName}.sample.json` via `Bun.file(path).json()`. Optionally read `{baseName}.meta.json`. Wrap all in try/catch, return `null` on error.
- `buildSchemaPromptSection()`: if empty/null input, return `""`. Build markdown section with each context's fileName, schema (JSON-stringified), and sample (JSON-stringified).

**Test:** `tests/ui/state/schema-loader.test.ts`
- `loadSchemaContext` returns context when files exist (use temp directory with test files).
- `loadSchemaContext` returns `null` when schema file is missing.
- `loadSchemaContext` returns `null` on JSON parse error.
- `buildSchemaPromptSection` returns markdown with file names and content.
- `buildSchemaPromptSection([])` returns `""`.

---

### Step 10: Implement task reviewer

**What to do:** Create `src/ui/state/task-reviewer.ts` implementing `reviewAndCorrectTask()`.

**Why:** LLM integration module. Depends on `src/providers/`. Satisfies acceptance criteria 41-43. (Note: the sentinel check uses exact equality after trimming per review item 4.)

**Type signatures:**

```typescript
export async function reviewAndCorrectTask(code: string, guidelines: string): Promise<string>;
```

**Implementation details:**
- Call `createHighLevelLLM().chat()` with a system prompt containing the guidelines and user prompt containing the code. The `chat()` method returns `string` (the full text response from the provider). Pin this expectation: if the provider interface changes, this call site must be updated.
- Normalize the response: trim whitespace. Check for the sentinel using **exact equality** (`trimmedResponse === 'NO_CHANGES_NEEDED'`), not substring matching. This prevents false positives when the corrected code or explanation merely contains that phrase.
- If the trimmed response equals `NO_CHANGES_NEEDED`, return the original `code`.
- Otherwise, strip markdown fences via `stripMarkdownFences()` and return the result.
- If the response is empty/falsy, return the original `code`.
- Do not catch LLM errors — let them propagate.

**Test:** `tests/ui/state/task-reviewer.test.ts`
- Mock `createHighLevelLLM` to return `NO_CHANGES_NEEDED` (exact) — verify original code returned.
- Mock to return `NO_CHANGES_NEEDED` with surrounding whitespace — verify original code returned (trimming works).
- Mock to return a response that *contains* `NO_CHANGES_NEEDED` as a substring within other text — verify the response is treated as corrected code (not as the sentinel).
- Mock to return corrected code with markdown fences — verify fences stripped.
- Mock to throw — verify error propagates.
- Mock to return empty string — verify original code returned.

---

### Step 11: Implement snapshot builder

**What to do:** Create `src/ui/state/snapshot.ts` implementing `composeStateSnapshot()` and `buildSnapshotFromFilesystem()`.

**Why:** Depends on status transformer and external modules (job-scanner, job-reader). Satisfies acceptance criteria 7-15.

**Type signatures:**

```typescript
export function composeStateSnapshot(options?: ComposeSnapshotOptions): StateSnapshot;
export async function buildSnapshotFromFilesystem(deps?: SnapshotDeps): Promise<FilesystemSnapshot>;
```

**Implementation details:**
- `composeStateSnapshot()`: defensive extraction of job fields from varied shapes (`jobId`/`id`/`uid`/`job_id`/`jobID`). Custom `transformJob` override if provided. Meta handling: if string, use as version; if object with `version`, use that; else default.
- `buildSnapshotFromFilesystem()`: resolve deps from injection or lazy imports. Call `listAllJobs()`, read all jobs concurrently, transform, deduplicate (current wins via Map), sort by location weight then status priority then updatedAt desc then id asc. Map to `SnapshotJob` shape.
- STATUS_ORDER fallback: `["error", "running", "complete", "pending"]`.

**Test:** `tests/ui/state/snapshot.test.ts`
- `composeStateSnapshot()` returns `{ jobs: [], meta: { version, lastUpdated } }`.
- `composeStateSnapshot({ jobs: [{ id: "x" }] })` extracts jobId from `id`.
- `composeStateSnapshot({ meta: "2.0" })` uses `"2.0"` as version.
- `composeStateSnapshot` never throws with any input (null, undefined, invalid objects).
- `buildSnapshotFromFilesystem` with injected deps returns sorted, deduplicated snapshot.
- `buildSnapshotFromFilesystem` throws when deps are missing and not importable.

---

### Step 12: Implement watcher

**What to do:** Create `src/ui/state/watcher.ts` implementing `startWatcher()` and `stopWatcher()`.

**Why:** I/O module integrating chokidar, change tracker, job change detector, and SSE enhancer. Satisfies acceptance criteria 63-73.

**Type signatures:**

```typescript
export function startWatcher(paths: string[], onChange: WatcherOnChange, options: WatcherOptions): WatcherHandle;
export async function stopWatcher(watcher: WatcherHandle | null | undefined): Promise<void>;
```

**Implementation details:**
- Validate `options.baseDir` — throw if falsy.
- On startup, call `setWatchedPaths(paths)` on the change tracker to register the watched directories.
- Initialize chokidar with `ignored` patterns: `/(^|[\/\\])(\.|node_modules|dist|\.git|_task_root)/`.
- On file events (`add`, `change`, `unlink`): normalize path relative to `baseDir`, classify type (`add`->`created`, `change`->`modified`, `unlink`->`deleted`). Skip `modified` events for `pipeline-data/.../files/` paths. Call `recordChange(normalizedPath, changeType)` on the change tracker for each accepted event.
- Accumulate events in a pending array. Debounce via `setTimeout` (default 200ms). On flush, execute effects in this fixed order and isolate failures between each step (see flush/error semantics below):
  1. Call `onChange(batch)` with the batched `ChangeEntry[]`.
  2. For each event in the batch, call `detectJobChange()` and route detected changes to the SSE enhancer.
  3. Detect `pipeline-config/registry.json` changes (add/change) and dynamically import and call `resetConfig()`.
- **Flush/error semantics:** Each of the three flush steps (onChange callback, job-change routing, config reload) runs sequentially and is awaited if async. Failures in any step are caught and logged via `console.error` but do not prevent subsequent steps from executing. This ensures one bad handler cannot break the entire flush cycle.
- `stopWatcher()`: no-op on null/undefined. Clear any pending debounce timer, then call `close()` on the chokidar instance.

**Test:** `tests/ui/state/watcher.test.ts`
- `startWatcher` throws when `baseDir` is not provided.
- `startWatcher` calls `setWatchedPaths()` with the provided paths on startup.
- `startWatcher` calls `recordChange()` for each accepted file event.
- `startWatcher` returns a handle with a `close()` method.
- `stopWatcher(null)` does not throw.
- `stopWatcher` clears the pending debounce timer.
- Flush error isolation: if `onChange` throws, job-change routing and config reload still execute.
- Flush ordering: `onChange` is called before job-change routing; job-change routing completes before config reload.
- Integration test: create a temp directory, start watcher, write a file, verify `onChange` is called with batched changes after debounce.

---

### Step 13: Wire barrel exports

**What to do:** Update `src/ui/state/index.ts` to re-export the public API from all submodules and all types from `types.ts`.

**Why:** Provides a single import point for consumers. Types are re-exported from `types.ts` (not from `index.ts` itself), avoiding circular self-references.

**Exports:**

```typescript
// src/ui/state/index.ts — barrel only, no definitions here
export { getState, recordChange, reset, setWatchedPaths } from './change-tracker.js';
export { composeStateSnapshot, buildSnapshotFromFilesystem } from './snapshot.js';
export { startWatcher, stopWatcher } from './watcher.js';
export { detectJobChange, getJobLocation } from './job-change-detector.js';
export { acquireLock, releaseLock, getLockStatus } from './analysis-lock.js';
export { parseMentions } from './mention-parser.js';
export { loadSchemaContext, buildSchemaPromptSection } from './schema-loader.js';
export { createSSEStream } from './sse-stream.js';
export { reviewAndCorrectTask } from './task-reviewer.js';
export * from './transformers/list-transformer.js';
export * from './transformers/status-transformer.js';
// All type exports — sourced from types.ts, NOT from index.ts
export type { ChangeType, ChangeEntry, ChangeTrackerState, JobChange, JobChangeCategory, JobLocation, LockState, AcquireResult, ChatMessage, SchemaContext, SSEWriter, SSEStreamResult, NormalizedJob, SnapshotMeta, StateSnapshot, SnapshotJob, FilesystemSnapshot, ComposeSnapshotOptions, SnapshotDeps, WatcherOptions, WatcherOnChange, WatcherHandle, ComputedStatus, CanonicalTask, CanonicalJob, JobReadResult, TransformationStats, JobListStats, GroupedJobs, CostsSummary, APIJob, AggregationStats, FilterOptions, TransformOptions } from './types.js';
```

**Test:** `tests/ui/state/index.test.ts` — Import all public functions from `src/ui/state/index.ts` and verify they are functions (not undefined). Import all types from `src/ui/state/types.ts` and verify they are accessible.
