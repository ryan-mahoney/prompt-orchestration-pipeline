# Implementation Specification: `core/batch-runner`

**Analysis source:** `docs/specs/analysis/core/batch-runner.md`

---

## 1. Qualifications

- TypeScript strict mode: generics, discriminated unions, branded types
- Bun `bun:sqlite` API: `Database`, `Statement`, prepared statements, `.run()`, `.get()`, `.all()`, `.exec()`, `db.transaction()`, `result.changes`
- SQLite schema design: DDL, indexes, `INSERT OR IGNORE`, status-machine column patterns
- Concurrency control: promise-based concurrency limiting, `Promise.allSettled`
- JSON serialization/deserialization edge cases
- UUID generation via `crypto.randomUUID()`

---

## 2. Problem Statement

The system requires a durable concurrent batch job executor backed by SQLite that can run independent work items in parallel, persist their state, retry failures, and recover from crashes. The existing JS implementation provides this via `p-limit` for concurrency control, `bun:sqlite` for persistence, and a retry loop driven by re-querying the database. This spec defines the TypeScript replacement.

---

## 3. Goal

A TypeScript module at `src/core/batch-runner.ts` that provides identical behavioral contracts to the analyzed JS module — concurrent job processing with SQLite-backed durable state, retry logic, and crash recovery — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/core/batch-runner.ts` | All batch runner logic: schema management, job CRUD, concurrent execution, retry loop, validation, and result collection. |
| `src/core/__tests__/batch-runner.test.ts` | Tests for all batch runner functionality. |

### Key types and interfaces

```typescript
import type { Database } from "bun:sqlite";

// --- Job status discriminated union ---

type JobStatus = "pending" | "processing" | "complete" | "failed";

// Rows read from the database may contain "permanently_failed" written by
// external processes. This wider type is used for the row shape and the
// terminal-state guard in insertJobs.
type PersistedJobStatus = JobStatus | "permanently_failed";

type TerminalJobStatus = "complete" | "permanently_failed";

// --- Database row shape ---

interface BatchJobRow {
  id: string;
  batch_id: string;
  status: PersistedJobStatus;
  input: string;       // JSON text
  output: string | null;
  error: string | null;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
}

// --- Pending job (returned by getPendingJobs) ---

interface PendingJob {
  id: string;
  input: unknown;
  retryCount: number;
}

// --- Processor context ---

interface ProcessorContext {
  attempt: number;
  batchId: string;
  db: Database;
}

// --- Processor function signature ---

type BatchProcessor = (input: unknown, ctx: ProcessorContext) => Promise<unknown>;

// --- Batch options ---

interface BatchOptions {
  jobs: Record<string, unknown>[];
  processor: BatchProcessor;
  concurrency?: number;
  maxRetries?: number;
  batchId?: string;
}

// --- Completed job in result ---

interface CompletedJob {
  id: string;
  input: unknown;
  output: unknown;
}

// --- Failed job in result ---

interface FailedJob {
  id: string;
  input: unknown;
  error: string;
  retryCount: number;
}

// --- Batch result ---

interface BatchResult {
  completed: CompletedJob[];
  failed: FailedJob[];
}
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| Replace `p-limit` with a simple Bun-native concurrency limiter | `p-limit` is a small utility. A ~15-line TypeScript implementation using a queue of resolve callbacks avoids an external dependency and is trivially testable. Alternatively, keep `p-limit` if the project already depends on it — the analysis shows it is the sole external runtime dependency. |
| Use `crypto.randomUUID()` directly | Available globally in Bun without importing `node:crypto`. |
| All SQLite operations use `bun:sqlite` types | The module already targets `bun:sqlite`. TypeScript types from `bun:sqlite` (`Database`, `Statement`) are used directly. |

**Decision on `p-limit`:** Replace `p-limit` with a minimal inline concurrency limiter to eliminate the external dependency. The limiter is ~15 lines and scoped entirely to `executeBatch`.

### Dependency map

**Internal (`src/`) imports:** None. This module is a leaf dependency with no imports from other project modules.

**External packages:**

| Package | Usage |
|---------|-------|
| `bun:sqlite` | `Database` type for all database operations |

---

## 5. Acceptance Criteria

### Core behavior

1. `ensureBatchSchema(db)` creates a `batch_jobs` table with the correct columns and an index `idx_batch_jobs_batch_status` on `(batch_id, status)` if they do not exist. Running it twice on the same database is idempotent.
2. `insertJobs(db, batchId, jobs)` inserts all jobs in a single transaction and returns an array of job IDs in insertion order.
3. When a job object has an `id` property, that value is used as the primary key; otherwise a UUID is generated.
4. `insertJobs` uses `INSERT OR IGNORE` so duplicate primary-key rows are silently skipped. Because `id` is the table-wide primary key, this includes duplicates across different batches — a job ID that already exists in another batch is silently skipped, and the returned ID array still includes that ID.
5. `insertJobs` throws if an existing same-batch row is in `complete` or `permanently_failed` status, and rolls back the entire transaction.
6. `markProcessing(db, jobId)` sets `status = 'processing'` and updates `started_at` to the current UTC datetime.
7. `markComplete(db, jobId, output)` sets `status = 'complete'`, stores `JSON.stringify(output)`, and updates `completed_at`.
8. `markFailed(db, jobId, error)` sets `status = 'failed'`, stores the error string, and increments `retry_count` by 1.
9. `getPendingJobs(db, batchId, maxRetries)` returns jobs in `pending` or `failed` status with `retry_count < maxRetries`, ordered by `id` ascending, with `input` deserialized from JSON.
10. `recoverStaleJobs(db, batchId)` resets all `processing` jobs for the given batch to `pending` and returns the count of recovered jobs.

### Concurrency

11. `executeBatch` processes jobs concurrently up to the configured `concurrency` limit (default 10).
12. All jobs in a processing round complete (via `Promise.allSettled`) before the next round of pending jobs is fetched.
13. A slow job does not prevent other jobs in the same round from starting (up to the concurrency limit).

### Retry behavior

14. Failed jobs with `retry_count < maxRetries` (i.e., jobs that have not yet exhausted their total-attempt budget) are re-fetched and re-processed in the next round.
15. When `maxRetries` is 0, no jobs are processed (the pending query returns nothing).
16. The default `maxRetries` is 3. Despite its name, `maxRetries` controls the total-attempt ceiling, not retries after a first attempt: a job with `maxRetries: 3` gets up to 3 total calls to the processor (the query `retry_count < maxRetries` enforces this because `retry_count` starts at 0 and increments on each failure).
17. The `attempt` field in the processor context equals `retryCount + 1`.

### Crash recovery

18. `recoverStaleJobs` is called at the start of `executeBatch`, resetting any `processing` jobs from a prior crash to `pending`.
19. Recovery does not increment `retry_count`.
20. `executeBatch` accepts an empty `jobs` array for recovery-only invocations. The empty-array check in `validateBatchOptions` applies only when callers invoke validation explicitly (see AC 22).

### Validation

21. `validateBatchOptions` throws a descriptive error when: options is not an object, `jobs` is not an array, `jobs` is empty, `processor` is not a function, `concurrency` is present but not a positive integer, `maxRetries` is present but not a non-negative integer.
22. `validateBatchOptions` is exported but NOT called by `executeBatch` — callers must invoke it explicitly.

### Error handling

23. Individual processor failures are caught, recorded via `markFailed`, and do not reject the `executeBatch` promise.
24. The processor context includes `{ attempt, batchId, db }`.
25. Database/schema errors propagate as thrown errors from `executeBatch`.
26. If `JSON.stringify(output)` fails inside `processOneJob`, the error is caught and the job is marked as failed.
27. Thrown values that are not `Error` instances are normalized to strings before being passed to `markFailed`: `Error` → `.message`, `string` → used directly, all other types → `String(value)`.

### Result

28. `executeBatch` returns `{ completed, failed }` where `completed` contains all `complete` jobs and `failed` contains all jobs with `retry_count >= maxRetries` still in `failed` status, both with deserialized `input`.

---

## 6. Notes

### Design trade-offs

- **Inline concurrency limiter vs. `p-limit`:** The analysis shows `p-limit` is the sole external runtime dependency. Replacing it with an inline limiter eliminates a dependency at the cost of ~15 lines of code. The limiter's behavior is well-defined (queue-based, FIFO dispatch) and easy to test. If the project retains `p-limit` elsewhere, consider keeping it for consistency.
- **`validateBatchOptions` not called by `executeBatch`:** This split is intentional per the analysis — the higher-level `runBatch()` wrapper in `file-io.ts` calls validation first. The low-level function trusts its caller.

### Open questions from analysis

- **`permanently_failed` status is checked but never written:** The `insertJobs` terminal-state guard checks for it, but no code in this module writes it. Preserve this behavior (check but don't write) for compatibility with potential external writers.
- **No batch resumption API:** `recoverStaleJobs` provides partial crash recovery, but re-inserting already-complete jobs causes a throw. This is a known limitation, not a bug.
- **No timeout mechanism:** The processor function can hang indefinitely. This is unchanged from the JS implementation — timeout enforcement is the caller's responsibility.
- **No cleanup/TTL for batch data:** The `batch_jobs` table grows indefinitely. This is unchanged.

### Dependencies on other modules

- This module has **no** internal dependencies. It can be implemented and tested in isolation.
- The `file-io.ts` module (step 4 in the orchestration) wraps this module via `runBatch()`. That integration is file-io's concern, not batch-runner's.

### Performance considerations

- All SQLite operations are synchronous (Bun's SQLite driver). The only async work is the user-supplied processor function.
- The concurrency limiter and `Promise.allSettled` introduce negligible overhead.
- Transaction-wrapped inserts are efficient for bulk job creation.

---

## 7. Implementation Steps

### Step 1: Define types and interfaces

**What to do:** Create `src/core/batch-runner.ts` with all type definitions: `JobStatus`, `PersistedJobStatus`, `TerminalJobStatus`, `BatchJobRow`, `PendingJob`, `ProcessorContext`, `BatchProcessor`, `BatchOptions`, `CompletedJob`, `FailedJob`, `BatchResult`. Export all public types.

**Why:** Types are the foundation for all subsequent functions and satisfy the Architecture § Key types requirement.

**Type signatures:**

```typescript
export type JobStatus = "pending" | "processing" | "complete" | "failed";
export type PersistedJobStatus = JobStatus | "permanently_failed";
export type TerminalJobStatus = "complete" | "permanently_failed";

export interface PendingJob {
  id: string;
  input: unknown;
  retryCount: number;
}

export interface ProcessorContext {
  attempt: number;
  batchId: string;
  db: Database;
}

export type BatchProcessor = (input: unknown, ctx: ProcessorContext) => Promise<unknown>;

export interface BatchOptions {
  jobs: Record<string, unknown>[];
  processor: BatchProcessor;
  concurrency?: number;
  maxRetries?: number;
  batchId?: string;
}

export interface CompletedJob {
  id: string;
  input: unknown;
  output: unknown;
}

export interface FailedJob {
  id: string;
  input: unknown;
  error: string;
  retryCount: number;
}

export interface BatchResult {
  completed: CompletedJob[];
  failed: FailedJob[];
}
```

**Test:** Create `src/core/__tests__/batch-runner.test.ts`. Import all exported types and verify they are importable without errors:

```typescript
// batch-runner.test.ts
import type { PendingJob, ProcessorContext, BatchProcessor, BatchOptions, CompletedJob, FailedJob, BatchResult } from "../batch-runner";
import { describe, test, expect } from "bun:test";

describe("batch-runner types", () => {
  test("types are importable", () => {
    // Type-level check — this test passes if the file compiles
    expect(true).toBe(true);
  });
});
```

---

### Step 2: Implement `ensureBatchSchema`

**What to do:** In `src/core/batch-runner.ts`, implement and export `ensureBatchSchema(db: Database): void`. Use `db.exec()` to run `CREATE TABLE IF NOT EXISTS batch_jobs (...)` with all columns from the analysis, and `CREATE INDEX IF NOT EXISTS idx_batch_jobs_batch_status ON batch_jobs (batch_id, status)`.

**Why:** Schema setup is the prerequisite for all other operations (AC #1).

**Type signature:**

```typescript
export function ensureBatchSchema(db: Database): void;
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("ensureBatchSchema", () => {
  test("creates batch_jobs table and index", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='batch_jobs'").all();
    expect(tables).toHaveLength(1);
    const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_batch_jobs_batch_status'").all();
    expect(indexes).toHaveLength(1);
    db.close();
  });

  test("is idempotent", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    ensureBatchSchema(db);
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='batch_jobs'").all();
    expect(tables).toHaveLength(1);
    db.close();
  });
});
```

---

### Step 3: Implement `insertJobs`

**What to do:** Implement and export `insertJobs(db: Database, batchId: string, jobs: Record<string, unknown>[]): string[]`. Within a `db.transaction()`:

1. For each job, determine the ID: use `job.id` (cast to string) if present, otherwise `crypto.randomUUID()`.
2. Before inserting, query for an existing row with the same `id` and `batchId` in a terminal state (`complete` or `permanently_failed`). If found, throw an `Error`.
3. Use a prepared `INSERT OR IGNORE INTO batch_jobs (id, batch_id, status, input) VALUES (?, ?, 'pending', ?)` statement.
4. Collect and return all IDs in insertion order.

**Why:** Job insertion with transactional safety and terminal-state guards satisfies AC #2–5.

**Type signature:**

```typescript
export function insertJobs(db: Database, batchId: string, jobs: Record<string, unknown>[]): string[];
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("insertJobs", () => {
  test("inserts jobs and returns IDs in order", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    const ids = insertJobs(db, "batch1", [{ id: "a", data: 1 }, { id: "b", data: 2 }]);
    expect(ids).toEqual(["a", "b"]);
    const rows = db.query("SELECT id FROM batch_jobs ORDER BY id").all();
    expect(rows).toHaveLength(2);
    db.close();
  });

  test("generates UUIDs for jobs without id", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    const ids = insertJobs(db, "batch1", [{ data: 1 }]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    db.close();
  });

  test("throws on re-inserting a complete job in same batch", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch1", [{ id: "a" }]);
    db.query("UPDATE batch_jobs SET status = 'complete' WHERE id = 'a'").run();
    expect(() => insertJobs(db, "batch1", [{ id: "a" }])).toThrow();
    db.close();
  });

  test("skips duplicate IDs via INSERT OR IGNORE", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch1", [{ id: "a" }]);
    const ids = insertJobs(db, "batch1", [{ id: "a" }]);
    expect(ids).toEqual(["a"]);
    const rows = db.query("SELECT id FROM batch_jobs").all();
    expect(rows).toHaveLength(1);
    db.close();
  });

  test("silently skips cross-batch duplicate IDs and still returns the ID", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch1", [{ id: "shared" }]);
    const ids = insertJobs(db, "batch2", [{ id: "shared" }]);
    expect(ids).toEqual(["shared"]);
    // Only one row exists because id is the table-wide PK
    const rows = db.query("SELECT id FROM batch_jobs WHERE id = 'shared'").all();
    expect(rows).toHaveLength(1);
    db.close();
  });

  test("rolls back entire transaction on terminal-state error", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch1", [{ id: "a" }]);
    db.query("UPDATE batch_jobs SET status = 'complete' WHERE id = 'a'").run();
    expect(() => insertJobs(db, "batch1", [{ id: "b" }, { id: "a" }])).toThrow();
    // "b" should not have been inserted because the transaction rolled back
    const rows = db.query("SELECT id FROM batch_jobs WHERE id = 'b'").all();
    expect(rows).toHaveLength(0);
    db.close();
  });
});
```

---

### Step 4: Implement `markProcessing`, `markComplete`, `markFailed`

**What to do:** Implement and export three functions:

- `markProcessing(db: Database, jobId: string): void` — `UPDATE batch_jobs SET status = 'processing', started_at = datetime('now') WHERE id = ?`
- `markComplete(db: Database, jobId: string, output: unknown): void` — `UPDATE batch_jobs SET status = 'complete', output = ?, completed_at = datetime('now') WHERE id = ?` with `JSON.stringify(output)`.
- `markFailed(db: Database, jobId: string, error: string): void` — `UPDATE batch_jobs SET status = 'failed', error = ?, retry_count = retry_count + 1 WHERE id = ?`

**Why:** These state transition functions are used by `processOneJob` and satisfy AC #6–8.

**Type signatures:**

```typescript
export function markProcessing(db: Database, jobId: string): void;
export function markComplete(db: Database, jobId: string, output: unknown): void;
export function markFailed(db: Database, jobId: string, error: string): void;
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("mark functions", () => {
  test("markProcessing sets status and started_at", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    markProcessing(db, "j1");
    const row = db.query("SELECT status, started_at FROM batch_jobs WHERE id = 'j1'").get() as any;
    expect(row.status).toBe("processing");
    expect(row.started_at).toBeTruthy();
    db.close();
  });

  test("markComplete sets status, output, and completed_at", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    markComplete(db, "j1", { result: 42 });
    const row = db.query("SELECT status, output, completed_at FROM batch_jobs WHERE id = 'j1'").get() as any;
    expect(row.status).toBe("complete");
    expect(JSON.parse(row.output)).toEqual({ result: 42 });
    expect(row.completed_at).toBeTruthy();
    db.close();
  });

  test("markFailed sets status, error, and increments retry_count", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    markFailed(db, "j1", "boom");
    const row = db.query("SELECT status, error, retry_count FROM batch_jobs WHERE id = 'j1'").get() as any;
    expect(row.status).toBe("failed");
    expect(row.error).toBe("boom");
    expect(row.retry_count).toBe(1);
    markFailed(db, "j1", "boom again");
    const row2 = db.query("SELECT retry_count FROM batch_jobs WHERE id = 'j1'").get() as any;
    expect(row2.retry_count).toBe(2);
    db.close();
  });
});
```

---

### Step 5: Implement `getPendingJobs`

**What to do:** Implement and export `getPendingJobs(db: Database, batchId: string, maxRetries: number): PendingJob[]`. Query: `SELECT id, input, retry_count as retryCount FROM batch_jobs WHERE batch_id = ? AND status IN ('pending', 'failed') AND retry_count < ? ORDER BY id ASC`. Deserialize `input` from JSON for each row.

**Why:** This is the query that drives the retry loop (AC #9, #14–16).

**Type signature:**

```typescript
export function getPendingJobs(db: Database, batchId: string, maxRetries: number): PendingJob[];
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("getPendingJobs", () => {
  test("returns pending and failed jobs below retry threshold", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }, { id: "j2" }, { id: "j3" }]);
    markFailed(db, "j2", "err");
    markComplete(db, "j3", "done");
    const pending = getPendingJobs(db, "b1", 3);
    expect(pending.map(j => j.id)).toEqual(["j1", "j2"]);
    expect(pending[1].retryCount).toBe(1);
    db.close();
  });

  test("excludes jobs at or above maxRetries", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    markFailed(db, "j1", "err1");
    markFailed(db, "j1", "err2");
    markFailed(db, "j1", "err3");
    const pending = getPendingJobs(db, "b1", 3);
    expect(pending).toHaveLength(0);
    db.close();
  });

  test("returns empty when maxRetries is 0", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    const pending = getPendingJobs(db, "b1", 0);
    expect(pending).toHaveLength(0);
    db.close();
  });

  test("deserializes input from JSON", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1", data: { nested: true } }]);
    const pending = getPendingJobs(db, "b1", 3);
    expect(pending[0].input).toEqual({ id: "j1", data: { nested: true } });
    db.close();
  });
});
```

---

### Step 6: Implement `recoverStaleJobs`

**What to do:** Implement and export `recoverStaleJobs(db: Database, batchId: string): number`. Execute: `UPDATE batch_jobs SET status = 'pending' WHERE batch_id = ? AND status = 'processing'`. Return `result.changes` (the number of rows affected).

**Why:** Crash recovery prerequisite for `executeBatch` (AC #10, #18–19).

**Type signature:**

```typescript
export function recoverStaleJobs(db: Database, batchId: string): number;
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("recoverStaleJobs", () => {
  test("resets processing jobs to pending and returns count", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }, { id: "j2" }]);
    markProcessing(db, "j1");
    markProcessing(db, "j2");
    const recovered = recoverStaleJobs(db, "b1");
    expect(recovered).toBe(2);
    const rows = db.query("SELECT status FROM batch_jobs WHERE batch_id = 'b1'").all() as any[];
    expect(rows.every(r => r.status === "pending")).toBe(true);
    db.close();
  });

  test("does not increment retry_count", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    markProcessing(db, "j1");
    recoverStaleJobs(db, "b1");
    const row = db.query("SELECT retry_count FROM batch_jobs WHERE id = 'j1'").get() as any;
    expect(row.retry_count).toBe(0);
    db.close();
  });

  test("does not affect other batches", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    insertJobs(db, "b2", [{ id: "j2" }]);
    markProcessing(db, "j1");
    markProcessing(db, "j2");
    const recovered = recoverStaleJobs(db, "b1");
    expect(recovered).toBe(1);
    const row = db.query("SELECT status FROM batch_jobs WHERE id = 'j2'").get() as any;
    expect(row.status).toBe("processing");
    db.close();
  });
});
```

---

### Step 7: Implement `validateBatchOptions`

**What to do:** Implement and export `validateBatchOptions(options: unknown): void`. Validate:

1. `options` is a non-null object — throw `"Batch options must be an object"`.
2. `options.jobs` is an array — throw `"jobs must be an array"`.
3. `options.jobs` is non-empty — throw `"jobs must not be empty"`.
4. `options.processor` is a function — throw `"processor must be a function"`.
5. If `options.concurrency` is defined, it must be a positive integer — throw `"concurrency must be a positive integer"`.
6. If `options.maxRetries` is defined, it must be a non-negative integer — throw `"maxRetries must be a non-negative integer"`.

**Why:** Validates caller input before batch execution (AC #21–22).

**Type signature:**

```typescript
export function validateBatchOptions(options: unknown): void;
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("validateBatchOptions", () => {
  test("passes with valid options", () => {
    expect(() => validateBatchOptions({
      jobs: [{ id: "1" }],
      processor: async () => {},
    })).not.toThrow();
  });

  test("throws when options is not an object", () => {
    expect(() => validateBatchOptions(null)).toThrow("object");
    expect(() => validateBatchOptions("bad")).toThrow("object");
  });

  test("throws when jobs is not an array", () => {
    expect(() => validateBatchOptions({ jobs: "bad", processor: async () => {} })).toThrow("array");
  });

  test("throws when jobs is empty", () => {
    expect(() => validateBatchOptions({ jobs: [], processor: async () => {} })).toThrow("empty");
  });

  test("throws when processor is not a function", () => {
    expect(() => validateBatchOptions({ jobs: [{}], processor: "bad" })).toThrow("function");
  });

  test("throws when concurrency is not a positive integer", () => {
    expect(() => validateBatchOptions({ jobs: [{}], processor: async () => {}, concurrency: 0 })).toThrow("positive integer");
    expect(() => validateBatchOptions({ jobs: [{}], processor: async () => {}, concurrency: -1 })).toThrow("positive integer");
    expect(() => validateBatchOptions({ jobs: [{}], processor: async () => {}, concurrency: 1.5 })).toThrow("positive integer");
  });

  test("throws when maxRetries is not a non-negative integer", () => {
    expect(() => validateBatchOptions({ jobs: [{}], processor: async () => {}, maxRetries: -1 })).toThrow("non-negative integer");
    expect(() => validateBatchOptions({ jobs: [{}], processor: async () => {}, maxRetries: 1.5 })).toThrow("non-negative integer");
  });

  test("allows maxRetries of 0", () => {
    expect(() => validateBatchOptions({ jobs: [{}], processor: async () => {}, maxRetries: 0 })).not.toThrow();
  });
});
```

---

### Step 8: Implement inline concurrency limiter

**What to do:** In `src/core/batch-runner.ts`, implement a private function `createLimiter(concurrency: number)` that returns a function `<T>(fn: () => Promise<T>) => Promise<T>`. The limiter queues calls and dispatches up to `concurrency` at a time using a FIFO queue of deferred promises.

**Why:** Replaces `p-limit` with zero external dependencies (AC #11–13).

**Type signature (private, not exported):**

```typescript
function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("concurrency limiter (via executeBatch)", () => {
  test("respects concurrency limit", async () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    let concurrent = 0;
    let maxConcurrent = 0;
    const result = await executeBatch(db, {
      jobs: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })),
      processor: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 10));
        concurrent--;
        return "ok";
      },
      concurrency: 3,
      maxRetries: 1,
    });
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(result.completed).toHaveLength(10);
    db.close();
  });
});
```

---

### Step 9: Implement `processOneJob` (private) and `executeBatch`

**What to do:** Implement:

1. A private `processOneJob` function that: calls `markProcessing`, invokes the `processor` with `{ attempt: retryCount + 1, batchId, db }`, calls `markComplete` on success, catches errors (including serialization errors from `markComplete`) and calls `markFailed` with the normalized error string. Error normalization rule: if the caught value is an `Error`, use `.message`; if it is a `string`, use it directly; for all other types, use `String(value)`.

2. Two private query helpers:
   - `getCompletedJobs(db: Database, batchId: string): CompletedJob[]` — `SELECT id, input, output FROM batch_jobs WHERE batch_id = ? AND status = 'complete'`, deserializing `input` and `output` from JSON.
   - `getFailedJobs(db: Database, batchId: string, maxRetries: number): FailedJob[]` — `SELECT id, input, error, retry_count as retryCount FROM batch_jobs WHERE batch_id = ? AND status = 'failed' AND retry_count >= ?`, deserializing `input`.

3. Export `executeBatch(db: Database, options: BatchOptions): Promise<BatchResult>`:
   - Destructure options with defaults: `concurrency = 10`, `maxRetries = 3`, `batchId = crypto.randomUUID()`.
   - Call `ensureBatchSchema(db)`.
   - Call `recoverStaleJobs(db, batchId)`.
   - Call `insertJobs(db, batchId, options.jobs)`.
   - Create concurrency limiter.
   - Retry loop: `while (getPendingJobs(db, batchId, maxRetries).length > 0)`: fetch pending, map through limiter → `processOneJob`, `await Promise.allSettled(promises)`.
   - Collect and return `{ completed: getCompletedJobs(...), failed: getFailedJobs(...) }`.

**Why:** This is the core batch execution engine (AC #11–20, #23–28).

**Type signature:**

```typescript
export function executeBatch(db: Database, options: BatchOptions): Promise<BatchResult>;
```

**Test:** In `batch-runner.test.ts`:

```typescript
describe("executeBatch", () => {
  test("processes all jobs and returns results", async () => {
    const db = new Database(":memory:");
    const result = await executeBatch(db, {
      jobs: [{ id: "a", value: 1 }, { id: "b", value: 2 }],
      processor: async (input) => ({ doubled: (input as any).value * 2 }),
      maxRetries: 1,
    });
    expect(result.completed).toHaveLength(2);
    expect(result.completed.find(j => j.id === "a")?.output).toEqual({ doubled: 2 });
    expect(result.failed).toHaveLength(0);
    db.close();
  });

  test("retries failed jobs within total-attempt budget (maxRetries)", async () => {
    const db = new Database(":memory:");
    let attempts = 0;
    const result = await executeBatch(db, {
      jobs: [{ id: "a" }],
      processor: async () => {
        attempts++;
        if (attempts < 3) throw new Error("fail");
        return "ok";
      },
      maxRetries: 3,
    });
    expect(attempts).toBe(3);
    expect(result.completed).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    db.close();
  });

  test("reports permanently failed jobs", async () => {
    const db = new Database(":memory:");
    const result = await executeBatch(db, {
      jobs: [{ id: "a" }],
      processor: async () => { throw new Error("always fails"); },
      maxRetries: 2,
    });
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("always fails");
    expect(result.failed[0].retryCount).toBe(2);
    db.close();
  });

  test("does not process when maxRetries is 0", async () => {
    const db = new Database(":memory:");
    let called = false;
    const result = await executeBatch(db, {
      jobs: [{ id: "a" }],
      processor: async () => { called = true; return "ok"; },
      maxRetries: 0,
    });
    expect(called).toBe(false);
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    db.close();
  });

  test("recovers stale processing jobs from prior crash", async () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }]);
    markProcessing(db, "j1");
    // Simulate crash recovery by calling executeBatch with the same batchId
    const result = await executeBatch(db, {
      jobs: [],
      processor: async () => "ok",
      batchId: "b1",
      maxRetries: 1,
    });
    // j1 should have been recovered and processed
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].id).toBe("j1");
    db.close();
  });

  test("processor receives correct context", async () => {
    const db = new Database(":memory:");
    let receivedCtx: ProcessorContext | null = null;
    await executeBatch(db, {
      jobs: [{ id: "a" }],
      processor: async (_input, ctx) => {
        receivedCtx = ctx;
        return "ok";
      },
      batchId: "test-batch",
      maxRetries: 1,
    });
    expect(receivedCtx!.attempt).toBe(1);
    expect(receivedCtx!.batchId).toBe("test-batch");
    expect(receivedCtx!.db).toBe(db);
    db.close();
  });

  test("normalizes non-Error thrown values to strings", async () => {
    const db = new Database(":memory:");
    const result = await executeBatch(db, {
      jobs: [{ id: "a" }, { id: "b" }, { id: "c" }],
      processor: async (input) => {
        const id = (input as any).id;
        if (id === "a") throw "string error";
        if (id === "b") throw 42;
        if (id === "c") throw null;
      },
      maxRetries: 1,
    });
    expect(result.failed).toHaveLength(3);
    expect(result.failed.find(j => j.id === "a")?.error).toBe("string error");
    expect(result.failed.find(j => j.id === "b")?.error).toBe("42");
    expect(result.failed.find(j => j.id === "c")?.error).toBe("null");
    db.close();
  });

  test("handles JSON.stringify failure in markComplete gracefully", async () => {
    const db = new Database(":memory:");
    const circular: any = {};
    circular.self = circular;
    const result = await executeBatch(db, {
      jobs: [{ id: "a" }],
      processor: async () => circular,
      maxRetries: 1,
    });
    expect(result.failed).toHaveLength(1);
    db.close();
  });

  test("uses default concurrency of 10 and default maxRetries of 3", async () => {
    const db = new Database(":memory:");
    let attempts = 0;
    const result = await executeBatch(db, {
      jobs: [{ id: "a" }],
      processor: async () => {
        attempts++;
        if (attempts < 3) throw new Error("fail");
        return "ok";
      },
    });
    // Default maxRetries = 3, so 3 attempts should succeed on attempt 3
    expect(result.completed).toHaveLength(1);
    db.close();
  });
});
```
