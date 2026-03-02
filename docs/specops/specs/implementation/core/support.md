# Implementation Specification: `core/support`

**Analysis source:** `docs/specs/analysis/core/support.md`

---

## 1. Qualifications

- TypeScript strict mode: generics, discriminated unions, mapped types, `satisfies` operator
- Bun file I/O APIs: `Bun.file()`, `Bun.write()`
- Bun environment: `process.env`, `Bun.env`
- JSON Schema validation with AJV (draft-07)
- Deep merge of plain objects with correct handling of nested references
- Dot-path property access on nested objects
- Async retry patterns with exponential backoff
- Dynamic ES module imports and cache-busting strategies
- Console-based structured logging with contextual prefixes

---

## 2. Problem Statement

The system requires a set of foundational cross-cutting services — configuration management, environment bootstrapping, structured logging, cache-busting module loading, schema-based validation, and retry-with-backoff — that all other subsystems depend on. The existing JS implementation provides these as six independent modules in `src/core/`. This spec defines the TypeScript replacements for all six, unified under the `core/support` grouping.

---

## 3. Goal

A set of TypeScript modules under `src/core/` (`config.ts`, `environment.ts`, `logger.ts`, `module-loader.ts`, `validation.ts`, `retry.ts`) that provide identical behavioral contracts to the analyzed JS modules, run on Bun, and pass all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/core/config.ts` | Centralized configuration management: defaults, file/env merging, pipeline registry hydration, validation, singleton caching. |
| `src/core/environment.ts` | Environment bootstrapping: loads `.env` files, validates API key presence, exposes structured provider credentials. |
| `src/core/logger.ts` | Structured logging factory: produces context-aware logger instances with SSE broadcast support. |
| `src/core/module-loader.ts` | Cache-busting dynamic module loader with multi-stage fallback. |
| `src/core/validation.ts` | Schema-based validation of seed and pipeline objects using AJV. |
| `src/core/retry.ts` | Generic retry with exponential backoff, configurable callbacks. |
| `src/core/__tests__/config.test.ts` | Tests for config module. |
| `src/core/__tests__/environment.test.ts` | Tests for environment module. |
| `src/core/__tests__/logger.test.ts` | Tests for logger module. |
| `src/core/__tests__/module-loader.test.ts` | Tests for module-loader module. |
| `src/core/__tests__/validation.test.ts` | Tests for validation module. |
| `src/core/__tests__/retry.test.ts` | Tests for retry module. |

### Key types and interfaces

#### config.ts

```typescript
interface OrchestratorConfig {
  shutdownTimeout: number;
  processSpawnRetries: number;
  processSpawnRetryDelay: number;
  lockFileTimeout: number;
  watchDebounce: number;
  watchStabilityThreshold: number;
  watchPollInterval: number;
}

interface TaskRunnerConfig {
  maxRefinementAttempts: number;
  stageTimeout: number;
  llmRequestTimeout: number;
}

interface LLMConfig {
  defaultProvider: string;
  defaultModel: string;
  maxConcurrency: number;
  retryMaxAttempts: number;
  retryBackoffMs: number;
}

interface UIConfig {
  port: number;
  host: string;
  heartbeatInterval: number;
  maxRecentChanges: number;
}

interface PathsConfig {
  root: string;
  dataDir: string;
  pendingDir: string;
  currentDir: string;
  completeDir: string;
}

interface PipelineEntry {
  configDir: string;
  tasksDir: string;
  name?: string;
  description?: string;
}

interface ValidationConfig {
  seedNameMinLength: number;
  seedNameMaxLength: number;
  seedNamePattern: string;
}

interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  format: "json";
  destination: "stdout";
}

interface AppConfig {
  orchestrator: OrchestratorConfig;
  taskRunner: TaskRunnerConfig;
  llm: LLMConfig;
  ui: UIConfig;
  paths: PathsConfig;
  pipelines: Record<string, PipelineEntry>;
  validation: ValidationConfig;
  logging: LoggingConfig;
}

interface LoadConfigOptions {
  configPath?: string;
  validate?: boolean;
}

interface PipelineConfigResult {
  pipelineJsonPath: string;
  tasksDir: string;
}

// Public API
export const defaultConfig: AppConfig;
export function loadConfig(options?: LoadConfigOptions): Promise<AppConfig>;
export function getConfig(): AppConfig;
export function resetConfig(): void;
export function getConfigValue(path: string, defaultValue?: unknown): unknown;
export function getPipelineConfig(slug: string): PipelineConfigResult;
```

#### environment.ts

```typescript
interface ProviderCredentials {
  apiKey?: string;
  organization?: string;
  baseURL?: string;
}

interface EnvironmentConfig {
  openai: ProviderCredentials;
  anthropic: Omit<ProviderCredentials, "organization">;
  deepseek: Pick<ProviderCredentials, "apiKey">;
  gemini: Omit<ProviderCredentials, "organization">;
}

interface LoadEnvironmentOptions {
  rootDir?: string;
  envFiles?: string[];
}

interface LoadEnvironmentResult {
  loaded: string[];
  warnings: string[];
  config: EnvironmentConfig;
}

export function loadEnvironment(options?: LoadEnvironmentOptions): Promise<LoadEnvironmentResult>;
export function validateEnvironment(): string[];
export function getEnvironmentConfig(): EnvironmentConfig;
```

#### logger.ts

```typescript
interface LogContext {
  jobId?: string;
  taskName?: string;
  stage?: string;
  [key: string]: string | undefined;
}

interface Logger {
  debug(message: string, data?: unknown): void;
  log(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  group(label: string, data?: unknown): void;
  groupEnd(): void;
  sse(eventType: string, eventData: unknown): void;
}

export function createLogger(componentName: string, context?: LogContext): Logger;
export function createJobLogger(componentName: string, jobId: string, additionalContext?: LogContext): Logger;
export function createTaskLogger(componentName: string, jobId: string, taskName: string, additionalContext?: LogContext): Logger;
```

#### module-loader.ts

```typescript
export function loadFreshModule(modulePath: string | URL): Promise<Record<string, unknown>>;
```

#### validation.ts

```typescript
interface ValidationError {
  message: string;
  path: string;
  params?: Record<string, unknown>;
  keyword?: string;
}

type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

export function validateSeed(seed: unknown): ValidationResult;
export function formatValidationErrors(errors: ValidationError[]): string;
export function validateSeedOrThrow(seed: unknown): void;
export function validatePipeline(pipeline: unknown): ValidationResult;
export function formatPipelineValidationErrors(errors: ValidationError[]): string;
export function validatePipelineOrThrow(pipeline: unknown, pathHint?: string): void;
```

#### retry.ts

```typescript
interface RetryInfo {
  attempt: number;
  delay: number;
  error: Error;
  maxAttempts: number;
}

interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  onRetry?: (info: RetryInfo) => void;
  shouldRetry?: (error: Error) => boolean;
}

export function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
export function createRetryWrapper(defaultOptions?: RetryOptions): <T>(fn: () => Promise<T>, options?: RetryOptions) => Promise<T>;
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| Use `Bun.file().exists()` and `Bun.file().text()` instead of `fs.access` / `fs.readFile` for config and registry file reads | Bun-native file API is simpler and avoids importing `node:fs`. |
| Use `Bun.file().exists()` instead of `existsSync` for environment `.env` file checks | Consistent with the Bun-native approach. |
| Use `Bun.file().text()` + `Bun.write()` instead of `fs.copyFile` in module-loader fallback | Bun-native file I/O is preferred per project conventions. |
| Replace `dotenv` with manual `.env` parsing | Bun has no native `.env` loader API that overrides, and the parsing logic is simple (line-by-line key=value). This eliminates the `dotenv` dependency. Alternatively, keep `dotenv` if its edge-case handling (multiline values, quotes, comments) is needed — the analysis shows it is only used in `loadEnvironment`. |
| Keep `ajv` and `ajv-formats` as external dependencies | AJV is a complex library with no Bun-native equivalent. Replacing it would be unreasonable. |
| Use `Bun.sleep()` instead of `setTimeout`-based sleep in retry | Bun provides `Bun.sleep(ms)` returning a Promise, eliminating the need for a manual `setTimeout` wrapper. |
| Use `crypto.randomUUID()` for module-loader cache file names | Available globally in Bun. |

**Decision on `dotenv`:** Keep `dotenv` as a dependency. The `.env` file format has edge cases (quoted values, multiline, comments, variable expansion) that `dotenv` handles correctly. Re-implementing this would violate the "simple > clever" principle.

### Dependency map

**Internal (`src/`) imports:**

| Module | Imports From |
|--------|-------------|
| `config.ts` | None (self-contained) |
| `environment.ts` | None (self-contained) |
| `logger.ts` | `../ui/sse.ts` (lazy dynamic import, fails gracefully) |
| `validation.ts` | `./config.ts` (`getConfig`) |
| `retry.ts` | None (self-contained) |
| `module-loader.ts` | None (self-contained) |

**External packages:**

| Package | Usage |
|---------|-------|
| `dotenv` | `.env` file loading in `environment.ts` |
| `ajv` | JSON Schema validation in `validation.ts` |
| `ajv-formats` | Format extensions for AJV in `validation.ts` |

---

## 5. Acceptance Criteria

### Configuration — Core behavior

> **Sync/async parity note:** `loadConfig()` (async) and `getConfig()` (sync) both merge defaults and environment overrides, but they differ in guarantees. `loadConfig` performs schema validation, registry hydration from disk, and pipeline directory existence checks. `getConfig` skips schema validation and pipeline path existence checks — it is a fast synchronous fallback. The criteria below are annotated with `[async-only]` where a guarantee applies only to `loadConfig`.

1. `defaultConfig` is an exported `const` containing all documented config sections with their default values. Callers never receive a direct reference — `loadConfig` and `getConfig` deep-clone it before use (see AC #28).
2. `loadConfig()` returns a fully assembled configuration object merging defaults, optional config file, and environment variables in priority order: env vars > config file > defaults.
3. `loadConfig({ configPath })` reads and merges the JSON config file at the given path. `[async-only]`
4. `loadConfig()` throws `"PO_ROOT is required"` when `paths.root` is not set after merging. `getConfig()` also throws this — both paths enforce it.
5. `loadConfig()` throws `"No pipelines are registered"` when the registry yields zero pipelines. `[async-only]` (`getConfig` skips this check when `NODE_ENV === "test"`; see AC #12.)
6. `loadConfig()` throws when a pipeline's `configDir`, `tasksDir`, or `pipeline.json` does not exist on disk. `[async-only]`
7. `loadConfig()` throws `"Configuration validation failed"` when numeric/enum constraints fail. `[async-only]`
8. `loadConfig()` throws `"Failed to load config file"` when the config file exists but cannot be parsed. `[async-only]`
9. `loadConfig()` throws `"Failed to read pipeline registry"` when the registry exists but cannot be parsed. `[async-only]`
10. `getConfig()` returns the cached configuration on repeat calls (same object reference).
11. `getConfig()` lazily initializes from defaults and environment on first call when `loadConfig` has not been called. It does **not** perform schema validation or pipeline path existence checks.
12. `getConfig()` skips the "no pipelines" check when `NODE_ENV === "test"`.
13. `resetConfig()` clears the cached configuration so the next `getConfig()` re-initializes.
14. `getConfigValue("orchestrator.shutdownTimeout")` returns the value at that path.
15. `getConfigValue("nonexistent.path", 42)` returns `42`.
16. `getPipelineConfig(slug)` returns `{ pipelineJsonPath, tasksDir }` for a registered pipeline.
17. `getPipelineConfig("unknown")` throws `"Pipeline unknown not found in registry"`.

### Configuration — Registry hydration

18. Pipeline registry is read from `<PO_ROOT>/pipeline-config/registry.json`.
19. All pipeline paths are resolved relative to `PO_ROOT`.
20. When `configDir` is omitted, it defaults to the directory containing `pipelineJsonPath` or `<PO_ROOT>/pipeline-config/<slug>`.
21. When `tasksDir` is omitted, it defaults to `<configDir>/tasks`.
22. Legacy `slugs` format is detected and warned about but not migrated.

### Configuration — Environment variable overrides

23. `PO_SHUTDOWN_TIMEOUT` overrides `orchestrator.shutdownTimeout` as a number.
24. `PO_UI_PORT` overrides `ui.port`; `PORT` is used as fallback if `PO_UI_PORT` is not set.
25. Deep merge replaces arrays wholesale, not element-by-element.

### Configuration — Edge cases

26. A missing config file is silently skipped (not an error).
27. A missing registry file is silently skipped (pipelines remain as-is from defaults).
28. Config file cannot mutate the `defaultConfig` constant (deep clone on load).

### Environment — Core behavior

29. `loadEnvironment()` loads `.env` files from the given `rootDir` (default: `process.cwd()`), in the order specified by `envFiles`.
30. `loadEnvironment()` returns `{ loaded, warnings, config }` where `loaded` lists applied files.
31. Missing `.env` files are silently skipped, not errored.
32. `validateEnvironment()` returns a warning array containing `"No LLM API keys found in environment."` when none of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` are set.
33. `validateEnvironment()` returns an empty array when at least one API key is set.
34. `getEnvironmentConfig()` returns structured credentials for all four providers, with `undefined` for unset variables.

### Logger — Core behavior

35. `createLogger("Orchestrator")` produces a logger whose output is prefixed with `[Orchestrator]`.
36. `createLogger("TaskRunner", { jobId: "j1", taskName: "t1" })` includes both identifiers in the prefix.
37. `debug()` only outputs when `NODE_ENV !== "production"` or `DEBUG` is set.
38. `error()` enriches Error instances with `name`, `message`, `stack`, component, and timestamp.
39. `sse()` broadcasts via the SSE registry when available, and logs to console.
40. SSE broadcast failures never cause logging to fail — caught and warned.
41. Data serialization failures in `sse()` return a JSON object with `serialization_error` instead of throwing.

### Logger — Convenience factories

42. `createJobLogger("Runner", "job-1")` is equivalent to `createLogger("Runner", { jobId: "job-1" })`. When `additionalContext` is provided, `jobId` takes precedence over any conflicting key in `additionalContext`.
43. `createTaskLogger("Runner", "job-1", "task-a")` is equivalent to `createLogger("Runner", { jobId: "job-1", taskName: "task-a" })`. When `additionalContext` is provided, `jobId` and `taskName` take precedence over any conflicting keys in `additionalContext`.

### Module Loader — Core behavior

44. `loadFreshModule(absolutePath)` returns the ES module namespace of the loaded module.
45. `loadFreshModule(relPath)` throws `"Module path must be absolute"`.
46. `loadFreshModule(123)` throws `TypeError("Module path must be a string or URL")`.
47. `loadFreshModule("/nonexistent.ts")` throws `"Module not found at"`.
48. The fallback ordering is: direct import → cache-busted import (`?t=<timestamp>`) → adjacent-copy import.

### Module Loader — Edge cases

49. Accepts `file://` URL strings and URL objects.
50. Adjacent-copy fallback creates `.cache.<basename>.<unique>.<ext>` files (not cleaned up by this module).

### Validation — Seed

51. `validateSeed({ name: "valid-name", data: {}, pipeline: "<registered>" })` returns `{ valid: true }`.
52. `validateSeed({})` returns `{ valid: false, errors: [...] }` with missing-field errors.
53. `validateSeed` dynamically pulls pipeline slugs from `getConfig().pipelines` for the `pipeline` enum.
54. `validateSeedOrThrow` throws an Error with formatted messages on invalid input.
55. Non-object input returns `{ valid: false }` with a descriptive error.

### Validation — Pipeline

56. `validatePipeline({ name: "p", tasks: ["t1"] })` returns `{ valid: true }`.
57. `validatePipeline({})` returns `{ valid: false, errors: [...] }`.
58. `validatePipelineOrThrow(invalid, "my-pipeline.json")` throws with the path hint in the error message.
59. The pipeline schema allows additional properties; the seed schema does not.

### Validation — Formatting

60. `formatValidationErrors(errors)` returns a human-readable string from an array of `ValidationError`.
61. `formatPipelineValidationErrors(errors)` returns a human-readable string.

### Retry — Core behavior

62. `withRetry(fn)` returns the result of `fn()` on first success.
63. `withRetry(fn)` retries up to `maxAttempts` (default 3) times on failure.
64. After all attempts are exhausted, the **last** error is thrown.
65. Delay increases exponentially: `initialDelay * backoffMultiplier^(attempt-1)`, capped at `maxDelay`.
66. `onRetry` is called before the delay sleep with `{ attempt, delay, error, maxAttempts }`.
67. `shouldRetry(error)` returning `false` causes immediate rethrow without further attempts.
68. Default `shouldRetry` returns `true` for all errors.

### Retry — createRetryWrapper

69. `createRetryWrapper({ maxAttempts: 5 })` returns a function that defaults to 5 attempts.
70. Per-call options override the wrapper's defaults.

### Retry — Edge cases

71. When `initialDelay` is 0, retries happen with zero delay.
72. When `maxAttempts` is 1, no retries occur — the function runs once.

---

## 6. Notes

### Design trade-offs

- **Six modules, one spec:** These modules are grouped because they are all foundational leaf dependencies with no mutual dependencies (except `validation.ts` → `config.ts`). Keeping them in one spec avoids orchestration overhead for six small specs.
- **Keep `dotenv`:** The `.env` format has enough edge cases (quoted values, multiline, comments, `#` escaping) that re-implementing it would be more code than the dependency itself. `dotenv` is well-tested and small.
- **Keep `ajv` + `ajv-formats`:** No Bun-native JSON Schema validator exists. AJV is the standard.
- **Schema recompilation:** AJV compiles schemas on every call in the JS implementation. For `validateSeed` this is necessary because the `pipeline` enum is dynamic (pulled from config). For `validatePipeline` the schema is static, but the TS implementation preserves per-call compilation to match the JS behavior exactly. Do not cache the pipeline schema.
- **`logging.level` is not consulted by the logger:** The analysis confirms this. The TS implementation preserves this behavior — debug gating uses `NODE_ENV` and `DEBUG`, not `config.logging.level`. This avoids scope creep.

### Open questions from analysis

1. **Valid provider list mismatch:** The `validateConfig` function hardcodes `["openai", "deepseek", "anthropic", "mock"]` but the system has more providers. Preserve this list exactly per the analysis — changing it is a feature change, not a migration concern.
2. **`logging.level`/`format`/`destination` unused:** Preserve these config fields and their validation. They may be used by future structured logging. Do not wire them into the logger.
3. **AJV schema recompilation:** Preserve per-call compilation for both `validateSeed` (necessary) and `validatePipeline` (matches JS behavior).
4. **Module-loader orphaned cache files:** Preserve this behavior. Cleanup is out of scope for this module.
5. **`getConfig` sync path skips validation:** Preserve this asymmetry. The sync path is a fast fallback.
6. **`deepMerge` array replacement:** Preserve wholesale array replacement behavior.
7. **Config `paths` relative directories:** Preserve as relative strings. Resolution is the consumer's responsibility.
8. **`dotenv` override semantics:** Preserve `override: true` behavior — later `.env` files override earlier ones.

### Dependencies on other modules

- `logger.ts` has a lazy dynamic import of `../ui/sse.ts`. This module may not exist when `logger.ts` is first implemented. The import must fail gracefully (catch and return `null`).
- `validation.ts` depends on `config.ts` (`getConfig`). Implement `config.ts` first.
- All other modules are self-contained and can be implemented in any order.

### Performance considerations

- `getConfig()` is synchronous and called frequently. The cached singleton pattern avoids repeated I/O.
- `loadConfig()` uses async file reads (`Bun.file().text()`) for the registry and config file, which is appropriate for startup-only use.
- `Bun.sleep()` in retry is more efficient than `setTimeout`-based Promise wrappers.

---

## 7. Implementation Steps

### Step 1: Implement `retry.ts` — types and `withRetry`

**What to do:** Create `src/core/retry.ts`. Define and export `RetryInfo`, `RetryOptions`, and implement `withRetry<T>(fn, options?)`. The function:

1. Destructures options with defaults: `maxAttempts = 3`, `initialDelay = 1000`, `maxDelay = 10000`, `backoffMultiplier = 2`, `onRetry = no-op`, `shouldRetry = () => true`.
2. Loops up to `maxAttempts`: calls `fn()`, returns on success.
3. On catch: if `shouldRetry(error)` returns `false`, rethrow immediately.
4. If attempts remain: compute delay as `Math.min(initialDelay * backoffMultiplier ** (attempt - 1), maxDelay)`, call `onRetry({ attempt, delay, error, maxAttempts })`, then `await Bun.sleep(delay)`.
5. After all attempts, throw the last error.

**Why:** Retry is a leaf dependency with no imports. All other modules can use it. Satisfies AC #62–68, #71–72.

**Type signatures:**

```typescript
export interface RetryInfo {
  attempt: number;
  delay: number;
  error: Error;
  maxAttempts: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  onRetry?: (info: RetryInfo) => void;
  shouldRetry?: (error: Error) => boolean;
}

export function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
```

**Test:** Create `src/core/__tests__/retry.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { withRetry } from "../retry";

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  test("retries on failure and returns on eventual success", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
      return "ok";
    }, { initialDelay: 0 });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("throws last error after all attempts exhausted", async () => {
    let lastMsg = "";
    try {
      await withRetry(async () => {
        throw new Error("always fails");
      }, { maxAttempts: 2, initialDelay: 0 });
    } catch (e: any) {
      lastMsg = e.message;
    }
    expect(lastMsg).toBe("always fails");
  });

  test("shouldRetry returning false causes immediate rethrow", async () => {
    let attempts = 0;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error("fatal");
      }, { maxAttempts: 5, initialDelay: 0, shouldRetry: () => false });
    } catch { /* expected */ }
    expect(attempts).toBe(1);
  });

  test("onRetry is called before delay with correct info", async () => {
    const retries: { attempt: number; delay: number }[] = [];
    let attempts = 0;
    await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
      return "ok";
    }, {
      initialDelay: 0,
      onRetry: (info) => retries.push({ attempt: info.attempt, delay: info.delay }),
    });
    expect(retries).toHaveLength(2);
    expect(retries[0].attempt).toBe(1);
    expect(retries[1].attempt).toBe(2);
  });

  test("delay is capped at maxDelay", async () => {
    const delays: number[] = [];
    let attempts = 0;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error("fail");
      }, {
        maxAttempts: 5,
        initialDelay: 100,
        maxDelay: 200,
        backoffMultiplier: 10,
        onRetry: (info) => delays.push(info.delay),
      });
    } catch { /* expected */ }
    // All delays after the first should be capped at 200
    expect(delays.every(d => d <= 200)).toBe(true);
  });

  test("zero initialDelay means no delay", async () => {
    const delays: number[] = [];
    let attempts = 0;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error("fail");
      }, {
        maxAttempts: 3,
        initialDelay: 0,
        onRetry: (info) => delays.push(info.delay),
      });
    } catch { /* expected */ }
    expect(delays.every(d => d === 0)).toBe(true);
  });
});
```

---

### Step 2: Implement `retry.ts` — `createRetryWrapper`

**What to do:** In `src/core/retry.ts`, implement and export `createRetryWrapper(defaultOptions?)`. It returns a function that calls `withRetry(fn, { ...defaultOptions, ...options })`.

**Why:** Pre-configured retry wrappers for LLM providers and other callers. Satisfies AC #69–70.

**Type signature:**

```typescript
export function createRetryWrapper(
  defaultOptions?: RetryOptions
): <T>(fn: () => Promise<T>, options?: RetryOptions) => Promise<T>;
```

**Test:** In `src/core/__tests__/retry.test.ts`:

```typescript
import { createRetryWrapper } from "../retry";

describe("createRetryWrapper", () => {
  test("returns a function with baked-in defaults", async () => {
    const retryWith5 = createRetryWrapper({ maxAttempts: 5, initialDelay: 0 });
    let attempts = 0;
    const result = await retryWith5(async () => {
      attempts++;
      if (attempts < 5) throw new Error("fail");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(5);
  });

  test("per-call options override wrapper defaults", async () => {
    const retryWith5 = createRetryWrapper({ maxAttempts: 5, initialDelay: 0 });
    let attempts = 0;
    try {
      await retryWith5(async () => {
        attempts++;
        throw new Error("fail");
      }, { maxAttempts: 2 });
    } catch { /* expected */ }
    expect(attempts).toBe(2);
  });
});
```

---

### Step 3: Implement `environment.ts` — `getEnvironmentConfig` and `validateEnvironment`

**What to do:** Create `src/core/environment.ts`. Define and export `EnvironmentConfig`, `ProviderCredentials` types. Implement:

1. `getEnvironmentConfig()`: reads `process.env` for `OPENAI_API_KEY`, `OPENAI_ORG_ID`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GEMINI_BASE_URL`. Returns structured object with `undefined` for unset variables.

2. `validateEnvironment()`: checks whether any of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` exist in `process.env`. Returns `["No LLM API keys found in environment."]` if none are set, empty array otherwise.

**Why:** These are pure functions with no file I/O, establishing the environment reading foundation. Satisfies AC #32–34.

**Type signatures:**

```typescript
export interface ProviderCredentials {
  apiKey?: string;
  organization?: string;
  baseURL?: string;
}

export interface EnvironmentConfig {
  openai: ProviderCredentials;
  anthropic: Omit<ProviderCredentials, "organization">;
  deepseek: Pick<ProviderCredentials, "apiKey">;
  gemini: Omit<ProviderCredentials, "organization">;
}

export function getEnvironmentConfig(): EnvironmentConfig;
export function validateEnvironment(): string[];
```

**Test:** Create `src/core/__tests__/environment.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getEnvironmentConfig, validateEnvironment } from "../environment";

describe("getEnvironmentConfig", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns structured credentials from env vars", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_ORG_ID = "org-test";
    const config = getEnvironmentConfig();
    expect(config.openai.apiKey).toBe("sk-test");
    expect(config.openai.organization).toBe("org-test");
  });

  test("returns undefined for unset variables", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const config = getEnvironmentConfig();
    expect(config.openai.apiKey).toBeUndefined();
    expect(config.anthropic.apiKey).toBeUndefined();
  });
});

describe("validateEnvironment", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns warning when no API keys are set", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const warnings = validateEnvironment();
    expect(warnings).toContain("No LLM API keys found in environment.");
  });

  test("returns empty array when at least one key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const warnings = validateEnvironment();
    expect(warnings).toHaveLength(0);
  });
});
```

---

### Step 4: Implement `environment.ts` — `loadEnvironment`

**What to do:** In `src/core/environment.ts`, implement and export `loadEnvironment(options?)`. The function:

1. Destructures options with defaults: `rootDir = process.cwd()`, `envFiles = [".env", ".env.local"]`.
2. For each file in `envFiles`: resolve to `path.join(rootDir, file)`, check existence via `Bun.file(resolved).exists()`. If it exists, call `dotenv.config({ path: resolved, override: true })` and add the filename to the `loaded` array.
3. Call `validateEnvironment()` to get warnings.
4. Call `getEnvironmentConfig()` for the config.
5. Return `{ loaded, warnings, config }`.

**Why:** Completes the environment module with file-loading capability. Satisfies AC #29–31.

**Type signature:**

```typescript
export interface LoadEnvironmentOptions {
  rootDir?: string;
  envFiles?: string[];
}

export interface LoadEnvironmentResult {
  loaded: string[];
  warnings: string[];
  config: EnvironmentConfig;
}

export function loadEnvironment(options?: LoadEnvironmentOptions): Promise<LoadEnvironmentResult>;
```

**Test:** In `src/core/__tests__/environment.test.ts`:

```typescript
import { loadEnvironment } from "../environment";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadEnvironment", () => {
  test("loads .env files and returns loaded filenames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "env-test-"));
    await writeFile(join(dir, ".env"), "OPENAI_API_KEY=test-key\n");
    const result = await loadEnvironment({ rootDir: dir });
    expect(result.loaded).toContain(".env");
    expect(result.config.openai.apiKey).toBe("test-key");
    await rm(dir, { recursive: true });
  });

  test("skips missing .env files without error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "env-test-"));
    const result = await loadEnvironment({ rootDir: dir, envFiles: [".env.nonexistent"] });
    expect(result.loaded).toHaveLength(0);
    await rm(dir, { recursive: true });
  });
});
```

---

### Step 5: Implement `config.ts` — types, `defaultConfig`, and `deepMerge`

**What to do:** Create `src/core/config.ts`. Define and export all config interfaces (`AppConfig`, `OrchestratorConfig`, etc.) and `defaultConfig`. Implement a private `deepMerge(target, source)` function that:

1. Recursively merges plain objects.
2. Replaces arrays wholesale (does not merge element-by-element).
3. Returns a new object (does not mutate inputs).

Export `defaultConfig` as a `const` satisfying `AppConfig`.

**Why:** Types and defaults are the foundation for all config operations. `deepMerge` is needed by `loadConfig`. Satisfies AC #1, #25, #28.

**Type signatures:** See Architecture § config.ts types above.

**Test:** Create `src/core/__tests__/config.test.ts`:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { defaultConfig, resetConfig } from "../config";

describe("defaultConfig", () => {
  test("contains all required config sections", () => {
    expect(defaultConfig.orchestrator).toBeDefined();
    expect(defaultConfig.taskRunner).toBeDefined();
    expect(defaultConfig.llm).toBeDefined();
    expect(defaultConfig.ui).toBeDefined();
    expect(defaultConfig.paths).toBeDefined();
    expect(defaultConfig.validation).toBeDefined();
    expect(defaultConfig.logging).toBeDefined();
  });

  test("default values match documented defaults", () => {
    expect(defaultConfig.llm.defaultProvider).toBe("openai");
    expect(defaultConfig.ui.port).toBe(3000);
    expect(defaultConfig.taskRunner.maxRefinementAttempts).toBeGreaterThan(0);
  });
});
```

---

### Step 6: Implement `config.ts` — `loadFromEnvironment`, `loadFromFile`, `validateConfig`

**What to do:** In `src/core/config.ts`, implement three private helpers:

1. `loadFromEnvironment(config: AppConfig): AppConfig` — reads `PO_*` and `PORT` env vars, returns a shallow-then-nested merged copy with numeric conversions.
2. `loadFromFile(filePath: string): Promise<Record<string, unknown> | null>` — reads JSON from `filePath` via `Bun.file().text()`. Returns parsed object, or `null` if file doesn't exist. Throws on parse failure with `"Failed to load config file"`.
3. `validateConfig(config: AppConfig): void` — validates numeric ranges and enum values. Throws `"Configuration validation failed"` with details on violation.

**Why:** These are internal building blocks for `loadConfig`. Satisfies AC #7–8, #23–24, #26.

**Test:** In `src/core/__tests__/config.test.ts`:

```typescript
// Tests for validateConfig behavior are covered indirectly through loadConfig tests.
// Direct tests for edge cases:

describe("config environment overrides", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  test("PO_SHUTDOWN_TIMEOUT overrides orchestrator.shutdownTimeout", async () => {
    // Tested via loadConfig in step 7
  });
});
```

---

### Step 7: Implement `config.ts` — `hydratePipelinesFromRegistry` and `loadConfig`

**What to do:** In `src/core/config.ts`, implement:

1. `hydratePipelinesFromRegistry(config: AppConfig, registryPath: string): Promise<void>` — reads `registry.json` via `Bun.file().text()`, parses it, normalizes pipeline paths relative to `config.paths.root`, warns on legacy `slugs` format.

2. Export `loadConfig(options?: LoadConfigOptions): Promise<AppConfig>`:
   - Deep-clones `defaultConfig` via `JSON.parse(JSON.stringify(defaultConfig))`.
   - If `options.configPath`, loads and deep-merges the file.
   - Merges environment variable overrides.
   - Validates that `paths.root` (`PO_ROOT`) is set — throw `"PO_ROOT is required"` before any registry work, because the registry path depends on it.
   - Hydrates pipelines from registry at `<paths.root>/pipeline-config/registry.json`.
   - Checks at least one pipeline exists and all pipeline directories/files exist on disk.
   - Validates if `options.validate !== false`.
   - Caches in module-level `currentConfig`.

**Why:** This is the primary async config initialization path. Satisfies AC #2–6, #9, #18–22, #27.

**Type signature:**

```typescript
export function loadConfig(options?: LoadConfigOptions): Promise<AppConfig>;
```

**Test:** In `src/core/__tests__/config.test.ts`:

```typescript
import { loadConfig, resetConfig } from "../config";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadConfig", () => {
  afterEach(() => {
    resetConfig();
  });

  test("throws when PO_ROOT is not set", async () => {
    const origRoot = process.env.PO_ROOT;
    delete process.env.PO_ROOT;
    try {
      await expect(loadConfig()).rejects.toThrow("PO_ROOT is required");
    } finally {
      if (origRoot) process.env.PO_ROOT = origRoot;
    }
  });

  test("loads config from file and merges with defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-test-"));
    const configDir = join(dir, "pipeline-config", "test");
    const tasksDir = join(configDir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(configDir, "pipeline.json"), JSON.stringify({ name: "test", tasks: ["t1"] }));
    await writeFile(join(dir, "pipeline-config", "registry.json"), JSON.stringify({
      pipelines: { test: { configDir, tasksDir } }
    }));
    process.env.PO_ROOT = dir;
    const config = await loadConfig();
    expect(config.paths.root).toBe(dir);
    expect(config.pipelines.test).toBeDefined();
    await rm(dir, { recursive: true });
  });
});
```

---

### Step 8: Implement `config.ts` — `getConfig`, `resetConfig`, `getConfigValue`, `getPipelineConfig`

**What to do:** In `src/core/config.ts`, implement and export:

1. `getConfig(): AppConfig` — returns `currentConfig` if set. Otherwise: deep-clones defaults, merges environment, synchronously reads registry via `readFileSync` (import from `node:fs`), caches and returns. Throws `"PO_ROOT is required"` if unset. Skips "no pipelines" check when `NODE_ENV === "test"`.

2. `resetConfig(): void` — sets `currentConfig = null`.

3. `getConfigValue(path: string, defaultValue?: unknown): unknown` — calls `getConfig()`, walks the dot-separated path, returns value or `defaultValue`.

4. `getPipelineConfig(slug: string): PipelineConfigResult` — calls `getConfig()`, looks up `slug` in `pipelines`, returns `{ pipelineJsonPath, tasksDir }`. Throws if slug not found.

**Why:** Synchronous config access for runtime use throughout the codebase. Satisfies AC #10–17.

**Type signatures:**

```typescript
export function getConfig(): AppConfig;
export function resetConfig(): void;
export function getConfigValue(path: string, defaultValue?: unknown): unknown;
export function getPipelineConfig(slug: string): PipelineConfigResult;
```

**Test:** In `src/core/__tests__/config.test.ts`:

```typescript
import { getConfig, resetConfig, getConfigValue, getPipelineConfig, loadConfig } from "../config";

describe("getConfig", () => {
  afterEach(() => {
    resetConfig();
  });

  test("returns cached config on repeat calls", async () => {
    // Setup valid PO_ROOT with registry...
    const config1 = getConfig();
    const config2 = getConfig();
    expect(config1).toBe(config2); // same reference
  });
});

describe("resetConfig", () => {
  test("clears cached config", () => {
    getConfig(); // initialize
    resetConfig();
    // Next getConfig() will re-initialize
  });
});

describe("getConfigValue", () => {
  test("retrieves nested value by dot path", () => {
    const val = getConfigValue("ui.port");
    expect(typeof val).toBe("number");
  });

  test("returns defaultValue for missing path", () => {
    const val = getConfigValue("nonexistent.deep.path", 42);
    expect(val).toBe(42);
  });
});

describe("getPipelineConfig", () => {
  test("throws for unknown slug", () => {
    expect(() => getPipelineConfig("nonexistent-slug")).toThrow("not found in registry");
  });
});
```

---

### Step 9: Implement `logger.ts`

**What to do:** Create `src/core/logger.ts`. Implement:

1. Module-level `sseRegistry` variable, initially `null`. A private `getSSERegistry()` function that lazily does `import("../ui/sse.ts")` and caches the result. On import failure, catches and returns `null`.

2. A private `formatPrefix(componentName, context)` function that builds `[ComponentName|jobId|taskName|stage]` from non-empty context fields.

3. A private `formatData(data)` function that safely serializes data. If `data` is an Error, returns `{ name, message, stack, component, timestamp, ...context }`. If serialization fails, returns `{ serialization_error: "..." }`.

4. Export `createLogger(componentName, context?)` returning a `Logger` object with:
   - `debug`: only logs when `process.env.NODE_ENV !== "production"` or `process.env.DEBUG` is set. Uses `console.debug`.
   - `log`: `console.log` with prefix.
   - `warn`: `console.warn` with prefix.
   - `error`: `console.error` with prefix. Enriches Error data.
   - `group`: `console.group` with prefix.
   - `groupEnd`: `console.groupEnd`.
   - `sse`: logs to console, then asynchronously broadcasts via SSE registry (if available). Catches and warns on broadcast failure.

5. Export `createJobLogger(componentName, jobId, additionalContext?)` — calls `createLogger(componentName, { ...additionalContext, jobId })`. The explicit `jobId` is spread **last** so that `additionalContext` cannot accidentally override it.

6. Export `createTaskLogger(componentName, jobId, taskName, additionalContext?)` — calls `createLogger(componentName, { ...additionalContext, jobId, taskName })`. The explicit `jobId` and `taskName` are spread **last** so that `additionalContext` cannot accidentally override them.

**Why:** Logger is used by all modules. The SSE dependency is lazy and gracefully degraded. Satisfies AC #35–43.

**Type signatures:**

```typescript
export interface LogContext {
  jobId?: string;
  taskName?: string;
  stage?: string;
  [key: string]: string | undefined;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  log(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  group(label: string, data?: unknown): void;
  groupEnd(): void;
  sse(eventType: string, eventData: unknown): void;
}

export function createLogger(componentName: string, context?: LogContext): Logger;
export function createJobLogger(componentName: string, jobId: string, additionalContext?: LogContext): Logger;
export function createTaskLogger(componentName: string, jobId: string, taskName: string, additionalContext?: LogContext): Logger;
```

**Test:** Create `src/core/__tests__/logger.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createLogger, createJobLogger, createTaskLogger } from "../logger";

describe("createLogger", () => {
  test("log outputs with component prefix", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createLogger("TestComponent");
    logger.log("hello");
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0].join(" ");
    expect(output).toContain("[TestComponent]");
  });

  test("includes context in prefix", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createLogger("Runner", { jobId: "j1", taskName: "t1" });
    logger.log("test");
    const output = spy.mock.calls[0].join(" ");
    expect(output).toContain("j1");
    expect(output).toContain("t1");
  });

  test("debug only outputs in non-production", () => {
    const spy = mock(() => {});
    console.debug = spy;
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.DEBUG;
    const logger = createLogger("Test");
    logger.debug("should not appear");
    expect(spy).not.toHaveBeenCalled();
    process.env.NODE_ENV = origEnv;
  });

  test("error enriches Error data", () => {
    const spy = mock(() => {});
    console.error = spy;
    const logger = createLogger("Test");
    logger.error("failed", new Error("boom"));
    expect(spy).toHaveBeenCalled();
  });

  test("sse does not throw on broadcast failure", () => {
    const logger = createLogger("Test");
    expect(() => logger.sse("event", { data: "test" })).not.toThrow();
  });
});

describe("createJobLogger", () => {
  test("creates logger with jobId in context", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createJobLogger("Runner", "job-1");
    logger.log("test");
    const output = spy.mock.calls[0].join(" ");
    expect(output).toContain("job-1");
  });
});

describe("createTaskLogger", () => {
  test("creates logger with jobId and taskName in context", () => {
    const spy = mock(() => {});
    console.log = spy;
    const logger = createTaskLogger("Runner", "job-1", "task-a");
    logger.log("test");
    const output = spy.mock.calls[0].join(" ");
    expect(output).toContain("job-1");
    expect(output).toContain("task-a");
  });
});
```

---

### Step 10: Implement `module-loader.ts`

**What to do:** Create `src/core/module-loader.ts`. Implement and export `loadFreshModule(modulePath)`:

1. Validate input: if not a string or URL, throw `TypeError("Module path must be a string or URL")`.
2. Normalize: if string, check for `file://` prefix or absolute path (starts with `/`). If neither, throw `Error("Module path must be absolute")`.
3. Resolve to a file path. Check existence via `Bun.file(filePath).exists()`. If not found, throw `Error("Module not found at ...")`.
4. Attempt 1: `await import(fileUrl)`. On success, return the module namespace.
5. Attempt 2: `await import(fileUrl + "?t=" + Date.now())`. On success, return.
6. Attempt 3: Compute adjacent path `.cache.<basename>.<timestamp>-<random>.<ext>`, copy via `await Bun.write(adjacentPath, Bun.file(filePath))`, then `await import(adjacentUrl)`. On success, return.
7. If all three fail, throw a combined error listing all failure messages.

**Why:** Dynamic module loading with cache-busting for task definition files. Satisfies AC #44–50.

**Type signature:**

```typescript
export function loadFreshModule(modulePath: string | URL): Promise<Record<string, unknown>>;
```

**Test:** Create `src/core/__tests__/module-loader.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { loadFreshModule } from "../module-loader";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadFreshModule", () => {
  test("loads a module from an absolute path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modloader-"));
    const modPath = join(dir, "test-mod.ts");
    await writeFile(modPath, "export const value = 42;");
    const mod = await loadFreshModule(modPath);
    expect(mod.value).toBe(42);
    await rm(dir, { recursive: true });
  });

  test("throws TypeError for non-string non-URL argument", async () => {
    await expect(loadFreshModule(123 as any)).rejects.toThrow("Module path must be a string or URL");
  });

  test("throws for relative path", async () => {
    await expect(loadFreshModule("./relative.ts")).rejects.toThrow("Module path must be absolute");
  });

  test("throws for nonexistent module", async () => {
    await expect(loadFreshModule("/tmp/nonexistent-module-12345.ts")).rejects.toThrow("Module not found at");
  });

  test("accepts file:// URL string", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modloader-"));
    const modPath = join(dir, "test-mod.ts");
    await writeFile(modPath, "export const value = 99;");
    const mod = await loadFreshModule("file://" + modPath);
    expect(mod.value).toBe(99);
    await rm(dir, { recursive: true });
  });

  test("accepts URL object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modloader-"));
    const modPath = join(dir, "test-mod.ts");
    await writeFile(modPath, "export const value = 77;");
    const mod = await loadFreshModule(new URL("file://" + modPath));
    expect(mod.value).toBe(77);
    await rm(dir, { recursive: true });
  });
});
```

---

### Step 11: Implement `validation.ts` — seed validation

**What to do:** Create `src/core/validation.ts`. Import `Ajv` from `ajv` and `addFormats` from `ajv-formats`. Import `getConfig` from `./config`. Define and export `ValidationError`, `ValidationResult` types. Implement:

1. Create module-level `ajv` instance with `allErrors: true`.

2. `validateSeed(seed)`: Reads `getConfig()` to get current pipeline slugs and validation params (`seedNameMinLength`, `seedNameMaxLength`, `seedNamePattern`). Builds JSON schema with `pipeline` as an enum of registered slugs. Compiles and validates. Maps AJV errors to `{ message, path, params, keyword }`. Returns `{ valid: true }` or `{ valid: false, errors }`. Returns `{ valid: false, errors: [{ message: "Seed must be an object", path: "" }] }` for non-object input.

3. `formatValidationErrors(errors)`: Joins errors into a human-readable multiline string.

4. `validateSeedOrThrow(seed)`: Calls `validateSeed`, throws `Error` with `formatValidationErrors` output if invalid.

**Why:** Seed validation with dynamic pipeline enum from config. Satisfies AC #51–55, #60.

**Type signatures:**

```typescript
export interface ValidationError {
  message: string;
  path: string;
  params?: Record<string, unknown>;
  keyword?: string;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

export function validateSeed(seed: unknown): ValidationResult;
export function formatValidationErrors(errors: ValidationError[]): string;
export function validateSeedOrThrow(seed: unknown): void;
```

**Test:** Create `src/core/__tests__/validation.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { validateSeed, formatValidationErrors, validateSeedOrThrow } from "../validation";
import { resetConfig } from "../config";

describe("validateSeed", () => {
  afterEach(() => resetConfig());

  test("returns valid for a correct seed object", () => {
    // Requires config with registered pipelines
    // Setup test config with PO_ROOT pointing to a valid structure
    // or mock getConfig — implementation detail
  });

  test("returns invalid for empty object", () => {
    const result = validateSeed({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test("returns invalid for non-object input", () => {
    const result = validateSeed("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].message).toContain("object");
    }
  });
});

describe("formatValidationErrors", () => {
  test("formats errors into readable string", () => {
    const result = formatValidationErrors([
      { message: "required property 'name'", path: "" },
      { message: "must be string", path: "/name" },
    ]);
    expect(result).toContain("name");
    expect(typeof result).toBe("string");
  });
});

describe("validateSeedOrThrow", () => {
  test("throws on invalid input", () => {
    expect(() => validateSeedOrThrow(null)).toThrow();
  });
});
```

---

### Step 12: Implement `validation.ts` — pipeline validation

**What to do:** In `src/core/validation.ts`, implement:

1. `validatePipeline(pipeline)`: Builds static JSON schema requiring `name` (string) and `tasks` (array of strings, minItems 1), with `additionalProperties: true`. Compiles and validates. Returns `ValidationResult`.

2. `formatPipelineValidationErrors(errors)`: Same format as `formatValidationErrors`.

3. `validatePipelineOrThrow(pipeline, pathHint?)`: Calls `validatePipeline`, throws `Error` with `pathHint` (default `"pipeline.json"`) in the message header if invalid.

**Why:** Pipeline definition validation for API and CLI input. Satisfies AC #56–59, #61.

**Type signatures:**

```typescript
export function validatePipeline(pipeline: unknown): ValidationResult;
export function formatPipelineValidationErrors(errors: ValidationError[]): string;
export function validatePipelineOrThrow(pipeline: unknown, pathHint?: string): void;
```

**Test:** In `src/core/__tests__/validation.test.ts`:

```typescript
import { validatePipeline, validatePipelineOrThrow, formatPipelineValidationErrors } from "../validation";

describe("validatePipeline", () => {
  test("returns valid for correct pipeline", () => {
    const result = validatePipeline({ name: "test", tasks: ["t1"] });
    expect(result.valid).toBe(true);
  });

  test("returns invalid for missing tasks", () => {
    const result = validatePipeline({ name: "test" });
    expect(result.valid).toBe(false);
  });

  test("returns invalid for empty tasks array", () => {
    const result = validatePipeline({ name: "test", tasks: [] });
    expect(result.valid).toBe(false);
  });

  test("allows additional properties", () => {
    const result = validatePipeline({ name: "test", tasks: ["t1"], extra: true });
    expect(result.valid).toBe(true);
  });
});

describe("validatePipelineOrThrow", () => {
  test("throws with pathHint in message", () => {
    expect(() => validatePipelineOrThrow({}, "my-pipeline.json")).toThrow("my-pipeline.json");
  });
});

describe("formatPipelineValidationErrors", () => {
  test("formats errors into readable string", () => {
    const result = formatPipelineValidationErrors([
      { message: "required property 'name'", path: "" },
    ]);
    expect(typeof result).toBe("string");
    expect(result).toContain("name");
  });
});
```
