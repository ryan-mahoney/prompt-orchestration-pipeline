# Specification Review: `core/file-io`

**Reviewed source files:**
- `src/core/file-io.js`
- `src/core/symlink-bridge.js`
- `src/core/symlink-utils.js`
- `src/core/status-writer.js`
- `src/core/batch-runner.js`
- `src/config/log-events.js`

## Verdict

The previous analysis overstated the scope of `file-io.js` and was inaccurate in a few important places:

- `file-io.js` does **not** create or manage symlink bridges. Those behaviors live in separate modules.
- `writeLog()` and `writeLogSync()` do **not** enforce canonical log events/extensions. They only require a filename that can be parsed as `something-something-something.ext`.
- Async status updates do **not** warn on missing or invalid `tasks-status.json`; `status-writer.js` recreates a default snapshot instead.
- The sync status path in `file-io.js` is much less robust than the async path and can race with queued async status writes.

This patched analysis reflects the current implementation.

---

## 1. Purpose

`src/core/file-io.js` builds a task-scoped file I/O adapter around a job `workDir`. It provides:

- scoped artifact/log/tmp reads and writes
- file registration in `tasks-status.json`
- a synchronous log-writing path for critical code paths
- access to a Bun SQLite database at `files/artifacts/run.db`
- a thin `runBatch()` wrapper over `batch-runner`

Related symlink helpers exist in `src/core/symlink-bridge.js` and `src/core/symlink-utils.js`, but they are **not** called by `createTaskFileIO()`.

## 2. Public Interface

### 2.1 `createTaskFileIO(config)`

Creates a closure-bound file API for one task.

Parameters:

| Field | Type | Required | Notes |
|---|---|---|---|
| `workDir` | string | Yes | Base job directory |
| `taskName` | string | Yes | Used for `tasks/{taskName}` and task-level status tracking |
| `getStage` | function | Yes | Returned unchanged through `getCurrentStage()` |
| `statusPath` | string | Yes | Used to derive `jobDir = dirname(statusPath)` |
| `trackTaskFiles` | boolean | No | Defaults to `true` |

Returns an object with:

- `writeArtifact(name, content, options?)`
- `writeLog(name, content, options?)`
- `writeTmp(name, content, options?)`
- `readArtifact(name)`
- `readLog(name)`
- `readTmp(name)`
- `getTaskDir()`
- `writeLogSync(name, content, options?)`
- `getCurrentStage()`
- `getDB(options?)`
- `runBatch(options)`

### 2.2 Write methods

Common behavior:

- Artifacts go to `{workDir}/files/artifacts/{name}`
- Logs go to `{workDir}/files/logs/{name}`
- Tmp files go to `{workDir}/files/tmp/{name}`
- Directories are created lazily with `mkdir(..., { recursive: true })`
- Default mode is `"replace"` for all async write methods
- `"replace"` uses temp-file then rename
- `"append"` uses direct append
- After a successful write, the bare filename is recorded in `tasks-status.json`

Important accuracy note:

- `writeLog()` validates with `validateLogName()`
- `validateLogName()` only checks whether `parseLogName()` returns non-null
- That means names like `foo-bar-baz.txt` pass validation even if `baz` is not a canonical `LogEvent` and `txt` is not a canonical `LogFileExtension`

Method-specific notes:

| Method | Extra behavior |
|---|---|
| `writeArtifact` | No filename validation |
| `writeLog` | Throws only if filename does not match `^[^-]+-[^-]+-[^.]+\\..+$` |
| `writeTmp` | No filename validation |
| `writeLogSync` | Same validation semantics as `writeLog`, but uses sync fs calls and a local sync status writer |

### 2.3 Read methods

- `readArtifact(name)`
- `readLog(name)`
- `readTmp(name)`

Each reads UTF-8 from the corresponding directory. Missing files surface the underlying filesystem error.

### 2.4 Utility methods

`getTaskDir()`

- Returns `{workDir}/tasks/{taskName}`
- Does not create that directory

`getCurrentStage()`

- Returns `getStage()`
- No caching or normalization

### 2.5 `getDB(options?)`

Behavior:

- Ensures `{workDir}/files/artifacts` exists
- Opens `{workDir}/files/artifacts/run.db`
- If `options` is empty, calls `new Database(dbPath)`
- Otherwise calls `new Database(dbPath, options)`
- Executes `PRAGMA journal_mode = WAL;`
- Tracks `run.db` as an artifact using the sync status path

Notes:

- Each call returns a new `Database` instance
- `getDB()` itself does not close the database
- Bun runtime is required because it imports `bun:sqlite`

### 2.6 `runBatch(options)`

Thin wrapper:

1. calls `validateBatchOptions(options)`
2. opens a DB via `this.getDB()`
3. delegates to `executeBatch(db, options)`
4. closes the DB in `finally`

Return shape:

- `{ completed, failed }`

`executeBatch()` also:

- ensures the `batch_jobs` schema exists
- recovers stale `"processing"` rows back to `"pending"`
- inserts jobs with `INSERT OR IGNORE`
- retries failed jobs until `retry_count >= maxRetries`

## 3. Log Filename Helpers

### 3.1 `generateLogName(taskName, stage, event, ext = LogFileExtension.TEXT)`

This is the strict helper.

It throws when:

- any argument is falsy
- `event` is not in `LogEvent`
- `ext` is not in `LogFileExtension`

Valid `LogEvent` values come from `src/config/log-events.js`:

- `start`
- `complete`
- `error`
- `context`
- `debug`
- `metrics`
- `pipeline-start`
- `pipeline-complete`
- `pipeline-error`
- `execution-logs`
- `failure-details`

Valid extensions:

- `log`
- `json`

### 3.2 `parseLogName(fileName)`

Behavior:

- returns `null` for non-strings
- parses with `^(?<taskName>[^-]+)-(?<stage>[^-]+)-(?<event>[^.]+)\\.(?<ext>.+)$`
- returns `{ taskName, stage, event, ext }` on match

Important consequence:

- `taskName` cannot contain `-`
- `stage` cannot contain `-`
- `event` may contain `-`
- `ext` is any non-empty suffix after the final `.`

### 3.3 `validateLogName(fileName)`

Returns `parseLogName(fileName) !== null`.

It does **not** verify canonical events or canonical extensions.

### 3.4 `getLogPattern(taskName = "*", stage = "*", event = "*", ext = "*")`

Returns a glob-like string:

- `${taskName}-${stage}-${event}.${ext}`

This helper does not validate inputs.

## 4. Status Tracking Semantics

Async writes call `writeJobStatus(jobDir, updater)` from `status-writer.js`.

Actual behavior:

- writes are serialized per `jobDir` through an in-memory promise queue
- missing `tasks-status.json` creates a default snapshot
- invalid JSON also creates a default snapshot and emits `console.warn(...)`
- unknown fields on the snapshot are preserved unless overwritten by the updater
- `lastUpdated` is refreshed on each async write
- SSE events are attempted after writes, but SSE failures do not fail the write

File tracking behavior in `file-io.js`:

- ensures `snapshot.files.{artifacts,logs,tmp}` exist
- pushes only if the filename is not already present
- if `trackTaskFiles` is true, also ensures `snapshot.tasks[taskName].files` exists and de-duplicates there too

Sync status behavior is different:

- `writeLogSync()` and `getDB()` use a local `writeJobStatusSync()` inside `file-io.js`
- that sync path reads and writes `tasks-status.json` directly
- it does not use temp-file-rename for the status file
- it does not participate in the async queue from `status-writer.js`
- on missing or invalid JSON, it silently falls back to a minimal default snapshot

## 5. Directory Layout

`file-io.js` writes only under:

```text
{workDir}/
  files/
    artifacts/
    logs/
    tmp/
  tasks/
    {taskName}/
```

Important accuracy note:

- `createTaskFileIO()` computes `tasks/{taskName}` for `getTaskDir()`
- it does **not** create symlinks or populate that directory on its own

## 6. Concurrency and Failure Modes

### Guaranteed or mostly guaranteed

- Replace-mode file writes are atomic at the target-file level because they use write-then-rename
- Async status writes are serialized per job
- File name tracking is de-duplicated by simple `includes()` checks

### Not guaranteed

- No filename sanitization or path traversal protection exists in `file-io.js`
- Concurrent sync and async status writes can race
- Append mode is not atomic in the same way replace mode is
- Crash during sync status write can leave `tasks-status.json` partially written
- Crash during replace-mode file write can leave behind `*.tmp` files

## 7. Related Symlink Utilities

These are separate from `file-io.js`, but the previous analysis was broadly correct that they exist:

### `ensureTaskSymlinkBridge({ taskDir, poRoot, taskModulePath })`

- creates `taskDir` if needed
- creates `taskDir/node_modules` pointing to `path.resolve(poRoot, "..", "node_modules")`
- creates `taskDir/_task_root` pointing to `dirname(taskModulePath)`
- returns `taskDir/_task_root/{basename(taskModulePath)}`

### `ensureSymlink(linkPath, targetPath, type)`

- idempotent for an already-correct symlink
- removes conflicting file/dir/symlink first
- wraps failures in a contextual `Error`

### `validateTaskSymlinks(taskDir, expectedTargets)`

- validates `node_modules` and `_task_root`
- checks existence, symlink-ness, resolved target match, and accessible directory targets
- returns `{ isValid, errors, details, duration }`

### `repairTaskSymlinks(taskDir, poRoot, taskModulePath)`

- delegates to `ensureTaskSymlinkBridge()`
- returns `{ success, relocatedEntry, duration, errors }`

### `cleanupTaskSymlinks(completedJobDir)`

- walks `{completedJobDir}/tasks/*`
- best-effort removes `node_modules`, `project`, and `_task_root` if they are symlinks
- swallows per-entry cleanup failures

## 8. Bottom Line

The implementation is a task-scoped filesystem/status adapter with a Bun SQLite convenience layer. The biggest corrections versus the original analysis are:

- symlink functionality is adjacent, not part of `createTaskFileIO()`
- log validation in write paths is structural, not canonical
- async status handling is more resilient than described
- sync status handling is less safe than described
