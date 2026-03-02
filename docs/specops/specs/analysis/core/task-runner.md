# Specification: `core/task-runner`

> SpecOps Analysis — implementation-language-agnostic specification extracted from source.
>
> **Source files:**
> - `src/core/task-runner.js`
> - `src/core/lifecycle-policy.js`
> - `src/core/progress.js`

---

## 1. Purpose & Responsibilities

### Problem Solved

The task-runner module is the **single-task execution engine** for the pipeline system. While the pipeline-runner orchestrates which tasks to run and in what order, the task-runner owns the execution of one task through a fixed sequence of pipeline stages. It loads the task's module, wires up the execution context (LLM client, file I/O, metadata), runs each stage in order, validates results, tracks flags and data flow between stages, captures console output to log files, records LLM token usage, writes progress and status updates, and returns a structured result indicating success or failure.

The lifecycle-policy sub-module is a **pure decision engine** that determines whether a task transition (start or restart) is allowed based on static rules. It owns no state and performs no side effects — it only evaluates preconditions and returns a frozen decision object.

The progress sub-module is a **deterministic progress calculator** that maps a (pipeline task list, current task, current stage) triple to an integer percentage in [0, 100]. It is stateless and pure.

### Responsibilities

- **Task-runner (task-runner.js):**
  - Load the task module dynamically from an absolute file path.
  - Populate the canonical pipeline stage list with handlers exported by the loaded module.
  - Construct the execution context: I/O adapter, LLM client, metadata, data/flags/logs containers.
  - Execute each pipeline stage sequentially, honoring skip predicates and handler availability.
  - Validate every stage result conforms to the `{ output, flags }` contract.
  - Validate flag types against declared schemas (both prerequisites and produced flags).
  - Detect and reject flag type conflicts when merging stage flags into the accumulated flags map.
  - Capture console output per stage to dedicated log files.
  - Write pre-execution context snapshots for debugging.
  - Track and serialize LLM token usage to the job status file.
  - Write stage start/completion/failure status updates to the job status file.
  - Compute and record deterministic progress after each stage.
  - On stage failure: normalize the error, enrich it with debug metadata, write failure status, and return immediately (fail-fast).
  - On pipeline completion: mark the job as done with 100% progress.
  - Clean up LLM event listeners and flush pending token usage writes on both success and failure paths.

- **Lifecycle Policy (lifecycle-policy.js):**
  - Evaluate whether a "start" or "restart" operation is permitted given the current task state and dependency readiness.
  - Enforce that restarts are only allowed when the task state is "done" (`TaskState.DONE`).
  - Enforce that starts require all dependencies to be ready.

- **Progress (progress.js):**
  - Define the canonical ordered list of all pipeline stages.
  - Compute a deterministic progress percentage from pipeline task position and stage position.

### Boundaries

- The task-runner does NOT decide which tasks to run or in what order — that is the pipeline-runner's job.
- The task-runner does NOT own the stage handler implementations — it dynamically loads them from the task module.
- The lifecycle-policy does NOT execute transitions — it only evaluates whether they are allowed.
- The progress module does NOT track or store progress — it computes it statelessly from inputs.

### Patterns

- **Task-runner:** Orchestrator / Pipeline Executor pattern — coordinates a linear sequence of stages with validation gates.
- **Lifecycle-policy:** Strategy / Policy pattern — pure decision function with no side effects.
- **Progress:** Pure Function / Calculator pattern.

---

## 2. Public Interface

### `runPipeline(modulePath, initialContext)`

**Purpose:** Execute a single task through the full pipeline stage sequence.

**Parameters:**

| Name | Shape | Optional | Semantic Meaning |
|------|-------|----------|-----------------|
| `modulePath` | string (absolute file path) | No | Absolute file system path to the task module. Must be absolute; relative paths are rejected with an error. |
| `initialContext` | object | Yes (defaults to `{}`) | Execution context containing task metadata, LLM configuration, and working directory information. |

**`initialContext` fields:**

| Field | Type | Optional | Meaning |
|-------|------|----------|---------|
| `workDir` | string | No | Absolute path to the job's working directory. Required for file I/O and status writes. |
| `taskName` | string | No | Identifier for the current task within the pipeline. |
| `statusPath` | string | No | Path to the task's status file. |
| `jobId` | string | Yes | Job identifier for logging. If absent, the logger falls back to `"unknown"`, but `context.meta.jobId` remains whatever was passed in (possibly `undefined`). |
| `envLoaded` | boolean | Yes | If truthy, skips environment loading. Otherwise, `loadEnvironment()` is called and this flag is set to `true`. |
| `llm` | object | Yes | Pre-configured LLM client. If absent, one is created via `createLLM()` or `createLLMWithOverride()`. |
| `llmOverride` | any | Yes | If present and `llm` is absent, passed to `createLLMWithOverride()` to construct the LLM client. |
| `seed` | any | Yes | Initial data to seed into the pipeline. Because the implementation uses `initialContext.seed || initialContext`, any falsy seed value (`0`, `false`, `""`, `null`, `undefined`) falls back to `initialContext` itself. |
| `modelConfig` | object | Yes | Model configuration metadata passed through to the execution context. |
| `pipelineTasks` | string[] | Yes | Ordered list of all task IDs in the pipeline, used for progress computation. Also accepted at `meta.pipelineTasks`. |
| `tasksOverride` | object | Yes | If provided, stage handlers are populated from this object instead of the loaded module. Intended for testing. |

**Return value:** Promise resolving to a result object:

- **On success:** `{ ok: true, logs: Array, context: Object, llmMetrics: Array }`
- **On failure:** `{ ok: false, failedStage: string, error: Object, logs: Array, context: Object }`

The `logs` array contains per-stage entries with `{ stage, ok, ms }` on success or `{ stage, ok: false, ms, error }` on failure. Only stages skipped because the handler is missing are recorded as `{ stage, skipped: true }`. Stages skipped by a `skipIf` predicate are recorded only in `context.logs`, not in the returned `logs` array.

The `error` object on failure is a normalized error envelope with `{ name?, message, stack?, status?, code?, error?, debug }` where `debug` contains `{ stage, previousStage, logPath, snapshotPath, dataHasSeed, seedHasData, flagsKeys }`.

**Thrown errors:** Throws immediately if `workDir`, `taskName`, or `statusPath` are missing from `initialContext`. Throws if `modulePath` is not absolute.

---

### `runPipelineWithModelRouting(modulePath, initialContext, modelConfig)`

**Purpose:** Convenience wrapper around `runPipeline` that injects model routing configuration into the context.

**Parameters:**

| Name | Shape | Optional | Semantic Meaning |
|------|-------|----------|-----------------|
| `modulePath` | string | No | Same as `runPipeline`. |
| `initialContext` | object | Yes (defaults to `{}`) | Same as `runPipeline`. |
| `modelConfig` | object | Yes (defaults to `{}`) | Model routing configuration containing `models` (array of available models) and `defaultModel`. |

**Return value:** Same as `runPipeline`.

**Behavior:** Builds a shallow wrapper context containing `modelConfig`, `availableModels` (from `modelConfig.models` or `["default"]`), and `currentModel` (from `modelConfig.defaultModel` or `"default"`), then delegates to `runPipeline`. The task-runner itself only consumes `modelConfig`; the extra routing fields are merely passed through and only surface downstream if some stage reads them from seed data or another caller-provided object.

---

### `deriveModelKeyAndTokens(metric)`

**Purpose:** Extract a canonical model key and token counts from an LLM metric event.

**Parameters:**

| Name | Shape | Optional | Semantic Meaning |
|------|-------|----------|-----------------|
| `metric` | object | No | LLM metric event emitted on `llm:request:complete`. |

**`metric` fields used:**

| Field | Type | Meaning |
|-------|------|---------|
| `provider` | string | LLM provider identifier (e.g., "anthropic", "openai"). Falls back to `"undefined"`. |
| `model` | string | Model identifier. Falls back to `"undefined"`. |
| `metadata.alias` | string | If present, used as the model key instead of `provider:model`. |
| `promptTokens` | number | Input token count. Must be finite; non-finite values default to 0. |
| `completionTokens` | number | Output token count. Must be finite; non-finite values default to 0. |

**Return value:** A 3-element tuple `[modelKey, inputTokens, outputTokens]` where `modelKey` is a string and token counts are numbers.

---

### `decideTransition({ op, taskState, dependenciesReady })` (lifecycle-policy.js)

**Purpose:** Evaluate whether a task lifecycle transition is permitted.

**Parameters:**

| Name | Shape | Optional | Semantic Meaning |
|------|-------|----------|-----------------|
| `op` | `"start"` \| `"restart"` | No | The operation being attempted. |
| `taskState` | string | No | The current state of the task (e.g., `"done"`, `"failed"`, `"running"`). |
| `dependenciesReady` | boolean | No | Whether all upstream task dependencies are satisfied. |

**Return value:** A frozen object:
- `{ ok: true }` — transition is allowed.
- `{ ok: false, code: "unsupported_lifecycle", reason: "dependencies" }` — start blocked because dependencies are not ready.
- `{ ok: false, code: "unsupported_lifecycle", reason: "policy" }` — restart blocked because task state is not `"done"`.

**Thrown errors:** Throws if `op` is not `"start"` or `"restart"`, if `taskState` is not a string, or if `dependenciesReady` is not a boolean. Strict input validation — fail-fast on invalid data.

---

### `computeDeterministicProgress(pipelineTaskIds, currentTaskId, currentStageName, stages?)` (progress.js)

**Purpose:** Compute a deterministic progress percentage for a pipeline execution.

**Parameters:**

| Name | Shape | Optional | Semantic Meaning |
|------|-------|----------|-----------------|
| `pipelineTaskIds` | string[] | No | Ordered list of all task IDs in the pipeline. |
| `currentTaskId` | string | No | ID of the currently executing task. |
| `currentStageName` | string | No | Name of the stage that just completed. |
| `stages` | string[] | Yes | Custom stage list. Defaults to `KNOWN_STAGES`. |

**Return value:** Integer in [0, 100] representing progress percentage.

**Behavior:** `completed = (taskIndex * stageCount) + (stageIndex + 1)`. Progress = `round(100 * completed / totalSteps)`, clamped to [0, 100]. If `currentTaskId` is not found in `pipelineTaskIds`, task index defaults to 0. Same for stage name not found in stages list. Empty pipeline defaults to 1 total step to avoid division by zero.

---

### `KNOWN_STAGES` (progress.js)

**Purpose:** Canonical ordered list of all pipeline stage names.

**Value:** `["ingestion", "preProcessing", "promptTemplating", "inference", "parsing", "validateStructure", "validateQuality", "critique", "refine", "finalValidation", "integration"]`

**Type:** Exported constant, array of strings.

---

## 3. Data Models & Structures

### Execution Context

The central data structure created by `runPipeline` and passed (in cloned form) to each stage handler.

| Field | Type | Meaning |
|-------|------|---------|
| `io` | object | File I/O adapter created by `createTaskFileIO`. Provides `writeLog` and other file operations. |
| `llm` | object | LLM client for making inference calls. |
| `meta` | object | Shared metadata object: `{ taskName, workDir, statusPath, jobId, envLoaded, modelConfig, pipelineTasks }`. It is not frozen or cloned per stage. |
| `data` | object | Accumulated stage outputs. Initially `{ seed: <initialSeed> }`. After each stage, `data[stageName] = stageResult.output`. |
| `flags` | object | Accumulated flags from all completed stages. Starts empty. Merged after each stage. |
| `logs` | array | Audit log of stage actions: skips, debugging entries, completions with timestamps and flag keys. |
| `currentStage` | string \| null | Name of the currently executing stage. `null` before first stage and after completion. |
| `validators` | object | Contains `{ validateWithSchema }` — injected validation capability. |

**Lifecycle:** Created once per `runPipeline` invocation. Mutated in-place as stages execute (data and flags accumulate). Returned in the result object. Not persisted directly — individual parts are persisted via status writes.

**Ownership:** Owned by `runPipeline`. Stages receive cloned `data`, `flags`, and `output`, but shared references to `io`, `llm`, `meta`, and `validators`.

---

### Stage Context (passed to stage handlers)

Each stage handler receives a cloned subset of the execution context:

| Field | Type | Meaning |
|-------|------|---------|
| `io` | object | Shared reference (not cloned) to the file I/O adapter. |
| `llm` | object | Shared reference (not cloned) to the LLM client. |
| `meta` | object | Shared reference (not cloned) to the metadata object. |
| `data` | object | Deep clone of accumulated `context.data` at the time of stage execution. |
| `flags` | object | Deep clone of accumulated `context.flags` at the time of stage execution. |
| `currentStage` | string | Name of the stage being executed. |
| `output` | any | Deep clone of the previous non-validation stage's output. For the first stage, this is the seed data. |
| `previousStage` | string | Name of the last executed non-validation stage, or `"seed"` if no prior stage ran. |
| `validators` | object | Reference to `{ validateWithSchema }`. |

**Serialization concern:** The cloning is done via `JSON.parse(JSON.stringify(...))`, which means non-serializable values (functions, `undefined`, `Date` objects, circular references) in `data`, `flags`, or `output` will be lost or corrupted.

---

### Stage Result Contract

Every stage handler must return:

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `output` | any | Yes | The output data produced by this stage. Must be an own property of the result object. |
| `flags` | plain object | Yes | Flags to merge into the accumulated flags map. Must be a plain object (not array, null, or class instance). |

---

### Pipeline Stage Configuration (`PIPELINE_STAGES`)

Internal constant defining the ordered pipeline stages:

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | Stage identifier. Must match a key in the loaded task module. |
| `handler` | function \| null | Stage handler function, populated dynamically from the loaded module. `null` means the stage is skipped. |
| `skipIf` | function \| null | Predicate receiving `context.flags`. If it returns `true`, the stage is skipped. `null` means never skip. |
| `maxIterations` | number \| null | Reserved field. Currently always `null` and unused. |

**Stages defined (in order):** `ingestion`, `preProcessing`, `promptTemplating`, `inference`, `parsing`, `validateStructure`, `validateQuality`, `critique`, `refine`, `finalValidation`, `integration`.

**Conditional stages:** `critique`, `refine`, and `finalValidation` all have `skipIf: (flags) => flags.needsRefinement !== true` — they only execute when the `needsRefinement` flag is explicitly `true`.

**IMPORTANT:** `PIPELINE_STAGES` is a module-level mutable array. Handlers are populated by mutating the stage config objects in-place during `runPipeline`. This means the module-level state is modified on every call, which could be a concern for concurrent invocations.

---

### Flag Schemas (`FLAG_SCHEMAS`)

Static schema definitions for flag validation:

Currently only one entry exists:

```
validateQuality:
  requires: {}  (no prerequisites)
  produces:
    needsRefinement: "boolean"
```

The `requires` map defines flags that must exist with the specified types before the stage runs. The `produces` map defines flags the stage is expected to output with the specified types.

Type specifications can be a single string (e.g., `"boolean"`) or an array of strings (e.g., `["string", "number"]`) for multiple allowed types.

---

### LLM Metric Record

Accumulated in the `llmMetrics` array during execution:

| Field | Type | Meaning |
|-------|------|---------|
| (all fields from metric event) | various | Spread from the original metric event. |
| `task` | string | Present on successful `llm:request:complete` events; copied from `context.meta.taskName`. |
| `stage` | string | Present on successful `llm:request:complete` events; copied from `context.currentStage`. |
| `failed` | boolean | Present and `true` only for `llm:request:error` metrics. |

---

### Token Usage Tuple

Written to the job status file:

A 3-element array: `[modelKey, inputTokens, outputTokens]`
- `modelKey`: string — either `metadata.alias` or `"provider:model"`.
- `inputTokens`: number — prompt/input tokens (0 if not finite).
- `outputTokens`: number — completion/output tokens (0 if not finite).

Stored as an array appended to `snapshot.tasks[taskName].tokenUsage`.

---

### Lifecycle Decision Result (lifecycle-policy.js)

Frozen objects returned by `decideTransition`:

| Variant | Shape |
|---------|-------|
| Allowed | `{ ok: true }` |
| Blocked by dependencies | `{ ok: false, code: "unsupported_lifecycle", reason: "dependencies" }` |
| Blocked by policy | `{ ok: false, code: "unsupported_lifecycle", reason: "policy" }` |

All return values are `Object.freeze`'d — callers cannot mutate them.

---

### Normalized Error Envelope

Produced by `normalizeError`:

| Field | Type | Present When |
|-------|------|-------------|
| `name` | string | Error is an `Error` instance |
| `message` | string | Always |
| `stack` | string | Error is an `Error` instance |
| `status` | any | Original error has `.status` |
| `code` | any | Original error has `.code` |
| `error` | string | Original error has `.error` (stringified if object) |
| `debug` | object | Added by task-runner after normalization |

The `debug` sub-object contains: `{ stage, previousStage, logPath, snapshotPath, dataHasSeed, seedHasData, flagsKeys }`.

---

## 4. Behavioral Contracts

### Preconditions

- `modulePath` must be an absolute file system path. Relative paths cause an immediate throw.
- `initialContext.workDir`, `initialContext.taskName`, and `initialContext.statusPath` must all be present. Missing any of these causes an immediate throw.
- For `decideTransition`: `op` must be `"start"` or `"restart"`, `taskState` must be a string, `dependenciesReady` must be a boolean. Invalid types cause immediate throws.

### Postconditions

- On success (`ok: true`), all non-skipped stages with available handlers have been executed in order.
- The job status file has been updated to `state: DONE`, `progress: 100`, `current: null`, `currentStage: null`.
- All LLM event listeners registered during this run have been removed.
- The `tokenWriteQueue` has been flushed.
- The `context.data` object contains the output of every executed stage, keyed by stage name.
- The `context.flags` object contains the merged flags from all executed stages.

- On failure (`ok: false`), execution stopped at the failed stage. The job status has been updated to `state: FAILED` with `failedStage` recorded. LLM listeners and token queue are still cleaned up.

### Invariants

- Stages execute in the fixed order defined by `PIPELINE_STAGES`. No stage reordering or parallel execution occurs.
- Each stage receives deep-cloned `data`, `flags`, and `output` — stages cannot corrupt those inputs for later stages through mutation, but `io`, `llm`, `meta`, and `validators` are shared references.
- The `output` and `previousStage` fields passed to a stage always reflect the last **non-validation** stage. Validation stages (`validateStructure`, `validateQuality`, `validateFinal`, `finalValidation`) do not update `lastStageOutput` or `lastExecutedStageName`.
- A stage result must have own properties `output` and `flags`, where `flags` is a plain object.
- Flag types cannot change across stages — merging a flag with a different type than its existing value causes an error.
- Console output is captured per stage and restored in a `finally` block, even on error.
- Lifecycle policy decisions are frozen objects — callers cannot mutate them.

### Ordering Guarantees

- Stages are executed strictly sequentially in PIPELINE_STAGES order.
- Token usage writes are serialized through a promise chain (`tokenWriteQueue`) to prevent concurrent file writes.
- Status file writes are awaited before proceeding to the next stage.

### Concurrency Behavior

- `runPipeline` is designed for sequential single-task execution. However, the module-level `PIPELINE_STAGES` array is mutated in-place when populating handlers. If two `runPipeline` calls execute concurrently, they would overwrite each other's handlers, leading to incorrect behavior. This is a **potential concurrency hazard** in the current design.
- The `tokenWriteQueue` is per-invocation, so concurrent runs maintain separate queues.
- The LLM event listeners reference the specific run's `context`, providing isolation.

---

## 5. State Management

### In-Memory State

| State | Scope | Lifecycle | Cleanup |
|-------|-------|-----------|---------|
| `PIPELINE_STAGES` (module-level) | Module singleton | Populated per `runPipeline` call by mutating in-place | Never cleaned up; overwritten on next call |
| `FLAG_SCHEMAS` (module-level) | Module singleton | Static, never changes | N/A |
| `KNOWN_STAGES` (module-level, progress.js) | Module singleton | Static, never changes | N/A |
| `context` (local) | Per-invocation | Created at start of `runPipeline`, returned in result | Garbage collected after caller releases reference |
| `llmMetrics` (local) | Per-invocation | Accumulated during execution, returned in result | Garbage collected with result |
| `tokenWriteQueue` (local) | Per-invocation | Promise chain; grows with each LLM completion | Flushed at end of pipeline |
| `logs` (local) | Per-invocation | Accumulated during execution, returned in result | Garbage collected with result |

### Persisted State

The task-runner writes to two types of persisted state:

1. **Job status file** (via `writeJobStatus`): Updated at stage start, stage completion, stage failure, and pipeline completion. Contains current task, current stage, state, progress, per-task data (currentStage, state, failedStage, tokenUsage).

2. **Log files** (via `context.io.writeLog` and `captureConsoleOutput`):
   - Per-stage console capture logs at `<workDir>/files/logs/<taskName>__<stageName>__start.log`.
   - Per-stage context snapshots at `<workDir>/files/logs/<taskName>__<stageName>__context.json`.
   - Per-stage completion markers at `<workDir>/files/logs/<taskName>__<stageName>__complete.log`.

### Shared State

- The job status file is shared state written by the task-runner and read by other subsystems (UI, status-writer). Only token-usage appends are explicitly serialized via `tokenWriteQueue`; stage start/completion/failure writes are separate awaited `writeJobStatus(...)` calls. No cross-process locking is visible in this module.
- The `PIPELINE_STAGES` array is module-level shared state that could be corrupted by concurrent invocations (see Concurrency Behavior above).

### Crash Recovery

- If the process crashes mid-stage, the job status file will reflect the last successful write (stage start or prior stage completion). The task state will be `RUNNING` with the failing stage as `currentStage`.
- Console capture logs may be incomplete or empty if the crash occurs during stage execution.
- The `tokenWriteQueue` will be lost, so some token usage records may not be persisted.
- `readStatusSnapshot`, `mergeStatusSnapshot`, and `persistStatusSnapshot` exist in the module, but they are not used by `runPipeline`. They do not contribute to runtime crash recovery in the current implementation.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What Is Used | Nature | Coupling |
|--------|-------------|--------|----------|
| `../llm/index.js` | `createLLM`, `createLLMWithOverride`, `getLLMEvents` | Hard import; creates LLM client and subscribes to events | Medium — uses event-based interface, but depends on specific event names (`llm:request:complete`, `llm:request:error`) |
| `./module-loader.js` | `loadFreshModule` | Hard import; dynamically loads task modules | Low — generic module loading |
| `./environment.js` | `loadEnvironment` | Hard import; loads environment variables | Low — called once if not already loaded |
| `./file-io.js` | `createTaskFileIO`, `generateLogName` | Hard import; creates file I/O adapter and generates log file names | Medium — file I/O adapter is passed to stages and used extensively |
| `./status-writer.js` | `writeJobStatus` | Hard import; writes to job status file | Medium — called frequently during execution for status updates |
| `./progress.js` | `computeDeterministicProgress` | Hard import; computes progress percentage | Low — pure function, easily replaceable |
| `../config/statuses.js` | `TaskState` | Hard import; enum-like constants for task states (`RUNNING`, `FAILED`, `DONE`) | Low — simple constant reference |
| `../api/validators/json.js` | `validateWithSchema` | Hard import; injected into context.validators | Low — passed through, not called directly by task-runner |
| `./logger.js` | `createJobLogger` | Hard import; creates structured logger | Low — used for error logging |
| `../config/log-events.js` | `LogEvent`, `LogFileExtension` | Hard import; constants for log event types and file extensions | Low — simple constant references |

### 6.2 External Dependencies

| Package | What It Provides | Usage | Replaceability |
|---------|-----------------|-------|---------------|
| `node:path` | File path manipulation | `path.join`, `path.isAbsolute`, `path.dirname` | Platform-level; any path utility would work |
| `node:url` | URL utilities | `pathToFileURL` — converts absolute paths to `file://` URLs for dynamic import | Localized; wrappable |
| `fs` | File system access | `fs.mkdirSync`, `fs.createWriteStream`, `fs.existsSync`, `fs.readFileSync`, `fs.writeFileSync` | Used directly in several internal functions |

### 6.3 System-Level Dependencies

- **File system layout:** Expects `<workDir>/files/logs/` directory structure. Creates it via `mkdirSync({ recursive: true })` if absent.
- **Absolute paths:** Task module paths must be absolute. The module resolves them to `file://` URLs for dynamic ESM import.
- **Environment variables:** Delegates to `loadEnvironment()` if not already loaded. Specific variables are not referenced directly in this module.
- **`performance.now()`:** Used for timing stage execution. Assumes a high-resolution timer is available.
- **Console global:** The module monkey-patches `console.log/error/warn/info/debug` during stage execution to capture output. This is a global-level side effect.

---

## 7. Side Effects & I/O

### File System

| Operation | When | Sync/Async | Error Handling |
|-----------|------|-----------|---------------|
| `mkdirSync(logsPath, { recursive: true })` | Before pipeline execution begins | Sync | None — will throw on failure |
| `mkdirSync(logDir, { recursive: true })` | Before each stage's console capture | Sync | None — will throw on failure |
| `createWriteStream(logPath, { flags: "w" })` | Before each stage execution | Sync (stream creation) | None — will throw on creation failure |
| `context.io.writeLog(...)` | Pre-execution snapshot and post-completion marker per stage | Async | Errors would propagate (awaited) |
| `writeJobStatus(...)` | Stage start, completion, failure, and pipeline completion | Async | Caught and logged; does not fail the pipeline |
| `readStatusSnapshot` / `persistStatusSnapshot` | Private helper functions present in the module but unused by `runPipeline` | Sync | `readStatusSnapshot` catches and warns; `persistStatusSnapshot` silently returns when inputs are missing |

### Logging & Observability

- **Console capture:** During each stage, all `console.log/error/warn/info/debug` calls are redirected to a per-stage log file. Error-level output is prefixed with `[ERROR]`, warn with `[WARN]`, info with `[INFO]`, debug with `[DEBUG]`. Restoration occurs in a `finally` block.
- **Structured logging:** Uses `createJobLogger("TaskRunner", jobId)` for error-level structured log entries (stage failure, status write failure).
- **Debug logging:** Emits `console.debug` messages for stage log path resolution and progress computation (these will be captured to the stage's log file).
- **Stage execution log:** The full `stageContext` is logged via `console.log("STAGE CONTEXT", ...)` before each stage handler invocation. This is a verbose debug artifact.

### Event Listeners

| Event | Source | When Registered | When Removed |
|-------|--------|----------------|-------------|
| `llm:request:complete` | `getLLMEvents()` EventEmitter | Start of `runPipeline` | After pipeline completion or failure, via `cleanupLLMListeners()` |
| `llm:request:error` | `getLLMEvents()` EventEmitter | Start of `runPipeline` | After pipeline completion or failure, via `cleanupLLMListeners()` |

### Timing

- `performance.now()` is used to measure each stage's wall-clock execution time in milliseconds (rounded to 2 decimal places).
- No timers, intervals, polling loops, or debouncing.

---

## 8. Error Handling & Failure Modes

### Error Categories

1. **Input validation errors:** Missing `workDir`/`taskName`/`statusPath`, non-absolute module path, invalid `decideTransition` parameters. These throw immediately before any work begins.
2. **Module loading errors:** If the task module cannot be loaded (file not found, syntax error, etc.). Propagates from `loadFreshModule`.
3. **Stage execution errors:** Any exception thrown by a stage handler. Caught and handled with fail-fast behavior.
4. **Stage result validation errors:** Stage returns invalid shape (missing `output` or `flags`, non-plain-object flags). Thrown by `assertStageResult`.
5. **Flag validation errors:** Flag type mismatch against schema or type conflict during merge. Thrown by `validateFlagTypes` or `checkFlagTypeConflicts`.
6. **Status write errors:** Failures writing to the job status file. Caught, logged, and swallowed — never fail the pipeline.
7. **Token usage write errors:** Failures appending token usage. Caught via `.catch()` on the write queue — logged as warnings.

### Propagation Strategy

- **Fail-fast on stage errors:** Any error during stage execution (handler throw, result validation, flag validation) immediately terminates the pipeline. The error is normalized, enriched with debug metadata, and returned in the result object (`ok: false`).
- **Swallow status write errors:** Status file write failures are caught, logged, and ignored. The rationale is that status is observability — its failure should not prevent task execution.
- **Swallow token usage errors:** Token write failures are caught via promise chain `.catch()` and logged as warnings.
- **Throw on input validation:** Invalid inputs cause immediate throws before any pipeline setup.

### Recovery Behavior

- No retry logic for stage execution. Failure is immediate and terminal for the current pipeline run.
- No rollback of partially written data — stages that completed successfully have their outputs in `context.data` and their status updates persisted.
- Console output is always restored via `finally` block, even on error.
- LLM listeners are always cleaned up on both success and failure paths.
- Token write queue is always flushed (with errors absorbed) before returning.

### Partial Failure

If a multi-stage pipeline fails at stage N:
- Stages 1 through N-1 have their outputs in `context.data` and flags in `context.flags`.
- The job status file shows `state: FAILED` with `failedStage` set to stage N.
- Stage N's console output log will contain whatever was written before the error, plus the error itself (logged via `console.error`).
- The returned `context` object contains all state accumulated up to the point of failure.

### User/Operator Visibility

- Failed stages produce a normalized error with `debug` metadata including paths to log files and context snapshots.
- The job status file is updated with failure information visible to the UI.
- Structured log entries are written via the job logger.

---

## 9. Integration Points & Data Flow

### Upstream

- **Pipeline Runner (`pipeline-runner.js`):** Primary caller. Provides `modulePath` and `initialContext` with all required fields. Consumes the result to determine pipeline-level success/failure.
- **`runPipelineWithModelRouting`:** A thin wrapper that can be called directly when model routing configuration is needed.

### Downstream

- **Task modules (dynamically loaded):** The loaded module provides stage handler functions. The task-runner calls these handlers in sequence.
- **`writeJobStatus`:** Called to persist task/stage state transitions and progress.
- **`createTaskFileIO` / file I/O adapter:** Creates the I/O adapter passed to stages. Used directly for writing log files and context snapshots.
- **`computeDeterministicProgress`:** Called after each stage completion to update progress percentage.
- **`createLLM` / `createLLMWithOverride`:** Called to create the LLM client if not provided.
- **`getLLMEvents`:** Subscribed to for collecting LLM metrics and token usage.
- **`loadFreshModule`:** Called to dynamically import the task module.
- **`loadEnvironment`:** Called once to load environment variables.

### Data Transformation

1. **Input:** `modulePath` + `initialContext` → loads module, constructs execution context.
2. **Per-stage:** `stageContext` (cloned data + flags + previous output) → `stageHandler(stageContext)` → `{ output, flags }`.
3. **Accumulation:** Stage outputs are stored in `context.data[stageName]`. Flags are merged into `context.flags`.
4. **Output threading:** `lastStageOutput` carries the output from the most recent non-validation stage forward as the `output` field for the next stage. Validation stages store their output in `context.data` but do not update the output thread.
5. **Result:** The complete `context` object, accumulated `logs`, and `llmMetrics` are returned.

### Control Flow (Primary Success Path)

1. Create logger.
2. Load environment if needed.
3. Create or reuse LLM client.
4. Set up LLM metric event listeners.
5. Load task module from `modulePath`.
6. Populate `PIPELINE_STAGES` handlers from loaded module.
7. Validate required context fields.
8. Create file I/O adapter.
9. Build execution context.
10. Ensure log directory exists.
11. For each stage in `PIPELINE_STAGES`:
    a. Check `skipIf` predicate → skip if true.
    b. Check handler availability → skip if null.
    c. Set up console capture to log file.
    d. Set `currentStage`.
    e. Write stage-start status.
    f. Clone data, flags, and output into `stageContext`.
    g. Write pre-execution context snapshot.
    h. Validate prerequisite flags.
    i. Execute stage handler.
    j. Validate result shape.
    k. Validate produced flag types.
    l. Check flag type conflicts.
    m. Store output in `context.data[stageName]`.
    n. Update `lastStageOutput` (if not a validation stage).
    o. Merge flags.
    p. Log completion audit entry.
    q. Write stage-completion status with progress.
    r. Write completion log marker.
    s. Restore console (in `finally`).
12. Flush token write queue.
13. Remove LLM listeners.
14. Write final done status (progress: 100).
15. Return `{ ok: true, logs, context, llmMetrics }`.

### System-Wide Pattern Participation

- **Pipeline architecture:** The task-runner is the inner executor within a two-level pipeline system. The outer level (pipeline-runner) manages task sequencing and dependencies; the inner level (task-runner) manages stage sequencing within a single task.
- **Event-driven metrics:** Subscribes to the LLM event bus (`llm:request:complete`, `llm:request:error`) for cross-cutting metric collection.

---

## 10. Edge Cases & Implicit Behavior

### Default Values That Shape Behavior

- If `initialContext.seed` is absent or any other falsy value, the entire `initialContext` object is used as the seed. This means all runner configuration (workDir, statusPath, LLM client, etc.) may be present in `context.data.seed`.
- If `pipelineTaskIds` is empty or the current task/stage is not found in the lists, `computeDeterministicProgress` silently defaults indices to 0 rather than erroring.
- `modelConfig.models` defaults to `["default"]` and `modelConfig.defaultModel` defaults to `"default"` in `runPipelineWithModelRouting`, but those extra routing fields are not consumed directly by `runPipeline`.
- `jobId` defaults to `"unknown"` for the logger if not provided; `context.meta.jobId` itself is not rewritten to that value.

### Implicit Ordering and Timing Assumptions

- Validation stages (`validateStructure`, `validateQuality`, `validateFinal`, `finalValidation`) are treated specially: they do not update `lastStageOutput` or `lastExecutedStageName`. This means the next non-validation stage receives the output from the last non-validation stage, not from the validation stage. This behavior is implicit — there is no configuration or documentation within the code beyond the inline comment.
- The `previousStage` field passed to stage handlers starts as `"seed"` — a synthetic name, not an actual stage.

### Console Monkey-Patching

- During each stage, `console.log/error/warn/info/debug` are globally redirected to a per-stage log file. This is a significant global side effect. If a stage spawns async work that outlives the stage execution (though stages are awaited), console calls from that async work would go to the wrong log file or to the restored original console.
- The prefixes `[ERROR]`, `[WARN]`, `[INFO]`, `[DEBUG]` are added to redirected output but not to `console.log` (which gets no prefix).

### Mutable Module-Level State

- `PIPELINE_STAGES` is defined at module level and mutated in-place during `runPipeline` to set handlers. This means the handlers from the most recent `runPipeline` call persist on the module-level objects. This is not cleaned up after execution.

### Verbose Debug Logging

- The `console.log("STAGE CONTEXT", JSON.stringify(stageContext, null, 2))` call before each stage handler logs the entire stage context as JSON. This is a very verbose debug artifact that will appear in every stage's log file.

### Status File Merge Logic

- `readStatusSnapshot` and `mergeStatusSnapshot` implement a defensive merge strategy: `data` and `flags` sub-objects are shallow-merged, `logs` is replaced entirely, and all other fields are overwritten.
- `persistStatusSnapshot` applies that merge and writes the file synchronously, but these helpers are currently unused by `runPipeline`. In this module's active execution path, status persistence goes through `writeJobStatus(...)` instead.

### `maxIterations` Field

- Every `PIPELINE_STAGES` entry has a `maxIterations: null` field. This field is never read or acted upon anywhere in the code. It appears to be a placeholder for future iteration/retry functionality that was never implemented.

### Lifecycle Policy Strictness

- The lifecycle policy only allows restart when `taskState === "done"` (`TaskState.DONE`). Tasks in `"failed"` state cannot be restarted through this policy. This is a strict policy decision.
- The start operation only checks `dependenciesReady` — it does not check `taskState` at all. A task in any state can be started as long as dependencies are ready.

---

## 11. Open Questions & Ambiguities

1. **Module-level mutation of `PIPELINE_STAGES`:** Handlers are set by mutating module-level objects. Is concurrent `runPipeline` invocation expected to be safe? The current implementation would cause handler cross-contamination between concurrent runs. It is unclear whether this is an intentional design constraint (single-threaded use only) or an oversight.

2. **`persistStatusSnapshot` usage:** The `readStatusSnapshot`, `mergeStatusSnapshot`, and `persistStatusSnapshot` functions are defined in task-runner.js but do not appear to be called from `runPipeline` itself (which uses `writeJobStatus` instead). Are these used by external callers, or are they dead code?

3. **Seed fallback to `initialContext`:** Because the code uses `initialContext.seed || initialContext`, any falsy seed value causes the entire `initialContext` (including `workDir`, `statusPath`, LLM client, etc.) to become the seed data. Is this intentional, or should there be a more explicit/nullish fallback?

4. **`maxIterations` field purpose:** Every pipeline stage has `maxIterations: null` but this field is never used. Was this for a planned retry/iteration feature? Is it intended for future use or can it be removed?

5. **Validation stage output threading:** The special treatment of validation stages (not updating `lastStageOutput`) is only documented by inline code. Is this behavior well-understood by task module authors? Could a validation stage ever need to pass modified data forward?

6. **`FLAG_SCHEMAS` completeness:** Only `validateQuality` has a flag schema entry. Is this intentional (other stages have no flag contracts), or are schemas missing for other stages?

7. **Console capture and async leakage:** If a stage handler starts async work that completes after the stage's `await` resolves, console output from that work would go to the restored original console (or the next stage's capture). Is this a known limitation?

8. **`console.log("STAGE CONTEXT", ...)` debug line:** This logs potentially large JSON to every stage's log file. Is this intended for production use, or is it a debug artifact that should be removed or gated?

9. **Lifecycle policy scope:** `decideTransition` is exported from `lifecycle-policy.js` but it is not imported or used within `task-runner.js`. It appears to be consumed by other modules (likely `pipeline-runner.js` or UI endpoints). The grouping of this module with task-runner in the spec is organizational rather than indicating direct coupling.

10. **Error normalization for non-Error objects:** The `normalizeError` function handles plain objects and extracts nested `.error.message` patterns. This suggests LLM providers may return non-Error rejection values. The specific shapes handled appear to match HTTP error response patterns, but the expected shapes are not documented.
