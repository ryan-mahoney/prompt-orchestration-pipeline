# SpecOps Analysis: `core/pipeline-runner`

**Source files:** `src/core/pipeline-runner.js`

---

## 1. Purpose & Responsibilities

The pipeline runner is the system's per-job execution engine. It receives a job identifier, resolves the associated pipeline definition and task registry, and executes each task in the pipeline sequentially — managing task lifecycle state, filesystem scaffolding, symlink integrity, and artifact collection along the way.

**Responsibilities:**

- Resolving all runtime configuration for a job: root directories, pipeline slug, pipeline definition, task registry, and data directories.
- Writing and cleaning up a PID file (`runner.pid`) so that external actors (e.g., stop-job endpoints) can signal this process.
- Installing signal handlers (`SIGINT`, `SIGTERM`, process `exit`) for graceful PID cleanup.
- Reading and validating the pipeline definition (`pipeline.json`).
- Loading the task registry module to obtain the mapping from task names to task module paths.
- Iterating through the pipeline's task list in declared order, respecting `startFromTask` and `runSingleTask` execution modes.
- Enforcing lifecycle policy: consulting the lifecycle-policy module before starting each task to confirm dependencies are satisfied.
- Updating the shared job status file (`tasks-status.json`) at each task state transition (running, done, failed).
- Setting up symlinks for each task's execution sandbox, validating them, and repairing them if invalid.
- Delegating actual task execution to the task runner (`runPipeline`).
- Persisting execution logs and failure details to the filesystem via the file I/O module.
- On full pipeline completion (not single-task mode), moving the job directory from `current/` to `complete/`, appending a summary record to `runs.jsonl`, and cleaning up task symlinks.
- On any task failure, terminating the process with a non-zero exit code.

**Boundaries:**

- The pipeline runner does **not** create the initial job directory or `tasks-status.json` — the orchestrator does that before spawning the runner.
- It does **not** watch for new work — it processes exactly one job per invocation.
- It does **not** execute pipeline stages directly — it delegates to the task runner for each task.
- It does **not** manage the `pending/` directory lifecycle.

**Pattern:** Sequential Pipeline Executor — iterates a declared task list, enforces lifecycle gates, delegates execution, manages state transitions and filesystem lifecycle.

---

## 2. Public Interface

### `runPipelineJob(jobId)`

- **Purpose:** Execute all tasks in a pipeline job from start to finish, managing state transitions and filesystem lifecycle.
- **Parameters:**

| Name | Shape | Optional | Semantic Meaning |
|---|---|---|---|
| `jobId` | string | **Required** | The unique identifier for the job. Corresponds to a directory under the `current/` data directory containing `seed.json` and `tasks-status.json`. |

- **Return value:** `Promise<void>` — resolves when all tasks complete successfully (or when a single-task run finishes). Does not return a value; success is indicated by the process exiting with code 0.
- **Thrown errors / failure modes:**
  - Throws if the pipeline slug cannot be determined (neither from `PO_PIPELINE_SLUG` environment variable nor from `seed.json`).
  - Throws if `getPipelineConfig` fails (pipeline slug not in registry).
  - Throws if `pipeline.json` cannot be read or parsed.
  - Throws if the pipeline definition fails validation (`validatePipelineOrThrow`).
  - Throws if a task is not registered in the task registry.
  - On any task failure or unhandled error, the process is forcefully exited with code 1 after updating status. The function does not reject gracefully — it calls `process.exit(1)`.

### `isDirectSourceExecution()` (module-private)

- **Purpose:** Determines whether the module is being executed directly (as an entry point) rather than imported as a library.
- **Return value:** Boolean. True if the current script is being run directly via `node pipeline-runner.js` or equivalent.
- **Note:** This is not exported. It gates the direct-execution block at the bottom of the module.

### Direct Execution Mode

When the module detects it is the entry point (via `isDirectSourceExecution()`), it:
1. Installs global `unhandledRejection` and `uncaughtException` handlers that force-exit after 100ms.
2. Reads `jobId` from `process.argv[2]`.
3. Calls `runPipelineJob(jobId)` and exits on failure.

This mode is explicitly documented as the "source-mode" path; compiled binary execution uses a different `_run-job` subcommand.

---

## 3. Data Models & Structures

### Pipeline Definition (consumed)

Read from `pipeline.json` at the path resolved by the pipeline config module.

| Field | Type | Semantic Meaning |
|---|---|---|
| `tasks` | Array of (string \| { name: string }) | Ordered list of task names to execute. Each element is either a plain string task name or an object with a `name` property. |
| `llm` | object \| null | Optional LLM provider/model override for all tasks in this pipeline. |
| `taskConfig` | object \| undefined | Optional per-task configuration map. Keys are task names, values are arbitrary config objects passed into the task context. |

**Ownership:** Owned by the pipeline configuration; consumed read-only by the runner.

### Task Registry (consumed)

Loaded dynamically from the task registry module path. The default export is expected to be an object mapping task names (strings) to relative or absolute file paths of the task module.

| Field | Type | Semantic Meaning |
|---|---|---|
| `[taskName]` | string | File path to the task module. Relative paths are resolved relative to the directory containing the registry file. |

### Seed Data (consumed)

Read from `seed.json` in the job's working directory.

| Field | Type | Semantic Meaning |
|---|---|---|
| `pipeline` | string | Pipeline slug identifier. Used as a fallback when `PO_PIPELINE_SLUG` is not set. |
| *(other fields)* | any | Passed through to each task's execution context as `ctx.seed`. |

### Job Status (`tasks-status.json`) (consumed and mutated)

The runner reads the initial status snapshot and continuously updates it via `writeJobStatus`. The structure managed by the runner:

| Field | Type | Semantic Meaning |
|---|---|---|
| `id` | string | Job identifier. |
| `current` | string \| null | Name of the currently executing task. Updated at each task start. |
| `tasks` | object | Map of task name → task status object. |
| `tasks[name].state` | string | One of: `"pending"`, `"running"`, `"done"`, `"failed"`. |
| `tasks[name].startedAt` | string (ISO 8601) | Timestamp when the task began execution. |
| `tasks[name].endedAt` | string (ISO 8601) | Timestamp when the task finished (success or failure). |
| `tasks[name].attempts` | number | Cumulative number of execution attempts. Incremented on each start. |
| `tasks[name].executionTimeMs` | number | Total execution time derived from summing log entry durations. Set on success. |
| `tasks[name].refinementAttempts` | number | Number of refinement cycles the task runner performed. |
| `tasks[name].error` | object | Normalized error object on failure. Contains at minimum a `message` field. |
| `tasks[name].failedStage` | string | Name of the pipeline stage that failed, if applicable. |
| `tasks[name].stageLogPath` | string | Filesystem path to the failed stage's log file. |
| `tasks[name].errorContext` | object | Diagnostic metadata about the failure context (previous stage, data shape indicators, flag keys). |

**Note:** Root-level fields such as `state`, `currentStage`, `lastUpdated`, and `files` may exist in the snapshot because they are created or normalized by the status writer, but this runner only directly mutates `current` and `tasks[taskName]`.

**Lifecycle:** Created by the orchestrator before spawning the runner. The runner reads it at startup and mutates it throughout execution. The status file persists after the job moves to `complete/`.

**Serialization:** JSON. Written atomically by the status-writer module (which serializes concurrent writes via a per-job queue).

### Task Execution Context (produced)

Constructed for each task and passed to the task runner:

| Field | Type | Semantic Meaning |
|---|---|---|
| `workDir` | string | Absolute path to the job's working directory. |
| `taskDir` | string | Absolute path to the task-specific subdirectory (`{workDir}/tasks/{taskName}`). |
| `seed` | object | The full seed data object. |
| `taskName` | string | Name of the current task. |
| `taskConfig` | object | Per-task configuration from `pipeline.taskConfig[taskName]`, or empty object if not configured. |
| `statusPath` | string | Absolute path to `tasks-status.json`. |
| `jobId` | string | The job identifier. |
| `llmOverride` | object \| null | Pipeline-level LLM override, or null. |
| `meta.pipelineTasks` | Array | Shallow copy of `pipeline.tasks` as declared. Entries are not normalized, so this array may contain strings and/or `{ name: string }` objects. |

### Pipeline Artifacts (internal)

An in-memory object (`pipelineArtifacts`) that accumulates `output.json` from completed tasks. Keyed by task name. Used in the completion summary written to `runs.jsonl`.

**Note:** Despite being accumulated, `pipelineArtifacts` is only populated for tasks that were already `DONE` when the runner starts (i.e., previously completed tasks when resuming with `startFromTask`). Tasks completed during the current run do not have their outputs added to this map — this appears to be a gap or intentional simplification.

### Completion Record (`runs.jsonl` entry)

Appended to `{COMPLETE_DIR}/runs.jsonl` when a full pipeline run completes:

| Field | Type | Semantic Meaning |
|---|---|---|
| `id` | string | Job identifier (from status). |
| `finishedAt` | string (ISO 8601) | Timestamp of pipeline completion. |
| `tasks` | Array of string | List of task names that were part of the job. |
| `totalExecutionTime` | number | Sum of `executionTimeMs` across all tasks. |
| `totalRefinementAttempts` | number | Sum of `refinementAttempts` across all tasks. |
| `finalArtifacts` | Array of string | Keys of `pipelineArtifacts` — names of tasks whose output was loaded. |

**Serialization:** One JSON object per line (JSONL format), appended to the file.

---

## 4. Behavioral Contracts

### Preconditions

- The job working directory (`{CURRENT_DIR}/{jobId}`) must already exist and contain `seed.json` and `tasks-status.json`.
- Environment variable `PO_ROOT` (or a default via `process.cwd()`) must point to a valid project root.
- Either `PO_PIPELINE_SLUG` must be set, or `seed.json` must contain a `pipeline` field.
- The pipeline slug must be registered in the pipeline config registry.
- The pipeline definition file must exist, be valid JSON, and pass validation.
- The task registry module must exist and export a default object mapping task names to module paths.

### Postconditions

- On success (full run): the job directory has been moved from `current/{jobId}` to `complete/{jobId}`, a summary record has been appended to `runs.jsonl`, task symlinks have been cleaned up, and the process exits with code 0.
- On success (`PO_RUN_SINGLE_TASK === "true"`): the runner does not move the job to `complete/`; the job directory remains in `current/`. In the intended usage, where `PO_START_FROM_TASK` is also set, the targeted task ends in `"done"` and the loop exits immediately afterward.
- On failure: the failing task's status is `"failed"` in `tasks-status.json` with error details, and the process exits with code 1.
- The `runner.pid` file is cleaned up in all exit paths (normal, signal, crash).

### Invariants

- Tasks are executed in the order declared in `pipeline.tasks`. No parallel task execution.
- In the normal full-run path (no `PO_START_FROM_TASK`), a task is only started if all upstream tasks (those appearing earlier in the list) have state `"done"`.
- When `PO_START_FROM_TASK` is set, the runner skips the lifecycle-policy dependency check for resumed execution and relies on the caller to choose a safe restart point.
- The `tasks-status.json` file is updated atomically before and after each task execution — there is always a status record reflecting the current state of the pipeline.
- The `attempts` counter monotonically increases across invocations.

### Ordering Guarantees

- Strictly sequential task execution. The next task does not begin until the current task's `runPipeline` promise resolves.
- Status writes are serialized through the status-writer's per-job write queue.

### Concurrency Behavior

- The module is designed to run as a single process per job. There is no cross-process locking for the job directory, PID file, or completion move.
- Concurrent invocations for the same job can race on `tasks-status.json`, `runner.pid`, and the final `fs.rename()` into `complete/`. The status writer only serializes writes within a given process.
- The PID file mechanism provides a way for external actors to detect an active runner, but there is no file locking to prevent concurrent runners.

---

## 5. State Management

### In-Memory State

| State | Type | Lifecycle | Mutation Triggers |
|---|---|---|---|
| `status` | object | Created by parsing `tasks-status.json` at startup. Kept in sync with disk via `updateStatus`. | Updated after each `writeJobStatus` call via `Object.assign`. |
| `pipelineArtifacts` | object | Created empty at start. Populated from `output.json` of pre-completed tasks. | Only populated for tasks already in `DONE` state when the runner starts. |
| Signal handlers | process listeners | Registered once at start. Never removed. | N/A |

### Persisted State

| State | Location | Schema | Read/Write Pattern |
|---|---|---|---|
| `tasks-status.json` | `{workDir}/tasks-status.json` | See Data Models section | Read once at startup; written via `writeJobStatus` at each state transition. |
| `runner.pid` | `{workDir}/runner.pid` | Plain text: process PID followed by newline | Written once at startup; deleted on exit/signal/cleanup. |
| Execution logs | `{workDir}/files/logs/` | JSON stringified log arrays or failure detail objects | Written after each task completes or fails. |
| `runs.jsonl` | `{COMPLETE_DIR}/runs.jsonl` | JSONL (see Completion Record) | Appended once on full pipeline completion. |
| Job directory | `{CURRENT_DIR}/{jobId}` → `{COMPLETE_DIR}/{jobId}` | Directory tree | Moved atomically via `fs.rename` on completion. |

### Crash Recovery

- If the process crashes mid-task, `tasks-status.json` will show the task as `"running"` with a `startedAt` timestamp but no `endedAt`. The `runner.pid` file may or may not be cleaned up depending on the crash mechanism.
- The synchronous `process.on('exit')` handler attempts PID file cleanup via `fsSync.unlinkSync`, providing best-effort cleanup even on abrupt exit.
- There is no journal or write-ahead log. Partial writes to `tasks-status.json` are mitigated by the status-writer's atomic write pattern, but the runner itself does not implement rollback.
- A crashed or partially completed job can be resumed by re-invoking the runner with `PO_START_FROM_TASK` set to the desired restart task. This works because previously completed tasks remain marked `DONE`, and resumed execution bypasses the normal dependency gate.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What Is Used | Nature | Coupling |
|---|---|---|---|
| `core/task-runner` | `runPipeline` | Direct import, hard dependency | High — the runner's primary delegation target. Return shape (`ok`, `error`, `failedStage`, `logs`, `context`, `refinementAttempts`) is a tight contract. |
| `core/module-loader` | `loadFreshModule` | Direct import | Low — used solely to load the task registry. Could be replaced with any dynamic module loader. |
| `core/validation` | `validatePipelineOrThrow` | Direct import | Low — called once to validate the pipeline definition. |
| `core/config` | `getPipelineConfig` | Direct import | Medium — used to resolve pipeline paths from the slug. Depends on config module's registry being populated. |
| `core/status-writer` | `writeJobStatus` | Direct import | High — every status mutation goes through this module. The runner depends on its atomic write and snapshot merge semantics. |
| `core/symlink-bridge` | `ensureTaskSymlinkBridge` | Direct import | Medium — required for task execution sandboxing. Returns the relocated entry path. |
| `core/symlink-utils` | `cleanupTaskSymlinks`, `validateTaskSymlinks`, `repairTaskSymlinks` | Direct import | Medium — symlink lifecycle management. |
| `core/file-io` | `createTaskFileIO`, `generateLogName` | Direct import | Medium — used for writing logs and failure details. |
| `core/logger` | `createJobLogger` | Direct import | Low — logging utility. Easily replaceable. |
| `core/lifecycle-policy` | `decideTransition` | Direct import | Medium — consulted before starting each task. The runner checks the `ok` field and uses `reason` on failure. |
| `config/statuses` | `TaskState` | Direct import | Low — uses the enum for state comparisons (`DONE`, `RUNNING`, `FAILED`). |
| `config/log-events` | `LogEvent`, `LogFileExtension` | Direct import | Low — constants for log file naming. |

### 6.2 External Dependencies

| Package | What It Provides | Usage | Replaceability |
|---|---|---|---|
| `node:fs/promises` | Async filesystem operations | File reads, writes, directory creation, rename, unlink | Core platform API |
| `node:fs` | Sync filesystem operations | `unlinkSync` in the `exit` handler | Core platform API |
| `node:path` | Path manipulation | Directory joining, resolution, basename | Core platform API |
| `node:url` | URL utilities | `pathToFileURL` for `isDirectSourceExecution` check | Core platform API |

### 6.3 System-Level Dependencies

- **File system layout:** Expects `{DATA_DIR}/current/{jobId}/` to contain `seed.json`, `tasks-status.json`, and the ability to create `tasks/{taskName}/` subdirectories and `files/logs/` directories.
- **Environment variables:**
  - `PO_ROOT` — project root (falls back to `process.cwd()`)
  - `PO_DATA_DIR` — relative data directory name (default: `"pipeline-data"`)
  - `PO_CURRENT_DIR` — absolute or relative path to current jobs directory
  - `PO_COMPLETE_DIR` — absolute or relative path to completed jobs directory
  - `PO_PIPELINE_SLUG` — pipeline identifier (optional if seed contains it)
  - `PO_TASK_REGISTRY` — absolute path to task registry module (optional)
  - `PO_PIPELINE_PATH` — absolute path to pipeline definition (optional)
  - `PO_START_FROM_TASK` — task name to resume from (optional)
  - `PO_RUN_SINGLE_TASK` — `"true"` to run only the start-from task (optional)
- **Process management:** Uses `process.pid`, `process.exit()`, `process.exitCode`, `process.on()` for signal handling. Expects the process to be stoppable via SIGINT/SIGTERM.

---

## 7. Side Effects & I/O

### File System

| Operation | Path | Sync/Async | Error Handling |
|---|---|---|---|
| Write PID file | `{workDir}/runner.pid` | Async | None — errors propagate |
| Delete PID file | `{workDir}/runner.pid` | Both (async in handlers, sync in `exit`) | Silently ignores `ENOENT` |
| Read `seed.json` | `{workDir}/seed.json` | Async | Throws with descriptive message |
| Read `tasks-status.json` | `{workDir}/tasks-status.json` | Async | Errors propagate |
| Read `pipeline.json` | Resolved from config | Async | Errors propagate |
| Read `output.json` | `{workDir}/tasks/{taskName}/output.json` | Async | Logged warning, continues |
| Write status updates | `{workDir}/tasks-status.json` | Async (via status-writer) | Errors propagate |
| Create task directory | `{workDir}/tasks/{taskName}/` | Async, recursive | Errors propagate |
| Write execution logs | `{workDir}/files/logs/` | Async (via file-io) | Errors propagate |
| Move job directory | `{CURRENT_DIR}/{jobId}` → `{COMPLETE_DIR}/{jobId}` | Async (`fs.rename`) | Errors propagate |
| Append completion record | `{COMPLETE_DIR}/runs.jsonl` | Async (mkdir + appendFile) | Errors propagate |
| Cleanup symlinks | `{COMPLETE_DIR}/{jobId}` | Async | Errors propagate |

### Process Management

- Registers handlers on `process.on('exit')`, `process.on('SIGINT')`, `process.on('SIGTERM')`.
- In direct-execution mode, also registers `unhandledRejection` and `uncaughtException` handlers.
- Calls `process.exit(1)` on task failure and unhandled errors. Uses a 5-second force-exit timeout (unreffed) as a safety net for the top-level catch block.

### Logging & Observability

- Uses `createJobLogger("PipelineRunner", jobId)` for structured logging.
- Logs at `group` level: pipeline execution start with metadata (job ID, slug, task count, start-from task, single-task mode).
- Logs at `warn` level: lifecycle blocks, failed output reads for completed tasks, symlink validation failures.
- Logs at `error` level: task failures, symlink repair failures, unhandled pipeline errors.
- Logs at `debug` level: symlink validation success.
- Falls back to `console.error` for fatal errors in the top-level catch and direct-execution error handlers.

### Timing

- Timestamps are generated via `new Date().toISOString()` at the point of each state transition.
- A 5-second unreffed timeout is set in the top-level catch as a force-exit safety net.
- In direct-execution mode, 100ms timeouts are used as delays before force-exiting on unhandled rejections/exceptions.

---

## 8. Error Handling & Failure Modes

### Error Categories

| Category | Source | Examples |
|---|---|---|
| Configuration | Missing pipeline slug, unregistered pipeline, missing registry | `"Pipeline slug is required"`, `"Pipeline {slug} not found in registry"` |
| Validation | Invalid pipeline definition | Thrown by `validatePipelineOrThrow` |
| Lifecycle | Task cannot start due to dependency or policy violation | Error with `httpStatus: 409`, `error: "unsupported_lifecycle"` |
| Task Registration | Task name not in registry | `"Task not registered: {taskName}"` |
| Symlink | Symlink validation and repair failures | `"Failed to repair task symlinks for {taskName}"` |
| Task Execution | Task runner reports failure | `result.ok === false` with error details |
| Unexpected | Any unhandled exception in the main loop | Caught by top-level try/catch |

### Propagation Strategy

- **Task failures** (`result.ok === false`): Status is updated to `FAILED`, logs and failure details are written, then `process.exit(1)` is called.
- **Caught exceptions** in the per-task try/catch: Status is updated to `FAILED` with normalized error, then `process.exit(1)`.
- **Lifecycle blocks**: An error object is constructed with `httpStatus: 409` and thrown, which is caught by the per-task catch block.
- **Top-level unhandled errors**: Logged, PID file cleaned up, `process.exit(1)` called with a 5-second force-exit safety timeout.

### Recovery Behavior

- There is no retry logic within the pipeline runner itself. Each task gets exactly one attempt per invocation. (Retry/refinement logic exists within the task runner.)
- Recovery from a failed run requires re-invocation, typically with `PO_START_FROM_TASK` to skip already-completed tasks.
- The `attempts` counter tracks cumulative invocations across restarts.

### Partial Failure

- If a task fails midway through a multi-task pipeline, all preceding tasks remain in `DONE` state. The failed task is marked `FAILED`. Subsequent tasks remain in their prior state (typically `pending`).
- The job directory remains in `current/` — it is never moved to `complete/` on failure.

---

## 9. Integration Points & Data Flow

### Upstream

- **Orchestrator** spawns the pipeline runner as a child process, passing `jobId` as a command-line argument and configuration via environment variables.
- **CLI** can also invoke the runner directly for development/debugging.

### Downstream

- **Task Runner** (`runPipeline`): The runner delegates each task's execution and receives a result object.
- **Status Writer** (`writeJobStatus`): All status mutations flow through this module.
- **File I/O** (`createTaskFileIO`): Log writes are delegated here.
- **Symlink Bridge / Utils**: Task sandbox setup is delegated here.
- **Config Module**: Pipeline configuration resolution.
- **Lifecycle Policy**: Pre-start gate check.

### Data Transformation

1. **Input assembly:** Environment variables + `seed.json` + config registry → resolved paths and pipeline slug.
2. **Pipeline loading:** `pipeline.json` → validated pipeline definition with task list, LLM overrides, and per-task config.
3. **Task registry loading:** Dynamic module import → task name-to-path mapping.
4. **Per-task context construction:** Pipeline definition + seed + resolved paths → task execution context object.
5. **Result processing:** Task runner result → status update patches + log files.
6. **Completion summarization:** Accumulated status data → `runs.jsonl` record.

### Control Flow (Primary Use Case: Full Pipeline Run)

1. Resolve configuration: root, data dirs, pipeline slug, pipeline config.
2. Write PID file, register signal handlers.
3. Read and validate `pipeline.json`.
4. Load task registry.
5. Read `tasks-status.json` and `seed.json`.
6. For each task in declared order:
   a. Skip if before `startFromTask` (when set).
   b. Skip if already `DONE` (load output into artifacts map).
   c. Check lifecycle policy (unless `startFromTask` is set, which bypasses the check).
   d. Update status to `RUNNING`.
   e. Create task directory.
   f. Validate and repair task symlinks.
   g. Set up symlink bridge.
   h. Create file I/O interface.
   i. Execute task via `runPipeline`.
   j. On success: write logs, update status to `DONE`.
   k. On failure: write logs + failure details, update status to `FAILED`, exit.
7. Move job directory to `complete/`.
8. Append completion record to `runs.jsonl`.
9. Clean up task symlinks.

### System-Wide Patterns

The pipeline runner participates in the **filesystem-based job lifecycle** pattern: jobs progress through `pending/` → `current/` → `complete/` directories. The runner owns the `current/` → `complete/` transition.

It also participates in the **environment-variable configuration** pattern: behavior is controlled by `PO_*` environment variables set by the orchestrator at spawn time.

---

## 10. Edge Cases & Implicit Behavior

### Default Values That Shape Behavior

- `PO_ROOT` defaults to `process.cwd()` if not set. This means the runner's behavior changes depending on which directory the process is started from.
- `PO_DATA_DIR` defaults to `"pipeline-data"` — a relative path joined to ROOT.
- `PO_CURRENT_DIR` defaults to `{DATA_DIR}/current` but can be overridden to an absolute path.
- `PO_COMPLETE_DIR` defaults to `{DATA_DIR}/complete` but can be overridden to an absolute path.
- `taskConfig` defaults to an empty object `{}` for tasks without per-task configuration.
- `llmOverride` is `null` if the pipeline definition has no `llm` field.

### Lifecycle Policy Bypass

When `startFromTask` is set, the lifecycle policy check is skipped entirely for the target task. This means a resumed task can be started regardless of upstream dependency state — the assumption is that the operator knows what they're doing when resuming.

### Pipeline Artifacts Gap

The `pipelineArtifacts` map is only populated from previously-completed tasks' `output.json` files. Tasks that complete during the current run do not add their outputs to this map. This means the `finalArtifacts` field in the `runs.jsonl` completion record only reflects tasks that were already done before this invocation — not all tasks. This is likely a bug or an intentional simplification where `pipelineArtifacts` was originally intended for inter-task data passing but the feature was never fully implemented.

### Hard Process Exit

The runner calls `process.exit(1)` immediately upon task failure rather than unwinding the task loop. This means:
- No subsequent tasks are attempted after a failure.
- The `finally` block for PID cleanup does execute (since `process.exit` triggers `exit` event handlers).
- The top-level `catch` block is only reached for errors thrown before or between task executions, not for task-level failures (which exit before reaching it).

### Force-Exit Safety Net

The top-level catch block sets a 5-second unreffed timeout before calling `process.exit(1)`. This guards against the async PID cleanup hanging indefinitely. The `unref()` call ensures this timeout does not keep the event loop alive if the process exits normally.

### Error Normalization

The `normalizeError` helper has a subtle ordering issue: it checks `e && typeof e === "object" && typeof e.message === "string"` before `e instanceof Error`. This means plain objects with a `message` string field are returned as-is (without `name` or `stack`), while actual `Error` instances are destructured into `{ name, message, stack }`. The first branch will match Error instances too (since they have a string `message`), meaning the `instanceof Error` branch is effectively dead code.

### Task Name Extraction

The `getTaskName` helper supports two task declaration formats: plain strings and objects with a `name` property. This dual format is used throughout the pipeline system but the runner only uses it for extracting names — it does not use other potential fields on task objects.

### Direct Execution Guards

The `isDirectSourceExecution()` function compares `import.meta.url` against `process.argv[1]` (converted to file URL) and also checks if the basename is `"pipeline-runner.js"`. The basename check is a fallback for environments where the URL comparison might not match exactly.

---

## 11. Open Questions & Ambiguities

1. **`pipelineArtifacts` incompleteness:** The artifacts map is never populated with results from tasks that complete during the current run. Is this intentional (the map was only meant for re-reads on resume) or a missing feature? The `runs.jsonl` record's `finalArtifacts` field is misleading if it only lists pre-completed tasks.

2. **No inter-task data passing:** Despite accumulating `pipelineArtifacts`, this data is never injected into subsequent tasks' contexts. Tasks appear to communicate only through the filesystem (each task reads its predecessors' `output.json` independently if needed). It is unclear whether the artifacts map was intended to enable in-memory inter-task data flow.

3. **Symlink expected targets:** The `expectedTargets.nodeModules` path is computed as `path.join(path.resolve(poRoot, ".."), "node_modules")` — one directory above PO_ROOT. This assumes a specific monorepo or project layout where `node_modules` lives in the parent directory. The rationale for this is not documented.

4. **Lifecycle policy bypass semantics:** When `startFromTask` is set, the lifecycle check is entirely skipped. There is no validation that upstream tasks are actually in `DONE` state. This could lead to a task executing with missing upstream outputs.

5. **`normalizeError` dead code:** The `instanceof Error` branch in `normalizeError` is unreachable because the preceding condition (`typeof e.message === "string"`) will match Error instances first. This may be unintentional.

6. **Process exit in async context:** The signal handlers (`SIGINT`, `SIGTERM`) call `await cleanupRunnerPid()` followed by `process.exit()`. Using `async` in signal handlers is not guaranteed to complete before the process exits in all runtimes — the behavior depends on the specific runtime's signal handling implementation.

7. **No `runSingleTask` without `startFromTask`:** The `runSingleTask` flag only triggers a `break` when `taskName === startFromTask`. If `runSingleTask` is `true` but `startFromTask` is not set, the flag has no effect and the full pipeline runs. This may be a valid usage constraint but it is not validated or documented.

8. **Status `id` field provenance:** The `status.id` field used in the `runs.jsonl` record comes from the initial `tasks-status.json` file. The runner does not set or validate this field — it trusts that the orchestrator populated it correctly.
