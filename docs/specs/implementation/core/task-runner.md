# Implementation Specification: `core/task-runner`

**Analysis source:** `docs/specs/analysis/core/task-runner.md`

---

## 1. Qualifications

- TypeScript strict mode (discriminated unions, generic containers, branded types for stage names)
- Bun file I/O APIs (`Bun.file()`, `Bun.write()`) for log and snapshot writes
- Bun test runner (`bun test`) for acceptance criteria verification
- EventEmitter subscription patterns (LLM metric event bus)
- Deep cloning via `structuredClone` (replacing `JSON.parse(JSON.stringify(...))`)
- Console monkey-patching and stream redirection for per-stage log capture
- Promise chaining for serialized token-usage writes
- Dynamic ESM module loading (`import()` with `file://` URLs)
- `performance.now()` high-resolution timing
- Pipeline/orchestrator execution pattern (sequential stage execution with validation gates)
- Flag type schema validation (runtime type checking against declared schemas)
- Deterministic progress computation (integer arithmetic, clamping)

---

## 2. Problem Statement

The system requires a single-task execution engine that loads a task module, runs it through a fixed sequence of pipeline stages with validation gates, captures metrics and logs, and returns a structured result. The existing JS implementation provides this via `runPipeline` with mutable module-level `PIPELINE_STAGES`, `JSON.parse(JSON.stringify(...))` cloning, and `fs.createWriteStream` for console capture. This spec defines the TypeScript replacement, fixing the module-level mutation concurrency hazard by using per-invocation stage arrays, replacing JSON round-trip cloning with `structuredClone`, and using Bun-native file I/O.

---

## 3. Goal

A set of TypeScript modules — `src/core/task-runner.ts`, `src/core/lifecycle-policy.ts`, and `src/core/progress.ts` — that provide identical behavioral contracts to the analyzed JS modules, run on Bun, and pass all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/core/task-runner.ts` | Single-task pipeline executor: loads task module, runs stages sequentially, validates results and flags, captures console output, tracks LLM metrics, writes status and progress, returns structured result. |
| `src/core/lifecycle-policy.ts` | Pure decision engine: evaluates whether a task start/restart transition is allowed based on state and dependency readiness. |
| `src/core/progress.ts` | Pure progress calculator: maps (pipeline tasks, current task, current stage) to an integer percentage [0, 100]. |

### Key types and interfaces

```typescript
// ── progress.ts ──

/** Canonical ordered list of all pipeline stage names. */
export const KNOWN_STAGES = [
  "ingestion",
  "preProcessing",
  "promptTemplating",
  "inference",
  "parsing",
  "validateStructure",
  "validateQuality",
  "critique",
  "refine",
  "finalValidation",
  "integration",
] as const;

export type StageName = (typeof KNOWN_STAGES)[number];

export function computeDeterministicProgress(
  pipelineTaskIds: string[],
  currentTaskId: string,
  currentStageName: string,
  stages?: readonly string[],
): number;
```

```typescript
// ── lifecycle-policy.ts ──

/** The operation being attempted on a task. */
type LifecycleOp = "start" | "restart";

/** Input for a lifecycle transition decision. */
interface TransitionInput {
  op: LifecycleOp;
  taskState: string;
  dependenciesReady: boolean;
}

/** Allowed transition result. */
interface TransitionAllowed {
  ok: true;
}

/** Blocked transition result with reason. */
interface TransitionBlocked {
  ok: false;
  code: "unsupported_lifecycle";
  reason: "dependencies" | "policy";
}

type TransitionDecision = TransitionAllowed | TransitionBlocked;

export function decideTransition(input: TransitionInput): Readonly<TransitionDecision>;
```

```typescript
// ── task-runner.ts ──

import type { StageName } from "./progress";

/** Configuration for a single pipeline stage. */
interface StageConfig {
  name: StageName;
  handler: StageHandler | null;
  skipIf: ((flags: Record<string, unknown>) => boolean) | null;
}

/** Function signature for a stage handler. */
type StageHandler = (context: StageContext) => Promise<StageResult>;

/** Stage result contract — every handler must return this shape. */
interface StageResult {
  output: unknown;
  flags: Record<string, unknown>;
}

/** Execution context created per runPipeline invocation. */
interface ExecutionContext {
  io: TaskFileIO;
  llm: LLMClient;
  meta: ExecutionMeta;
  data: Record<string, unknown>;
  flags: Record<string, unknown>;
  logs: AuditLogEntry[];
  currentStage: StageName | null;
  validators: { validateWithSchema: ValidateWithSchemaFn };
}

/** Metadata shared across all stages within a single task run. */
interface ExecutionMeta {
  taskName: string;
  workDir: string;
  statusPath: string;
  jobId: string | undefined;
  envLoaded: boolean;
  modelConfig: ModelConfig | undefined;
  pipelineTasks: string[] | undefined;
}

/** Model routing configuration. */
interface ModelConfig {
  models?: string[];
  defaultModel?: string;
  [key: string]: unknown;
}

/** Context passed to each stage handler (cloned data/flags/output). */
interface StageContext {
  io: TaskFileIO;
  llm: LLMClient;
  meta: ExecutionMeta;
  data: Record<string, unknown>;
  flags: Record<string, unknown>;
  currentStage: StageName;
  output: unknown;
  previousStage: string;
  validators: { validateWithSchema: ValidateWithSchemaFn };
}

/** Audit log entry for stage execution. */
type AuditLogEntry =
  | { stage: string; ok: true; ms: number }
  | { stage: string; ok: false; ms: number; error: unknown }
  | { stage: string; skipped: true };

/** Successful pipeline result. */
interface PipelineSuccess {
  ok: true;
  logs: AuditLogEntry[];
  context: ExecutionContext;
  llmMetrics: LLMMetricRecord[];
}

/** Failed pipeline result. */
interface PipelineFailure {
  ok: false;
  failedStage: string;
  error: NormalizedError;
  logs: AuditLogEntry[];
  context: ExecutionContext;
}

type PipelineResult = PipelineSuccess | PipelineFailure;

/** Normalized error envelope with debug metadata. */
interface NormalizedError {
  name?: string;
  message: string;
  stack?: string;
  status?: unknown;
  code?: unknown;
  error?: string;
  debug: ErrorDebugInfo;
}

/** Debug metadata attached to normalized errors. */
interface ErrorDebugInfo {
  stage: string;
  previousStage: string;
  logPath: string;
  snapshotPath: string;
  dataHasSeed: boolean;
  seedHasData: boolean;
  flagsKeys: string[];
}

/** LLM metric record accumulated during execution. */
interface LLMMetricRecord {
  task?: string;
  stage?: string;
  failed?: true;
  [key: string]: unknown;
}

/** Token usage tuple written to the job status file. */
type TokenUsageTuple = [modelKey: string, inputTokens: number, outputTokens: number];

/** Initial context provided by the caller (pipeline-runner). */
interface InitialContext {
  workDir: string;
  taskName: string;
  statusPath: string;
  jobId?: string;
  envLoaded?: boolean;
  llm?: LLMClient;
  llmOverride?: unknown;
  seed?: unknown;
  modelConfig?: ModelConfig;
  pipelineTasks?: string[];
  tasksOverride?: Record<string, StageHandler>;
  meta?: { pipelineTasks?: string[] };
  [key: string]: unknown;
}

/** Flag schema entry for a stage. */
interface FlagSchema {
  requires: Record<string, string | string[]>;
  produces: Record<string, string | string[]>;
}

// Opaque types referenced from other modules (imported at implementation time)
type TaskFileIO = import("./file-io").TaskFileIO;
type LLMClient = import("../llm/index").LLMClient;
type ValidateWithSchemaFn = (schema: unknown, data: unknown) => unknown;

export function runPipeline(
  modulePath: string,
  initialContext?: InitialContext,
): Promise<PipelineResult>;

export function runPipelineWithModelRouting(
  modulePath: string,
  initialContext?: InitialContext,
  modelConfig?: ModelConfig,
): Promise<PipelineResult>;

export function deriveModelKeyAndTokens(
  metric: Record<string, unknown>,
): TokenUsageTuple;
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| `structuredClone` replaces `JSON.parse(JSON.stringify(...))` for cloning `data`, `flags`, and `output` into stage contexts | `structuredClone` handles `undefined`, `Date`, `RegExp`, `ArrayBuffer`, and other types that JSON round-tripping silently drops or corrupts. It also throws on circular references rather than silently losing data. Web-standard API available in Bun. |
| `Bun.write()` replaces `fs.createWriteStream` + `stream.write()` for console capture log files | Bun-native file writing. Console output is accumulated in a string buffer per stage and flushed once at stage end, which is simpler than streaming and avoids partial-write issues. |
| `Bun.file(path).exists()` for file existence checks | Replaces `fs.existsSync` with Bun-native API. |
| `mkdir` from `node:fs/promises` retained | Bun supports `node:fs/promises` and there is no simpler Bun-native equivalent for recursive directory creation. |
| Per-invocation stage array replaces module-level mutable `PIPELINE_STAGES` | Fixes the concurrency hazard identified in the analysis. Each `runPipeline` call creates its own stage configuration array, preventing handler cross-contamination between concurrent runs. |
| `maxIterations` field removed from stage config | Analysis confirmed it is unused dead code. Removed per engineering standards ("Build for today"). |

### Dependency map

| Source | Import | Purpose |
|--------|--------|---------|
| `./progress` | `computeDeterministicProgress`, `KNOWN_STAGES` | Progress computation and stage name constants |
| `./lifecycle-policy` | `decideTransition` | Re-exported for consumers (not used directly by task-runner) |
| `../llm/index` | `createLLM`, `createLLMWithOverride`, `getLLMEvents` | LLM client creation and metric event subscription |
| `./module-loader` | `loadFreshModule` | Dynamic task module loading |
| `./environment` | `loadEnvironment` | Environment variable initialization |
| `./file-io` | `createTaskFileIO`, `generateLogName` | File I/O adapter and log name generation |
| `./status-writer` | `writeJobStatus` | Job status file updates |
| `../config/statuses` | `TaskState` | Task state enum constants (`RUNNING`, `FAILED`, `DONE`) |
| `../api/validators/json` | `validateWithSchema` | Injected into execution context |
| `./logger` | `createJobLogger` | Structured error logging |
| `../config/log-events` | `LogEvent`, `LogFileExtension` | Log event type and extension constants |
| `node:path` | `join`, `isAbsolute`, `dirname` | Path manipulation |
| `node:url` | `pathToFileURL` | Convert paths to `file://` URLs for dynamic import |
| `node:fs/promises` | `mkdir` | Recursive directory creation |

---

## 5. Acceptance Criteria

### Core behavior

1. `runPipeline(modulePath, initialContext)` loads the task module from `modulePath` and executes each pipeline stage in the fixed order: ingestion → preProcessing → promptTemplating → inference → parsing → validateStructure → validateQuality → critique → refine → finalValidation → integration.
2. Each stage handler receives a `StageContext` where `data`, `flags`, and `output` are deep clones of the accumulated state, while `io`, `llm`, `meta`, and `validators` are shared references.
3. After each stage, the handler's `output` is stored in `context.data[stageName]` and flags are merged into `context.flags`.
4. The `output` field passed to stage handlers reflects the last **non-validation** stage's output. Validation stages (`validateStructure`, `validateQuality`, `finalValidation`) do not update the output thread.
5. The `previousStage` field starts as `"seed"` and updates to the last executed non-validation stage name.
6. On success, `runPipeline` returns `{ ok: true, logs, context, llmMetrics }` with `context.data` containing outputs from all executed stages.
7. On success, the job status file is updated to `state: DONE`, `progress: 100`, `current: null`, `currentStage: null`.

### Stage skipping

8. Stages with no handler (handler is `null` after module loading) are skipped and recorded as `{ stage, skipped: true }` in the returned `logs` array.
9. Stages with a `skipIf` predicate that returns `true` for the current flags are skipped and recorded in `context.logs` only (not in the returned `logs` array).
10. `critique`, `refine`, and `finalValidation` stages have `skipIf: (flags) => flags.needsRefinement !== true` — they only execute when `needsRefinement` is explicitly `true`.

### Stage result validation

11. Every stage handler must return an object with own properties `output` and `flags`.
12. `flags` must be a plain object (not an array, `null`, or class instance). Invalid shapes cause immediate pipeline failure.
13. Flag types are validated against `FLAG_SCHEMAS`: prerequisite flags must exist with the correct type before the stage runs, and produced flags must match the declared type after the stage completes.
14. Merging a flag with a different type than its existing value in `context.flags` causes an immediate error (flag type conflict).

### Console capture

15. During each stage execution, `console.log`, `console.error`, `console.warn`, `console.info`, and `console.debug` are redirected to a per-stage log file at `<workDir>/files/logs/<taskName>__<stageName>__start.log`.
16. Redirected output is prefixed: `[ERROR]` for `console.error`, `[WARN]` for `console.warn`, `[INFO]` for `console.info`, `[DEBUG]` for `console.debug`. `console.log` has no prefix.
17. Console is always restored via a `finally` block, even on stage handler errors.

### Context snapshots and log markers

18. Before each stage handler invocation, a context snapshot is written as JSON to `<workDir>/files/logs/<taskName>__<stageName>__context.json`.
19. After each successful stage, a completion log marker is written to `<workDir>/files/logs/<taskName>__<stageName>__complete.log`.

### Status updates

20. A status update is written at stage start (`state: RUNNING`, `currentStage` set).
21. A status update is written at stage completion (with progress from `computeDeterministicProgress`).
22. A status update is written at stage failure (`state: FAILED`, `failedStage` recorded).
23. Status write failures are caught, logged, and swallowed — they never fail the pipeline.

### LLM metrics and token usage

24. LLM `llm:request:complete` events are captured with `task` and `stage` metadata appended.
25. LLM `llm:request:error` events are captured with `failed: true` appended.
26. Token usage tuples `[modelKey, inputTokens, outputTokens]` are derived from complete events and appended to the status file, serialized through a per-invocation promise queue.
27. `deriveModelKeyAndTokens` uses `metadata.alias` as the model key when present, otherwise `"provider:model"`. Non-finite token counts default to 0.
28. LLM event listeners are removed after pipeline completion or failure.
29. The token write queue is flushed before returning the result.

### Error handling

30. `runPipeline` throws immediately if `workDir`, `taskName`, or `statusPath` are missing from `initialContext`.
31. `runPipeline` throws immediately if `modulePath` is not an absolute path.
32. Stage execution errors are normalized into `NormalizedError` with `debug` metadata (`stage`, `previousStage`, `logPath`, `snapshotPath`, `dataHasSeed`, `seedHasData`, `flagsKeys`) and returned as `{ ok: false, failedStage, error, logs, context }`.
33. No retry logic for stage execution. Failure is immediate and terminal.

### Seed handling

34. If `initialContext.seed` is falsy, `initialContext` itself is used as the seed data (stored in `context.data.seed`).

### Model routing

35. `runPipelineWithModelRouting` builds a wrapper context with `modelConfig`, `availableModels` (from `modelConfig.models` or `["default"]`), and `currentModel` (from `modelConfig.defaultModel` or `"default"`), then delegates to `runPipeline`.

### Progress computation

36. `computeDeterministicProgress` returns an integer in [0, 100] computed as `round(100 * ((taskIndex * stageCount) + (stageIndex + 1)) / totalSteps)`, clamped to [0, 100].
37. If `currentTaskId` is not found in `pipelineTaskIds`, task index defaults to 0.
38. If `currentStageName` is not found in the stages list, stage index defaults to 0.
39. An empty `pipelineTaskIds` array defaults to 1 total step to avoid division by zero.

### Lifecycle policy

40. `decideTransition({ op: "start", taskState: any, dependenciesReady: true })` returns `{ ok: true }`.
41. `decideTransition({ op: "start", taskState: any, dependenciesReady: false })` returns `{ ok: false, code: "unsupported_lifecycle", reason: "dependencies" }`.
42. `decideTransition({ op: "restart", taskState: "done", dependenciesReady: any })` returns `{ ok: true }`.
43. `decideTransition({ op: "restart", taskState: <not "done">, dependenciesReady: any })` returns `{ ok: false, code: "unsupported_lifecycle", reason: "policy" }`.
44. All `decideTransition` return values are frozen (`Object.freeze`).
45. `decideTransition` throws if `op` is not `"start"` or `"restart"`, if `taskState` is not a string, or if `dependenciesReady` is not a boolean.

### Concurrency safety

46. Each `runPipeline` invocation creates its own stage configuration array. Concurrent `runPipeline` calls do not share or corrupt each other's handlers.

---

## 6. Notes

### Design trade-offs

- **Per-invocation stage array vs module-level mutable `PIPELINE_STAGES`:** The JS original mutated a module-level array in-place, creating a concurrency hazard. The TS version creates a fresh array per invocation. This costs one array allocation per call but eliminates the shared-state bug. The trade-off is trivial.
- **`structuredClone` vs JSON round-trip cloning:** `structuredClone` is strictly better for correctness (preserves `Date`, `undefined`, `RegExp`, `ArrayBuffer`; throws on circular references instead of silently corrupting). The only behavioral difference from the JS original is that stage handlers will now see `undefined` values preserved in cloned data rather than having them silently stripped. This is an intentional improvement.
- **String buffer vs stream for console capture:** The JS original used `fs.createWriteStream` for real-time console capture. The TS version accumulates output in a string buffer and writes it with `Bun.write()` at stage end. This is simpler, avoids partial-write issues, and is sufficient because stage output is bounded by stage execution time. The trade-off is that if the process crashes mid-stage, captured output is lost; the JS version would have flushed some output to disk. This is acceptable because crash recovery already loses the token write queue and leaves the task in `RUNNING` state regardless.
- **`maxIterations` removed:** The analysis confirmed this field is never read. Removing dead code per engineering standards.

### Known risks

- **Console monkey-patching is a global side effect.** If a stage handler spawns async work that outlives the stage's `await`, console calls from that work will go to the restored original console (or the next stage's capture). This matches the JS behavior and is a known limitation.
- **Seed fallback to `initialContext`:** The `initialContext.seed || initialContext` pattern means falsy seeds (`0`, `false`, `""`) cause the entire context (including `workDir`, LLM client, etc.) to become seed data. The TS version preserves this behavior for backward compatibility, but documents it as a known wart. A future improvement would use nullish coalescing (`??`), but that would change behavior for `false`/`0`/`""` seeds.
- **`FLAG_SCHEMAS` only covers `validateQuality`:** Other stages have no declared flag contracts. This means flag type conflicts are only caught during merge, not via schema validation. This matches the JS behavior.

### Migration-specific concerns

- **`structuredClone` behavioral change:** Stages that relied on `undefined` values being stripped from cloned data may see different behavior. This is intentional and an improvement.
- **Per-invocation stages is a new guarantee:** The JS version never guaranteed concurrent invocation safety. The TS version does. No backward-incompatible change, but downstream code may rely on the (broken) module-level state for inspection between calls.
- **`readStatusSnapshot`/`mergeStatusSnapshot`/`persistStatusSnapshot` not ported:** These functions exist in the JS module but are not called by `runPipeline`. They are dead code in the active execution path. If external callers use them, they should be migrated as part of the status-writer module or a separate utility.

### Dependencies on other modules

- Requires `core/module-loader` (`loadFreshModule`) — migrated or shimmed.
- Requires `core/environment` (`loadEnvironment`) — migrated or shimmed.
- Requires `core/file-io` (`createTaskFileIO`, `generateLogName`) — migrated or shimmed.
- Requires `core/status-writer` (`writeJobStatus`) — migrated or shimmed.
- Requires `llm/index` (`createLLM`, `createLLMWithOverride`, `getLLMEvents`) — migrated or shimmed.
- Requires `config/statuses` (`TaskState`) — migrated or shimmed.
- Requires `api/validators/json` (`validateWithSchema`) — migrated or shimmed.
- Requires `core/logger` (`createJobLogger`) — migrated or shimmed.
- Requires `config/log-events` (`LogEvent`, `LogFileExtension`) — migrated or shimmed.

### Performance considerations

- `structuredClone` is faster than `JSON.parse(JSON.stringify(...))` for most data shapes in Bun's runtime. No performance regression expected.
- Per-invocation stage array allocation is negligible (11-element array of objects).
- String buffer accumulation for console capture avoids I/O during stage execution, reducing syscall overhead compared to streaming writes.

---

## 7. Implementation Steps

### Step 1: Define `KNOWN_STAGES` constant and `computeDeterministicProgress` function

**What:** Create `src/core/progress.ts`. Export the `KNOWN_STAGES` constant as a `const` assertion array. Implement and export `computeDeterministicProgress(pipelineTaskIds, currentTaskId, currentStageName, stages?)` that computes progress as described in the analysis.

**Why:** Pure function with no dependencies. Required by task-runner for progress updates (acceptance criteria 36–39).

**Type signatures:**

```typescript
export const KNOWN_STAGES = [
  "ingestion", "preProcessing", "promptTemplating", "inference", "parsing",
  "validateStructure", "validateQuality", "critique", "refine", "finalValidation", "integration",
] as const;

export type StageName = (typeof KNOWN_STAGES)[number];

export function computeDeterministicProgress(
  pipelineTaskIds: string[],
  currentTaskId: string,
  currentStageName: string,
  stages?: readonly string[],
): number;
```

**Test:** `tests/core/progress.test.ts`
- Given `["task1", "task2"]`, `"task1"`, `"ingestion"` → progress is `round(100 * 1 / 22)` = 5.
- Given `["task1", "task2"]`, `"task2"`, `"integration"` → progress is 100.
- Unknown task ID defaults to task index 0.
- Unknown stage name defaults to stage index 0.
- Empty `pipelineTaskIds` returns a clamped value (does not throw or return NaN).
- Custom `stages` parameter overrides `KNOWN_STAGES`.

---

### Step 2: Implement `decideTransition` in lifecycle-policy

**What:** Create `src/core/lifecycle-policy.ts`. Implement and export `decideTransition({ op, taskState, dependenciesReady })`. Validate inputs (throw on invalid `op`, non-string `taskState`, non-boolean `dependenciesReady`). Return frozen decision objects per the analysis spec.

**Why:** Pure decision function with no dependencies. Required by pipeline-runner for lifecycle checks (acceptance criteria 40–45).

**Type signatures:**

```typescript
type LifecycleOp = "start" | "restart";

interface TransitionInput {
  op: LifecycleOp;
  taskState: string;
  dependenciesReady: boolean;
}

interface TransitionAllowed { ok: true }
interface TransitionBlocked { ok: false; code: "unsupported_lifecycle"; reason: "dependencies" | "policy" }
type TransitionDecision = TransitionAllowed | TransitionBlocked;

export function decideTransition(input: TransitionInput): Readonly<TransitionDecision>;
```

**Test:** `tests/core/lifecycle-policy.test.ts`
- `{ op: "start", taskState: "pending", dependenciesReady: true }` → `{ ok: true }`.
- `{ op: "start", taskState: "pending", dependenciesReady: false }` → `{ ok: false, code: "unsupported_lifecycle", reason: "dependencies" }`.
- `{ op: "restart", taskState: "done", dependenciesReady: true }` → `{ ok: true }`.
- `{ op: "restart", taskState: "done", dependenciesReady: false }` → `{ ok: true }` (restart does not check dependencies).
- `{ op: "restart", taskState: "failed", dependenciesReady: true }` → `{ ok: false, code: "unsupported_lifecycle", reason: "policy" }`.
- All return values are frozen (attempting to assign a property throws in strict mode).
- Invalid `op` throws.
- Non-string `taskState` throws.
- Non-boolean `dependenciesReady` throws.

---

### Step 3: Define task-runner types and `FLAG_SCHEMAS` constant

**What:** Create `src/core/task-runner.ts`. Define all types and interfaces from Section 4: `StageConfig`, `StageHandler`, `StageResult`, `ExecutionContext`, `ExecutionMeta`, `ModelConfig`, `StageContext`, `AuditLogEntry`, `PipelineSuccess`, `PipelineFailure`, `PipelineResult`, `NormalizedError`, `ErrorDebugInfo`, `LLMMetricRecord`, `TokenUsageTuple`, `InitialContext`, `FlagSchema`. Define the `FLAG_SCHEMAS` constant with the single `validateQuality` entry. Define the `VALIDATION_STAGES` set for identifying stages that don't update the output thread.

**Why:** All subsequent task-runner steps depend on these types. Types-first per spec conventions (acceptance criteria 11–14).

**Type signatures:** As listed in Section 4 above.

**Test:** `tests/core/task-runner.test.ts`
- `FLAG_SCHEMAS` has a `validateQuality` entry with `requires: {}` and `produces: { needsRefinement: "boolean" }`.
- `VALIDATION_STAGES` contains `"validateStructure"`, `"validateQuality"`, and `"finalValidation"`.

---

### Step 4: Implement `deriveModelKeyAndTokens`

**What:** In `src/core/task-runner.ts`, implement and export `deriveModelKeyAndTokens(metric)`. If `metric.metadata.alias` exists, use it as the model key; otherwise construct `"provider:model"` from `metric.provider` and `metric.model` (both defaulting to `"undefined"`). Token counts default to 0 if not finite numbers.

**Why:** Required for token usage tracking (acceptance criteria 27).

**Type signature:**

```typescript
export function deriveModelKeyAndTokens(
  metric: Record<string, unknown>,
): TokenUsageTuple;
```

**Test:** `tests/core/task-runner.test.ts`
- Metric with `metadata.alias: "gpt-4"` → model key is `"gpt-4"`.
- Metric with `provider: "anthropic"`, `model: "claude-3"`, no alias → key is `"anthropic:claude-3"`.
- Missing provider/model → key is `"undefined:undefined"`.
- `promptTokens: 100`, `completionTokens: 50` → `[key, 100, 50]`.
- `promptTokens: NaN` → defaults to 0.
- `promptTokens: Infinity` → defaults to 0.
- Missing token fields → defaults to 0.

---

### Step 5: Implement `normalizeError` and `assertStageResult`

**What:** In `src/core/task-runner.ts`, implement `normalizeError(err: unknown): Omit<NormalizedError, "debug">` that extracts `name`, `message`, `stack`, `status`, `code`, and `error` from an unknown thrown value. Implement `assertStageResult(result: unknown, stageName: string): asserts result is StageResult` that validates the result has own properties `output` and `flags`, and that `flags` is a plain object.

**Why:** Required for error handling and stage result validation (acceptance criteria 11, 12, 32).

**Type signatures:**

```typescript
function normalizeError(err: unknown): Omit<NormalizedError, "debug">;
function assertStageResult(result: unknown, stageName: string): asserts result is StageResult;
```

**Test:** `tests/core/task-runner.test.ts`
- `normalizeError(new Error("boom"))` → `{ name: "Error", message: "boom", stack: "..." }`.
- `normalizeError("string error")` → `{ message: "string error" }`.
- `normalizeError({ message: "api fail", status: 429 })` → `{ message: "api fail", status: 429 }`.
- `normalizeError({ error: { message: "nested" } })` → `{ error: '{"message":"nested"}', message: ... }`.
- `assertStageResult({ output: "x", flags: {} }, "test")` → does not throw.
- `assertStageResult({ flags: {} }, "test")` → throws (missing `output`).
- `assertStageResult({ output: "x", flags: [] }, "test")` → throws (array is not a plain object).
- `assertStageResult({ output: "x", flags: null }, "test")` → throws (null is not a plain object).

---

### Step 6: Implement flag validation functions

**What:** In `src/core/task-runner.ts`, implement `validateFlagTypes(stageName: string, flags: Record<string, unknown>, mode: "requires" | "produces")` that checks flags against `FLAG_SCHEMAS[stageName]` for the given mode. Implement `checkFlagTypeConflicts(existingFlags: Record<string, unknown>, newFlags: Record<string, unknown>)` that throws if a new flag has a different type than an existing flag with the same key.

**Why:** Required for flag schema enforcement and type conflict detection (acceptance criteria 13, 14).

**Type signatures:**

```typescript
function validateFlagTypes(
  stageName: string,
  flags: Record<string, unknown>,
  mode: "requires" | "produces",
): void;

function checkFlagTypeConflicts(
  existingFlags: Record<string, unknown>,
  newFlags: Record<string, unknown>,
): void;
```

**Test:** `tests/core/task-runner.test.ts`
- `validateFlagTypes("validateQuality", { needsRefinement: true }, "produces")` → does not throw.
- `validateFlagTypes("validateQuality", { needsRefinement: "yes" }, "produces")` → throws (expected boolean, got string).
- `validateFlagTypes("ingestion", {}, "requires")` → does not throw (no schema entry for ingestion).
- `checkFlagTypeConflicts({ needsRefinement: true }, { needsRefinement: false })` → does not throw (same type).
- `checkFlagTypeConflicts({ needsRefinement: true }, { needsRefinement: "yes" })` → throws (type conflict: boolean vs string).
- `checkFlagTypeConflicts({}, { newFlag: 42 })` → does not throw (no existing value to conflict with).

---

### Step 7: Implement console capture and restore

**What:** In `src/core/task-runner.ts`, implement `captureConsoleOutput(logPath: string): () => void` that replaces `console.log/error/warn/info/debug` with functions that write to a string buffer with appropriate prefixes, and returns a restore function. The restore function flushes the buffer to `logPath` via `Bun.write()` and restores original console methods. Ensure the log directory is created via `mkdir({ recursive: true })` before capturing.

**Why:** Required for per-stage console capture (acceptance criteria 15–17).

**Type signature:**

```typescript
function captureConsoleOutput(logPath: string): () => Promise<void>;
```

**Test:** `tests/core/task-runner.test.ts`
- Call `captureConsoleOutput` with a temp file path. Call `console.log("hello")`, `console.error("err")`. Call the restore function. Assert the temp file contains `"hello\n[ERROR] err\n"`. Assert `console.log` is restored to its original function.
- Call `captureConsoleOutput`, throw an error inside a try block, call restore in `finally`. Assert console is restored despite the error.

---

### Step 8: Implement `createPipelineStages` factory

**What:** In `src/core/task-runner.ts`, implement `createPipelineStages(taskModule: Record<string, unknown>, tasksOverride?: Record<string, StageHandler>): StageConfig[]` that returns a fresh array of stage configurations with handlers populated from the task module (or `tasksOverride`). The `skipIf` predicates for `critique`, `refine`, and `finalValidation` are set to `(flags) => flags.needsRefinement !== true`.

**Why:** Per-invocation stage array eliminates the concurrency hazard (acceptance criteria 1, 10, 46).

**Type signature:**

```typescript
function createPipelineStages(
  taskModule: Record<string, unknown>,
  tasksOverride?: Record<string, StageHandler>,
): StageConfig[];
```

**Test:** `tests/core/task-runner.test.ts`
- Given a module with `ingestion` and `inference` functions, the returned array has handlers set for those stages and `null` for others.
- `critique`, `refine`, and `finalValidation` have `skipIf` predicates that return `true` when `flags.needsRefinement` is not `true`, and `false` when it is `true`.
- A `tasksOverride` parameter takes precedence over the module's exports.
- Two calls return distinct array instances (not shared references).

---

### Step 9: Implement the `runPipeline` main loop

**What:** In `src/core/task-runner.ts`, implement the core `runPipeline(modulePath, initialContext)` function. This is the largest step and wires together all previous helpers:

1. Validate required fields (`workDir`, `taskName`, `statusPath`) — throw if missing.
2. Validate `modulePath` is absolute — throw if not.
3. Create logger via `createJobLogger`.
4. Load environment if `!initialContext.envLoaded`.
5. Create or reuse LLM client (`initialContext.llm`, or create via `createLLMWithOverride`/`createLLM`).
6. Register LLM metric event listeners on `getLLMEvents()` for `llm:request:complete` and `llm:request:error`.
7. Load task module via `loadFreshModule(modulePath)` (using `pathToFileURL`).
8. Create per-invocation stage array via `createPipelineStages`.
9. Create file I/O adapter via `createTaskFileIO`.
10. Build execution context.
11. Ensure log directory exists.
12. Execute each stage sequentially:
    - Check `skipIf` → skip if true (log to `context.logs` only).
    - Check handler → skip if null (log to returned `logs` as `{ stage, skipped: true }`).
    - Capture console output.
    - Set `currentStage`.
    - Write stage-start status (swallow errors).
    - Clone `data`, `flags`, `output` via `structuredClone` into `StageContext`.
    - Write context snapshot.
    - Validate prerequisite flags.
    - Execute handler, time with `performance.now()`.
    - Validate result shape via `assertStageResult`.
    - Validate produced flag types.
    - Check flag type conflicts.
    - Store output in `context.data[stageName]`.
    - Update `lastStageOutput` if not a validation stage.
    - Merge flags.
    - Log completion audit entry.
    - Write stage-completion status with progress (swallow errors).
    - Write completion log marker.
    - Restore console (in `finally`).
13. On stage error: normalize, enrich with debug metadata, write failure status, restore console, clean up, return `{ ok: false, ... }`.
14. After all stages: flush token write queue, remove LLM listeners, write done status, return `{ ok: true, ... }`.

**Why:** Core behavioral contract (acceptance criteria 1–9, 15–24, 28–34, 46).

**Type signature:**

```typescript
export async function runPipeline(
  modulePath: string,
  initialContext: InitialContext = {} as InitialContext,
): Promise<PipelineResult>;
```

**Test:** `tests/core/task-runner.test.ts` — integration-level tests using mock dependencies:
- Mock `loadFreshModule` to return a module with `ingestion` and `inference` handlers.
- Mock `createTaskFileIO` to return a stub I/O adapter.
- Mock `writeJobStatus` as a no-op.
- Mock `createLLM` to return a stub client.
- Mock `getLLMEvents` to return a mock EventEmitter.
- Call `runPipeline("/absolute/path/module.ts", { workDir: "/tmp/test", taskName: "test-task", statusPath: "/tmp/test/status.json" })`.
- Assert: result is `{ ok: true }`, `context.data.ingestion` and `context.data.inference` are set, `context.flags` contains merged flags.
- Assert: stages without handlers are skipped with `{ stage, skipped: true }` in logs.
- Assert: missing `workDir` throws.
- Assert: relative `modulePath` throws.
- Assert: a handler that throws produces `{ ok: false, failedStage, error }` with debug metadata.
- Assert: a handler returning `{ flags: [] }` produces `{ ok: false }` (invalid result shape).

---

### Step 10: Implement `runPipelineWithModelRouting`

**What:** In `src/core/task-runner.ts`, implement and export `runPipelineWithModelRouting(modulePath, initialContext, modelConfig)`. Build a wrapper context containing `modelConfig`, `availableModels` (from `modelConfig.models` or `["default"]`), and `currentModel` (from `modelConfig.defaultModel` or `"default"`). Delegate to `runPipeline`.

**Why:** Convenience wrapper for model routing (acceptance criterion 35).

**Type signature:**

```typescript
export async function runPipelineWithModelRouting(
  modulePath: string,
  initialContext: InitialContext = {} as InitialContext,
  modelConfig: ModelConfig = {},
): Promise<PipelineResult>;
```

**Test:** `tests/core/task-runner.test.ts`
- Call with `modelConfig: { models: ["gpt-4", "claude-3"], defaultModel: "gpt-4" }`. Assert the context passed to `runPipeline` contains `modelConfig`, `availableModels: ["gpt-4", "claude-3"]`, `currentModel: "gpt-4"`.
- Call with empty `modelConfig`. Assert defaults: `availableModels: ["default"]`, `currentModel: "default"`.

---

### Step 11: Re-export lifecycle policy from task-runner

**What:** In `src/core/task-runner.ts`, add a re-export of `decideTransition` from `./lifecycle-policy` and `computeDeterministicProgress`, `KNOWN_STAGES` from `./progress` for consumers that import from the task-runner module.

**Why:** Preserves the JS module's export surface where `decideTransition` and progress utilities were co-located or re-exported alongside the task-runner (acceptance criteria 40–45 are accessible from the task-runner entry point).

**Type signature:**

```typescript
export { decideTransition } from "./lifecycle-policy";
export { computeDeterministicProgress, KNOWN_STAGES } from "./progress";
```

**Test:** `tests/core/task-runner.test.ts`
- Import `decideTransition` from `src/core/task-runner` and assert it is a function.
- Import `KNOWN_STAGES` from `src/core/task-runner` and assert it has 11 entries.
