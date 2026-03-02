# Implementation Specification: `core/pipeline-runner`

**Analysis source:** `docs/specs/analysis/core/pipeline-runner.md`

---

## 1. Qualifications

- TypeScript strict mode (interfaces, discriminated unions, mapped types, `satisfies`)
- Bun file I/O APIs (`Bun.file()`, `Bun.write()`, `Bun.file().exists()`, `Bun.file().text()`)
- Bun-native subprocess awareness (understanding of Bun runtime context for `process.pid`, `process.exit`, signal handling)
- Node.js-compatible filesystem operations (`node:fs/promises` for `rename`, `mkdir`, `appendFile`; `node:fs` for `unlinkSync`)
- POSIX process signals (`SIGINT`, `SIGTERM`) and graceful PID-file lifecycle
- JSON and JSONL parsing/serialization
- Pipeline execution patterns (sequential task orchestration with lifecycle gates)
- Dynamic module loading (task registry resolution)
- Symlink management (creation, validation, repair, cleanup)

---

## 2. Problem Statement

The system requires a per-job execution engine that receives a job identifier, resolves the associated pipeline definition and task registry, and executes each task sequentially — managing task lifecycle state, filesystem scaffolding, symlink integrity, and artifact collection. The existing JS implementation provides this via `runPipelineJob()` using Node.js `fs` APIs, dynamic `import()` for the task registry, and `process.exit(1)` for failure termination. This spec defines the TypeScript replacement, leveraging Bun-native file I/O, fixing the `normalizeError` dead-code branch, and addressing the `pipelineArtifacts` incompleteness gap.

---

## 3. Goal

A TypeScript module at `src/core/pipeline-runner.ts` that provides identical behavioral contracts to the analyzed JS module — PID file management, pipeline resolution, sequential task execution with lifecycle gates, status tracking, log persistence, and job completion lifecycle — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/core/pipeline-runner.ts` | Per-job pipeline execution engine: configuration resolution, PID file lifecycle, pipeline loading/validation, sequential task execution with lifecycle gates, status updates, log persistence, job completion (move to `complete/`, append `runs.jsonl`). |

### Key types and interfaces

```typescript
import type { TaskState } from "../config/statuses";

/** Pipeline definition read from pipeline.json. */
interface PipelineDefinition {
  tasks: Array<string | { name: string }>;
  llm?: Record<string, unknown> | null;
  taskConfig?: Record<string, Record<string, unknown>>;
}

/** Task registry: maps task names to module file paths. */
type TaskRegistry = Record<string, string>;

/** Seed data read from seed.json. */
interface SeedData {
  pipeline?: string;
  [key: string]: unknown;
}

/** Per-task execution context passed to the task runner. */
interface TaskExecutionContext {
  workDir: string;
  taskDir: string;
  seed: SeedData;
  taskName: string;
  taskConfig: Record<string, unknown>;
  statusPath: string;
  jobId: string;
  llmOverride: Record<string, unknown> | null;
  meta: {
    pipelineTasks: Array<string | { name: string }>;
  };
}

/** Result returned by the task runner's runPipeline function. */
interface TaskRunResult {
  ok: boolean;
  error?: NormalizedError;
  failedStage?: string;
  logs?: Array<TaskLogEntry>;
  context?: Record<string, unknown>;
  refinementAttempts?: number;
}

/** A single entry in the task runner's logs array. */
interface TaskLogEntry {
  stage: string;
  ok: boolean;
  ms: number;
  error?: unknown;
  skipped?: boolean;
}

/** Normalized error with optional debug metadata. */
interface NormalizedError {
  name?: string;
  message: string;
  stack?: string;
}

/** Job status snapshot (subset of fields the runner directly reads/writes). */
interface JobStatus {
  id: string;
  current: string | null;
  tasks: Record<string, TaskStatus>;
  [key: string]: unknown;
}

/** Per-task status fields managed by the runner. */
interface TaskStatus {
  state: string;
  startedAt?: string;
  endedAt?: string;
  attempts?: number;
  executionTimeMs?: number;
  refinementAttempts?: number;
  error?: NormalizedError;
  failedStage?: string;
  stageLogPath?: string;
  errorContext?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Completion record appended to runs.jsonl. */
interface CompletionRecord {
  id: string;
  finishedAt: string;
  tasks: string[];
  totalExecutionTime: number;
  totalRefinementAttempts: number;
  finalArtifacts: string[];
}

/** Resolved runtime configuration for a pipeline job. */
interface ResolvedJobConfig {
  poRoot: string;
  dataDir: string;
  currentDir: string;
  completeDir: string;
  pipelineSlug: string;
  pipelineJsonPath: string;
  tasksDir: string;
  workDir: string;
  statusPath: string;
  startFromTask: string | null;
  runSingleTask: boolean;
}
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| `Bun.file(path).text()` replaces `fs.readFile(path, "utf-8")` | Bun-native file reading for `seed.json`, `pipeline.json`, `tasks-status.json`, and `output.json`. |
| `Bun.write(path, content)` replaces `fs.writeFile` | Bun-native file writing for `runner.pid`. |
| `Bun.file(path).exists()` replaces `fs.access` catch pattern | Simpler boolean existence checks for `output.json` reads. |
| `node:fs/promises` `rename` retained | `Bun.write` does not provide atomic rename; `fs.rename` is needed for the `current/` → `complete/` directory move. |
| `node:fs/promises` `appendFile` retained | Used for appending to `runs.jsonl`. No Bun-native append API. |
| `node:fs` `unlinkSync` retained | Required in synchronous `process.on("exit")` handler for PID cleanup. |

### Dependency map

| Source | Import | Purpose |
|--------|--------|---------|
| `./task-runner` | `runPipeline` | Delegate single-task execution |
| `./module-loader` | `loadFreshModule` | Load task registry module dynamically |
| `./validation` | `validatePipelineOrThrow` | Validate pipeline definition |
| `./config` | `getPipelineConfig` | Resolve pipeline paths from slug |
| `./status-writer` | `writeJobStatus` | Atomic status file updates |
| `./symlink-bridge` | `ensureTaskSymlinkBridge` | Set up task execution sandbox |
| `./symlink-utils` | `cleanupTaskSymlinks`, `validateTaskSymlinks`, `repairTaskSymlinks` | Symlink lifecycle management |
| `./file-io` | `createTaskFileIO`, `generateLogName` | Write execution logs and failure details |
| `./logger` | `createJobLogger` | Structured logging |
| `./lifecycle-policy` | `decideTransition` | Pre-start lifecycle gate check |
| `../config/statuses` | `TaskState` | State enum constants (`DONE`, `RUNNING`, `FAILED`) |
| `../config/log-events` | `LogEvent`, `LogFileExtension` | Log file naming constants |
| `node:fs/promises` | `mkdir`, `rename`, `appendFile`, `unlink` | Directory creation, job move, JSONL append, PID cleanup |
| `node:fs` | `unlinkSync` | Synchronous PID cleanup in `exit` handler |
| `node:path` | `join`, `resolve`, `basename`, `dirname` | Path manipulation |

---

## 5. Acceptance Criteria

### Core behavior

1. `runPipelineJob(jobId)` resolves the pipeline slug from either `PO_PIPELINE_SLUG` env var or `seed.json`'s `pipeline` field, and throws if neither is available.
2. The pipeline definition is read from the path resolved by `getPipelineConfig(slug).pipelineJsonPath`, parsed as JSON, and validated via `validatePipelineOrThrow`.
3. The task registry is loaded dynamically from the path resolved by `getPipelineConfig(slug).tasksDir` (or `PO_TASK_REGISTRY` env override) using `loadFreshModule`. The default export is a `TaskRegistry` mapping task names to module paths.
4. Tasks are executed in the order declared in `pipeline.tasks`, strictly sequentially — no parallel execution.
5. When `PO_START_FROM_TASK` is set, tasks before the start-from task are skipped (but their artifacts are loaded if they are in `DONE` state).
6. When `PO_RUN_SINGLE_TASK` is `"true"` and `PO_START_FROM_TASK` is set, the runner exits the task loop after executing the start-from task.
7. On full pipeline completion (not single-task mode), the job directory is moved from `current/{jobId}` to `complete/{jobId}`, a summary record is appended to `runs.jsonl`, and task symlinks are cleaned up.

### PID file lifecycle

8. A `runner.pid` file is written to the job's working directory at startup, containing `process.pid` followed by a newline.
9. Signal handlers for `SIGINT` and `SIGTERM` clean up the PID file and call `process.exit()`.
10. A synchronous `process.on("exit")` handler performs best-effort PID file cleanup via `unlinkSync`, ignoring `ENOENT`.
11. The PID file is cleaned up in all exit paths: normal completion, signal, and crash.

### Status tracking

12. Before each task starts, `tasks-status.json` is updated with the task's state set to `RUNNING`, `startedAt` set to current ISO timestamp, and `attempts` incremented.
13. The root-level `current` field is updated to the current task name before each task.
14. On task success, the task's state is set to `DONE`, `endedAt` is set, `executionTimeMs` is computed from the task runner's logs, and `refinementAttempts` is recorded.
15. On task failure, the task's state is set to `FAILED`, `endedAt` is set, and the error details (`error`, `failedStage`, `stageLogPath`, `errorContext`) are recorded.
16. All status mutations go through `writeJobStatus` from the status-writer module.

### Lifecycle policy

17. Before starting each task (when `startFromTask` is NOT set), `decideTransition` is called with `{ op: "start", taskState, dependenciesReady }` where `dependenciesReady` is true only if all preceding tasks are in `DONE` state.
18. If `decideTransition` returns `{ ok: false }`, the runner throws an error with `httpStatus: 409` and `error: "unsupported_lifecycle"`.
19. When `startFromTask` is set, the lifecycle check is bypassed entirely for the target task.

### Symlink management

20. Before each task execution, task symlinks are validated via `validateTaskSymlinks`. If invalid, `repairTaskSymlinks` is called.
21. `ensureTaskSymlinkBridge` is called to set up the task's execution sandbox, and the returned relocated entry path is used as the module path for the task runner.
22. On pipeline completion, `cleanupTaskSymlinks` is called on the completed job directory.

### Log persistence

23. On task success, execution logs are written to `{workDir}/files/logs/` using `createTaskFileIO` with a `generateLogName` filename using `LogEvent` constants.
24. On task failure, both execution logs and failure detail files are written.

### Error handling

25. If any task fails (`result.ok === false`), `process.exit(1)` is called after updating the task's status to `FAILED`.
26. Unhandled errors in the main execution loop are caught, logged, PID is cleaned up, and `process.exit(1)` is called with a 5-second unreffed timeout safety net.
27. A task not found in the task registry throws `"Task not registered: {taskName}"`.

### Direct execution mode

28. When the module detects it is the entry point (comparison of `import.meta.url` against `process.argv[1]`), it reads `jobId` from `process.argv[2]`, installs `unhandledRejection`/`uncaughtException` handlers with 100ms force-exit timeouts, and calls `runPipelineJob(jobId)`.

### Completion record

29. The `runs.jsonl` entry contains: `id`, `finishedAt` (ISO 8601), `tasks` (array of task names), `totalExecutionTime` (sum of `executionTimeMs`), `totalRefinementAttempts` (sum of `refinementAttempts`), and `finalArtifacts` (keys from the pipeline artifacts map).
30. The `runs.jsonl` file and its parent directory are created if they don't exist.

### Bug fixes from analysis

31. `normalizeError` correctly normalizes errors: `Error` instances produce `{ name, message, stack }`; plain objects with a string `message` produce `{ message }`; other values produce `{ message: String(e) }`. The dead-code `instanceof Error` branch from the JS original is eliminated.
32. The `pipelineArtifacts` map is populated both for pre-completed tasks (on resume) AND for tasks that complete during the current run, fixing the gap identified in the analysis.

---

## 6. Notes

### Design trade-offs

- **`process.exit(1)` retained on task failure:** The analysis documents that the runner calls `process.exit(1)` immediately on task failure rather than unwinding gracefully. This behavior is preserved because the orchestrator spawns the runner as a child process and expects exit codes to signal success/failure. Changing to graceful unwinding would require coordination with the orchestrator's process management.
- **Synchronous `exit` handler for PID cleanup:** Using `unlinkSync` in the `process.on("exit")` handler is the only reliable way to clean up the PID file on abrupt exit. Bun supports synchronous fs operations in exit handlers.
- **Environment variable configuration preserved:** The runner reads `PO_*` environment variables set by the orchestrator at spawn time. This pattern is preserved rather than switching to a config-injection approach, because the runner is spawned as a separate process.

### Known risks

- **No cross-process locking:** The PID file and `tasks-status.json` are not protected by file locks. Concurrent runners for the same job can race. The analysis identified this as a known limitation — the system assumes one runner per job.
- **`fs.rename` across filesystems:** If `currentDir` and `completeDir` are on different filesystems, `fs.rename` will fail. The JS original has this same limitation. A copy-and-delete fallback could be added but is out of scope for this migration.
- **Async signal handlers:** Using `await` in `SIGINT`/`SIGTERM` handlers is not guaranteed to complete in all runtimes. Bun's signal handling should support this, but it is a runtime-specific behavior.

### Migration-specific concerns

- **`normalizeError` fixed:** The JS original had a dead `instanceof Error` branch because the preceding `typeof e.message === "string"` check matched Error instances first. The TS version uses proper discriminated logic: check `instanceof Error` first, then check for plain objects with a `message` property.
- **`pipelineArtifacts` gap fixed:** The JS original only populated `pipelineArtifacts` for tasks already in `DONE` state when the runner starts. The TS version also adds outputs from tasks that complete during the current run, making the `finalArtifacts` field in `runs.jsonl` accurate.
- **`isDirectSourceExecution` updated for Bun:** The direct-execution detection compares `import.meta.url` against `Bun.argv[1]` (or `process.argv[1]` with file URL conversion). The basename fallback check for `"pipeline-runner.js"` is updated to `"pipeline-runner.ts"`.
- **`getTaskName` helper preserved:** Supports both `string` and `{ name: string }` task formats from the pipeline definition.

### Dependencies on other modules

- Depends on `core/task-runner` (`runPipeline`) — high coupling; return shape is a tight contract.
- Depends on `core/status-writer` (`writeJobStatus`) — high coupling; every status mutation flows through it.
- Depends on `core/config` (`getPipelineConfig`) — medium coupling.
- Depends on `core/module-loader` (`loadFreshModule`) — low coupling.
- Depends on `core/validation` (`validatePipelineOrThrow`) — low coupling.
- Depends on `core/symlink-bridge` and `core/symlink-utils` — medium coupling.
- Depends on `core/file-io` (`createTaskFileIO`, `generateLogName`) — medium coupling.
- Depends on `core/lifecycle-policy` (`decideTransition`) — medium coupling.
- Depends on `core/logger` (`createJobLogger`) — low coupling.
- Depends on `config/statuses` (`TaskState`) — low coupling.
- Depends on `config/log-events` (`LogEvent`, `LogFileExtension`) — low coupling.

### Performance considerations

- `Bun.file().text()` is faster than `fs.readFile` for reading JSON files because Bun optimizes the underlying syscalls.
- `Bun.write()` is faster than `fs.writeFile` for the PID file write.
- Sequential task execution is the design constraint — no parallelism optimizations apply here.

---

## 7. Implementation Steps

### Step 1: Define types and interfaces

**What:** Create `src/core/pipeline-runner.ts` with all type definitions: `PipelineDefinition`, `TaskRegistry`, `SeedData`, `TaskExecutionContext`, `TaskRunResult`, `TaskLogEntry`, `NormalizedError`, `JobStatus`, `TaskStatus`, `CompletionRecord`, `ResolvedJobConfig`. Also add the `getTaskName` helper function.

**Why:** All subsequent steps depend on these types. Types-first ordering per spec conventions.

**Type signatures:**

```typescript
function getTaskName(task: string | { name: string }): string
```

**Test:** `tests/core/pipeline-runner.test.ts` — assert `getTaskName("myTask")` returns `"myTask"` and `getTaskName({ name: "myTask" })` returns `"myTask"`.

---

### Step 2: Implement `normalizeError`

**What:** Add the `normalizeError(e: unknown): NormalizedError` function. Check `instanceof Error` first → return `{ name, message, stack }`. Then check if `e` is a non-null object with a string `message` property → return `{ message }`. Otherwise → return `{ message: String(e) }`.

**Why:** Acceptance criterion 31. Fixes the dead-code branch from the JS original.

**Type signature:**

```typescript
function normalizeError(e: unknown): NormalizedError
```

**Test:** `tests/core/pipeline-runner.test.ts` — (1) `new Error("fail")` produces `{ name: "Error", message: "fail", stack: ... }`; (2) `{ message: "oops" }` produces `{ message: "oops" }` without `name` or `stack`; (3) `"string error"` produces `{ message: "string error" }`; (4) `null` produces `{ message: "null" }`; (5) an `Error` subclass includes the subclass `name`.

---

### Step 3: Implement `resolveJobConfig`

**What:** Add `resolveJobConfig(jobId: string): ResolvedJobConfig`. Reads environment variables (`PO_ROOT` defaulting to `process.cwd()`, `PO_DATA_DIR` defaulting to `"pipeline-data"`, `PO_CURRENT_DIR`, `PO_COMPLETE_DIR`, `PO_PIPELINE_SLUG`, `PO_TASK_REGISTRY`, `PO_PIPELINE_PATH`, `PO_START_FROM_TASK`, `PO_RUN_SINGLE_TASK`). Computes `workDir`, `statusPath`, and resolves pipeline config via `getPipelineConfig` if `PO_PIPELINE_PATH` is not set.

**Why:** Centralizes configuration resolution before the main execution begins.

**Type signature:**

```typescript
function resolveJobConfig(jobId: string, pipelineSlug: string): ResolvedJobConfig
```

**Test:** `tests/core/pipeline-runner.test.ts` — set env vars, call `resolveJobConfig`, assert all paths are correctly computed. Test default fallbacks when optional env vars are unset.

---

### Step 4: Implement PID file lifecycle

**What:** Add `writePidFile(workDir: string): Promise<void>` that writes `process.pid + "\n"` to `{workDir}/runner.pid` via `Bun.write`. Add `cleanupPidFile(workDir: string): Promise<void>` that deletes the PID file, ignoring `ENOENT`. Add `cleanupPidFileSync(workDir: string): void` that uses `unlinkSync` with `ENOENT` suppression. Add `installSignalHandlers(workDir: string): void` that registers `SIGINT`, `SIGTERM`, and `process.on("exit")` handlers.

**Why:** Acceptance criteria 8, 9, 10, 11.

**Type signatures:**

```typescript
async function writePidFile(workDir: string): Promise<void>
function cleanupPidFileSync(workDir: string): void
function installSignalHandlers(workDir: string): void
```

**Test:** `tests/core/pipeline-runner.test.ts` — (1) `writePidFile` creates a file containing the current PID; (2) `cleanupPidFileSync` removes the file; (3) `cleanupPidFileSync` on a non-existent file does not throw.

---

### Step 5: Implement pipeline loading and validation

**What:** Add `loadPipeline(pipelineJsonPath: string): Promise<PipelineDefinition>` that reads the pipeline JSON file via `Bun.file().text()`, parses it, calls `validatePipelineOrThrow`, and returns the typed definition. Add `loadTaskRegistry(registryPath: string): Promise<TaskRegistry>` that calls `loadFreshModule` and returns the default export.

**Why:** Acceptance criteria 2, 3.

**Type signatures:**

```typescript
async function loadPipeline(pipelineJsonPath: string): Promise<PipelineDefinition>
async function loadTaskRegistry(registryPath: string): Promise<TaskRegistry>
```

**Test:** `tests/core/pipeline-runner.test.ts` — (1) `loadPipeline` with a valid JSON file returns a parsed `PipelineDefinition`; (2) `loadPipeline` with invalid JSON throws; (3) `loadPipeline` with a structurally invalid definition throws via `validatePipelineOrThrow`.

---

### Step 6: Implement task execution loop — status updates and lifecycle checks

**What:** Add the core `executeTaskLoop` function (or integrate directly into `runPipelineJob`). For each task in the pipeline's `tasks` array: extract the task name via `getTaskName`, handle `startFromTask` skip logic, handle already-`DONE` tasks (load their `output.json` into `pipelineArtifacts`), check lifecycle policy via `decideTransition` (unless `startFromTask` is set), update status to `RUNNING` via `writeJobStatus` with `startedAt` and incremented `attempts`, and handle the `runSingleTask` break condition.

**Why:** Acceptance criteria 4, 5, 6, 12, 13, 17, 18, 19.

**Type signatures:**

```typescript
export async function runPipelineJob(jobId: string): Promise<void>
```

**Test:** `tests/core/pipeline-runner.test.ts` — (1) tasks execute in declared order; (2) with `startFromTask`, preceding tasks are skipped; (3) with `runSingleTask`, the loop exits after the target task; (4) lifecycle policy block throws with status 409; (5) status is updated to `RUNNING` before each task with `startedAt` and incremented `attempts`.

---

### Step 7: Implement per-task execution — delegation, symlinks, and result handling

**What:** Within the task loop: create the task directory via `mkdir({ recursive: true })`, validate and repair task symlinks, set up the symlink bridge, create the file I/O interface via `createTaskFileIO`, build the `TaskExecutionContext`, delegate to `runPipeline(modulePath, context)`, and handle the result. On success: write execution logs, update status to `DONE` with `endedAt`, `executionTimeMs`, and `refinementAttempts`; add task output to `pipelineArtifacts`. On failure: write execution logs and failure details, update status to `FAILED` with error details, call `process.exit(1)`.

**Why:** Acceptance criteria 14, 15, 20, 21, 23, 24, 25, 27, 32.

**Test:** `tests/core/pipeline-runner.test.ts` — mock `runPipeline` to return success/failure results. Assert: (1) on success, status is `DONE` with `executionTimeMs` and `endedAt`; (2) on failure, status is `FAILED` with error details and `process.exit(1)` is called; (3) unregistered task name throws `"Task not registered: {taskName}"`; (4) task output is added to `pipelineArtifacts` for tasks completing during the current run.

---

### Step 8: Implement pipeline completion — directory move, runs.jsonl, symlink cleanup

**What:** After the task loop completes without failure (and not in single-task mode): move the job directory from `current/{jobId}` to `complete/{jobId}` via `fs.rename`, create the `complete/` directory if needed via `mkdir({ recursive: true })`, build the `CompletionRecord`, append it as a JSON line to `{completeDir}/runs.jsonl` via `appendFile`, and call `cleanupTaskSymlinks` on the completed directory.

**Why:** Acceptance criteria 7, 29, 30, 22.

**Type signatures:**

```typescript
// Internal — called at end of runPipelineJob
async function completeJob(
  config: ResolvedJobConfig,
  status: JobStatus,
  pipelineArtifacts: Record<string, unknown>
): Promise<void>
```

**Test:** `tests/core/pipeline-runner.test.ts` — set up a mock job directory under `current/`. Call `completeJob`. Assert: (1) directory no longer exists under `current/`; (2) directory exists under `complete/`; (3) `runs.jsonl` exists and contains a valid JSON line with the expected `CompletionRecord` fields; (4) `cleanupTaskSymlinks` was called on the completed directory.

---

### Step 9: Implement top-level error handling and force-exit safety net

**What:** Wrap the main `runPipelineJob` body in a try/catch. In the catch: log the error, clean up the PID file, set `process.exitCode = 1`, create a 5-second unreffed timeout as a force-exit safety net, then call `process.exit(1)`.

**Why:** Acceptance criterion 26.

**Test:** `tests/core/pipeline-runner.test.ts` — mock internal functions to throw an unexpected error. Assert that the error is logged, PID file is cleaned up, and `process.exit(1)` is called.

---

### Step 10: Implement direct execution mode

**What:** Add the `isDirectSourceExecution(): boolean` function that compares `import.meta.url` against `process.argv[1]` (converted to file URL). Include a basename fallback check for `"pipeline-runner.ts"`. At module level, conditionally execute the direct-execution block: install `unhandledRejection` and `uncaughtException` handlers (with 100ms force-exit timeouts), read `jobId` from `process.argv[2]`, and call `runPipelineJob(jobId)`.

**Why:** Acceptance criterion 28.

**Type signature:**

```typescript
function isDirectSourceExecution(): boolean
```

**Test:** `tests/core/pipeline-runner.test.ts` — (1) when `import.meta.url` matches `process.argv[1]`, returns `true`; (2) when they differ, returns `false`. Note: the direct-execution block itself is tested via integration tests, not unit tests, to avoid triggering `process.exit` in the test runner.

---

### Step 11: Integration test — full pipeline run lifecycle

**What:** Write an integration test that exercises the full lifecycle: set up a temp directory with `seed.json`, `tasks-status.json`, and a mock pipeline/task registry, set environment variables, call `runPipelineJob(jobId)` with mocked dependencies (task runner, status writer, symlink utils), and verify all side effects — status transitions, log files, directory move, `runs.jsonl` record, PID file cleanup.

**Why:** End-to-end validation that all steps work together. Covers acceptance criteria 1–32 in combination.

**Test:** `tests/core/pipeline-runner.integration.test.ts` — full lifecycle test. Use `Bun.tempdir` or `import { mkdtemp } from "node:fs/promises"` for filesystem isolation. Mock `runPipeline` from task-runner to return controlled success results. Assert the complete sequence of status transitions and filesystem artifacts.
