# Implementation Specification: `core/file-io`

**Analysis source:** `docs/specs/analysis/core/file-io.md`

---

## 1. Qualifications

- TypeScript strict mode (interfaces, generics, discriminated unions for write modes)
- Bun file I/O APIs (`Bun.file()`, `Bun.write()`)
- Bun SQLite (`bun:sqlite` — `Database` class, prepared statements, WAL mode)
- Node.js-compatible filesystem operations (`node:fs/promises` for `mkdir`, `rename`, `readFile`, `writeFile`, `appendFile`)
- Synchronous filesystem operations (`node:fs` for `readFileSync`, `writeFileSync`, `mkdirSync`)
- Regular expressions for log filename parsing/validation
- JSON serialization and deserialization
- Closure-based API design (factory function producing a bound interface)
- Atomic file writes (temp-file-then-rename pattern)

---

## 2. Problem Statement

The system requires a task-scoped file I/O adapter that provides scoped reads and writes to artifact, log, and tmp directories under a job's working directory, tracks written files in `tasks-status.json`, provides synchronous log writing for critical paths, exposes a Bun SQLite database for batch operations, and wraps the batch runner. The existing JS implementation provides this via `createTaskFileIO()` — a closure-based factory that binds all operations to a `workDir` and `taskName`. This spec defines the TypeScript replacement.

---

## 3. Goal

A TypeScript module at `src/core/file-io.ts` that provides identical behavioral contracts to the analyzed JS module — scoped file I/O, status tracking, log filename helpers, SQLite access, and batch execution — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/core/file-io.ts` | Task-scoped file I/O adapter factory, log filename helpers, sync/async write methods with status tracking, SQLite access, batch runner wrapper. |

### Key types and interfaces

```typescript
import type { Database } from "bun:sqlite";

/** Enum of valid log event types. */
// Re-exported from config/log-events
import type { LogEvent } from "../config/log-events";

/** Enum of valid log file extensions. */
// Re-exported from config/log-events
import type { LogFileExtension } from "../config/log-events";

/** Write mode for file operations. */
type WriteMode = "replace" | "append";

/** Options for write methods. */
interface WriteOptions {
  mode?: WriteMode;
}

/** Options for getDB. */
interface DBOptions {
  readonly?: boolean;
  create?: boolean;
  [key: string]: unknown;
}

/** Batch runner options passed through to executeBatch. */
interface BatchOptions {
  jobs: Array<Record<string, unknown>>;
  processor: (input: unknown, ctx: BatchProcessorContext) => Promise<unknown>;
  concurrency?: number;
  maxRetries?: number;
  batchId?: string;
}

/** Context passed to the batch processor function. */
interface BatchProcessorContext {
  attempt: number;
  batchId: string;
  db: Database;
}

/** Batch execution result. */
interface BatchResult {
  completed: Array<{ id: string; input: unknown; output: unknown }>;
  failed: Array<{ id: string; input: unknown; error: string; retryCount: number }>;
}

/** Configuration for createTaskFileIO. */
interface TaskFileIOConfig {
  /** Base job directory. */
  workDir: string;
  /** Task name, used for scoping under tasks/{taskName}. */
  taskName: string;
  /** Function that returns the current stage name. */
  getStage: () => string;
  /** Path to tasks-status.json, used to derive jobDir. */
  statusPath: string;
  /** Whether to track files at the task level. Defaults to true. */
  trackTaskFiles?: boolean;
}

/** The task-scoped file I/O adapter returned by createTaskFileIO. */
interface TaskFileIO {
  writeArtifact(name: string, content: string, options?: WriteOptions): Promise<void>;
  writeLog(name: string, content: string, options?: WriteOptions): Promise<void>;
  writeTmp(name: string, content: string, options?: WriteOptions): Promise<void>;
  readArtifact(name: string): Promise<string>;
  readLog(name: string): Promise<string>;
  readTmp(name: string): Promise<string>;
  getTaskDir(): string;
  writeLogSync(name: string, content: string, options?: WriteOptions): void;
  getCurrentStage(): string;
  getDB(options?: DBOptions): Database;
  runBatch(options: BatchOptions): Promise<BatchResult>;
}

/** Parsed log filename components. */
interface ParsedLogName {
  taskName: string;
  stage: string;
  event: string;
  ext: string;
}

/** Log name pattern for glob matching. */
// function getLogPattern(taskName?: string, stage?: string, event?: string, ext?: string): string
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| `Bun.file(path).text()` replaces `fs.readFile(path, "utf-8")` for read methods | Bun-native file reading, simpler API. |
| `Bun.write(path, content)` for replace-mode writes (non-atomic path) | Used in the temp-file step before atomic rename. Bun-native, more idiomatic. |
| `import { Database } from "bun:sqlite"` replaces any Node SQLite adapter | Bun's native SQLite is synchronous and high-performance. Already required by analysis. |
| `Bun.file(path).exists()` for existence checks in getDB | Simpler than `fs.access` catch pattern. |
| Atomic writes use `Bun.write()` + `rename()` | `Bun.write()` handles the temp file write; `node:fs/promises rename` provides the atomic swap (same as POSIX `rename(2)`). |

### Dependency map

| Source | Import | Purpose |
|--------|--------|---------|
| `./status-writer` | `writeJobStatus` | Async status tracking after file writes |
| `./batch-runner` | `executeBatch`, `validateBatchOptions` | Batch execution delegation |
| `../config/log-events` | `LogEvent`, `LogFileExtension` | Canonical log event and extension enums for `generateLogName` |
| `node:path` | `join`, `dirname`, `basename` | Path manipulation |
| `node:fs/promises` | `mkdir`, `rename`, `appendFile` | Directory creation, atomic rename, append-mode writes |
| `node:fs` | `mkdirSync`, `readFileSync`, `writeFileSync` | Synchronous operations for `writeLogSync` and sync status |
| `bun:sqlite` | `Database` | SQLite database for `getDB` |

---

## 5. Acceptance Criteria

### Core write behavior

1. `writeArtifact(name, content)` writes content to `{workDir}/files/artifacts/{name}`, creating directories lazily.
2. `writeLog(name, content)` writes content to `{workDir}/files/logs/{name}`, creating directories lazily.
3. `writeTmp(name, content)` writes content to `{workDir}/files/tmp/{name}`, creating directories lazily.
4. Default write mode is `"replace"`, which uses temp-file-then-rename for atomicity.
5. Write mode `"append"` uses direct append without the temp-file pattern.
6. `writeLog` throws if the filename does not match the structural pattern `^[^-]+-[^-]+-[^.]+\..+$` (via `validateLogName`).
7. `writeArtifact` and `writeTmp` do not validate filenames.

### Core read behavior

8. `readArtifact(name)` reads UTF-8 content from `{workDir}/files/artifacts/{name}`.
9. `readLog(name)` reads UTF-8 content from `{workDir}/files/logs/{name}`.
10. `readTmp(name)` reads UTF-8 content from `{workDir}/files/tmp/{name}`.
11. Missing files surface the underlying filesystem error (no catch/default).

### Utility methods

12. `getTaskDir()` returns `{workDir}/tasks/{taskName}` without creating the directory.
13. `getCurrentStage()` returns the value from the injected `getStage()` function, with no caching or normalization.

### Status tracking — async

14. After a successful async write (artifact, log, tmp), the bare filename is recorded in `tasks-status.json` under `snapshot.files.{artifacts,logs,tmp}` — deduplicated by `includes()` check.
15. If `trackTaskFiles` is `true`, the filename is also recorded under `snapshot.tasks[taskName].files` — deduplicated.
16. Status tracking uses `writeJobStatus` from `status-writer`, operating on `jobDir = dirname(statusPath)`.

### Status tracking — sync

17. `writeLogSync` validates the log name identically to `writeLog`.
18. `writeLogSync` uses synchronous fs calls (`mkdirSync`, `writeFileSync` or equivalent) and a local `writeJobStatusSync` for status tracking.
19. The sync status path reads and writes `tasks-status.json` directly (no temp-file-rename, no async queue participation).
20. On missing or invalid JSON in the sync path, a minimal default snapshot is used silently.

### SQLite access

21. `getDB()` ensures `{workDir}/files/artifacts/` exists, opens `{workDir}/files/artifacts/run.db` via `new Database(dbPath)` (or with options if provided), executes `PRAGMA journal_mode = WAL;`, and tracks `run.db` as an artifact via the sync status path.
22. Each `getDB()` call returns a new `Database` instance; the method does not close it.

### Batch execution

23. `runBatch(options)` validates options via `validateBatchOptions`, opens a DB via `this.getDB()`, delegates to `executeBatch(db, options)`, closes the DB in a `finally` block, and returns `{ completed, failed }`.

### Log filename helpers

24. `generateLogName(taskName, stage, event, ext)` throws if any argument is falsy, if `event` is not in `LogEvent`, or if `ext` is not in `LogFileExtension`. Returns `{taskName}-{stage}-{event}.{ext}`.
25. `parseLogName(fileName)` returns `null` for non-strings, parses with `^(?<taskName>[^-]+)-(?<stage>[^-]+)-(?<event>[^.]+)\.(?<ext>.+)$`, returns `{ taskName, stage, event, ext }` on match.
26. `validateLogName(fileName)` returns `parseLogName(fileName) !== null` (structural validation only, no canonical checks).
27. `getLogPattern(taskName, stage, event, ext)` returns a glob-like string `{taskName}-{stage}-{event}.{ext}` with `"*"` defaults for all parameters.

### Error handling

28. Failed file writes propagate filesystem errors to the caller.
29. Failed status tracking writes (async) do not fail the file write — SSE failures in status-writer are non-fatal.
30. `generateLogName` throws descriptive errors for invalid arguments (falsy values, non-canonical event/extension).

---

## 6. Notes

### Design trade-offs

- **Closure-based API retained:** The factory pattern (`createTaskFileIO`) is preserved from the JS original. It binds `workDir`, `taskName`, and other config into closures, providing a clean scoped interface without class instantiation. This is simpler and matches the existing call sites.
- **Sync status writer kept separate from async path:** The analysis confirmed that the sync path (`writeLogSync`, `getDB`) does not participate in the async write queue from `status-writer.js`. This is preserved as-is — the sync path is a pragmatic shortcut for critical code paths where awaiting the async queue is not feasible. The trade-off is a potential race between sync and async status writes; this is a known accepted risk from the original design.
- **No filename sanitization:** The analysis noted that `file-io.js` has no path traversal protection. This spec preserves that behavior to maintain identical contracts. Path security is handled at the system boundary (e.g., `validateFilePath` in status-writer for uploads).

### Known risks

- **Sync/async status write race:** Concurrent `writeLogSync` and async `writeJobStatus` calls for the same job can race. The sync path reads and writes `tasks-status.json` directly while the async path may have queued writes not yet flushed. This matches the JS behavior.
- **Crash during replace-mode write:** A crash between writing the temp file and the rename can leave behind `*.tmp` files. No cleanup mechanism exists. This matches the JS behavior.
- **Crash during sync status write:** Can leave `tasks-status.json` partially written. This matches the JS behavior.

### Migration-specific concerns

- **No behavioral changes:** This module is a straightforward port. All behavioral contracts from the JS original are preserved identically.
- **`bun:sqlite` already required:** The analysis confirms the JS module already imports `bun:sqlite`, so this is not a new dependency.

### Dependencies on other modules

- Depends on `core/status-writer` (`writeJobStatus`) being migrated or shimmed.
- Depends on `core/batch-runner` (`executeBatch`, `validateBatchOptions`) being migrated or shimmed.
- Depends on `config/log-events` (`LogEvent`, `LogFileExtension`) being migrated or shimmed.

### Performance considerations

- `Bun.write()` is generally faster than `fs.writeFile` for the temp-file step.
- `Bun.file(path).text()` is faster than `fs.readFile` for reads.
- SQLite `PRAGMA journal_mode = WAL` is already set, which is optimal for concurrent read access.

---

## 7. Implementation Steps

### Step 1: Define types, interfaces, and constants

**What:** Create `src/core/file-io.ts` with all type definitions: `WriteMode`, `WriteOptions`, `DBOptions`, `BatchOptions`, `BatchProcessorContext`, `BatchResult`, `TaskFileIOConfig`, `TaskFileIO`, `ParsedLogName`. Also define the log name regex constant and the file subdirectory constants (`"artifacts"`, `"logs"`, `"tmp"`).

**Why:** All subsequent steps depend on these types. Types-first ordering per spec conventions.

**Type signatures:**

```typescript
export type WriteMode = "replace" | "append";

export interface WriteOptions {
  mode?: WriteMode;
}

export interface TaskFileIOConfig {
  workDir: string;
  taskName: string;
  getStage: () => string;
  statusPath: string;
  trackTaskFiles?: boolean;
}

export interface TaskFileIO {
  writeArtifact(name: string, content: string, options?: WriteOptions): Promise<void>;
  writeLog(name: string, content: string, options?: WriteOptions): Promise<void>;
  writeTmp(name: string, content: string, options?: WriteOptions): Promise<void>;
  readArtifact(name: string): Promise<string>;
  readLog(name: string): Promise<string>;
  readTmp(name: string): Promise<string>;
  getTaskDir(): string;
  writeLogSync(name: string, content: string, options?: WriteOptions): void;
  getCurrentStage(): string;
  getDB(options?: DBOptions): Database;
  runBatch(options: BatchOptions): Promise<BatchResult>;
}

export interface ParsedLogName {
  taskName: string;
  stage: string;
  event: string;
  ext: string;
}

const LOG_NAME_PATTERN = /^(?<taskName>[^-]+)-(?<stage>[^-]+)-(?<event>[^.]+)\.(?<ext>.+)$/;
```

**Test:** `tests/core/file-io.test.ts` — assert `LOG_NAME_PATTERN` matches valid log names (`"task1-stage1-start.log"` → captures all four groups) and rejects invalid ones (`"no-dots"`, `""`, `"a.b"`).

---

### Step 2: Implement `parseLogName`, `validateLogName`, and `getLogPattern`

**What:** Implement the three log filename helper functions as named exports:

- `parseLogName(fileName)`: returns `null` for non-strings, applies `LOG_NAME_PATTERN`, returns `ParsedLogName | null`.
- `validateLogName(fileName)`: returns `parseLogName(fileName) !== null`.
- `getLogPattern(taskName?, stage?, event?, ext?)`: returns interpolated string with `"*"` defaults.

**Why:** These are pure functions with no dependencies, used by write methods and external callers. Acceptance criteria 25, 26, 27.

**Type signatures:**

```typescript
export function parseLogName(fileName: unknown): ParsedLogName | null
export function validateLogName(fileName: unknown): boolean
export function getLogPattern(
  taskName?: string,
  stage?: string,
  event?: string,
  ext?: string
): string
```

**Test:** `tests/core/file-io.test.ts`:
- `parseLogName("task1-stage1-start.log")` returns `{ taskName: "task1", stage: "stage1", event: "start", ext: "log" }`.
- `parseLogName("task1-stage1-pipeline-error.json")` returns `{ taskName: "task1", stage: "stage1", event: "pipeline-error", ext: "json" }` (event may contain hyphens).
- `parseLogName(123)` returns `null`.
- `parseLogName("invalid")` returns `null`.
- `validateLogName("a-b-c.d")` returns `true`.
- `validateLogName("nope")` returns `false`.
- `getLogPattern()` returns `"*-*-*.*"`.
- `getLogPattern("myTask", "s1")` returns `"myTask-s1-*.*"`.

---

### Step 3: Implement `generateLogName`

**What:** Implement `generateLogName` as a named export. It validates that all four arguments are truthy, that `event` is a valid `LogEvent` value, and that `ext` is a valid `LogFileExtension` value. Throws descriptive errors on failure. Returns `{taskName}-{stage}-{event}.{ext}`.

**Why:** Acceptance criterion 24. Used by pipeline-runner and orchestrator for structured log naming.

**Type signatures:**

```typescript
export function generateLogName(
  taskName: string,
  stage: string,
  event: string,
  ext?: string
): string
```

**Test:** `tests/core/file-io.test.ts`:
- `generateLogName("task1", "ingestion", "start", "log")` returns `"task1-ingestion-start.log"`.
- `generateLogName("task1", "ingestion", "start")` uses default extension (`LogFileExtension.TEXT` = `"log"`).
- Throws for falsy `taskName`, `stage`, or `event`.
- Throws for invalid `event` not in `LogEvent`.
- Throws for invalid `ext` not in `LogFileExtension`.

---

### Step 4: Implement core write helper with atomic replace and append modes

**What:** Implement an internal `writeFile(filePath, content, mode)` function used by all async write methods. For `"replace"` mode: write to a temp file (`{filePath}.tmp`) via `Bun.write()`, then atomically rename to the target via `rename()`. For `"append"` mode: use `appendFile()` directly. Both modes lazily create parent directories via `mkdir({ recursive: true })`.

**Why:** Acceptance criteria 4, 5. Shared logic for `writeArtifact`, `writeLog`, `writeTmp`.

**Type signatures:**

```typescript
// internal, not exported
async function writeFileScoped(
  filePath: string,
  content: string,
  mode: WriteMode
): Promise<void>
```

**Test:** `tests/core/file-io.test.ts`:
- Replace mode: write content to a path in a temp dir. Assert file exists with correct content. Assert no `.tmp` file remains.
- Append mode: write "a" then append "b". Assert file contains "ab".
- Both modes: write to a path with a non-existent parent directory. Assert directory is created and file is written.

---

### Step 5: Implement async status tracking helper

**What:** Implement an internal `trackFile(jobDir, category, fileName, taskName, trackTaskFiles)` function that calls `writeJobStatus(jobDir, updater)`. The updater ensures `snapshot.files.{category}` exists (as an array), pushes `fileName` if not already present (via `includes()`), and if `trackTaskFiles` is true, also ensures `snapshot.tasks[taskName].files` exists and de-duplicates there.

**Why:** Acceptance criteria 14, 15, 16. Shared by all async write methods.

**Type signatures:**

```typescript
// internal, not exported
async function trackFile(
  jobDir: string,
  category: "artifacts" | "logs" | "tmp",
  fileName: string,
  taskName: string,
  trackTaskFiles: boolean
): Promise<void>
```

**Test:** `tests/core/file-io.test.ts`:
- Mock `writeJobStatus`. Call `trackFile` with category `"artifacts"` and a filename. Assert the updater function adds the filename to `snapshot.files.artifacts` and to `snapshot.tasks[taskName].files.artifacts`.
- Call again with the same filename. Assert no duplicate is added.
- Call with `trackTaskFiles: false`. Assert only `snapshot.files` is updated, not `snapshot.tasks`.

---

### Step 6: Implement sync status writer

**What:** Implement an internal `writeJobStatusSync(jobDir, updater)` function for the sync write path. It reads `tasks-status.json` synchronously, parses JSON (falling back to a minimal default `{ id, state: "pending", tasks: {}, files: { artifacts: [], logs: [], tmp: [] } }` on missing or invalid JSON), applies the updater, writes the result back synchronously as pretty-printed JSON (2-space indent). No temp-file-rename, no async queue participation.

**Why:** Acceptance criteria 17–20. Used by `writeLogSync` and `getDB`.

**Type signatures:**

```typescript
// internal, not exported
function writeJobStatusSync(
  jobDir: string,
  updater: (snapshot: Record<string, unknown>) => void
): void
```

**Test:** `tests/core/file-io.test.ts`:
- Write a valid `tasks-status.json` to a temp dir. Call `writeJobStatusSync` with an updater that adds a field. Assert the file contains the updated field.
- Call when `tasks-status.json` does not exist. Assert a default snapshot is created with the updater applied.
- Call when `tasks-status.json` contains invalid JSON. Assert a default snapshot is used.

---

### Step 7: Implement `createTaskFileIO` — factory function with scoped read/write methods

**What:** Implement the `createTaskFileIO(config)` factory function as a named export. It computes directory paths (`artifactsDir`, `logsDir`, `tmpDir`, `taskDir`, `jobDir`) from `config.workDir`, `config.taskName`, and `config.statusPath`. Returns a `TaskFileIO` object with:

- `writeArtifact`, `writeLog`, `writeTmp`: call `writeFileScoped` with the appropriate directory, then `trackFile` for status tracking. `writeLog` validates the filename first via `validateLogName`.
- `readArtifact`, `readLog`, `readTmp`: read via `Bun.file(path).text()`.
- `getTaskDir()`: returns `taskDir`.
- `getCurrentStage()`: returns `config.getStage()`.
- `writeLogSync`: validates log name, uses sync fs calls, then `writeJobStatusSync` for tracking.

**Why:** Acceptance criteria 1–3, 6–13, 17–18. This is the primary public API.

**Type signatures:**

```typescript
export function createTaskFileIO(config: TaskFileIOConfig): TaskFileIO
```

**Test:** `tests/core/file-io.test.ts`:
- Create a `TaskFileIO` instance with a temp `workDir`. Call `writeArtifact("test.txt", "hello")`. Assert file exists at `{workDir}/files/artifacts/test.txt` with content `"hello"`.
- Call `readArtifact("test.txt")`. Assert returns `"hello"`.
- Call `writeLog("task1-stage1-start.log", "data")`. Assert file exists at `{workDir}/files/logs/task1-stage1-start.log`.
- Call `writeLog("invalid", "data")`. Assert throws.
- Call `writeTmp("temp.txt", "tmp")`. Assert file exists at `{workDir}/files/tmp/temp.txt`.
- Call `readTmp("temp.txt")`. Assert returns `"tmp"`.
- Call `getTaskDir()`. Assert returns `{workDir}/tasks/{taskName}`.
- Call `getCurrentStage()`. Assert returns value from `getStage`.
- Call `writeLogSync("task1-stage1-start.log", "sync data")`. Assert file exists with content.
- Call `writeLogSync("invalid", "data")`. Assert throws.

---

### Step 8: Implement `getDB` — SQLite database access

**What:** Implement the `getDB(options?)` method on the `TaskFileIO` object. It ensures `{workDir}/files/artifacts/` exists (via `mkdirSync`), constructs the path `{workDir}/files/artifacts/run.db`, creates a new `Database` instance (passing `options` if provided), executes `PRAGMA journal_mode = WAL;`, tracks `run.db` as an artifact via `writeJobStatusSync`, and returns the `Database`.

**Why:** Acceptance criteria 21, 22.

**Type signatures:**

```typescript
// Part of TaskFileIO interface
getDB(options?: DBOptions): Database
```

**Test:** `tests/core/file-io.test.ts`:
- Create a `TaskFileIO` instance. Call `getDB()`. Assert returns a `Database` instance. Assert `run.db` exists at `{workDir}/files/artifacts/run.db`. Execute a simple query (`SELECT 1`) to verify it works.
- Call `getDB()` twice. Assert two different `Database` instances are returned.
- Call `getDB({ readonly: true })`. Assert the database opens without error.

---

### Step 9: Implement `runBatch` — batch runner wrapper

**What:** Implement the `runBatch(options)` method on the `TaskFileIO` object. It calls `validateBatchOptions(options)`, opens a database via `this.getDB()`, delegates to `executeBatch(db, options)`, closes the database in a `finally` block, and returns the result.

**Why:** Acceptance criterion 23.

**Type signatures:**

```typescript
// Part of TaskFileIO interface
runBatch(options: BatchOptions): Promise<BatchResult>
```

**Test:** `tests/core/file-io.test.ts`:
- Create a `TaskFileIO` instance. Call `runBatch` with a minimal batch (one job, simple processor). Assert the result has `completed` with one entry and `failed` as empty.
- Call `runBatch` with invalid options (missing `processor`). Assert throws validation error.
- Assert the database is closed after `runBatch` completes (even on error — test with a failing processor).

---

### Step 10: Integration test — full write/read/track lifecycle

**What:** Write an integration test that exercises the full lifecycle: create a `TaskFileIO` instance with a real temp directory, write artifacts/logs/tmp files using both replace and append modes, read them back, verify status tracking by reading `tasks-status.json` directly, test `getDB` and verify `run.db` is tracked, and test `writeLogSync`.

**Why:** End-to-end validation that all steps work together. Covers acceptance criteria 1–22 in combination.

**Test:** `tests/core/file-io.integration.test.ts`:
- Set up a temp directory with a valid `tasks-status.json`.
- Create `TaskFileIO` with `trackTaskFiles: true`.
- Write an artifact, a log, and a tmp file.
- Read each back and assert content matches.
- Read `tasks-status.json` and assert all three filenames appear in `files.artifacts`, `files.logs`, `files.tmp` respectively, and in `tasks[taskName].files`.
- Write the same artifact again. Assert no duplicate in status.
- Call `getDB()`, run a query, close DB. Assert `run.db` in artifacts list.
- Call `writeLogSync` with a valid name. Assert file exists and status is updated.
- Write in append mode. Assert content is appended.
