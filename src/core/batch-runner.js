/**
 * Batch Runner - Concurrent job processing with SQLite state management
 */

import crypto from "node:crypto";
import pLimit from "p-limit";

/**
 * Creates the batch_jobs table and index if they don't exist
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 */
export function ensureBatchSchema(db) {
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
    CREATE INDEX IF NOT EXISTS idx_batch_jobs_batch_status ON batch_jobs(batch_id, status);
  `);
}

/**
 * Inserts jobs into the batch_jobs table
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} batchId - Unique batch identifier
 * @param {Array<Object>} jobs - Array of job objects
 * @returns {string[]} Array of job IDs inserted
 */
export function insertJobs(db, batchId, jobs) {
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO batch_jobs (id, batch_id, status, input) VALUES (?, ?, 'pending', ?)`
  );
  const selectStatusStmt = db.prepare(
    `SELECT status FROM batch_jobs WHERE id = ? AND batch_id = ?`
  );

  const insertMany = db.transaction((jobList) => {
    const ids = [];
    for (const job of jobList) {
      const id = job.id ?? crypto.randomUUID();
      const input = JSON.stringify(job);
      const result = insertStmt.run(id, batchId, input);

      // If no row was inserted, the job already exists. Validate its state.
      if (result.changes === 0) {
        const existing = selectStatusStmt.get(id, batchId);
        if (existing && (existing.status === "complete" || existing.status === "permanently_failed")) {
          throw new Error(
            `Cannot re-insert job "${id}" for batch "${batchId}": existing job is in terminal state "${existing.status}".`
          );
        }
      }
      ids.push(id);
    }
    return ids;
  });

  return insertMany(jobs);
}

/**
 * Marks a job as processing
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} jobId - Job identifier
 */
export function markProcessing(db, jobId) {
  const stmt = db.prepare(
    `UPDATE batch_jobs SET status = 'processing', started_at = datetime('now') WHERE id = ?`
  );
  stmt.run(jobId);
}

/**
 * Marks a job as complete with output
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} jobId - Job identifier
 * @param {*} output - Job output (will be JSON serialized)
 */
export function markComplete(db, jobId, output) {
  const stmt = db.prepare(
    `UPDATE batch_jobs SET status = 'complete', output = ?, completed_at = datetime('now') WHERE id = ?`
  );
  stmt.run(JSON.stringify(output), jobId);
}

/**
 * Marks a job as failed and increments retry count
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} jobId - Job identifier
 * @param {string} error - Error message
 */
export function markFailed(db, jobId, error) {
  const stmt = db.prepare(
    `UPDATE batch_jobs SET status = 'failed', error = ?, retry_count = retry_count + 1 WHERE id = ?`
  );
  stmt.run(error, jobId);
}

/**
 * Gets pending and failed jobs that are under the retry limit
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} batchId - Unique batch identifier
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Array<{id: string, input: Object, retryCount: number}>} Array of pending jobs
 */
export function getPendingJobs(db, batchId, maxRetries) {
  const stmt = db.prepare(
    `SELECT id, input, retry_count FROM batch_jobs WHERE batch_id = ? AND status IN ('pending', 'failed') AND retry_count < ? ORDER BY id`
  );
  const rows = stmt.all(batchId, maxRetries);
  return rows.map((row) => ({
    id: row.id,
    input: JSON.parse(row.input),
    retryCount: row.retry_count,
  }));
}

/**
 * Recovers jobs stuck in 'processing' state (from process crash)
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} batchId - Unique batch identifier
 * @returns {number} Number of jobs recovered
 */
export function recoverStaleJobs(db, batchId) {
  const stmt = db.prepare(
    `UPDATE batch_jobs SET status = 'pending' WHERE batch_id = ? AND status = 'processing'`
  );
  const result = stmt.run(batchId);
  return result.changes;
}

/**
 * Gets completed jobs for a batch
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} batchId - Unique batch identifier
 * @returns {Array<{id: string, input: Object, output: *}>} Array of completed jobs
 */
function getCompletedJobs(db, batchId) {
  const stmt = db.prepare(
    `SELECT id, input, output FROM batch_jobs WHERE batch_id = ? AND status = 'complete'`
  );
  const rows = stmt.all(batchId);
  return rows.map((row) => ({
    id: row.id,
    input: JSON.parse(row.input),
    output: JSON.parse(row.output),
  }));
}

/**
 * Gets failed jobs for a batch (those that exhausted retries)
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {string} batchId - Unique batch identifier
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Array<{id: string, input: Object, error: string, retryCount: number}>} Array of failed jobs
 */
function getFailedJobs(db, batchId, maxRetries) {
  const stmt = db.prepare(
    `SELECT id, input, error, retry_count FROM batch_jobs WHERE batch_id = ? AND status = 'failed' AND retry_count >= ?`
  );
  const rows = stmt.all(batchId, maxRetries);
  return rows.map((row) => ({
    id: row.id,
    input: JSON.parse(row.input),
    error: row.error,
    retryCount: row.retry_count,
  }));
}

/**
 * Processes a single job with try/catch and status updates
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {Object} job - Job object with id, input, retryCount
 * @param {Function} processor - async (input, ctx) => result
 * @param {string} batchId - Unique batch identifier
 */
async function processOneJob(db, job, processor, batchId) {
  markProcessing(db, job.id);
  try {
    const output = await processor(job.input, {
      attempt: job.retryCount + 1,
      batchId,
      db,
    });
    markComplete(db, job.id, output);
  } catch (err) {
    markFailed(db, job.id, err.message || String(err));
  }
}

/**
 * Validates batch options and throws with descriptive errors if invalid
 * @param {Object} options - Batch options to validate
 * @throws {Error} If options are invalid
 */
export function validateBatchOptions(options) {
  if (!options || typeof options !== "object") {
    throw new Error(
      `runBatch: options must be an object, got: ${typeof options}`
    );
  }
  if (!Array.isArray(options.jobs)) {
    throw new Error(
      `runBatch: jobs must be an array, got: ${typeof options.jobs}`
    );
  }
  if (options.jobs.length === 0) {
    throw new Error("runBatch: jobs must be a non-empty array");
  }
  if (typeof options.processor !== "function") {
    throw new Error(
      `runBatch: processor must be a function, got: ${typeof options.processor}`
    );
  }
  if (options.concurrency !== undefined) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error(
        `runBatch: concurrency must be a positive integer, got: ${options.concurrency}`
      );
    }
  }
  if (options.maxRetries !== undefined) {
    if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
      throw new Error(
        `runBatch: maxRetries must be a non-negative integer, got: ${options.maxRetries}`
      );
    }
  }
}

/**
 * Executes a batch of jobs concurrently with retry support
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {Object} options - Batch options
 * @param {Array<Object>} options.jobs - Array of job objects
 * @param {Function} options.processor - async (input, ctx) => result
 * @param {number} [options.concurrency=10] - Max concurrent jobs
 * @param {number} [options.maxRetries=3] - Max retry attempts per job
 * @param {string} [options.batchId] - Unique batch identifier (auto-generated if omitted)
 * @returns {Promise<{completed: Array, failed: Array}>} Batch results
 */
export async function executeBatch(db, options) {
  const {
    jobs,
    processor,
    concurrency = 10,
    maxRetries = 3,
    batchId = crypto.randomUUID(),
  } = options;

  ensureBatchSchema(db);
  recoverStaleJobs(db, batchId);
  insertJobs(db, batchId, jobs);

  const limit = pLimit(concurrency);

  let pending = getPendingJobs(db, batchId, maxRetries);
  while (pending.length > 0) {
    const promises = pending.map((job) =>
      limit(() => processOneJob(db, job, processor, batchId))
    );
    await Promise.allSettled(promises);
    pending = getPendingJobs(db, batchId, maxRetries);
  }

  return {
    completed: getCompletedJobs(db, batchId),
    failed: getFailedJobs(db, batchId, maxRetries),
  };
}
