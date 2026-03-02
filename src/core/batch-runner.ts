import type { Database } from "bun:sqlite";

export type JobStatus = "pending" | "processing" | "complete" | "failed";
export type PersistedJobStatus = JobStatus | "permanently_failed";
export type TerminalJobStatus = "complete" | "permanently_failed";

interface BatchJobRow {
  id: string;
  batch_id: string;
  status: PersistedJobStatus;
  input: string;
  output: string | null;
  error: string | null;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
}

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

export function ensureBatchSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_batch_jobs_batch_status ON batch_jobs (batch_id, status);
  `);
}

export function insertJobs(db: Database, batchId: string, jobs: Record<string, unknown>[]): string[] {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO batch_jobs (id, batch_id, status, input) VALUES (?, ?, 'pending', ?)"
  );
  const checkTerminal = db.prepare(
    "SELECT id FROM batch_jobs WHERE id = ? AND batch_id = ? AND status IN ('complete', 'permanently_failed') LIMIT 1"
  );

  return db.transaction(() => {
    const ids: string[] = [];
    for (const job of jobs) {
      const id = job.id !== undefined ? String(job.id) : crypto.randomUUID();
      const existing = checkTerminal.get(id, batchId);
      if (existing) {
        throw new Error(`Job "${id}" in batch "${batchId}" is already in a terminal state`);
      }
      insert.run(id, batchId, JSON.stringify(job));
      ids.push(id);
    }
    return ids;
  })();
}

export function markProcessing(db: Database, jobId: string): void {
  db.prepare("UPDATE batch_jobs SET status = 'processing', started_at = datetime('now') WHERE id = ?").run(jobId);
}

export function markComplete(db: Database, jobId: string, output: unknown): void {
  db.prepare("UPDATE batch_jobs SET status = 'complete', output = ?, completed_at = datetime('now') WHERE id = ?").run(JSON.stringify(output), jobId);
}

export function markFailed(db: Database, jobId: string, error: string): void {
  db.prepare("UPDATE batch_jobs SET status = 'failed', error = ?, retry_count = retry_count + 1 WHERE id = ?").run(error, jobId);
}

export function getPendingJobs(db: Database, batchId: string, maxRetries: number): PendingJob[] {
  const rows = db.prepare(
    "SELECT id, input, retry_count as retryCount FROM batch_jobs WHERE batch_id = ? AND status IN ('pending', 'failed') AND retry_count < ? ORDER BY id ASC"
  ).all(batchId, maxRetries) as Array<{ id: string; input: string; retryCount: number }>;
  return rows.map(row => ({ id: row.id, input: JSON.parse(row.input), retryCount: row.retryCount }));
}

export function recoverStaleJobs(db: Database, batchId: string): number {
  const result = db.prepare(
    "UPDATE batch_jobs SET status = 'pending' WHERE batch_id = ? AND status = 'processing'"
  ).run(batchId);
  return result.changes;
}

export function validateBatchOptions(options: unknown): void {
  if (typeof options !== "object" || options === null) {
    throw new Error("Batch options must be an object");
  }
  const opts = options as Record<string, unknown>;
  if (!Array.isArray(opts.jobs)) {
    throw new Error("jobs must be an array");
  }
  if (opts.jobs.length === 0) {
    throw new Error("jobs must not be empty");
  }
  if (typeof opts.processor !== "function") {
    throw new Error("processor must be a function");
  }
  if (opts.concurrency !== undefined) {
    if (!Number.isInteger(opts.concurrency) || (opts.concurrency as number) <= 0) {
      throw new Error("concurrency must be a positive integer");
    }
  }
  if (opts.maxRetries !== undefined) {
    if (!Number.isInteger(opts.maxRetries) || (opts.maxRetries as number) < 0) {
      throw new Error("maxRetries must be a non-negative integer");
    }
  }
}

function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  function dispatch(): void {
    if (queue.length === 0 || active >= concurrency) return;
    active++;
    queue.shift()!();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          dispatch();
        });
      });
      dispatch();
    });
  };
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

async function processOneJob(
  db: Database,
  job: PendingJob,
  batchId: string,
  processor: BatchProcessor,
): Promise<void> {
  markProcessing(db, job.id);
  try {
    const output = await processor(job.input, { attempt: job.retryCount + 1, batchId, db });
    markComplete(db, job.id, output);
  } catch (err) {
    markFailed(db, job.id, normalizeError(err));
  }
}

function getCompletedJobs(db: Database, batchId: string): CompletedJob[] {
  const rows = db.prepare(
    "SELECT id, input, output FROM batch_jobs WHERE batch_id = ? AND status = 'complete'"
  ).all(batchId) as Array<{ id: string; input: string; output: string }>;
  return rows.map(row => ({ id: row.id, input: JSON.parse(row.input), output: JSON.parse(row.output) }));
}

function getFailedJobs(db: Database, batchId: string, maxRetries: number): FailedJob[] {
  const rows = db.prepare(
    "SELECT id, input, error, retry_count as retryCount FROM batch_jobs WHERE batch_id = ? AND status = 'failed' AND retry_count >= ?"
  ).all(batchId, maxRetries) as Array<{ id: string; input: string; error: string; retryCount: number }>;
  return rows.map(row => ({ id: row.id, input: JSON.parse(row.input), error: row.error, retryCount: row.retryCount }));
}

export async function executeBatch(db: Database, options: BatchOptions): Promise<BatchResult> {
  const { processor, concurrency = 10, maxRetries = 3, batchId = crypto.randomUUID() } = options;
  ensureBatchSchema(db);
  recoverStaleJobs(db, batchId);
  insertJobs(db, batchId, options.jobs);
  const limit = createLimiter(concurrency);
  while (getPendingJobs(db, batchId, maxRetries).length > 0) {
    const pending = getPendingJobs(db, batchId, maxRetries);
    const promises = pending.map(job => limit(() => processOneJob(db, job, batchId, processor)));
    await Promise.allSettled(promises);
  }
  return { completed: getCompletedJobs(db, batchId), failed: getFailedJobs(db, batchId, maxRetries) };
}
