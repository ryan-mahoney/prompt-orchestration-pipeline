# Config Module Specification

**MODULE_NAME:** `config`
**SOURCE_FILES:** `src/config/paths.js`, `src/config/models.js`, `src/config/log-events.js`, `src/config/statuses.js`

---

## 1. Purpose & Responsibilities

The `config` module serves as the **single source of truth** for cross-cutting constants, enumerations, pricing metadata, and path-resolution logic used throughout the prompt orchestration pipeline. It is a pure-data and pure-function module — it performs no I/O, holds no mutable state at runtime, and coordinates no workflows.

**Responsibilities:**

- Define canonical string enumerations for task states, job statuses, and job locations.
- Define canonical string enumerations for log event types and log file extensions.
- Define the complete catalog of supported LLM model aliases, their provider mapping, API model identifiers, and per-token pricing metadata.
- Provide deterministic path-resolution functions that convert a base directory and a job ID into the correct filesystem path for seed files, job metadata, and pipeline snapshots.
- Provide normalization functions that coerce raw or synonym strings into their canonical enumeration values.
- Provide utility functions for decomposing model aliases into provider names, model names, and derived function names used by the LLM dispatch layer.
- Validate its own internal consistency at module load time via invariant checks.

**Boundaries — what it does NOT do:**

- It does **not** read from or write to the filesystem. It only computes paths.
- It does **not** make network requests or interact with any LLM provider API.
- It does **not** hold runtime state (all exported structures are frozen/immutable).
- It does **not** enforce that paths exist — it is the caller's responsibility to create directories or verify file existence.
- It does **not** contain application-level business logic (e.g., job lifecycle transitions, pipeline execution).

**Pattern:** This module follows the **Constants Registry** pattern — a centralized, read-only catalog of configuration values that other modules import and reference.

---

## 2. Public Interface

### 2.1 `src/config/paths.js`

| Export | Purpose | Parameters | Return Value | Errors |
|---|---|---|---|---|
| `resolvePipelinePaths(baseDir)` | Resolves the four pipeline data subdirectory paths from a base directory. | `baseDir` (string): The root data directory for the pipeline instance. | Object with four string properties: `pending`, `current`, `complete`, `rejected` — each a fully-resolved filesystem path under `<baseDir>/pipeline-data/`. | None thrown. Behavior is undefined if `baseDir` is not a string (relies on `path.join` behavior). |
| `getPendingSeedPath(baseDir, jobId)` | Returns the full path to a job's seed file in the pending directory. | `baseDir` (string): Root data directory. `jobId` (string): The unique job identifier. | String: `<baseDir>/pipeline-data/pending/<jobId>-seed.json`. | None thrown. |
| `getCurrentSeedPath(baseDir, jobId)` | Returns the full path to a job's seed file in the current (active) directory. | `baseDir` (string): Root data directory. `jobId` (string): The unique job identifier. | String: `<baseDir>/pipeline-data/current/<jobId>/seed.json`. | None thrown. |
| `getCompleteSeedPath(baseDir, jobId)` | Returns the full path to a job's seed file in the complete directory. | `baseDir` (string): Root data directory. `jobId` (string): The unique job identifier. | String: `<baseDir>/pipeline-data/complete/<jobId>/seed.json`. | None thrown. |
| `getJobDirectoryPath(baseDir, jobId, location)` | Returns the full path to a job's directory within a given location bucket. | `baseDir` (string): Root data directory. `jobId` (string): Job identifier. `location` (string): One of `"current"`, `"complete"`, `"pending"`, `"rejected"`. | String: `<baseDir>/pipeline-data/<location>/<jobId>`. | None thrown. If `location` is not a valid key in the paths object, the resulting path will contain `undefined` as a path segment. |
| `getJobMetadataPath(baseDir, jobId, location?)` | Returns the full path to a job's metadata file (`job.json`). | `baseDir` (string): Root data directory. `jobId` (string): Job identifier. `location` (string, optional, default `"current"`): The location bucket. | String: `<baseDir>/pipeline-data/<location>/<jobId>/job.json`. | None thrown. |
| `getJobPipelinePath(baseDir, jobId, location?)` | Returns the full path to a job's pipeline snapshot file (`pipeline.json`). | `baseDir` (string): Root data directory. `jobId` (string): Job identifier. `location` (string, optional, default `"current"`): The location bucket. | String: `<baseDir>/pipeline-data/<location>/<jobId>/pipeline.json`. | None thrown. |

**Key structural observation:** The pending directory uses a **flat naming scheme** (`<jobId>-seed.json` directly in the pending folder), while the current and complete directories use a **nested scheme** (`<jobId>/seed.json` inside a per-job subdirectory). This asymmetry is intentional and reflects the job lifecycle: pending jobs have only a seed file, while active and completed jobs accumulate multiple files in a dedicated directory.

### 2.2 `src/config/models.js`

#### Constants

| Export | Purpose | Type |
|---|---|---|
| `ModelAlias` | Frozen object mapping human-readable constant names to canonical model alias strings in `"provider:model"` format. Contains aliases for DeepSeek, OpenAI, Google Gemini, Z.ai (Zhipu), Anthropic, Claude Code, and Moonshot/Kimi providers. | Frozen object of string values. |
| `MODEL_CONFIG` | Frozen object keyed by model alias string, mapping each alias to its configuration: `provider` (string), `model` (string — the API model identifier), `tokenCostInPerMillion` (number), `tokenCostOutPerMillion` (number). | Frozen object of configuration objects. |
| `VALID_MODEL_ALIASES` | A `Set` containing all valid model alias strings, derived from the keys of `MODEL_CONFIG`. | `Set<string>` |
| `DEFAULT_MODEL_BY_PROVIDER` | Frozen object mapping provider name strings to their default `ModelAlias` value. Used when a provider is specified without a specific model. | Frozen object of string values. |
| `FUNCTION_NAME_BY_ALIAS` | Frozen object mapping each model alias to a derived function name. Computed at module load time by applying `aliasToFunctionName` to every alias. | Frozen object of string values. |
| `PROVIDER_FUNCTIONS` | Frozen object mapping each provider name to an array of function metadata objects, each containing `alias`, `provider`, `model`, `functionName`, and `fullPath` (dotted path like `llm.anthropic.opus45`). | Frozen object of frozen arrays. |

#### Functions

| Export | Purpose | Parameters | Return Value | Errors |
|---|---|---|---|---|
| `aliasToFunctionName(alias)` | Converts a model alias string to a camelCase function name by stripping the provider prefix, then removing hyphens and dots while uppercasing the following character. | `alias` (string): A model alias in `"provider:model"` format (e.g., `"gemini:pro-2.5"`). | String: The derived function name (e.g., `"pro25"`). | Throws `Error` if `alias` is not a string or does not contain a colon. |
| `getProviderFromAlias(alias)` | Extracts the provider portion of a model alias. | `alias` (string): A model alias in `"provider:model"` format. | String: The provider name (e.g., `"openai"`). | Throws `Error` if `alias` is not a string or does not contain a colon. |
| `getModelFromAlias(alias)` | Extracts the model portion of a model alias. | `alias` (string): A model alias in `"provider:model"` format. | String: The model name (e.g., `"gpt-5"`). Handles aliases with multiple colons by rejoining all segments after the first. | Throws `Error` if `alias` is not a string or does not contain a colon. |
| `getModelConfig(alias)` | Looks up the full configuration object for a given model alias. | `alias` (string): A model alias. | The configuration object (`{ provider, model, tokenCostInPerMillion, tokenCostOutPerMillion }`) or `null` if the alias is not found. | None thrown. |
| `buildProviderFunctionsIndex()` | Constructs a frozen index of provider function metadata, grouped by provider name. Each entry includes `alias`, `provider`, `model`, `functionName`, and `fullPath`. | None. | Frozen object mapping provider names to frozen arrays of function metadata objects. | None thrown. |

### 2.3 `src/config/log-events.js`

#### Constants

| Export | Purpose | Type |
|---|---|---|
| `LogEvent` | Frozen object mapping log event constant names to their canonical string values: `START`, `COMPLETE`, `ERROR`, `CONTEXT`, `DEBUG`, `METRICS`, `PIPELINE_START`, `PIPELINE_COMPLETE`, `PIPELINE_ERROR`, `EXECUTION_LOGS`, `FAILURE_DETAILS`. | Frozen object of string values. |
| `LogFileExtension` | Frozen object mapping file extension constant names to canonical values: `TEXT` → `"log"`, `JSON` → `"json"`. | Frozen object of string values. |
| `VALID_LOG_EVENTS` | A `Set` containing all valid log event strings. | `Set<string>` |
| `VALID_LOG_FILE_EXTENSIONS` | A `Set` containing all valid log file extension strings. | `Set<string>` |

#### Functions

| Export | Purpose | Parameters | Return Value | Errors |
|---|---|---|---|---|
| `isValidLogEvent(event)` | Checks whether a string is a recognized log event. | `event` (string): The event string to validate. | Boolean: `true` if the event is in `VALID_LOG_EVENTS`, `false` otherwise. | None thrown. |
| `isValidLogFileExtension(ext)` | Checks whether a string is a recognized log file extension. | `ext` (string): The extension string to validate. | Boolean: `true` if the extension is in `VALID_LOG_FILE_EXTENSIONS`, `false` otherwise. | None thrown. |
| `normalizeLogEvent(event)` | Normalizes a raw log event string to its canonical lowercase-trimmed form if it matches a known event. | `event` (any): The raw event value. | The canonical log event string, or `null` if the input is not a string or does not match any known event after normalization. | None thrown. |
| `normalizeLogFileExtension(ext)` | Normalizes a raw file extension string to its canonical form, stripping a leading dot if present. | `ext` (any): The raw extension value. | The canonical extension string, or `null` if the input is not a string or does not match any known extension after normalization. | None thrown. |

### 2.4 `src/config/statuses.js`

#### Constants

| Export | Purpose | Type |
|---|---|---|
| `TaskState` | Frozen object mapping task state constant names to their canonical string values: `PENDING` → `"pending"`, `RUNNING` → `"running"`, `DONE` → `"done"`, `FAILED` → `"failed"`. | Frozen object of string values. |
| `JobStatus` | Frozen object mapping job status constant names to their canonical string values: `PENDING` → `"pending"`, `RUNNING` → `"running"`, `FAILED` → `"failed"`, `COMPLETE` → `"complete"`. | Frozen object of string values. |
| `JobLocation` | Frozen object mapping job location constant names to their canonical string values: `PENDING` → `"pending"`, `CURRENT` → `"current"`, `COMPLETE` → `"complete"`, `REJECTED` → `"rejected"`. | Frozen object of string values. |
| `VALID_TASK_STATES` | A `Set` containing all valid task state strings. | `Set<string>` |
| `VALID_JOB_STATUSES` | A `Set` containing all valid job status strings. | `Set<string>` |
| `VALID_JOB_LOCATIONS` | A `Set` containing all valid job location strings. | `Set<string>` |

#### Functions

| Export | Purpose | Parameters | Return Value | Errors |
|---|---|---|---|---|
| `normalizeTaskState(state)` | Normalizes a raw task state string to its canonical form, handling common synonyms (`"error"` → `"failed"`, `"succeeded"` → `"done"`). | `state` (any): The raw task state value. | The canonical task state string. Returns `"pending"` if the input is not a string or does not match any known state or synonym. | None thrown. Never returns null — always falls back to `"pending"`. |
| `normalizeJobStatus(status)` | Normalizes a raw job status string to its canonical form, handling common synonyms (`"completed"` → `"complete"`, `"error"` → `"failed"`). | `status` (any): The raw job status value. | The canonical job status string. Returns `"pending"` if the input is not a string or does not match any known status or synonym. | None thrown. Never returns null — always falls back to `"pending"`. |
| `deriveJobStatusFromTasks(tasks)` | Computes the aggregate job status from an array of task objects by applying priority rules to their normalized states. | `tasks` (array of objects): Each object must have a `state` property representing the task's current state. | The derived canonical job status string. | None thrown. Returns `"pending"` if `tasks` is not an array or is empty. |

**Note on `deriveJobStatusFromTasks` priority logic:**
1. If **any** task is `"failed"` → job is `"failed"`.
2. Else if **any** task is `"running"` → job is `"running"`.
3. Else if **all** tasks are `"done"` → job is `"complete"`.
4. Otherwise → job is `"pending"`.

This is a strict priority ordering: failed > running > complete > pending.

---

## 3. Data Models & Structures

### 3.1 Pipeline Paths Object

- **Name:** Pipeline paths result (returned by `resolvePipelinePaths`).
- **Purpose:** Provides the four canonical directory paths for the pipeline data lifecycle.
- **Fields:**

| Field | Type | Meaning |
|---|---|---|
| `pending` | string | Path to directory holding seed files for jobs awaiting pickup: `<baseDir>/pipeline-data/pending`. |
| `current` | string | Path to directory holding active job subdirectories: `<baseDir>/pipeline-data/current`. |
| `complete` | string | Path to directory holding finished job subdirectories: `<baseDir>/pipeline-data/complete`. |
| `rejected` | string | Path to directory holding rejected job subdirectories: `<baseDir>/pipeline-data/rejected`. |

- **Lifecycle:** Created on demand each time `resolvePipelinePaths` is called. Not cached.
- **Ownership:** Caller-owned. The paths module creates and returns a fresh object each time.
- **Serialization:** Not persisted directly, but the path strings it produces correspond to filesystem locations where job data is read and written by other modules.

### 3.2 Model Configuration Entry

- **Name:** Model config entry (values in `MODEL_CONFIG`).
- **Purpose:** Describes one supported LLM model's provider, API identifier, and per-token cost.
- **Fields:**

| Field | Type | Meaning |
|---|---|---|
| `provider` | string | The provider identifier (e.g., `"openai"`, `"anthropic"`, `"deepseek"`, `"gemini"`, `"zhipu"`, `"claudecode"`, `"moonshot"`). Must match the prefix of the model alias key. |
| `model` | string | The exact API model identifier string sent to the provider's API (e.g., `"gpt-5.2"`, `"claude-opus-4-5-20251101"`, `"kimi-k2.5"`). |
| `tokenCostInPerMillion` | number (≥ 0) | Cost in USD per million input tokens. Zero for subscription-based providers (Claude Code). |
| `tokenCostOutPerMillion` | number (≥ 0) | Cost in USD per million output tokens. Zero for subscription-based providers. |

- **Lifecycle:** Created at module load time and frozen. Immutable for the process lifetime.
- **Ownership:** Owned by `models.js`. Consumers read but never mutate.
- **Serialization:** Not directly serialized, but pricing data is used to compute cost estimates that may appear in job metadata and UI displays.

### 3.3 Provider Function Metadata Entry

- **Name:** Provider function entry (elements in `PROVIDER_FUNCTIONS` arrays).
- **Purpose:** Maps a model alias to its dotted dispatch path for use by the LLM invocation layer.
- **Fields:**

| Field | Type | Meaning |
|---|---|---|
| `alias` | string | The canonical model alias (e.g., `"openai:gpt-5.2"`). |
| `provider` | string | The provider identifier. |
| `model` | string | The API model identifier. |
| `functionName` | string | The derived camelCase function name (e.g., `"gpt52"`). |
| `fullPath` | string | The dotted dispatch path (e.g., `"llm.openai.gpt52"`). |

- **Lifecycle:** Computed at module load time and frozen. Immutable.
- **Ownership:** Owned by `models.js`.

### 3.4 Model Alias Format

Model aliases follow the canonical format `"<provider>:<model-name>"`. This is a string convention, not a typed structure, but it is central to the system's identity model:

- The provider prefix is always one of the recognized provider names.
- The model name portion uses hyphens and dots as separators (e.g., `"gpt-5.2"`, `"flash-2.5-lite"`).
- The format is validated at parse time by checking for the presence of a colon character.
- The `aliasToFunctionName` function strips the provider prefix and converts the remainder to camelCase by removing hyphens and dots.

### 3.5 Enumeration Values Summary

| Enumeration | Values | Usage Context |
|---|---|---|
| `TaskState` | `pending`, `running`, `done`, `failed` | Per-task execution tracking. |
| `JobStatus` | `pending`, `running`, `failed`, `complete` | Aggregate job-level status derived from constituent tasks. Note: uses `complete` (not `done`). |
| `JobLocation` | `pending`, `current`, `complete`, `rejected` | Filesystem bucket where a job's data directory resides. |
| `LogEvent` | `start`, `complete`, `error`, `context`, `debug`, `metrics`, `pipeline-start`, `pipeline-complete`, `pipeline-error`, `execution-logs`, `failure-details` | Log entry classification. |
| `LogFileExtension` | `log`, `json` | Determines file extension for log files. |

---

## 4. Behavioral Contracts

### Preconditions

- **Path functions:** `baseDir` must be a string representing a valid filesystem path. `jobId` must be a string. `location` must be one of the four valid location keys (`"pending"`, `"current"`, `"complete"`, `"rejected"`) for `getJobDirectoryPath`; otherwise the path will contain `"undefined"`.
- **Model functions:** `alias` must be a string containing at least one colon character for `aliasToFunctionName`, `getProviderFromAlias`, and `getModelFromAlias`.
- **Normalization functions:** Accept any value type. Non-string inputs produce a safe fallback (`null` for log events/extensions; `"pending"` for task states and job statuses).

### Postconditions

- `resolvePipelinePaths` always returns a fresh object with exactly four string properties.
- Path functions always return a string (never null or undefined), assuming valid string inputs.
- `getModelConfig` returns a configuration object if the alias exists, or `null` otherwise.
- Normalization functions are idempotent: normalizing an already-canonical value returns the same value.
- `deriveJobStatusFromTasks` always returns a valid `JobStatus` value.

### Invariants

- All exported constant objects (`ModelAlias`, `MODEL_CONFIG`, `TaskState`, `JobStatus`, `JobLocation`, `LogEvent`, `LogFileExtension`, etc.) are frozen and immutable for the entire process lifetime.
- The `provider` field in every `MODEL_CONFIG` entry exactly matches the provider prefix of its alias key. This is verified by a module-load-time invariant check that throws if violated.
- All `tokenCostInPerMillion` and `tokenCostOutPerMillion` values are non-negative numbers. This is verified by a module-load-time invariant check.
- `VALID_MODEL_ALIASES` is an exact mirror of `MODEL_CONFIG`'s key set. This is verified by a module-load-time invariant check.
- `FUNCTION_NAME_BY_ALIAS` has an entry for every key in `MODEL_CONFIG` and no extras.

### Ordering Guarantees

- `deriveJobStatusFromTasks` applies a strict priority order: `failed` > `running` > `complete` > `pending`. This is a deterministic, order-independent evaluation — the position of tasks in the array does not matter.

### Concurrency Behavior

- All exports are either frozen objects or pure functions with no side effects. They are inherently safe for concurrent access from multiple call sites.

---

## 5. State Management

### In-Memory State

All state is **computed once at module load time** and then frozen:

- `MODEL_CONFIG`, `ModelAlias`, `VALID_MODEL_ALIASES`, `DEFAULT_MODEL_BY_PROVIDER`, `FUNCTION_NAME_BY_ALIAS`, and `PROVIDER_FUNCTIONS` are computed during the initial evaluation of `models.js` and frozen immediately.
- `LogEvent`, `LogFileExtension`, `VALID_LOG_EVENTS`, and `VALID_LOG_FILE_EXTENSIONS` are computed during evaluation of `log-events.js` and frozen.
- `TaskState`, `JobStatus`, `JobLocation`, and the corresponding validation sets are computed during evaluation of `statuses.js` and frozen.
- The invariant checks in `models.js` execute during module load and will throw (halting the process) if any inconsistency is detected.

There is **no mutable state** in any of the four source files. No caches, queues, counters, or singletons exist.

### Persisted State

None. This module does not read from or write to the filesystem, database, or any external store.

### Shared State

The frozen objects are shared across all importing modules. Since they are immutable, there are no consistency concerns.

### Crash Recovery

Not applicable — there is no state to lose or recover.

---

## 6. Dependencies

### 6.1 Internal Dependencies

None. The config module files do not import from any other module within the prompt orchestration pipeline. This is by design — as a foundational constants module, it sits at the bottom of the dependency graph and is imported by many other modules but depends on none.

### 6.2 External Dependencies

| Package | Used By | What It Provides | Replaceability |
|---|---|---|---|
| `path` (Node.js built-in / Bun equivalent) | `paths.js` | `path.join` for platform-aware filesystem path construction. | Tightly coupled to path joining semantics. Any runtime providing a compatible `path.join` would work. |

### 6.3 System-Level Dependencies

- **File system layout:** `paths.js` encodes the convention that pipeline data lives under `<baseDir>/pipeline-data/` with subdirectories `pending/`, `current/`, `complete/`, and `rejected/`. This layout must be honored by all modules that read/write job data.
- **Pending file naming convention:** Pending seed files use the flat format `<jobId>-seed.json`, while current/complete seed files use the nested format `<jobId>/seed.json`.
- **Job metadata convention:** Job metadata is stored as `job.json` and pipeline snapshots as `pipeline.json` within each job's subdirectory.
- No environment variables, network services, or OS-level features are required.

---

## 7. Side Effects & I/O

### Module Load-Time Side Effects

`models.js` executes invariant validation checks at module load time:

1. **Provider-alias consistency check:** Iterates over every entry in `MODEL_CONFIG` and verifies that the provider field matches the alias prefix. Throws an `Error` if any mismatch is found.
2. **Token cost validation:** Verifies that `tokenCostInPerMillion` and `tokenCostOutPerMillion` are non-negative numbers for every model. Throws an `Error` on violation.
3. **Alias set consistency check:** Verifies that `VALID_MODEL_ALIASES` is an exact match of `MODEL_CONFIG` keys. Throws an `Error` on mismatch.

These checks are synchronous and execute once during the first import of the module. If any check fails, the process will crash with an unhandled error during startup, preventing the system from running with inconsistent model configuration.

### Runtime Side Effects

None. All exported functions are pure — they compute and return values without modifying any external state, performing I/O, or producing observable side effects.

---

## 8. Error Handling & Failure Modes

### Error Categories

| Source | Error Type | Trigger | Handling |
|---|---|---|---|
| `aliasToFunctionName` | Validation error | Alias is not a string or lacks a colon. | Throws `Error` with descriptive message. |
| `getProviderFromAlias` | Validation error | Alias is not a string or lacks a colon. | Throws `Error` with descriptive message. |
| `getModelFromAlias` | Validation error | Alias is not a string or lacks a colon. | Throws `Error` with descriptive message. |
| Module-load invariant checks | Configuration integrity error | `MODEL_CONFIG` entry has mismatched provider, invalid cost, or `VALID_MODEL_ALIASES` diverges from `MODEL_CONFIG`. | Throws `Error`, crashing the process at startup. |

### Propagation Strategy

- Functions that validate alias format use **throw** to report invalid input.
- Normalization functions use **silent fallback** — they never throw, instead returning a default canonical value (`"pending"`) or `null`.
- Module-load invariant violations use **fail-fast** — they throw immediately, preventing the application from starting with corrupt configuration.

### Recovery Behavior

- There is no retry logic. The module is deterministic — the same inputs always produce the same outputs.
- Invariant failures require fixing the source code (correcting the `MODEL_CONFIG` data) and restarting.

### Partial Failure

Not applicable — all operations are atomic single-value computations.

### User/Operator Visibility

- Invariant check failures produce descriptive error messages identifying the exact alias and field that violated the constraint (e.g., `Model config invariant violation: alias "openai:gpt-5" has provider "deepseek" but alias prefix indicates "openai"`).
- Function-level validation errors produce messages like `Invalid model alias: <value>`.

---

## 9. Integration Points & Data Flow

### Upstream (Who Uses This Module)

The config module is a **foundational dependency** consumed by nearly every other subsystem:

- **Core subsystem** (`orchestrator`, `pipeline-runner`, `task-runner`, `file-io`, `status-writer`): Uses `TaskState`, `JobStatus`, `JobLocation` for status tracking; uses path functions for locating job data on disk.
- **Providers** (`providers/base.js`, provider implementations): Uses `MODEL_CONFIG`, `ModelAlias`, `getModelConfig`, `getProviderFromAlias` to look up model metadata and pricing.
- **LLM dispatch** (`llm/index.js`): Uses `PROVIDER_FUNCTIONS` and `FUNCTION_NAME_BY_ALIAS` to dynamically build the dispatch table mapping dotted paths to provider call functions.
- **UI subsystem** (server, state, client adapters): Uses `JobStatus`, `JobLocation`, `TaskState` for status display and filtering; uses path functions for reading job data.
- **CLI**: Uses `VALID_MODEL_ALIASES` and `DEFAULT_MODEL_BY_PROVIDER` for command-line argument validation and defaults.
- **Task analysis**: Uses `LogEvent` for classifying extracted log entries.
- **Utils** (cost calculator): Uses `MODEL_CONFIG` pricing fields for computing execution costs.

### Downstream (What This Module Calls)

Nothing. The config module calls no other application modules. It only uses the `path` built-in.

### Data Transformation

- **Model alias → provider name:** `getProviderFromAlias` splits on the first colon.
- **Model alias → model name:** `getModelFromAlias` takes everything after the first colon.
- **Model alias → function name:** `aliasToFunctionName` strips provider prefix, then removes hyphens and dots while uppercasing subsequent characters (e.g., `"openai:gpt-5.2"` → `"gpt52"`, `"gemini:flash-2.5-lite"` → `"flash25Lite"`).
- **Model alias → full dispatch path:** `buildProviderFunctionsIndex` combines provider and function name into `"llm.<provider>.<functionName>"`.
- **Raw status strings → canonical strings:** Normalization functions lowercase, trim, apply synonym mappings, and validate against known enumerations.
- **Task states → job status:** `deriveJobStatusFromTasks` aggregates an array of per-task states into a single job-level status via priority rules.

### Control Flow

The module has no control flow in the traditional sense. It is a pure data definition with some derived computations. The only conditional logic exists in:

1. Normalization switch statements (synonym mapping).
2. `deriveJobStatusFromTasks` priority evaluation (sequential `some`/`every` checks).
3. Module-load invariant checks (validation loop with early-throw).

---

## 10. Edge Cases & Implicit Behavior

### Default Values That Shape Behavior

- `getJobMetadataPath` and `getJobPipelinePath` default `location` to `"current"` when not provided. Callers requesting metadata for completed or pending jobs must explicitly pass the location.
- `normalizeTaskState` and `normalizeJobStatus` default to `"pending"` for any unrecognized or non-string input. This means **garbage in produces `"pending"` out**, not an error. This is a deliberate design choice for resilience but could mask data corruption.
- `normalizeLogEvent` and `normalizeLogFileExtension` return `null` for unrecognized input rather than a default value, which is inconsistent with the status normalization behavior.

### Implicit Assumptions

- The `path.join` behavior is assumed to be platform-aware (using OS-appropriate separators). Since the system runs on both macOS and Linux, this is generally safe, but Windows path semantics would differ.
- The `aliasToFunctionName` regex `[-.]([a-z0-9])/gi` processes both lowercase and uppercase characters after hyphens/dots. If a model name contained consecutive separator characters (e.g., `"gpt--5"`), the first separator would remain as a literal hyphen in the output (since it's not followed by an alphanumeric character), while the second separator would be consumed along with the following character.

### Synonym Handling

- `normalizeTaskState` treats `"error"` as a synonym for `"failed"` and `"succeeded"` as a synonym for `"done"`. These are the only two synonyms. No other alternative spellings are handled (e.g., `"success"`, `"complete"`, `"errored"` would all fall through to the default `"pending"`).
- `normalizeJobStatus` treats `"completed"` as a synonym for `"complete"` and `"error"` as a synonym for `"failed"`. Note that `"done"` is **not** a synonym for `"complete"` at the job level, despite `"done"` being the terminal success state at the task level.

### Asymmetry Between TaskState and JobStatus Terminal States

- Task success state: `"done"`.
- Job success status: `"complete"`.
- These are deliberately different strings. `deriveJobStatusFromTasks` translates from one domain to the other: when all tasks are `"done"`, the job is `"complete"`.

### Pending Path Naming Asymmetry

- Pending directory: flat file naming (`<jobId>-seed.json`).
- Current/complete/rejected directories: nested subdirectory naming (`<jobId>/seed.json`).
- This asymmetry means `getJobDirectoryPath(baseDir, jobId, "pending")` produces a path that may or may not be meaningful — in the pending state, there is no per-job subdirectory, only a flat seed file. Callers working with pending jobs should use `getPendingSeedPath` instead.

### Claude Code Provider Pricing

- Claude Code entries have `tokenCostInPerMillion: 0` and `tokenCostOutPerMillion: 0`. This is because Claude Code access is subscription-based via the CLI, so individual API call costs are zero from the pipeline's perspective. Cost calculators should handle this correctly (producing $0.00 cost estimates).

### Legacy/Backward Compatibility

- `ModelAlias` includes legacy entries (`OPENAI_GPT_4_1`, `OPENAI_GPT_4`) explicitly marked in comments as being for backward compatibility, primarily for tests. These still have full `MODEL_CONFIG` entries and are validated like any other model.

---

## 11. Open Questions & Ambiguities

1. **No `"rejected"` location in path helper functions:** `getJobDirectoryPath` technically supports any location key, including `"rejected"`, but there are no dedicated helper functions for rejected job paths (no `getRejectedSeedPath`, etc.). It is unclear whether rejected jobs follow the same nested directory structure as current/complete jobs.

2. **No cache hit pricing:** `MODEL_CONFIG` includes only cache-miss token pricing. Some providers (notably DeepSeek, Gemini, and Moonshot) offer significant discounts for cached input tokens. The config module does not model this, which may lead to cost overestimation. The comment on DeepSeek's entry mentions "cache miss price" but there is no corresponding cache-hit field.

3. **Gemini tiered pricing:** The comment on `GEMINI_2_5_PRO` and `GEMINI_3_PRO` mentions that input pricing changes for contexts above 200K tokens (2x for Gemini 2.5 Pro). The config only stores a single input price. Modules computing costs for large-context Gemini calls may underestimate.

4. **Provider name `"zhipu"` vs brand name "Z.ai":** The constants use `"zhipu"` as the provider identifier despite the company rebranding to "Z.ai". Comments reference both names. It is unclear whether `"zhipu"` will be kept or renamed in a future update.

5. **Estimated pricing:** The `OPENAI_GPT_5_2_PRO` entry comment says "Estimated based on prior Pro pricing" for its costs. It is unclear whether these estimates have been confirmed against actual API pricing.

6. **`getJobDirectoryPath` with invalid location:** If `location` is not one of the four valid keys, `paths[location]` evaluates to `undefined`, and `path.join` will include the literal string `"undefined"` in the resulting path. No validation or error is raised.

7. **Normalization inconsistency:** Status normalization functions (`normalizeTaskState`, `normalizeJobStatus`) return a default value for invalid input, while log event normalization functions (`normalizeLogEvent`, `normalizeLogFileExtension`) return `null`. This inconsistency may confuse callers about whether null-checking is needed.

8. **No `"rejected"` in `JobStatus` or `TaskState`:** The `JobLocation` enum includes `"rejected"`, but there is no corresponding `JobStatus.REJECTED`. It is unclear what job status a rejected job would have — presumably `"failed"`, but this is not explicitly encoded.
