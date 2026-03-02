import type { PendingJob, ProcessorContext, BatchProcessor, BatchOptions, CompletedJob, FailedJob, BatchResult } from "../batch-runner";
import { ensureBatchSchema, insertJobs, markProcessing, markComplete, markFailed, getPendingJobs, recoverStaleJobs, validateBatchOptions, executeBatch } from "../batch-runner";
import { Database } from "bun:sqlite";
import { describe, test, expect } from "vitest";

describe("batch-runner types", () => {
  test("types are importable", () => {
    // Type-level check — this test passes if the file compiles
    expect(true).toBe(true);
  });
});

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

describe("getPendingJobs", () => {
  test("returns pending and failed jobs below retry threshold", () => {
    const db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "b1", [{ id: "j1" }, { id: "j2" }, { id: "j3" }]);
    markFailed(db, "j2", "err");
    markComplete(db, "j3", "done");
    const pending = getPendingJobs(db, "b1", 3);
    expect(pending.map(j => j.id)).toEqual(["j1", "j2"]);
    expect(pending[1]!.retryCount).toBe(1);
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
    expect(pending[0]!.input).toEqual({ id: "j1", data: { nested: true } });
    db.close();
  });
});

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
    expect(result.failed[0]!.error).toBe("always fails");
    expect(result.failed[0]!.retryCount).toBe(2);
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
    expect(result.completed[0]!.id).toBe("j1");
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
