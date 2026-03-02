# SpecOps Analysis: `core/batch-runner`

**Source Files:** `src/core/batch-runner.js`

---

## 1. Purpose & Responsibilities

The Batch Runner module provides **concurrent job processing with durable state management** backed by SQLite. It runs a collection of independent work items (jobs) in parallel, persists their state, retries failures up to a configurable limit, and exposes enough state to support limited recovery-oriented reruns when the caller reuses the same database, `batchId`, and stable job IDs.

**Responsibilities:**

- Accepting a batch of job definitions and a processor function, then executing them concurrently up to a configurable concurrency limit.
- Persisting job state (`pending`, `processing`, `complete`, `failed`) in a SQLite `batch_jobs` table.
- Retrying failed jobs up to a configurable maximum, automatically re-queuing them between processing rounds.
- Recovering jobs left in `processing` by resetting them to `pending` before a new execution begins for the same `batchId`.
- Returning a structured summary of completed jobs and failed jobs whose `retry_count` has reached the configured threshold.

**Boundaries — what it does NOT do:**

- It does **not** define what a "job" does — the caller supplies the `processor` function.
- It does **not** create or manage the SQLite database instance; it receives one via injection.
- It does **not** handle job scheduling across multiple processes or machines; it is a single-process, in-memory concurrency limiter backed by persistent state.
- It does **not** emit events, progress callbacks, or real-time status updates. It is a run-to-completion batch executor.

**Pattern:** This module implements a **durable task queue** pattern, but the resume story is partial rather than seamless: persisted state survives, while successful resumption still depends on how the caller chooses `batchId` and job IDs.

---

## 2. Public Interface

### `ensureBatchSchema(db)`

- **Purpose:** Creates the `batch_jobs` table and its index if they do not already exist.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection (Bun's `bun:sqlite` `Database`). |
- **Return value:** None (void).
- **Failure modes:** Will throw if the database is closed or if there is a file-system error preventing table creation.

### `insertJobs(db, batchId, jobs)`

- **Purpose:** Inserts job records into the `batch_jobs` table for a given batch, using each job's `id` or a generated UUID as the table primary key.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection. |
  | `batchId` | string | Yes | Batch identifier stored in the `batch_id` column and used to scope later reads and stale-job recovery. |
  | `jobs` | Array of Objects | Yes | Job definitions. Each object is serialized as JSON and stored in the `input` column. If a job has an `id` property, it is used as the primary key; otherwise a UUID is generated. |
- **Return value:** `string[]` — an array of job IDs in insertion order.
- **Failure modes:**
  - Throws an `Error` if an existing row with the same `id` and same `batchId` is found in `complete` or `permanently_failed` state.
  - Uses `INSERT OR IGNORE`, so any primary-key collision on `id` is skipped. If the colliding row belongs to a different batch, the follow-up status check does not find it, so no error is raised and the ID is still returned.
  - Duplicate IDs for same-batch rows in `pending`, `processing`, or `failed` are also silently skipped.
- **Transactional behavior:** All inserts run inside a single database transaction. If any insert throws (e.g., due to the terminal-state check), the entire transaction rolls back and no jobs are inserted.

### `markProcessing(db, jobId)`

- **Purpose:** Transitions a job to the `processing` state and records the start timestamp.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection. |
  | `jobId` | string | Yes | The primary key of the job to update. |
- **Return value:** None (void).
- **Failure modes:** No validation; if `jobId` does not match a row, no error is raised and no rows are changed.

### `markComplete(db, jobId, output)`

- **Purpose:** Transitions a job to the `complete` state, stores the output, and records the completion timestamp.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection. |
  | `jobId` | string | Yes | The primary key of the job to update. |
  | `output` | any | Yes | The result produced by the processor. Serialized to JSON before storage. |
- **Return value:** None (void).
- **Failure modes:** If `output` is not JSON-serializable and this function is called via `processOneJob`, that error is caught by `processOneJob` and converted into a failed job via `markFailed`. Direct callers would see the thrown serialization error.

### `markFailed(db, jobId, error)`

- **Purpose:** Transitions a job to the `failed` state, stores the error message, and increments the retry counter.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection. |
  | `jobId` | string | Yes | The primary key of the job to update. |
  | `error` | string | Yes | A human-readable error description. |
- **Return value:** None (void).
- **Failure modes:** None beyond database I/O errors.

### `getPendingJobs(db, batchId, maxRetries)`

- **Purpose:** Retrieves jobs that are eligible for (re-)processing — those in `pending` or `failed` status with a retry count below the limit.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection. |
  | `batchId` | string | Yes | Scopes the query to a specific batch. |
  | `maxRetries` | number (integer) | Yes | The maximum allowed value of `retry_count` for a job to remain eligible. Jobs with `retry_count >= maxRetries` are excluded. In practice this makes `maxRetries` behave like a total-attempts ceiling, not "retries after the first attempt." |
- **Return value:** `Array<{ id: string, input: Object, retryCount: number }>` — the `input` field is deserialized from JSON. Results are ordered by `id` (ascending).
- **Failure modes:** Will throw if stored `input` JSON is corrupt and cannot be parsed.

### `recoverStaleJobs(db, batchId)`

- **Purpose:** Recovers jobs that were left in the `processing` state due to a process crash, resetting them to `pending` so they can be re-processed.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection. |
  | `batchId` | string | Yes | Scopes the recovery to a specific batch. |
- **Return value:** `number` — the count of jobs that were recovered.
- **Failure modes:** None beyond database I/O errors.

### `validateBatchOptions(options)`

- **Purpose:** Validates the shape and types of the options object before batch execution begins.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `options` | Object | Yes | The options bag to validate. Expected fields: `jobs` (non-empty array), `processor` (function), `concurrency` (optional positive integer), `maxRetries` (optional non-negative integer). |
- **Return value:** None (void). Returns normally if validation passes.
- **Failure modes:** Throws a descriptive `Error` for each validation failure: options not an object, `jobs` not an array, `jobs` empty, `processor` not a function, `concurrency` not a positive integer, `maxRetries` not a non-negative integer.

### `executeBatch(db, options)`

- **Purpose:** The primary low-level entry point. Orchestrates schema setup, stale-job recovery, job insertion, concurrent processing, and result collection.
- **Parameters:**
  | Name | Type | Required | Description |
  |------|------|----------|-------------|
  | `db` | SQLite Database instance | Yes | An open SQLite database connection. |
  | `options` | Object | Yes | Configuration for the batch. |
  | `options.jobs` | Array of Objects | Yes | The jobs to process. |
  | `options.processor` | Function | Yes | `async (input, ctx) => result`. Called for each job. Receives the deserialized job input and a context object `{ attempt, batchId, db }`. |
  | `options.concurrency` | number | No | Maximum concurrent jobs. Defaults to `10`. |
  | `options.maxRetries` | number | No | Retry threshold used by `getPendingJobs` / `getFailedJobs`. Defaults to `3`. |
  | `options.batchId` | string | No | A unique batch identifier. Defaults to a generated UUID. |
- **Return value:** `Promise<{ completed: Array, failed: Array }>` where:
  - `completed` — array of `{ id, input, output }` for all jobs that reached `complete` status.
  - `failed` — array of `{ id, input, error, retryCount }` for all jobs that exhausted retries while still in `failed` status.
- **Failure modes:** Propagates schema, database, and insertion errors. Individual processor failures are caught internally and recorded in the database; they do not reject the returned promise. `executeBatch` does not validate `options` itself, so malformed input can also fail earlier during destructuring or later inside `p-limit` / SQL calls.

---

## 3. Data Models & Structures

### `batch_jobs` Table (SQLite)

The persistent data model. One row per job.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | TEXT (PK) | No | — | Unique job identifier across the entire table, not just within a batch. Supplied by the caller or auto-generated as a UUID. |
| `batch_id` | TEXT | No | — | Groups jobs into a logical batch for scoped queries. |
| `status` | TEXT | No | `'pending'` | State machine value. Valid values: `pending`, `processing`, `complete`, `failed`. (The `permanently_failed` value is referenced in an error check but is never written by this module.) |
| `input` | TEXT | No | — | JSON-serialized job definition as provided by the caller. |
| `output` | TEXT | Yes | `NULL` | JSON-serialized result from the processor, populated on completion. |
| `error` | TEXT | Yes | `NULL` | Error message string, populated on failure. |
| `retry_count` | INTEGER | No | `0` | Number of recorded failures for this job. Incremented on each failure. |
| `started_at` | TEXT | Yes | `NULL` | ISO-8601 timestamp set when the job enters `processing` state. Uses `datetime('now')`. |
| `completed_at` | TEXT | Yes | `NULL` | ISO-8601 timestamp set when the job enters `complete` state. Uses `datetime('now')`. |

**Index:** `idx_batch_jobs_batch_status` on `(batch_id, status)` — optimizes the primary query pattern of finding jobs by batch and status.

**Lifecycle:**

1. Created with status `pending` during `insertJobs`.
2. Transitions to `processing` when picked up by `processOneJob`.
3. Transitions to `complete` (with output) on success, or `failed` (with error, incremented retry count) on failure.
4. Failed jobs with `retry_count < maxRetries` are re-fetched by `getPendingJobs` and re-processed in the next loop iteration.
5. Jobs stuck in `processing` (from a crash) are reset to `pending` by `recoverStaleJobs`.

**Ownership:** This module owns the table schema and all writes. The caller owns the database file and connection.

**Serialization:** Job input and output are stored as JSON text. No schema versioning or migration mechanism exists.

### Processor Context Object

Passed as the second argument to the `processor` function.

| Field | Type | Description |
|-------|------|-------------|
| `attempt` | number | The 1-based attempt number for this job (`retryCount + 1`). |
| `batchId` | string | The batch identifier, allowing the processor to correlate with the batch. |
| `db` | SQLite Database | The same database instance, exposed so the processor can perform its own queries if needed. |

### Batch Result Object

Returned by `executeBatch`.

| Field | Type | Description |
|-------|------|-------------|
| `completed` | Array of `{ id, input, output }` | Jobs that finished successfully. `input` and `output` are deserialized from JSON. |
| `failed` | Array of `{ id, input, error, retryCount }` | Jobs that exhausted all retries. `input` is deserialized from JSON; `error` is a string. |

---

## 4. Behavioral Contracts

### Preconditions

- The `db` parameter must be an open, writable SQLite database connection.
- Direct callers of `executeBatch` must provide a structurally valid `options` object; the low-level function does not call `validateBatchOptions`.
- The higher-level `runBatch()` wrapper in `src/core/file-io.js` does call `validateBatchOptions` before opening the database.

### Postconditions

- On ordinary successful runs with `maxRetries >= 1`, jobs inserted for this invocation will end in either `complete` or `failed` with `retry_count >= maxRetries`.
- If `maxRetries` is `0`, `getPendingJobs()` returns no work and newly inserted jobs remain `pending`.
- The returned result contains rows in `complete` plus rows in `failed` whose `retry_count >= maxRetries`.

### Invariants

- A job's `retry_count` is monotonically increasing; it is never decremented by this module.
- A job `id` is globally unique across `batch_jobs` because `id` alone is the primary key.
- Same-batch rows in `complete` or `permanently_failed` cannot be re-inserted without causing `insertJobs()` to throw.

### Ordering Guarantees

- `getPendingJobs` returns jobs ordered by `id` (ascending). This provides deterministic pick-up order.
- Within a processing round, jobs execute concurrently (up to the concurrency limit). There is no guaranteed completion order.
- Retry rounds are sequential: all jobs from one round must settle before the next round's pending jobs are fetched.

### Concurrency Behavior

- Concurrency is bounded by `p-limit` at the configured `concurrency` value (default 10).
- `Promise.allSettled` is used, so all jobs in a round complete (or fail) before the next round begins. A single slow job blocks the start of the next retry round.
- The module is **not** designed for concurrent calls to `executeBatch` with the same `batchId`.
- Different `batchId` values can coexist only if their job IDs are also distinct, because writes and inserts key off the globally unique `id` column.

---

## 5. State Management

### In-Memory State

- **Concurrency limiter:** An instance of `p-limit` is created per `executeBatch` call. It lives for the duration of that call and is garbage-collected afterward.
- No singleton or module-level mutable state exists. The module is stateless between calls.

### Persisted State

- All durable state lives in the `batch_jobs` SQLite table. The read/write pattern is:
  1. **Write:** Insert pending jobs (transactional batch insert).
  2. **Write per job:** Update status to `processing`, then to `complete` or `failed`.
  3. **Read:** Fetch pending/failed jobs at the start of each retry round.
  4. **Read:** Fetch completed and failed jobs at the end for the result.
- Timestamps use SQLite's `datetime('now')`, which returns UTC.

### Crash Recovery

- If the process crashes while jobs are in `processing` state, `recoverStaleJobs` (called at the start of `executeBatch`) resets them to `pending`. This means:
  - **Output of a partially-processed job is lost** (it was never written to the database).
  - **The job can be re-executed from scratch** on a later run, but only if the caller reruns with a compatible `batchId` / job-ID set.
  - **The retry count is NOT incremented** by recovery — only by explicit failure. A crash during processing does not count as a retry attempt.

### Shared State

- The SQLite database is shared with the caller. This module assumes exclusive control of the `batch_jobs` table but does not enforce it (no locking beyond SQLite's built-in transaction isolation).

---

## 6. Dependencies

### 6.1 Internal Dependencies

None. This module does not import any other module from the project.

### 6.2 External Dependencies

| Package | What It Provides | How It's Used | Replaceability |
|---------|-----------------|---------------|----------------|
| `node:crypto` | UUID generation | `crypto.randomUUID()` for generating job IDs and batch IDs when not supplied by the caller. | Easily replaceable with any UUID generator. |
| `p-limit` | Concurrency limiter | Creates a limiter with the configured concurrency value; wraps each job's processing call. | Localized usage; any concurrency-limiting utility with the same API shape would work. |

### 6.3 System-Level Dependencies

- **SQLite database:** The caller must provide an open `bun:sqlite` `Database` instance. The module uses Bun-specific SQLite APIs (`db.exec`, `db.prepare`, `db.transaction`, `stmt.run`, `stmt.get`, `stmt.all`) and the `result.changes` property.
- **No file system, network, or environment variable dependencies** within this module itself — all I/O is mediated through the injected database handle.

---

## 7. Side Effects & I/O

### Database I/O

| Operation | Sync/Async | Description |
|-----------|-----------|-------------|
| `ensureBatchSchema` | Synchronous | Creates table and index via `db.exec`. |
| `insertJobs` | Synchronous | Transactional batch insert via prepared statements. |
| `markProcessing` | Synchronous | Single-row UPDATE. |
| `markComplete` | Synchronous | Single-row UPDATE with JSON serialization. |
| `markFailed` | Synchronous | Single-row UPDATE with retry count increment. |
| `getPendingJobs` | Synchronous | SELECT query with JSON deserialization. |
| `recoverStaleJobs` | Synchronous | Bulk UPDATE resetting `processing` → `pending`. |
| `getCompletedJobs` | Synchronous | SELECT query with JSON deserialization. |
| `getFailedJobs` | Synchronous | SELECT query with JSON deserialization. |

All database operations are synchronous (Bun's SQLite driver is synchronous). The only asynchronous operation is the user-supplied `processor` function.

### Logging & Observability

None. This module does not log anything. Status is communicated solely through the returned result object and the database state.

### Timing & Scheduling

No timers, intervals, or polling. The retry loop is driven by a `while` loop that re-queries the database for pending jobs after each round of processing settles.

---

## 8. Error Handling & Failure Modes

### Error Categories

| Category | Source | Handling |
|----------|--------|----------|
| Validation errors | `validateBatchOptions` | Thrown immediately with descriptive messages. |
| Terminal-state conflict | `insertJobs` | Thrown when attempting to re-insert a same-batch job that is `complete` or `permanently_failed`. Rolls back the entire transaction. |
| Processor errors | User-supplied `processor` function | Caught by `processOneJob`'s try/catch. The error message is stored via `markFailed`. The job becomes eligible for retry. |
| Database errors | SQLite operations | Not explicitly caught by this module; they propagate to the caller. |
| JSON parse errors | `JSON.parse` in read helpers | Not explicitly caught; will propagate. |
| JSON stringify errors | `JSON.stringify` in `insertJobs` / `markComplete` | In `insertJobs`, they propagate and abort the transaction. In `markComplete`, they occur inside `processOneJob`'s `try` block and are converted into failed-job records if `markFailed` succeeds. |

### Propagation Strategy

- **Per-job failures:** Caught and recorded in the database. They do **not** cause `executeBatch` to reject. Individual jobs fail silently (from the caller's perspective) and appear in the `failed` array of the result.
- **Infrastructure failures** (database errors, schema creation failures): Propagate as thrown errors or rejected promises.

### Partial Failure

- If the process crashes mid-batch, the database retains all state, and `recoverStaleJobs` can reset in-flight rows to `pending` on a later invocation with the same `batchId`.
- That is not a seamless full-batch resume API: if the caller reruns `executeBatch` with the original full job list and stable IDs, any already-`complete` rows will cause `insertJobs` to throw before processing starts.
- If job IDs were auto-generated on the first run, rerunning with the same logical jobs creates new rows instead of resuming the originals.
- If `insertJobs` fails mid-transaction (e.g., due to the terminal-state check), the entire transaction rolls back — no partial inserts.

### User/Operator Visibility

- No logging, no events, no progress callbacks. The caller learns about failures only by inspecting the `failed` array in the result, or by querying the database directly.

---

## 9. Integration Points & Data Flow

### Upstream

- The primary caller is expected to be any module that needs to run a set of independent tasks concurrently with durability guarantees (e.g., orchestrating multiple LLM calls, file processing jobs, etc.).
- The caller provides: a database handle, job definitions, a processor function, and optional configuration.

### Downstream

- The `processor` function (caller-supplied) is the primary downstream dependency. It receives job input and a context object and is expected to return a result or throw an error.
- The processor also receives the `db` handle, enabling it to perform its own database operations within the same SQLite database.

### Data Transformation

1. **Input:** Caller provides plain objects as job definitions → serialized to JSON for storage.
2. **Processing:** Deserialized from JSON → passed to the processor → processor result serialized to JSON for storage.
3. **Output:** Deserialized from JSON → returned in the result object as parsed objects.

### Control Flow — Primary Use Case (`executeBatch`)

1. Destructure options, applying defaults for `concurrency` (10), `maxRetries` (3), and `batchId` (new UUID).
2. Call `ensureBatchSchema` — create table if needed.
3. Call `recoverStaleJobs` — reset any `processing` jobs from a prior crash.
4. Call `insertJobs` — add all jobs as `pending`, skip rows that already exist in a non-terminal state, and throw for same-batch rows already in `complete` / `permanently_failed`.
5. **Retry loop:** `while (pending.length > 0)`:
   a. Fetch pending/failed jobs with `retry_count < maxRetries`.
   b. Map each job through `pLimit` → `processOneJob`.
   c. `await Promise.allSettled(promises)` — wait for all jobs in this round.
   d. Re-fetch pending jobs to check for failed-and-retryable jobs.
6. Collect and return `{ completed, failed }`.

---

## 10. Edge Cases & Implicit Behavior

- **Default concurrency of 10** is applied silently if not specified. This could lead to resource contention if the processor is resource-intensive.
- **Default `maxRetries` of `3`** means each job gets at most 3 total attempts under the current implementation: attempt 1 starts at `retry_count = 0`, and the job stops being eligible once failures raise `retry_count` to `3`.
- **`maxRetries = 0`** is allowed by validation but results in zero processing attempts, because `getPendingJobs()` only returns rows where `retry_count < maxRetries`.
- **`INSERT OR IGNORE` semantics:** If a row with the same `id` already exists, the new input is ignored. For same-batch non-terminal rows this acts like a partial idempotency mechanism; for cross-batch collisions it silently prevents insertion into the new batch.
- **UUID generation for job IDs:** If a job object does not have an `id` property, a UUID is auto-generated at insertion time. Re-running with the same logical jobs but without explicit IDs creates new rows rather than resuming existing ones.
- **`permanently_failed` status is checked but never written:** The `insertJobs` function checks for `permanently_failed` in the terminal-state guard, but no function in this module ever sets a job's status to `permanently_failed`. The `failed` status with `retry_count >= maxRetries` is the de facto terminal failure state. This suggests either an external process sets `permanently_failed`, or it is vestigial.
- **`validateBatchOptions` is exported but not called by `executeBatch`:** The validation function exists as a public utility, but `executeBatch` does not invoke it. This means callers must call it explicitly or risk runtime errors deeper in the execution flow.
- **Crash during `markComplete` or `markFailed`:** If the process crashes after the processor returns but before the database write, the job will be recovered as `pending` and re-executed. The processor should ideally be idempotent to handle this case safely.
- **`started_at` is overwritten on retry:** Each time a job enters `processing`, `started_at` is updated. The original start time of the first attempt is lost.
- **No timeout mechanism:** There is no built-in timeout for the processor function. A processor that hangs will block indefinitely.

---

## 11. Open Questions & Ambiguities

1. **Why is `validateBatchOptions` not called within `executeBatch`?** The higher-level `runBatch()` wrapper in `src/core/file-io.js` does validate first, so the low-level function appears to rely on wrapper discipline. Is that split intentional?

2. **What writes the `permanently_failed` status?** The `insertJobs` function guards against re-inserting jobs in `permanently_failed` state, but no code in this module transitions a job to that status. Is there an external process or another module that sets this status? Or is this dead code from a removed feature?

3. **Is there an intended mechanism for batch resumption?** `recoverStaleJobs` suggests resume support, but rerunning with the full original job list and stable IDs will fail if any row is already `complete`. The intended caller contract for resumable batches is unclear.

4. **Why is the `db` handle passed to the processor context?** This gives the processor direct access to the SQLite database, including the `batch_jobs` table. This is a powerful but potentially dangerous capability — a processor could corrupt batch state. Is this intentional for advanced use cases, or an incidental leak of implementation detail?

5. **No progress reporting mechanism exists.** For long-running batches with many jobs, there is no way for the caller to observe progress without polling the database directly. Was a callback or event-based progress API considered?

6. **Magic number: `datetime('now')`** — timestamps are generated by SQLite, not by the application. This means timestamps reflect the database server's clock (the local system in this case). In distributed scenarios (which the module doesn't target), this could be an issue.

7. **No cleanup or TTL for completed batch data.** The `batch_jobs` table grows indefinitely. There is no mechanism to purge old batch records. Is cleanup expected to be handled externally?
