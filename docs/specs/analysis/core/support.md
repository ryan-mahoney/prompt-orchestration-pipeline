# Module Specification: core/support

**Source files:**
- `src/core/config.js`
- `src/core/environment.js`
- `src/core/logger.js`
- `src/core/module-loader.js`
- `src/core/validation.js`
- `src/core/retry.js`

---

## 1. Purpose & Responsibilities

This module is a collection of six foundational support services that the rest of the system depends on. Each file addresses a distinct cross-cutting concern:

| File | Role |
|---|---|
| `config.js` | Centralized configuration management — loads, merges, validates, and caches the system's runtime configuration from defaults, config files, environment variables, and the pipeline registry. |
| `environment.js` | Environment bootstrapping — loads `.env` files into the process, validates that at least one LLM API key is present, and exposes a structured map of provider credentials. |
| `logger.js` | Structured logging factory — produces context-aware logger instances that prefix messages with component name and optional job/task context, and optionally broadcast log events over SSE. |
| `module-loader.js` | Cache-busting dynamic module loader — imports ES modules at runtime while defeating the module cache, with a multi-stage fallback strategy to handle runtimes where query-string cache busting breaks file resolution. |
| `validation.js` | Schema-based validation — validates seed files and pipeline definition objects against JSON schemas using AJV, producing structured error results or throwing descriptive errors. |
| `retry.js` | Retry with exponential backoff — wraps async functions in configurable retry logic with exponential backoff, maximum delay cap, and pluggable retry/filter callbacks. |

**Responsibilities:**
- **config.js** owns the full lifecycle of system configuration: defining defaults, layering overrides, resolving pipeline registry entries to absolute paths, validating the assembled configuration, and providing synchronous and asynchronous access to the result.
- **environment.js** owns the loading of dotenv files and the extraction of provider-specific API credentials from environment variables.
- **logger.js** owns the creation of formatted, context-tagged log output and the optional side-channel broadcast of log events via SSE.
- **module-loader.js** owns the reliable dynamic import of ES modules from file-system paths, including cache-busting strategies.
- **validation.js** owns structural validation of seed objects and pipeline definition objects against their respective JSON schemas.
- **retry.js** owns the generic retry-with-backoff pattern, decoupled from any specific caller.

**Boundaries:**
- `config.js` does NOT parse or interpret the contents of `pipeline.json` files; it only verifies they exist on disk.
- `environment.js` does NOT validate that API keys are functional — only that they are present.
- `logger.js` does NOT control log level filtering based on configuration; debug output is gated by `NODE_ENV` and a `DEBUG` environment variable, not by `config.logging.level`.
- `module-loader.js` does NOT manage module registries or plugin discovery — it loads a single module from a known path.
- `validation.js` does NOT load files from disk — callers must parse JSON before calling validators.
- `retry.js` does NOT know anything about LLM providers or network errors — the caller supplies a `shouldRetry` predicate.

**Patterns:**
- `config.js` acts as a **Singleton Cache** — it lazily initializes on first access and returns the cached instance thereafter.
- `logger.js` is a **Factory** — it produces logger instances parameterized by component name and context.
- `retry.js` is a **Higher-Order Function / Decorator** — it wraps an arbitrary async function with retry behavior.
- `module-loader.js` is an **Adapter** — it adapts the native dynamic `import()` mechanism to handle cache-busting and file-system edge cases.

---

## 2. Public Interface

### config.js

| Export | Kind | Purpose |
|---|---|---|
| `defaultConfig` | Named constant (object) | The full default configuration tree. Serves as the base layer before any overrides. |
| `loadConfig(options?)` | Named async function | Initializes configuration by merging defaults, an optional config file, and environment variables; hydrates the pipeline registry; validates the result; caches it. |
| `getConfig()` | Named sync function | Returns the cached configuration, initializing it synchronously from defaults and environment if not yet loaded. |
| `resetConfig()` | Named sync function | Clears the cached configuration (sets it to `null`). Intended for testing. |
| `getConfigValue(path, defaultValue?)` | Named sync function | Retrieves a single value from the configuration by dot-separated path. |
| `getPipelineConfig(slug)` | Named sync function | Returns `{ pipelineJsonPath, tasksDir }` for a given pipeline slug. |

**`loadConfig(options?)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `options` | Object | Yes | Container for load-time options. |
| `options.configPath` | String (file path) | Yes | Path to a JSON configuration file to layer between defaults and environment variables. |
| `options.validate` | Boolean | Yes (default `true`) | Whether to run configuration validation after assembly. |

- **Returns:** Promise resolving to the fully assembled configuration object.
- **Throws:**
  - `Error("PO_ROOT is required")` if `paths.root` is not set after merging.
  - `Error("No pipelines are registered…")` if no pipelines exist after registry hydration.
  - `Error("…does not exist")` if a pipeline's `configDir`, `tasksDir`, or `pipeline.json` file is missing on disk.
  - `Error("Configuration validation failed…")` if numeric/enum constraints fail.
  - `Error("Failed to load config file…")` if the config file exists but cannot be parsed.
  - `Error("Failed to read pipeline registry…")` if the registry file exists but cannot be parsed.

**`getConfig()`**

- **Parameters:** None.
- **Returns:** The current configuration object.
- **Throws:**
  - `Error("PO_ROOT is required")` if `paths.root` is unset.
  - `Error("No pipelines are registered…")` if no pipelines and not in test environment.
- **Side effects:** On first call, reads the pipeline registry file synchronously and mutates the module-level `currentConfig` cache.

**`getConfigValue(path, defaultValue?)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `path` | String | No | Dot-separated key path (e.g., `"orchestrator.shutdownTimeout"`). |
| `defaultValue` | Any | Yes (default `undefined`) | Value returned if the path does not resolve. |

- **Returns:** The value at the given path, or `defaultValue`.

**`getPipelineConfig(slug)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `slug` | String | No | The pipeline identifier as registered in the registry. |

- **Returns:** `{ pipelineJsonPath: string, tasksDir: string }`.
- **Throws:** `Error("Pipeline <slug> not found in registry")` if the slug is not present.

---

### environment.js

| Export | Kind | Purpose |
|---|---|---|
| `loadEnvironment(options?)` | Named async function | Loads `.env` files from disk, validates API key presence, and returns structured provider credentials. |
| `validateEnvironment()` | Named sync function | Checks whether any of the known LLM API keys exist in the process environment. |
| `getEnvironmentConfig()` | Named sync function | Returns a structured object mapping provider names to their credential/endpoint values from environment variables. |

**`loadEnvironment(options?)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `options` | Object | Yes | Container. |
| `options.rootDir` | String | Yes (default `process.cwd()`) | Base directory from which to resolve `.env` file paths. |
| `options.envFiles` | Array of strings | Yes (default `[".env", ".env.local"]`) | List of dotenv files to attempt loading, in order. |

- **Returns:** `{ loaded: string[], warnings: string[], config: object }` where `loaded` lists the filenames that were found and applied, `warnings` contains any advisory messages, and `config` is the output of `getEnvironmentConfig()`.
- **Failure modes:** None thrown — missing `.env` files are silently skipped.

**`validateEnvironment()`**

- **Returns:** Array of warning strings. Contains `"No LLM API keys found in environment."` if none of the four known API key variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`) are set.

**`getEnvironmentConfig()`**

- **Returns:** An object with keys `openai`, `anthropic`, `deepseek`, `gemini`, each containing their respective credential and endpoint fields sourced from environment variables. Fields are `undefined` if the corresponding variable is not set.

---

### logger.js

| Export | Kind | Purpose |
|---|---|---|
| `createLogger(componentName, context?)` | Named sync function | Factory that produces a logger instance tagged with a component name and optional context (jobId, taskName, stage). |
| `createJobLogger(componentName, jobId, additionalContext?)` | Named sync function | Convenience wrapper that calls `createLogger` with `{ jobId, ...additionalContext }`. |
| `createTaskLogger(componentName, jobId, taskName, additionalContext?)` | Named sync function | Convenience wrapper that calls `createLogger` with `{ jobId, taskName, ...additionalContext }`. |

**`createLogger(componentName, context?)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `componentName` | String | No | Human-readable component identifier (e.g., `"Orchestrator"`, `"TaskRunner"`). |
| `context` | Object | Yes (default `{}`) | Contextual identifiers: `jobId`, `taskName`, `stage` are recognized and included in the log prefix. |

- **Returns:** A logger object with methods: `debug`, `log`, `warn`, `error`, `group`, `groupEnd`, `sse`.

**Logger instance methods:**

| Method | Parameters | Behavior |
|---|---|---|
| `debug(message, data?)` | message: string, data: any | Logs at debug level. Only outputs when `NODE_ENV !== "production"` or `DEBUG` env var is set. |
| `log(message, data?)` | message: string, data: any | Logs at info level via `console.log`. |
| `warn(message, data?)` | message: string, data: any | Logs at warn level via `console.warn`. |
| `error(message, data?)` | message: string, data: any | Logs at error level via `console.error`. If `data` is an Error instance, it enriches the output with `name`, `message`, `stack`, component name, timestamp, and context. Also handles the case where `data.error` is an Error. |
| `group(label, data?)` | label: string, data: any | Opens a console group with the prefixed label; optionally logs data inside. |
| `groupEnd()` | (none) | Closes the current console group. |
| `sse(eventType, eventData)` | eventType: string, eventData: any | Logs the SSE broadcast to console and asynchronously broadcasts the event via the SSE registry (if available). |

---

### module-loader.js

| Export | Kind | Purpose |
|---|---|---|
| `loadFreshModule(modulePath)` | Named async function | Dynamically imports an ES module from a file-system path, defeating the module cache via a multi-stage fallback. |

**`loadFreshModule(modulePath)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `modulePath` | String or URL | No | Absolute file-system path, `file://` URL string, or URL object pointing to the module to load. Relative paths are rejected. |

- **Returns:** Promise resolving to the module's namespace object (i.e., the result of `import()`).
- **Throws:**
  - `TypeError("Module path must be a string or URL…")` if the argument is not a string or URL.
  - `Error("Module path must be absolute…")` if a string path is not absolute.
  - `Error("Module not found at…")` if the file does not exist on disk.
  - A combined error with details of all three failed attempts if every fallback fails.

---

### validation.js

| Export | Kind | Purpose |
|---|---|---|
| `validateSeed(seed)` | Named sync function | Validates a seed object against the seed JSON schema. |
| `formatValidationErrors(errors)` | Named sync function | Formats an array of validation error objects into a human-readable string. |
| `validateSeedOrThrow(seed)` | Named sync function | Validates a seed and throws if invalid. |
| `validatePipeline(pipeline)` | Named sync function | Validates a pipeline definition object against the pipeline JSON schema. |
| `formatPipelineValidationErrors(errors)` | Named sync function | Formats pipeline validation errors into a human-readable string. |
| `validatePipelineOrThrow(pipeline, pathHint?)` | Named sync function | Validates a pipeline and throws if invalid. |

**`validateSeed(seed)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `seed` | Object | No | The seed data to validate. |

- **Returns:** `{ valid: true }` or `{ valid: false, errors: Array<{ message, path, params?, keyword? }> }`.

**`validatePipeline(pipeline)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `pipeline` | Object | No | The pipeline definition to validate. |

- **Returns:** Same shape as `validateSeed`.

**`validatePipelineOrThrow(pipeline, pathHint?)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `pipeline` | Object | No | The pipeline definition to validate. |
| `pathHint` | String | Yes (default `"pipeline.json"`) | File path included in the error message for context. |

- **Throws:** `Error` with a header and formatted body if validation fails.

---

### retry.js

| Export | Kind | Purpose |
|---|---|---|
| `withRetry(fn, options?)` | Named async function | Executes an async function with retry logic and exponential backoff. |
| `createRetryWrapper(defaultOptions?)` | Named sync function | Returns a pre-configured `withRetry` function with baked-in default options. |

**`withRetry(fn, options?)`**

| Parameter | Shape | Optional | Semantics |
|---|---|---|---|
| `fn` | Async function (no arguments) | No | The operation to attempt. |
| `options.maxAttempts` | Number | Yes (default `3`) | Total number of attempts before giving up. |
| `options.initialDelay` | Number (ms) | Yes (default `1000`) | Delay before the first retry. |
| `options.maxDelay` | Number (ms) | Yes (default `10000`) | Upper bound on computed delay. |
| `options.backoffMultiplier` | Number | Yes (default `2`) | Factor by which delay increases each attempt. |
| `options.onRetry` | Function | Yes (default no-op) | Called before each retry with `{ attempt, delay, error, maxAttempts }`. |
| `options.shouldRetry` | Function | Yes (default `() => true`) | Predicate receiving the caught error; if it returns `false`, the error is immediately rethrown without further retries. |

- **Returns:** Promise resolving to the return value of `fn()` on the first successful attempt.
- **Throws:** The last caught error after all attempts are exhausted, or immediately if `shouldRetry` returns `false`.

**`createRetryWrapper(defaultOptions?)`**

- **Returns:** A function `(fn, options?) => Promise<any>` that calls `withRetry` with the default options merged under any per-call overrides.

---

## 3. Data Models & Structures

### Configuration Object (config.js)

The central configuration is a nested plain object with the following top-level sections:

| Section | Fields | Semantics |
|---|---|---|
| `orchestrator` | `shutdownTimeout` (ms), `processSpawnRetries` (count), `processSpawnRetryDelay` (ms), `lockFileTimeout` (ms), `watchDebounce` (ms), `watchStabilityThreshold` (ms), `watchPollInterval` (ms) | Tuning knobs for the orchestrator process. |
| `taskRunner` | `maxRefinementAttempts` (count), `stageTimeout` (ms), `llmRequestTimeout` (ms) | Limits and timeouts for task execution. |
| `llm` | `defaultProvider` (enum string), `defaultModel` (string), `maxConcurrency` (count), `retryMaxAttempts` (count), `retryBackoffMs` (ms) | LLM provider selection and request parameters. |
| `ui` | `port` (1–65535), `host` (string), `heartbeatInterval` (ms), `maxRecentChanges` (count) | UI server parameters. |
| `paths` | `root` (absolute path, required), `dataDir` (relative or absolute), `pendingDir`, `currentDir`, `completeDir` (relative directory names) | File-system layout. |
| `pipelines` | `{ [slug]: { configDir, tasksDir, name?, description? } }` | Resolved pipeline registry. Each entry's `configDir` and `tasksDir` are absolute paths after loading. |
| `validation` | `seedNameMinLength`, `seedNameMaxLength` (numbers), `seedNamePattern` (regex string) | Rules governing seed name validation. |
| `logging` | `level` (enum: debug/info/warn/error), `format` (enum: json), `destination` (enum: stdout) | Logging configuration. |

**Lifecycle:** Created by `loadConfig` (async, full validation) or lazily by `getConfig` (sync, minimal validation). Cached in the module-level `currentConfig` variable. Cleared by `resetConfig`.

**Ownership:** Owned by `config.js`. Other modules read it; none modify it after initialization.

**Serialization:** The configuration originates from JSON (both `defaultConfig` literal and optional config file). The default config is deep-cloned via `JSON.parse(JSON.stringify(...))` to prevent mutation of the template.

### Pipeline Registry (registry.json)

Read from `<PO_ROOT>/pipeline-config/registry.json`.

```
{
  "pipelines": {
    "<slug>": {
      "pipelineJsonPath"?: string,   // path to pipeline.json (or legacy "pipelinePath")
      "configDir"?: string,          // directory containing pipeline config
      "tasksDir"?: string,           // directory containing task definitions
      "name"?: string,               // human-readable name
      "description"?: string         // human-readable description
    }
  }
}
```

**Normalization:** All paths are resolved relative to `PO_ROOT`. If `configDir` is omitted, it defaults to the directory containing `pipelineJsonPath`, or `<PO_ROOT>/pipeline-config/<slug>`. If `tasksDir` is omitted, it defaults to `<configDir>/tasks`.

**Legacy:** An older format using `slugs` instead of `pipelines` is detected and warned about but not migrated.

### Environment Config (environment.js)

```
{
  openai:    { apiKey?, organization?, baseURL? },
  anthropic: { apiKey?, baseURL? },
  deepseek:  { apiKey? },
  gemini:    { apiKey?, baseURL? }
}
```

All fields are strings or `undefined`. This structure does not cross module boundaries in persistent form — it is returned to the caller of `loadEnvironment` and consumed in-process.

### Seed Schema (validation.js)

The seed object must conform to:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | String | Yes | Length between `seedNameMinLength` and `seedNameMaxLength`; matches `seedNamePattern` (alphanumeric, hyphens, underscores). |
| `data` | Object | Yes | Arbitrary payload. |
| `pipeline` | String | Yes | Must be one of the currently registered pipeline slugs. |
| `metadata` | Object | No | Arbitrary metadata. |
| `context` | Object | No | Optional execution context with known keys: `framing` (string), `emphases` (string[]), `de_emphases` (string[]), `culturalMarkers` (string[]), `practitionerBias` (string). No additional properties allowed. |

### Pipeline Schema (validation.js)

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | String | Yes | — |
| `tasks` | Array of strings | Yes | At least one element. Each element must be a string. |
| `taskConfig` | Object of objects | No | Keys are task names; values are arbitrary objects. |

Additional properties are allowed on the pipeline object.

### Validation Result

Both `validateSeed` and `validatePipeline` return:

```
{ valid: true }
// or
{ valid: false, errors: [{ message: string, path: string, params?: object, keyword?: string }] }
```

---

## 4. Behavioral Contracts

### config.js

- **Precondition:** `PO_ROOT` must be set (either via environment variable or config file) before `loadConfig` or `getConfig` is called. Violation throws.
- **Precondition:** The pipeline registry file must parse as valid JSON with a `pipelines` object, and at least one pipeline must be registered (unless in test environment for `getConfig`).
- **Postcondition:** After `loadConfig` succeeds, every pipeline's `configDir`, `tasksDir`, and `pipeline.json` are confirmed to exist on disk.
- **Postcondition:** After `loadConfig` or `getConfig`, the returned config object has all default fields present (environment variables only override, never remove).
- **Invariant:** The configuration priority order is: environment variables > config file > defaults.
- **Invariant:** `currentConfig` is either `null` (uninitialized) or a fully assembled configuration object. There is no partial state.
- **Idempotency:** Calling `getConfig` multiple times returns the same cached object.
- **Concurrency:** No synchronization. If `loadConfig` is called concurrently, the last write to `currentConfig` wins. This is not explicitly addressed in the code.

### environment.js

- **Precondition:** None — gracefully handles missing files and missing variables.
- **Postcondition:** After `loadEnvironment`, all found `.env` files have been loaded into `process.env` with override semantics (later files override earlier ones).
- **Ordering:** `.env` files are processed in the order given by the `envFiles` array.

### logger.js

- **Postcondition:** Every log message emitted by a logger instance is prefixed with `[ComponentName|context...]`.
- **Invariant:** SSE broadcast failures never cause logging to fail — they are caught and warned about.

### module-loader.js

- **Precondition:** `modulePath` must be an absolute path, a `file://` URL string, or a URL object.
- **Postcondition:** On success, the returned object is the ES module namespace of the imported module.
- **Ordering of fallbacks:** (1) Direct import → (2) Cache-busted import with `?t=<timestamp>` query param → (3) Copy the file to an adjacent location with a unique name and import the copy.
- **Invariant:** Temporary adjacent copies are created but never cleaned up by this module. (See Edge Cases.)

### validation.js

- **Precondition:** Input must be a parsed object, not a raw string.
- **Postcondition:** If `valid` is `true`, the input conforms to the declared schema.
- **Invariant:** The seed schema's `pipeline` enum is dynamically computed from the current configuration's registered pipelines at validation time. This means seed validation results can differ depending on when `getConfig` was initialized and what pipelines are registered.

### retry.js

- **Precondition:** `fn` must be a callable (async function).
- **Postcondition:** If `fn` succeeds on any attempt, its return value is returned.
- **Postcondition:** If all attempts fail, the **last** error is thrown.
- **Invariant:** `shouldRetry(error)` returning `false` causes immediate rethrow without consuming further attempts.
- **Ordering:** Delays increase exponentially: `initialDelay * backoffMultiplier^(attempt-1)`, capped at `maxDelay`.
- **Timing:** `onRetry` is called *before* the delay sleep on each retry.

---

## 5. State Management

### In-Memory State

| Module | State | Lifecycle |
|---|---|---|
| `config.js` | `currentConfig` (module-level variable) | Created on first call to `loadConfig` or `getConfig`. Persists for the lifetime of the process. Cleared by `resetConfig()`. |
| `logger.js` | `sseRegistry` (module-level variable) | Lazily populated on first call to `getSSERegistry()` by dynamically importing `../ui/sse.js`. Persists for process lifetime. |
| `validation.js` | `ajv` (module-level AJV instance) | Created at module load time. Persists for process lifetime. AJV compiles schemas on each `validateSeed`/`validatePipeline` call (not cached between calls). |

### Persisted State

None of these modules write to disk (with the exception of `module-loader.js` creating temporary file copies).

### Shared State

- `config.js`'s `currentConfig` is shared across all callers via `getConfig()`. Since it is a plain object reference, any caller could theoretically mutate it in place, but no mutation protocol exists. This is a potential fragility.
- `environment.js` mutates `process.env` as a side effect of calling `dotenv.config()`. This affects all modules in the process.

### Crash Recovery

- If the process crashes after `loadConfig` but before work begins, no persistent state needs recovery — configuration is re-loaded from disk on next start.
- `module-loader.js` leaves behind `.cache.<basename>.<unique>.<ext>` files in the source module's directory if the adjacent-copy fallback is used. These are orphaned on crash.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | Depends On | What Is Used | Nature |
|---|---|---|---|
| `config.js` | (none) | — | Self-contained. |
| `environment.js` | (none) | — | Self-contained. |
| `logger.js` | `../ui/sse.js` | `sseRegistry` object for broadcasting | Lazy dynamic import. Fails gracefully if unavailable. Loosely coupled. |
| `validation.js` | `./config.js` | `getConfig()` to read current pipeline slugs and validation rules | Hard import. Tightly coupled to config shape. |
| `retry.js` | (none) | — | Self-contained. |
| `module-loader.js` | (none) | — | Self-contained. |

### 6.2 External Dependencies

| Package | Used By | What It Provides | Replaceability |
|---|---|---|---|
| `dotenv` | `environment.js` | `.env` file loading into `process.env` | Localized — only used in `loadEnvironment`. Easily replaceable. |
| `ajv` | `validation.js` | JSON Schema validation engine | Core to validation logic. Replacement would require a different schema validator. |
| `ajv-formats` | `validation.js` | Format validation extensions for AJV (e.g., email, URI) | Companion to AJV. |

### 6.3 System-Level Dependencies

- **`process.env`**: `config.js` reads `PO_*` variables; `environment.js` reads and writes `process.env`; `logger.js` reads `NODE_ENV` and `DEBUG`.
- **File system**: `config.js` reads `registry.json` and verifies existence of pipeline directories and `pipeline.json` files. `module-loader.js` reads, copies, and imports files. `environment.js` checks `.env` file existence.
- **ES module system**: `module-loader.js` relies on the runtime's dynamic `import()` behavior, including how it handles `file://` URLs with query strings.
- **`PO_ROOT` environment variable**: Required for `config.js` to function. Must point to the repository root directory.

---

## 7. Side Effects & I/O

### File System

| Module | Operation | Details |
|---|---|---|
| `config.js` | Read | Reads optional config file (async), reads `registry.json` (async and sync variants), checks existence of pipeline directories and `pipeline.json` via `fs.access` / `existsSync`. |
| `environment.js` | Read | Checks existence of `.env` files via `existsSync`; dotenv reads file contents. |
| `module-loader.js` | Read + Write | Reads module files via `import()`. Creates temporary copies via `fs.copyFile` as a fallback. Checks file existence via `fs.access`. |

### Network

None identified across any of the six files.

### Process Management

None identified.

### Logging & Observability

| Module | Details |
|---|---|
| `config.js` | Emits `console.warn` for legacy registry format detection. |
| `logger.js` | All output goes through `console.debug`, `console.log`, `console.warn`, `console.error`, `console.group`, `console.groupEnd`. Debug output uses CSS styling for SSE broadcast messages (`%c` formatting). |

### Timing & Scheduling

| Module | Details |
|---|---|
| `retry.js` | Uses `setTimeout` (via a `sleep` helper) to implement backoff delays between retry attempts. Delays are computed as `min(initialDelay * backoffMultiplier^(attempt-1), maxDelay)`. |
| `module-loader.js` | Uses `Date.now()` for cache-busting timestamps and unique file suffixes. No actual scheduling. |

---

## 8. Error Handling & Failure Modes

### config.js

| Failure | Strategy |
|---|---|
| `PO_ROOT` not set | Fail-fast: throws `Error("PO_ROOT is required")`. |
| Config file missing | Graceful: returns `null` from `loadFromFile`, loading proceeds without file overrides. |
| Config file malformed | Fail-fast: throws with the parse error message. |
| Registry file missing | Graceful: `hydratePipelinesFromRegistry` returns without modifying config. |
| Registry file malformed | Fail-fast: throws with details. |
| Legacy registry format | Warn-and-continue: logs a console warning and falls back to default pipelines. |
| No pipelines registered | Fail-fast in production; in test environment (`NODE_ENV === "test"`), `getConfig` skips this check. |
| Pipeline directory or `pipeline.json` missing | Fail-fast: throws after checking each pipeline's paths. |
| Validation failures | Fail-fast: throws with all collected validation errors. |

### environment.js

| Failure | Strategy |
|---|---|
| `.env` file missing | Silent skip. |
| No API keys found | Returns a warning string; does not throw. |

### logger.js

| Failure | Strategy |
|---|---|
| SSE module not available | Graceful: `getSSERegistry` catches import error, returns `null`. |
| SSE broadcast failure | Warn-and-continue: catches error, logs a warning via `console.warn`. |
| Data serialization failure | Returns a JSON object with `serialization_error` message instead of throwing. |

### module-loader.js

| Failure | Strategy |
|---|---|
| Non-string/non-URL argument | Fail-fast: throws `TypeError`. |
| Relative path | Fail-fast: throws `Error` with a hint. |
| Module not found — direct import | Falls through to cache-busted import. |
| Module not found — cache-busted import | Falls through to adjacent-copy fallback. |
| File verified to not exist | Throws a descriptive `Error` with the original error as `cause`. |
| All three import strategies fail | Throws a combined error listing all three failure messages and attaching all three error objects. |

### validation.js

| Failure | Strategy |
|---|---|
| Non-object input | Returns `{ valid: false, errors: [...] }` with a descriptive message. |
| Schema violation | Returns structured errors from AJV, mapped to `{ message, path, params, keyword }`. |
| `*OrThrow` variants | Throw an `Error` with formatted multi-line messages. |

### retry.js

| Failure | Strategy |
|---|---|
| `fn` throws and `shouldRetry` returns `false` | Immediate rethrow. |
| `fn` throws and attempts remain | Calls `onRetry`, sleeps, retries. |
| All attempts exhausted | Throws the last error. |

---

## 9. Integration Points & Data Flow

### Upstream (Who Calls These Modules)

- **config.js** is called by virtually every subsystem. `loadConfig` is typically called once during application startup (e.g., by the CLI or orchestrator). `getConfig` and `getConfigValue` are called throughout the codebase for runtime configuration access. `getPipelineConfig` is called by any code that needs to locate pipeline files.
- **environment.js** is called early in the startup sequence to populate `process.env` before config loading.
- **logger.js** is called by any module that needs to emit logs. `createLogger`, `createJobLogger`, and `createTaskLogger` are used throughout the core, UI, and provider subsystems.
- **module-loader.js** is called by the task runner (or pipeline runner) when it needs to dynamically load task definition modules from the file system at runtime.
- **validation.js** is called by API endpoints and the CLI when seed files or pipeline definitions are submitted.
- **retry.js** is called by modules that make LLM API requests or other operations susceptible to transient failure.

### Downstream (What These Modules Consume)

- **config.js** reads from the file system and `process.env`. It does not call other application modules.
- **environment.js** reads from the file system (dotenv) and `process.env`.
- **logger.js** optionally calls into the SSE subsystem (`../ui/sse.js`) for event broadcasting.
- **validation.js** calls `getConfig()` from `config.js` to dynamically determine valid pipeline slugs and validation parameters.
- **retry.js** calls the user-supplied `fn` and callbacks. No module-level downstream dependencies.
- **module-loader.js** calls the runtime's `import()` and file-system APIs. No application-level downstream dependencies.

### Data Transformation

- **config.js** transforms: raw defaults + file JSON + environment strings → merged, resolved, validated configuration object.
- **environment.js** transforms: `.env` file contents → `process.env` mutations → structured credentials object.
- **validation.js** transforms: arbitrary input object → `{ valid, errors? }` result.

### Control Flow — Primary Use Cases

**Application startup:**
1. `loadEnvironment()` loads `.env` files and populates `process.env`.
2. `loadConfig()` assembles configuration from defaults, optional config file, and environment variables.
3. Registry hydration resolves pipeline paths.
4. Validation confirms numeric constraints and enum values.
5. Configuration is cached for the remainder of the process.

**Task module loading:**
1. Caller provides an absolute path to a task definition file.
2. `loadFreshModule()` attempts direct import.
3. On failure, tries cache-busted import.
4. On failure, copies the file adjacent and imports the copy.

**Seed validation:**
1. Caller passes a parsed seed object.
2. `validateSeed()` compiles the schema (pulling current pipeline slugs from config) and runs AJV validation.
3. Returns structured result.

---

## 10. Edge Cases & Implicit Behavior

### config.js
- **Shallow clone on environment loading:** `loadFromEnvironment` does a shallow copy (`{ ...config }`) but then mutates nested objects (`envConfig.orchestrator.shutdownTimeout = ...`). Because nested objects are shared references from the input, this mutates the original config's nested objects. However, since `loadConfig` deep-clones `defaultConfig` via `JSON.parse(JSON.stringify(...))` first, the defaults object itself is not mutated.
- **`PORT` fallback:** The UI port can be set via either `PO_UI_PORT` or the generic `PORT` environment variable. `PO_UI_PORT` takes precedence if both are set.
- **`PO_CONFIG_DIR` deprecated:** A comment notes this env var is deprecated in favor of the pipeline registry, but no code reads it.
- **`getConfig` sync vs `loadConfig` async:** `getConfig` performs synchronous I/O (`readFileSync`, `existsSync`) for the registry, while `loadConfig` uses async I/O. The sync path does NOT validate pipeline directory existence on disk (no `checkFileExistence` calls) and does NOT validate the config schema. It also skips the "no pipelines" error in test environments.
- **Deep merge does not handle arrays:** `deepMerge` replaces arrays wholesale rather than merging them element-by-element.
- **Valid providers list is hardcoded:** The `validateConfig` function checks `defaultProvider` against `["openai", "deepseek", "anthropic", "mock"]`. This list does not include all providers that exist in the codebase (e.g., `gemini`, `moonshot`, `zhipu`, `claude-code` are absent). This may cause validation failures for configurations using those providers.

### logger.js
- **CSS formatting in non-browser contexts:** The `sse` method uses `%c` CSS formatting directives which are meaningful in browser developer tools but appear as literal text in Node.js/Bun console output.
- **Debug gating logic:** Debug messages are shown when `NODE_ENV !== "production"` OR `DEBUG` is set. This means debug output is on by default in development. The config's `logging.level` setting is not consulted.

### module-loader.js
- **Orphaned cache files:** The adjacent-copy fallback creates files named `.cache.<base>.<timestamp>-<random>.<ext>` that are never cleaned up. Over time (or in a crash), these accumulate in the source module's directory.
- **URL-like objects:** The function accepts objects with a `href` property (duck typing), not just native URL instances.
- **`Error.cause` feature detection:** Uses `"cause" in Error.prototype` to decide whether to use the standard `cause` property or a custom `originalError`/`fallbackError` property for error chaining.

### validation.js
- **Schema recompilation:** `validateSeed` and `validatePipeline` compile their schemas on every call via `ajv.compile()`. The schemas are not cached between calls.
- **Dynamic `pipeline` enum:** The seed schema's allowed `pipeline` values come from `getConfig().pipelines` at validation time. If pipelines change after initial config load, validation behavior changes.
- **`additionalProperties` asymmetry:** The seed schema disallows additional properties (`additionalProperties: false`), while the pipeline schema explicitly allows them (`additionalProperties: true`).

### retry.js
- **`onRetry` timing:** The callback is invoked *after* the decision to retry but *before* the backoff delay. The `delay` field in the callback payload tells the caller how long the upcoming sleep will be.
- **Zero-delay edge case:** If `initialDelay` is 0, all retries happen immediately with no delay (since `0 * multiplier^n` is always 0).

---

## 11. Open Questions & Ambiguities

1. **Valid provider list mismatch:** `config.js` validates `llm.defaultProvider` against `["openai", "deepseek", "anthropic", "mock"]`, but the system includes providers for `gemini`, `moonshot`, `zhipu`, and `claude-code`. Is the validation list intentionally restrictive, or is it outdated?

2. **`logging.level` unused:** The configuration includes `logging.level` with validation against `["debug", "info", "warn", "error"]`, but `logger.js` does not read this value — it uses `NODE_ENV` and `DEBUG` environment variables instead. Is the config-based log level intended for future use, or is it a vestigial field?

3. **`logging.format` and `logging.destination`:** These config fields default to `"json"` and `"stdout"` respectively, but the logger always outputs plain-text-prefixed messages to `console.*`. Are these fields intended for a future structured logging implementation?

4. **AJV schema compilation on every call:** `validateSeed` and `validatePipeline` recompile their JSON schemas each time they are invoked. For `validateSeed`, this is because the schema dynamically reads from config (pipeline slugs). For `validatePipeline`, the schema is static — was per-call compilation intentional or an oversight?

5. **Module-loader cleanup:** The adjacent-copy fallback in `module-loader.js` creates temporary files that are never removed. Is there an external cleanup mechanism, or is this a known gap?

6. **`getConfig` sync path skips validation:** The synchronous `getConfig()` path does not call `validateConfig()` and does not verify pipeline directory existence. Is this acceptable for production use, or is `getConfig()` intended only as a fallback?

7. **`deepMerge` array behavior:** Arrays in config file overrides replace the default entirely. If a user-provided config file contains an array field, the defaults for that array are lost. Is this the intended merge behavior?

8. **Config `paths.pendingDir`, `currentDir`, `completeDir` not resolved:** These path fields are stored as relative strings (e.g., `"pending"`) and are never resolved to absolute paths within `config.js`. Resolution presumably happens in the consuming module. Is this intentional?

9. **`environment.js` override semantics:** `dotenv.config` is called with `override: true`, meaning `.env.local` values override `.env` values. This is typical but worth confirming as intentional since the default dotenv behavior is to NOT override existing environment variables.

10. **`config.js` race condition:** If `loadConfig` is called concurrently (e.g., during parallel initialization), the last resolution to complete wins the `currentConfig` assignment. No locking or deduplication exists. Is concurrent initialization a realistic scenario?
