/**
 * Canonical status constants and utilities for the prompt orchestration pipeline.
 * This module serves as the single source of truth for all status-related values.
 */

// Task states (per-task execution status)
export const TaskState = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
});

// Job statuses (computed aggregate from task states)
export const JobStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  FAILED: "failed",
  COMPLETE: "complete",
});

// Job locations (filesystem lifecycle buckets)
export const JobLocation = Object.freeze({
  PENDING: "pending",
  CURRENT: "current",
  COMPLETE: "complete",
  REJECTED: "rejected",
});

// Validation sets
export const VALID_TASK_STATES = new Set(Object.values(TaskState));
export const VALID_JOB_STATUSES = new Set(Object.values(JobStatus));
export const VALID_JOB_LOCATIONS = new Set(Object.values(JobLocation));

/**
 * Normalizes a task state string to canonical form.
 * @param {string} state - Raw task state
 * @returns {string} Canonical task state
 */
export function normalizeTaskState(state) {
  if (typeof state !== "string") {
    return TaskState.PENDING;
  }

  const normalized = state.toLowerCase().trim();

  // Handle common synonyms
  switch (normalized) {
    case "error":
      return TaskState.FAILED;
    case "succeeded":
      return TaskState.DONE;
    case TaskState.PENDING:
    case TaskState.RUNNING:
    case TaskState.DONE:
    case TaskState.FAILED:
      return normalized;
    default:
      return TaskState.PENDING;
  }
}

/**
 * Normalizes a job status string to canonical form.
 * @param {string} status - Raw job status
 * @returns {string} Canonical job status
 */
export function normalizeJobStatus(status) {
  if (typeof status !== "string") {
    return JobStatus.PENDING;
  }

  const normalized = status.toLowerCase().trim();

  // Handle common synonyms
  switch (normalized) {
    case "completed":
      return JobStatus.COMPLETE;
    case "error":
      return JobStatus.FAILED;
    case JobStatus.PENDING:
    case JobStatus.RUNNING:
    case JobStatus.FAILED:
    case JobStatus.COMPLETE:
      return normalized;
    default:
      return JobStatus.PENDING;
  }
}

/**
 * Derives job status from an array of task states.
 * Priority: failed > running > complete > pending
 * @param {Array<Object>} tasks - Array of task objects with state property
 * @returns {string} Canonical job status
 */
export function deriveJobStatusFromTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return JobStatus.PENDING;
  }

  // Normalize all task states first
  const normalizedStates = tasks.map((task) => normalizeTaskState(task.state));

  // Apply priority rules
  if (normalizedStates.some((state) => state === TaskState.FAILED)) {
    return JobStatus.FAILED;
  }

  if (normalizedStates.some((state) => state === TaskState.RUNNING)) {
    return JobStatus.RUNNING;
  }

  if (normalizedStates.every((state) => state === TaskState.DONE)) {
    return JobStatus.COMPLETE;
  }

  return JobStatus.PENDING;
}
