# Implementation Specification: `config`

**Analysis source:** `docs/specs/analysis/config.md`

---

## 1. Qualifications

- TypeScript strict mode: `const` assertions, `satisfies` operator, `as const` enums
- TypeScript discriminated unions and string literal types
- `Object.freeze` semantics with TypeScript readonly types
- Regular expressions for string transformation (camelCase conversion)
- `node:path` / Bun-compatible `path.join` for platform-aware path construction
- Set-based membership validation
- Module-load-time invariant assertions

---

## 2. Problem Statement

The system requires a single source of truth for cross-cutting constants (task states, job statuses, job locations, log events), LLM model metadata with pricing, and deterministic path-resolution logic used by nearly every other subsystem. The existing JS implementation provides this via four files (`paths.js`, `models.js`, `log-events.js`, `statuses.js`) using `Object.freeze` and pure functions. This spec defines the TypeScript replacements with full type safety, string literal types, and Bun-compatible path handling.

---

## 3. Goal

A set of TypeScript modules at `src/config/paths.ts`, `src/config/models.ts`, `src/config/log-events.ts`, and `src/config/statuses.ts` that provide identical behavioral contracts to the analyzed JS modules, enforce type safety at compile time via string literal unions and readonly types, run on Bun, and pass all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/config/paths.ts` | Deterministic path-resolution functions for pipeline data directories and job files. |
| `src/config/models.ts` | Complete LLM model alias catalog, configuration registry, pricing metadata, alias parsing/conversion functions, and module-load-time invariant checks. |
| `src/config/log-events.ts` | Log event type constants, log file extension constants, validation predicates, and normalization functions. |
| `src/config/statuses.ts` | Task state, job status, and job location enumerations with validation sets, normalization functions (including synonym handling), and task-to-job status derivation. |
| `src/config/index.ts` | Barrel re-export of all config submodules. |
| `src/config/__tests__/paths.test.ts` | Tests for path resolution functions. |
| `src/config/__tests__/models.test.ts` | Tests for model alias catalog, parsing functions, and invariant checks. |
| `src/config/__tests__/log-events.test.ts` | Tests for log event validation and normalization. |
| `src/config/__tests__/statuses.test.ts` | Tests for status enumerations, normalization, synonym handling, and job status derivation. |

### Key types and interfaces

#### paths.ts

```typescript
interface PipelinePaths {
  readonly pending: string;
  readonly current: string;
  readonly complete: string;
  readonly rejected: string;
}

type JobLocation = "pending" | "current" | "complete" | "rejected";

function resolvePipelinePaths(baseDir: string): PipelinePaths;
function getPendingSeedPath(baseDir: string, jobId: string): string;
function getCurrentSeedPath(baseDir: string, jobId: string): string;
function getCompleteSeedPath(baseDir: string, jobId: string): string;
function getJobDirectoryPath(baseDir: string, jobId: string, location: JobLocation): string;
function getJobMetadataPath(baseDir: string, jobId: string, location?: JobLocation): string;
function getJobPipelinePath(baseDir: string, jobId: string, location?: JobLocation): string;
```

#### models.ts

```typescript
// Literal union types derived from the source constants
type ProviderName = "openai" | "anthropic" | "gemini" | "deepseek" | "moonshot" | "claude-code" | "zai";
type ModelAliasKey = typeof ModelAlias[keyof typeof ModelAlias]; // derived from the as-const ModelAlias object

interface ModelConfigEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly tokenCostInPerMillion: number;
  readonly tokenCostOutPerMillion: number;
}

interface ProviderFunctionEntry {
  readonly alias: ModelAliasKey;
  readonly provider: ProviderName;
  readonly model: string;
  readonly functionName: string;
  readonly fullPath: string;
}

// Type aliases use literal unions rather than broad `string` to enforce the fixed catalog shape at compile time
type ModelAliasMap = Readonly<Record<string, ModelAliasKey>>;
type ModelConfigMap = Readonly<Record<ModelAliasKey, ModelConfigEntry>>;
type DefaultModelByProvider = Readonly<Record<ProviderName, ModelAliasKey>>;
type FunctionNameByAlias = Readonly<Record<ModelAliasKey, string>>;
type ProviderFunctionsIndex = Readonly<Record<ProviderName, readonly ProviderFunctionEntry[]>>;

// Constants
const ModelAlias: ModelAliasMap;
const MODEL_CONFIG: ModelConfigMap;
const VALID_MODEL_ALIASES: ReadonlySet<ModelAliasKey>;
const DEFAULT_MODEL_BY_PROVIDER: DefaultModelByProvider;
const FUNCTION_NAME_BY_ALIAS: FunctionNameByAlias;
const PROVIDER_FUNCTIONS: ProviderFunctionsIndex;

// Functions
function aliasToFunctionName(alias: string): string;
function getProviderFromAlias(alias: string): ProviderName;
function getModelFromAlias(alias: string): string;
function getModelConfig(alias: string): ModelConfigEntry | null;
function buildProviderFunctionsIndex(): ProviderFunctionsIndex;
function validateModelRegistry(
  config: Record<string, ModelConfigEntry>,
  aliasSet: ReadonlySet<string>,
): void;
```

#### log-events.ts

```typescript
type LogEventValue =
  | "start"
  | "complete"
  | "error"
  | "context"
  | "debug"
  | "metrics"
  | "pipeline-start"
  | "pipeline-complete"
  | "pipeline-error"
  | "execution-logs"
  | "failure-details";

type LogFileExtensionValue = "log" | "json";

const LogEvent: Readonly<{
  START: "start";
  COMPLETE: "complete";
  ERROR: "error";
  CONTEXT: "context";
  DEBUG: "debug";
  METRICS: "metrics";
  PIPELINE_START: "pipeline-start";
  PIPELINE_COMPLETE: "pipeline-complete";
  PIPELINE_ERROR: "pipeline-error";
  EXECUTION_LOGS: "execution-logs";
  FAILURE_DETAILS: "failure-details";
}>;

const LogFileExtension: Readonly<{
  TEXT: "log";
  JSON: "json";
}>;

const VALID_LOG_EVENTS: ReadonlySet<string>;
const VALID_LOG_FILE_EXTENSIONS: ReadonlySet<string>;

function isValidLogEvent(event: string): event is LogEventValue;
function isValidLogFileExtension(ext: string): ext is LogFileExtensionValue;
function normalizeLogEvent(event: unknown): LogEventValue | null;
function normalizeLogFileExtension(ext: unknown): LogFileExtensionValue | null;
```

#### statuses.ts

```typescript
type TaskStateValue = "pending" | "running" | "done" | "failed";
type JobStatusValue = "pending" | "running" | "failed" | "complete";
type JobLocationValue = "pending" | "current" | "complete" | "rejected";

const TaskState: Readonly<{
  PENDING: "pending";
  RUNNING: "running";
  DONE: "done";
  FAILED: "failed";
}>;

const JobStatus: Readonly<{
  PENDING: "pending";
  RUNNING: "running";
  FAILED: "failed";
  COMPLETE: "complete";
}>;

const JobLocation: Readonly<{
  PENDING: "pending";
  CURRENT: "current";
  COMPLETE: "complete";
  REJECTED: "rejected";
}>;

const VALID_TASK_STATES: ReadonlySet<string>;
const VALID_JOB_STATUSES: ReadonlySet<string>;
const VALID_JOB_LOCATIONS: ReadonlySet<string>;

function normalizeTaskState(state: unknown): TaskStateValue;
function normalizeJobStatus(status: unknown): JobStatusValue;
function deriveJobStatusFromTasks(tasks: ReadonlyArray<{ state: unknown }>): JobStatusValue;
```

### Bun-specific design decisions

- **`path` module:** Continue using `import { join } from "node:path"` which Bun supports natively. No migration needed — Bun's `node:path` is fully compatible.
- **No Bun-specific file I/O needed** — this module performs no I/O. It is pure computation and constant definitions.
- **`Object.freeze` → `as const satisfies` with deep freeze:** Where the JS original uses `Object.freeze({...})`, the TS version uses `as const satisfies <Type>` to get both compile-time literal types and runtime immutability via `Object.freeze`. The `satisfies` ensures the shape matches the expected type while `as const` preserves literal inference. For nested structures (`MODEL_CONFIG` entries, `PROVIDER_FUNCTIONS` entry arrays and objects), a recursive `deepFreeze` utility must be applied so that nested values cannot be mutated at runtime. Exported validation sets must also be protected from mutation (e.g., by casting to `ReadonlySet` and not exposing the underlying `Set` reference with `.add()` / `.delete()` available).

### Dependency map

**Internal dependencies:** None. The config module is foundational — it sits at the bottom of the dependency graph and imports nothing from other `src/` modules.

**External packages:**

| Package | Version | Usage |
|---------|---------|-------|
| `node:path` (Bun built-in) | — | `path.join` in `paths.ts` |

---

## 5. Acceptance Criteria

### Core behavior — paths

1. `resolvePipelinePaths(baseDir)` returns an object with exactly four string properties (`pending`, `current`, `complete`, `rejected`), each being `<baseDir>/pipeline-data/<location>`.
2. `getPendingSeedPath(baseDir, jobId)` returns `<baseDir>/pipeline-data/pending/<jobId>-seed.json` (flat naming).
3. `getCurrentSeedPath(baseDir, jobId)` returns `<baseDir>/pipeline-data/current/<jobId>/seed.json` (nested naming).
4. `getCompleteSeedPath(baseDir, jobId)` returns `<baseDir>/pipeline-data/complete/<jobId>/seed.json` (nested naming).
5. `getJobDirectoryPath(baseDir, jobId, location)` returns `<baseDir>/pipeline-data/<location>/<jobId>` for each valid location.
6. `getJobMetadataPath` defaults `location` to `"current"` and returns `<baseDir>/pipeline-data/<location>/<jobId>/job.json`.
7. `getJobPipelinePath` defaults `location` to `"current"` and returns `<baseDir>/pipeline-data/<location>/<jobId>/pipeline.json`.
8. Each call to `resolvePipelinePaths` returns a fresh object (not a cached singleton).

### Core behavior — models

9. `ModelAlias` contains all 35 model alias constants mapping to `"provider:model"` format strings.
10. `MODEL_CONFIG` contains a config entry for every alias in `ModelAlias` with `provider`, `model`, `tokenCostInPerMillion`, and `tokenCostOutPerMillion`.
11. `VALID_MODEL_ALIASES` is a `Set` exactly mirroring `MODEL_CONFIG` keys.
12. `DEFAULT_MODEL_BY_PROVIDER` maps all 7 providers to their default alias.
13. `FUNCTION_NAME_BY_ALIAS` has one entry per `MODEL_CONFIG` key with the correct camelCase function name.
14. `PROVIDER_FUNCTIONS` groups function metadata by provider, each entry containing `alias`, `provider`, `model`, `functionName`, and `fullPath` (`"llm.<provider>.<functionName>"`).
15. `aliasToFunctionName("openai:gpt-5.2")` returns `"gpt52"`.
16. `aliasToFunctionName("gemini:flash-2.5-lite")` returns `"flash25Lite"`.
17. `aliasToFunctionName("anthropic:opus-4-5")` returns `"opus45"`.
18. `aliasToFunctionName("moonshot:kimi-k2.5")` returns `"kimiK25"`.
19. `getProviderFromAlias("openai:gpt-5.2")` returns `"openai"`.
20. `getModelFromAlias("openai:gpt-5.2")` returns `"gpt-5.2"`.
21. `getModelConfig` returns the config entry for a valid alias, or `null` for unknown aliases.
22. All Claude Code model entries have `tokenCostInPerMillion: 0` and `tokenCostOutPerMillion: 0`.

### Error handling — models

23. `aliasToFunctionName` throws `Error` for non-string input.
24. `aliasToFunctionName` throws `Error` for strings without a colon.
25. `getProviderFromAlias` throws `Error` for non-string or colon-less input.
26. `getModelFromAlias` throws `Error` for non-string or colon-less input.
27. `getModelFromAlias` handles aliases with multiple colons by rejoining segments after the first (e.g., `"provider:model:variant"` → `"model:variant"`).

### Module-load invariant checks

28. If any `MODEL_CONFIG` entry has a `provider` field mismatching its alias prefix, module load throws an `Error` with a descriptive message.
29. If any `MODEL_CONFIG` entry has negative `tokenCostInPerMillion` or `tokenCostOutPerMillion`, module load throws an `Error`.
30. If `VALID_MODEL_ALIASES` size or content diverges from `MODEL_CONFIG` keys, module load throws an `Error`.

### Core behavior — log events

31. `LogEvent` contains all 11 event type constants with correct string values.
32. `LogFileExtension` contains `TEXT: "log"` and `JSON: "json"`.
33. `isValidLogEvent` returns `true` for all valid events and `false` for invalid strings.
34. `isValidLogFileExtension` returns `true` for `"log"` and `"json"`, `false` for others.
35. `normalizeLogEvent` lowercases and trims input, returning the canonical value or `null` for non-strings and unrecognized values.
36. `normalizeLogFileExtension` lowercases, trims, and strips a leading dot, returning the canonical value or `null` for non-strings and unrecognized values.
37. `normalizeLogEvent(42)` returns `null` (non-string input).
38. `normalizeLogFileExtension(".json")` returns `"json"` (leading dot stripped).

### Core behavior — statuses

39. `TaskState` contains `PENDING`, `RUNNING`, `DONE`, `FAILED` with correct string values.
40. `JobStatus` contains `PENDING`, `RUNNING`, `FAILED`, `COMPLETE` with correct string values.
41. `JobLocation` contains `PENDING`, `CURRENT`, `COMPLETE`, `REJECTED` with correct string values.
42. `normalizeTaskState("error")` returns `"failed"` (synonym).
43. `normalizeTaskState("succeeded")` returns `"done"` (synonym).
44. `normalizeTaskState("PENDING")` returns `"pending"` (case-insensitive).
45. `normalizeTaskState(123)` returns `"pending"` (non-string fallback).
46. `normalizeJobStatus("completed")` returns `"complete"` (synonym).
47. `normalizeJobStatus("error")` returns `"failed"` (synonym).
48. `normalizeJobStatus(null)` returns `"pending"` (non-string fallback).

### Core behavior — job status derivation

49. `deriveJobStatusFromTasks([{state:"failed"},{state:"done"}])` returns `"failed"` (failed priority).
50. `deriveJobStatusFromTasks([{state:"running"},{state:"done"}])` returns `"running"` (running priority).
51. `deriveJobStatusFromTasks([{state:"done"},{state:"done"}])` returns `"complete"` (all done → complete).
52. `deriveJobStatusFromTasks([{state:"pending"},{state:"done"}])` returns `"pending"` (mixed → pending).
53. `deriveJobStatusFromTasks([])` returns `"pending"` (empty array).
54. `deriveJobStatusFromTasks("not-array" as any)` returns `"pending"` (non-array).

### Immutability

55. All exported constant objects (`ModelAlias`, `MODEL_CONFIG`, `TaskState`, `JobStatus`, `JobLocation`, `LogEvent`, `LogFileExtension`, `DEFAULT_MODEL_BY_PROVIDER`, `FUNCTION_NAME_BY_ALIAS`, `PROVIDER_FUNCTIONS`) are deeply frozen: `Object.isFrozen` returns `true` for the top-level object and for every nested value object. Specifically, each entry in `MODEL_CONFIG`, each entry array and entry object in `PROVIDER_FUNCTIONS`, and all exported validation sets (`VALID_MODEL_ALIASES`, `VALID_LOG_EVENTS`, `VALID_LOG_FILE_EXTENSIONS`, `VALID_TASK_STATES`, `VALID_JOB_STATUSES`, `VALID_JOB_LOCATIONS`) must be immutable at runtime.

### Idempotency

56. Normalization functions are idempotent: normalizing an already-canonical value returns the same value.

### Concurrency safety

57. All exports are either frozen objects or pure functions with no side effects — safe for concurrent access.

---

## 6. Notes

### Design trade-offs

- **String literal unions vs. TypeScript `enum`:** Using `as const` objects with derived string literal unions rather than TypeScript `enum`. Rationale: `enum` generates runtime code and doesn't interop cleanly with plain string comparisons. `as const` objects preserve the original JS pattern while adding compile-time type safety.
- **Normalization inconsistency preserved:** The analysis notes that `normalizeTaskState`/`normalizeJobStatus` default to `"pending"` while `normalizeLogEvent`/`normalizeLogFileExtension` return `null`. This asymmetry is intentional per the original design and is preserved in the TS migration. The type signatures make this explicit.
- **`getJobDirectoryPath` with invalid location (intentional breaking change):** The JS version accepts arbitrary strings for `location` and produces a path containing `"undefined"` for invalid values. The TS version narrows the `location` parameter to `JobLocationValue`, which is an intentional breaking change for dynamic callers and plain JS consumers that previously passed arbitrary strings. This is a deliberate API tightening: callers that relied on the permissive behavior must validate or cast their location values before calling. The migration should surface any such callers at compile time.

### Known risks from analysis

- The `aliasToFunctionName` regex `[-.]([a-z0-9])/gi` will leave a separator as a literal character if it's not followed by an alphanumeric character (e.g., consecutive separators like `"gpt--5"`). This is an edge case preserved from the original.
- No cache-hit pricing in `MODEL_CONFIG`. Cost estimates may overestimate for providers with cached-token discounts (DeepSeek, Gemini, Moonshot).
- Gemini tiered pricing (above 200K tokens) is not modeled. A single input price is stored.
- Estimated pricing entries (e.g., `openai:gpt-5.2-pro`) may not reflect actual API pricing.

### Migration-specific concerns

- The `JobLocation` type in `paths.ts` and the `JobLocation` constant in `statuses.ts` overlap in name. The type alias in `paths.ts` should use the values from `statuses.ts` or be aliased to avoid confusion. The implementation uses the `JobLocationValue` type from `statuses.ts` in the `paths.ts` function signatures.
- Model alias data (all 35 entries with pricing) must be migrated exactly. Any drift would be caught by the invariant checks at load time.

### Dependencies on other modules

- None. This module is foundational and has no dependencies on other migrated modules. It can be implemented first.

---

## 7. Implementation Steps

### Step 1: Create `src/config/statuses.ts` — enumerations and normalization

**What to do:** Create `src/config/statuses.ts` with:
- `TaskState` as a frozen `as const` object with values `pending`, `running`, `done`, `failed`.
- `JobStatus` as a frozen `as const` object with values `pending`, `running`, `failed`, `complete`.
- `JobLocation` as a frozen `as const` object with values `pending`, `current`, `complete`, `rejected`.
- Derived string literal union types: `TaskStateValue`, `JobStatusValue`, `JobLocationValue`.
- Validation sets: `VALID_TASK_STATES`, `VALID_JOB_STATUSES`, `VALID_JOB_LOCATIONS`.
- `normalizeTaskState(state: unknown): TaskStateValue` — lowercase+trim, synonym map (`"error"` → `"failed"`, `"succeeded"` → `"done"`), membership check, default `"pending"`.
- `normalizeJobStatus(status: unknown): JobStatusValue` — lowercase+trim, synonym map (`"completed"` → `"complete"`, `"error"` → `"failed"`), membership check, default `"pending"`.
- `deriveJobStatusFromTasks(tasks: ReadonlyArray<{state: unknown}>): JobStatusValue` — guards on `Array.isArray`, normalizes task states, applies priority: failed > running > complete (all done) > pending.

**Why:** Establishes foundational enumerations consumed by every other module. Required before `paths.ts` (which uses `JobLocationValue`) and before any module that tracks status.

**Type signatures:**

```typescript
export type TaskStateValue = "pending" | "running" | "done" | "failed";
export type JobStatusValue = "pending" | "running" | "failed" | "complete";
export type JobLocationValue = "pending" | "current" | "complete" | "rejected";

export function normalizeTaskState(state: unknown): TaskStateValue;
export function normalizeJobStatus(status: unknown): JobStatusValue;
export function deriveJobStatusFromTasks(tasks: ReadonlyArray<{ state: unknown }>): JobStatusValue;
```

**Test:** `src/config/__tests__/statuses.test.ts`
- Assert `TaskState.PENDING === "pending"`, etc. for all enum values.
- Assert `VALID_TASK_STATES.has("pending")` is `true` and `VALID_TASK_STATES.has("invalid")` is `false`.
- Assert `normalizeTaskState("error")` returns `"failed"`, `normalizeTaskState("succeeded")` returns `"done"`, `normalizeTaskState("RUNNING")` returns `"running"`, `normalizeTaskState(42)` returns `"pending"`.
- Assert `normalizeJobStatus("completed")` returns `"complete"`, `normalizeJobStatus("error")` returns `"failed"`, `normalizeJobStatus(null)` returns `"pending"`.
- Assert `deriveJobStatusFromTasks([{state:"failed"},{state:"done"}])` returns `"failed"`.
- Assert `deriveJobStatusFromTasks([{state:"running"},{state:"done"}])` returns `"running"`.
- Assert `deriveJobStatusFromTasks([{state:"done"},{state:"done"}])` returns `"complete"`.
- Assert `deriveJobStatusFromTasks([{state:"pending"},{state:"done"}])` returns `"pending"`.
- Assert `deriveJobStatusFromTasks([])` returns `"pending"`.
- Assert `deriveJobStatusFromTasks("not-array" as any)` returns `"pending"`.
- Assert all constant objects are frozen (`Object.isFrozen`).
- Assert normalization is idempotent: `normalizeTaskState("done") === normalizeTaskState(normalizeTaskState("done"))`.

---

### Step 2: Create `src/config/log-events.ts` — log event and file extension constants

**What to do:** Create `src/config/log-events.ts` with:
- `LogEvent` as a frozen `as const` object with all 11 event values.
- `LogFileExtension` as a frozen `as const` object with `TEXT: "log"`, `JSON: "json"`.
- Derived string literal union types: `LogEventValue`, `LogFileExtensionValue`.
- Validation sets: `VALID_LOG_EVENTS`, `VALID_LOG_FILE_EXTENSIONS`.
- `isValidLogEvent(event: string): event is LogEventValue` — type guard using `VALID_LOG_EVENTS.has`.
- `isValidLogFileExtension(ext: string): ext is LogFileExtensionValue` — type guard using `VALID_LOG_FILE_EXTENSIONS.has`.
- `normalizeLogEvent(event: unknown): LogEventValue | null` — returns `null` for non-string, otherwise lowercase+trim and membership check.
- `normalizeLogFileExtension(ext: unknown): LogFileExtensionValue | null` — returns `null` for non-string, otherwise lowercase+trim+strip leading dot and membership check.

**Why:** Establishes log event taxonomy used by the status writer, logger, and task analysis modules.

**Type signatures:**

```typescript
export type LogEventValue = "start" | "complete" | "error" | "context" | "debug" | "metrics"
  | "pipeline-start" | "pipeline-complete" | "pipeline-error" | "execution-logs" | "failure-details";
export type LogFileExtensionValue = "log" | "json";

export function isValidLogEvent(event: string): event is LogEventValue;
export function isValidLogFileExtension(ext: string): ext is LogFileExtensionValue;
export function normalizeLogEvent(event: unknown): LogEventValue | null;
export function normalizeLogFileExtension(ext: unknown): LogFileExtensionValue | null;
```

**Test:** `src/config/__tests__/log-events.test.ts`
- Assert `LogEvent.START === "start"`, etc. for all 11 events.
- Assert `LogFileExtension.TEXT === "log"`, `LogFileExtension.JSON === "json"`.
- Assert `VALID_LOG_EVENTS` has size 11 and contains all event values.
- Assert `isValidLogEvent("start")` is `true`, `isValidLogEvent("invalid")` is `false`.
- Assert `isValidLogFileExtension("log")` is `true`, `isValidLogFileExtension("txt")` is `false`.
- Assert `normalizeLogEvent("START")` returns `"start"` (case-insensitive).
- Assert `normalizeLogEvent("  error  ")` returns `"error"` (trimming).
- Assert `normalizeLogEvent(42)` returns `null` (non-string).
- Assert `normalizeLogEvent("bogus")` returns `null` (unrecognized).
- Assert `normalizeLogFileExtension(".json")` returns `"json"` (leading dot stripped).
- Assert `normalizeLogFileExtension(".LOG")` returns `"log"` (case + dot).
- Assert `normalizeLogFileExtension(undefined)` returns `null`.
- Assert all constant objects are frozen.

---

### Step 3: Create `src/config/paths.ts` — path resolution functions

**What to do:** Create `src/config/paths.ts` with:
- `import { join } from "node:path"`.
- `import type { JobLocationValue } from "./statuses"` for the location parameter type.
- `PipelinePaths` interface.
- `resolvePipelinePaths(baseDir: string): PipelinePaths` — returns fresh object with four paths under `<baseDir>/pipeline-data/`.
- `getPendingSeedPath(baseDir: string, jobId: string): string` — `join(baseDir, "pipeline-data", "pending", `${jobId}-seed.json`)`.
- `getCurrentSeedPath(baseDir: string, jobId: string): string` — `join(baseDir, "pipeline-data", "current", jobId, "seed.json")`.
- `getCompleteSeedPath(baseDir: string, jobId: string): string` — `join(baseDir, "pipeline-data", "complete", jobId, "seed.json")`.
- `getJobDirectoryPath(baseDir: string, jobId: string, location: JobLocationValue): string` — `join(baseDir, "pipeline-data", location, jobId)`.
- `getJobMetadataPath(baseDir: string, jobId: string, location: JobLocationValue = "current"): string` — `join(getJobDirectoryPath(baseDir, jobId, location), "job.json")`.
- `getJobPipelinePath(baseDir: string, jobId: string, location: JobLocationValue = "current"): string` — `join(getJobDirectoryPath(baseDir, jobId, location), "pipeline.json")`.

**Why:** Provides deterministic path resolution required by `file-io`, `orchestrator`, `pipeline-runner`, and `status-writer` modules.

**Type signatures:**

```typescript
export interface PipelinePaths {
  readonly pending: string;
  readonly current: string;
  readonly complete: string;
  readonly rejected: string;
}

export function resolvePipelinePaths(baseDir: string): PipelinePaths;
export function getPendingSeedPath(baseDir: string, jobId: string): string;
export function getCurrentSeedPath(baseDir: string, jobId: string): string;
export function getCompleteSeedPath(baseDir: string, jobId: string): string;
export function getJobDirectoryPath(baseDir: string, jobId: string, location: JobLocationValue): string;
export function getJobMetadataPath(baseDir: string, jobId: string, location?: JobLocationValue): string;
export function getJobPipelinePath(baseDir: string, jobId: string, location?: JobLocationValue): string;
```

**Test:** `src/config/__tests__/paths.test.ts`
- Assert `resolvePipelinePaths("/data")` returns `{ pending: "/data/pipeline-data/pending", current: "/data/pipeline-data/current", complete: "/data/pipeline-data/complete", rejected: "/data/pipeline-data/rejected" }`.
- Assert `getPendingSeedPath("/data", "job-1")` returns `"/data/pipeline-data/pending/job-1-seed.json"`.
- Assert `getCurrentSeedPath("/data", "job-1")` returns `"/data/pipeline-data/current/job-1/seed.json"`.
- Assert `getCompleteSeedPath("/data", "job-1")` returns `"/data/pipeline-data/complete/job-1/seed.json"`.
- Assert `getJobDirectoryPath("/data", "job-1", "current")` returns `"/data/pipeline-data/current/job-1"`.
- Assert `getJobDirectoryPath("/data", "job-1", "rejected")` returns `"/data/pipeline-data/rejected/job-1"`.
- Assert `getJobMetadataPath("/data", "job-1")` returns `"/data/pipeline-data/current/job-1/job.json"` (default location).
- Assert `getJobMetadataPath("/data", "job-1", "complete")` returns `"/data/pipeline-data/complete/job-1/job.json"`.
- Assert `getJobPipelinePath("/data", "job-1")` returns `"/data/pipeline-data/current/job-1/pipeline.json"` (default location).
- Assert `getJobPipelinePath("/data", "job-1", "rejected")` returns `"/data/pipeline-data/rejected/job-1/pipeline.json"`.
- Assert two calls to `resolvePipelinePaths` return distinct objects (`!==`).

---

### Step 4: Create `src/config/models.ts` — model registry, alias functions, and invariant checks

**What to do:** Create `src/config/models.ts` with:

1. `ModelConfigEntry` interface and `ProviderFunctionEntry` interface.
2. `ModelAlias` as a frozen `as const` object with all 35 model alias constants.
3. `MODEL_CONFIG` as a deeply frozen object keyed by alias string, each value having `{ provider, model, tokenCostInPerMillion, tokenCostOutPerMillion }`. Each entry object must itself be frozen. All 35 entries with exact pricing data from the JS source.
4. `VALID_MODEL_ALIASES` as `new Set(Object.keys(MODEL_CONFIG))`.
5. `aliasToFunctionName(alias: string): string` — validates string + colon, splits on `:`, takes segments after first, joins with `:`, applies `model.replace(/[-.]([a-z0-9])/gi, (_, char) => char.toUpperCase())`.
6. `getProviderFromAlias(alias: string): string` — validates, returns `alias.split(":")[0]`.
7. `getModelFromAlias(alias: string): string` — validates, returns `alias.split(":").slice(1).join(":")`.
8. `getModelConfig(alias: string): ModelConfigEntry | null` — returns `MODEL_CONFIG[alias] ?? null`.
9. `DEFAULT_MODEL_BY_PROVIDER` as a frozen object with 7 provider-to-default-alias mappings.
10. `FUNCTION_NAME_BY_ALIAS` computed by iterating `MODEL_CONFIG` keys and applying `aliasToFunctionName`. Frozen.
11. `buildProviderFunctionsIndex(): ProviderFunctionsIndex` — groups entries by provider, each with `{ alias, provider, model, functionName, fullPath: "llm.<provider>.<functionName>" }`. Deep-freezes each entry object, each provider array, and the outer object.
12. `PROVIDER_FUNCTIONS` computed at module scope via `buildProviderFunctionsIndex()`.
13. Module-load-time invariant checks, implemented as a separately exported `validateModelRegistry(config, aliasSet)` function so that failure paths are independently testable:
    - Provider-alias consistency: for each `[alias, config]` in the config, verify `getProviderFromAlias(alias) === config.provider`.
    - Token cost validation: verify both cost fields are non-negative numbers.
    - Alias set consistency: verify the alias set size and content matches the config keys.
    - The module's top-level code calls `validateModelRegistry(MODEL_CONFIG, VALID_MODEL_ALIASES)` at load time.

**Why:** Central model registry consumed by providers, LLM gateway, CLI, and cost calculators.

**Type signatures:**

```typescript
export type ProviderName = "openai" | "anthropic" | "gemini" | "deepseek" | "moonshot" | "claude-code" | "zai";
export type ModelAliasKey = typeof ModelAlias[keyof typeof ModelAlias];

export interface ModelConfigEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly tokenCostInPerMillion: number;
  readonly tokenCostOutPerMillion: number;
}

export interface ProviderFunctionEntry {
  readonly alias: ModelAliasKey;
  readonly provider: ProviderName;
  readonly model: string;
  readonly functionName: string;
  readonly fullPath: string;
}

export function aliasToFunctionName(alias: string): string;
export function getProviderFromAlias(alias: string): ProviderName;
export function getModelFromAlias(alias: string): string;
export function getModelConfig(alias: string): ModelConfigEntry | null;
export function buildProviderFunctionsIndex(): Readonly<Record<ProviderName, readonly ProviderFunctionEntry[]>>;
export function validateModelRegistry(
  config: Record<string, ModelConfigEntry>,
  aliasSet: ReadonlySet<string>,
): void; // throws Error on invariant violation
```

**Test:** `src/config/__tests__/models.test.ts`
- Assert `ModelAlias` has exactly 35 entries.
- Assert `MODEL_CONFIG` has exactly 35 entries.
- Assert `VALID_MODEL_ALIASES.size === 35`.
- Assert each `ModelAlias` value is a key in `MODEL_CONFIG`.
- Assert `DEFAULT_MODEL_BY_PROVIDER` has entries for all 7 providers.
- Assert `aliasToFunctionName("openai:gpt-5.2")` returns `"gpt52"`.
- Assert `aliasToFunctionName("gemini:flash-2.5-lite")` returns `"flash25Lite"`.
- Assert `aliasToFunctionName("anthropic:opus-4-5")` returns `"opus45"`.
- Assert `aliasToFunctionName("moonshot:kimi-k2.5")` returns `"kimiK25"`.
- Assert `aliasToFunctionName(42 as any)` throws `Error`.
- Assert `aliasToFunctionName("no-colon")` throws `Error`.
- Assert `getProviderFromAlias("openai:gpt-5.2")` returns `"openai"`.
- Assert `getModelFromAlias("openai:gpt-5.2")` returns `"gpt-5.2"`.
- Assert `getModelFromAlias("provider:model:variant")` returns `"model:variant"` (multi-colon handling).
- Assert `getModelConfig("openai:gpt-5.2")` returns an object with `provider: "openai"`.
- Assert `getModelConfig("nonexistent:model")` returns `null`.
- Assert all Claude Code entries have zero pricing.
- Assert `FUNCTION_NAME_BY_ALIAS` has exactly 35 entries.
- Assert `PROVIDER_FUNCTIONS` has entries for all 7 providers.
- Assert each `PROVIDER_FUNCTIONS` entry has `alias`, `provider`, `model`, `functionName`, `fullPath`.
- Assert `fullPath` follows pattern `"llm.<provider>.<functionName>"`.
- Assert all constant objects are frozen (`Object.isFrozen`).
- Assert deep immutability: each `MODEL_CONFIG[alias]` entry is frozen, each `PROVIDER_FUNCTIONS[provider]` array is frozen, and each entry object within those arrays is frozen.

**Testing module-load invariant failures (acceptance criteria 28–30):**

The invariant checks (provider-alias consistency, non-negative pricing, alias-set drift) execute at module load time, which means a normal `import` triggers them once and caches the result. To test that these invariant checks correctly throw on bad data, the implementation must expose the validation logic as a separately callable internal function (e.g., `validateModelRegistry(config, aliasSet)`) that the tests can invoke with fixture data containing deliberate violations. The tests should:

- Call the validation function with a config entry whose `provider` field mismatches its alias prefix and assert it throws an `Error` with a descriptive message (AC 28).
- Call the validation function with a config entry that has a negative `tokenCostInPerMillion` and assert it throws an `Error` (AC 29).
- Call the validation function with an alias set whose size differs from the config keys and assert it throws an `Error` (AC 30).

The module's top-level code should call this same validation function against the real `MODEL_CONFIG` and `VALID_MODEL_ALIASES`, so the runtime behavior is unchanged while the failure paths become independently testable.

---

### Step 5: Create `src/config/index.ts` — barrel re-export

**What to do:** Create `src/config/index.ts` that re-exports all public symbols from:
- `./statuses`
- `./log-events`
- `./paths`
- `./models`

Use `export * from` for value exports and `export type * from` where applicable.

**Why:** Provides a single import path for consumers (`import { TaskState, ModelAlias, resolvePipelinePaths } from "@/config"`), matching the barrel pattern used in other subsystem specs.

**Test:** No dedicated test file. Correctness is verified by the existing tests importing from submodules.
