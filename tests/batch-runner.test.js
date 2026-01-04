import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  ensureBatchSchema,
  insertJobs,
  markProcessing,
  markComplete,
  markFailed,
  getPendingJobs,
  recoverStaleJobs,
  executeBatch,
  validateBatchOptions,
} from "../src/core/batch-runner.js";

describe("ensureBatchSchema", () => {
  let db;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("creates batch_jobs table with correct columns", () => {
    db = new Database(":memory:");

    ensureBatchSchema(db);

    const tableInfo = db.prepare("PRAGMA table_info(batch_jobs)").all();
    const columnNames = tableInfo.map((col) => col.name);

    expect(columnNames).toEqual([
      "id",
      "batch_id",
      "status",
      "input",
      "output",
      "error",
      "retry_count",
      "started_at",
      "completed_at",
    ]);
  });

  it("creates index on batch_id and status", () => {
    db = new Database(":memory:");

    ensureBatchSchema(db);

    const indexes = db.prepare("PRAGMA index_list(batch_jobs)").all();
    const indexNames = indexes.map((idx) => idx.name);

    expect(indexNames).toContain("idx_batch_jobs_batch_status");
  });

  it("is idempotent - can be called multiple times", () => {
    db = new Database(":memory:");

    ensureBatchSchema(db);
    ensureBatchSchema(db);

    const tableInfo = db.prepare("PRAGMA table_info(batch_jobs)").all();
    expect(tableInfo.length).toBe(9);
  });
});

describe("insertJobs", () => {
  let db;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("assigns UUIDs to jobs without id", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);

    const jobs = [{ value: 1 }, { value: 2 }];
    const ids = insertJobs(db, "batch-1", jobs);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(ids[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("preserves existing job ids", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);

    const jobs = [
      { id: "custom-id-1", value: 1 },
      { id: "custom-id-2", value: 2 },
    ];
    const ids = insertJobs(db, "batch-1", jobs);

    expect(ids).toEqual(["custom-id-1", "custom-id-2"]);
  });

  it("serializes job input to JSON", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);

    const jobs = [{ id: "job-1", nested: { a: 1, b: [2, 3] } }];
    insertJobs(db, "batch-1", jobs);

    const row = db
      .prepare("SELECT input FROM batch_jobs WHERE id = ?")
      .get("job-1");
    const parsed = JSON.parse(row.input);

    expect(parsed).toEqual({ id: "job-1", nested: { a: 1, b: [2, 3] } });
  });
});

describe("status transitions", () => {
  let db;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("markProcessing sets status and started_at", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [{ id: "job-1", value: 1 }]);

    markProcessing(db, "job-1");

    const row = db
      .prepare("SELECT status, started_at FROM batch_jobs WHERE id = ?")
      .get("job-1");
    expect(row.status).toBe("processing");
    expect(row.started_at).not.toBeNull();
  });

  it("markComplete sets status, output, and completed_at", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [{ id: "job-1", value: 1 }]);
    markProcessing(db, "job-1");

    markComplete(db, "job-1", { result: "success" });

    const row = db
      .prepare(
        "SELECT status, output, completed_at FROM batch_jobs WHERE id = ?"
      )
      .get("job-1");
    expect(row.status).toBe("complete");
    expect(JSON.parse(row.output)).toEqual({ result: "success" });
    expect(row.completed_at).not.toBeNull();
  });

  it("markFailed increments retry_count and captures error", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [{ id: "job-1", value: 1 }]);
    markProcessing(db, "job-1");

    markFailed(db, "job-1", "Something went wrong");

    const row = db
      .prepare("SELECT status, error, retry_count FROM batch_jobs WHERE id = ?")
      .get("job-1");
    expect(row.status).toBe("failed");
    expect(row.error).toBe("Something went wrong");
    expect(row.retry_count).toBe(1);

    // Increment again
    markFailed(db, "job-1", "Failed again");
    const row2 = db
      .prepare("SELECT retry_count FROM batch_jobs WHERE id = ?")
      .get("job-1");
    expect(row2.retry_count).toBe(2);
  });
});

describe("getPendingJobs", () => {
  let db;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("returns pending and failed jobs under retry limit", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [
      { id: "pending-job", value: 1 },
      { id: "failed-job", value: 2 },
    ]);
    markProcessing(db, "failed-job");
    markFailed(db, "failed-job", "error");

    const pending = getPendingJobs(db, "batch-1", 3);

    expect(pending).toHaveLength(2);
    expect(pending.map((j) => j.id)).toContain("pending-job");
    expect(pending.map((j) => j.id)).toContain("failed-job");
  });

  it("excludes completed jobs", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [
      { id: "pending-job", value: 1 },
      { id: "complete-job", value: 2 },
    ]);
    markProcessing(db, "complete-job");
    markComplete(db, "complete-job", { done: true });

    const pending = getPendingJobs(db, "batch-1", 3);

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("pending-job");
  });

  it("excludes jobs at retry limit", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [
      { id: "under-limit", value: 1 },
      { id: "at-limit", value: 2 },
    ]);

    // Fail "at-limit" job 3 times to hit maxRetries=3
    markProcessing(db, "at-limit");
    markFailed(db, "at-limit", "error 1");
    markFailed(db, "at-limit", "error 2");
    markFailed(db, "at-limit", "error 3");

    const pending = getPendingJobs(db, "batch-1", 3);

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("under-limit");
  });
});

describe("recoverStaleJobs", () => {
  let db;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("resets processing jobs to pending", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [
      { id: "processing-job", value: 1 },
      { id: "pending-job", value: 2 },
    ]);
    markProcessing(db, "processing-job");

    const recovered = recoverStaleJobs(db, "batch-1");

    expect(recovered).toBe(1);
    const row = db
      .prepare("SELECT status FROM batch_jobs WHERE id = ?")
      .get("processing-job");
    expect(row.status).toBe("pending");
  });

  it("only affects specified batchId", () => {
    db = new Database(":memory:");
    ensureBatchSchema(db);
    insertJobs(db, "batch-1", [{ id: "job-batch-1", value: 1 }]);
    insertJobs(db, "batch-2", [{ id: "job-batch-2", value: 2 }]);
    markProcessing(db, "job-batch-1");
    markProcessing(db, "job-batch-2");

    const recovered = recoverStaleJobs(db, "batch-1");

    expect(recovered).toBe(1);
    const row1 = db
      .prepare("SELECT status FROM batch_jobs WHERE id = ?")
      .get("job-batch-1");
    const row2 = db
      .prepare("SELECT status FROM batch_jobs WHERE id = ?")
      .get("job-batch-2");
    expect(row1.status).toBe("pending");
    expect(row2.status).toBe("processing");
  });
});

describe("executeBatch", () => {
  let db;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("processes all jobs and returns completed array", async () => {
    db = new Database(":memory:");

    const jobs = [
      { id: "job-1", value: 1 },
      { id: "job-2", value: 2 },
      { id: "job-3", value: 3 },
    ];
    const processor = async (input) => input.value * 2;

    const result = await executeBatch(db, { jobs, processor });

    expect(result.completed).toHaveLength(3);
    expect(result.failed).toHaveLength(0);

    const outputs = result.completed.map((c) => c.output);
    expect(outputs).toContain(2);
    expect(outputs).toContain(4);
    expect(outputs).toContain(6);
  });

  it("retries failed jobs up to maxRetries", async () => {
    db = new Database(":memory:");

    let callCount = 0;
    const processor = async (input) => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`Attempt ${callCount} failed`);
      }
      return input.value * 2;
    };

    const jobs = [{ id: "retry-job", value: 5 }];
    const result = await executeBatch(db, { jobs, processor, maxRetries: 3 });

    expect(result.completed).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.completed[0].output).toBe(10);
  });

  it("marks job as failed after maxRetries exhausted", async () => {
    db = new Database(":memory:");

    const processor = async () => {
      throw new Error("Always fails");
    };

    const jobs = [{ id: "always-fails", value: 1 }];
    const result = await executeBatch(db, { jobs, processor, maxRetries: 2 });

    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe("always-fails");
    expect(result.failed[0].retryCount).toBe(2);
  });

  it("respects concurrency limit", async () => {
    db = new Database(":memory:");

    let currentConcurrent = 0;
    let maxConcurrent = 0;

    const processor = async (input) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentConcurrent--;
      return input.value;
    };

    const jobs = [
      { id: "job-1", value: 1 },
      { id: "job-2", value: 2 },
      { id: "job-3", value: 3 },
      { id: "job-4", value: 4 },
      { id: "job-5", value: 5 },
    ];
    const result = await executeBatch(db, { jobs, processor, concurrency: 2 });

    expect(result.completed).toHaveLength(5);
    expect(maxConcurrent).toBe(2);
  });
});

describe("validateBatchOptions", () => {
  it("throws for missing jobs", () => {
    expect(() => validateBatchOptions({ processor: () => {} })).toThrow(
      "runBatch: jobs must be an array"
    );
  });

  it("throws for non-function processor", () => {
    expect(() =>
      validateBatchOptions({ jobs: [{ id: "1" }], processor: "not a function" })
    ).toThrow("runBatch: processor must be a function");
  });

  it("throws for empty jobs array", () => {
    expect(() =>
      validateBatchOptions({ jobs: [], processor: () => {} })
    ).toThrow("runBatch: jobs must be a non-empty array");
  });

  it("accepts valid options", () => {
    expect(() =>
      validateBatchOptions({ jobs: [{ id: "1" }], processor: () => {} })
    ).not.toThrow();
  });
});
