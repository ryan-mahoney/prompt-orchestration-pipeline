/**
 * Duration policy utilities for consistent time display across components
 */

/**
 * Normalizes task state names to canonical values
 * @param {string} state - Raw task state
 * @returns {string} Normalized state
 */
export function normalizeState(state) {
  switch (state) {
    case "done":
      return "completed";
    case "failed":
    case "error":
      return "error";
    case "pending":
    case "running":
    case "current":
    case "completed":
    case "rejected":
      return state;
    default:
      return state; // Pass through unknown states
  }
}

/**
 * Calculates display duration for a task according to policy rules
 * @param {Object} task - Task object with state, startedAt, endedAt, executionTime, executionTimeMs
 * @param {number} now - Current timestamp (default: Date.now())
 * @returns {number} Duration in milliseconds
 */
export function taskDisplayDurationMs(task, now = Date.now()) {
  const { state, startedAt, endedAt, executionTime, executionTimeMs } = task;
  const normalizedState = normalizeState(state);

  switch (normalizedState) {
    case "pending":
      return 0;

    case "running":
    case "current":
      if (!startedAt) {
        return 0;
      }
      const startTime = Date.parse(startedAt);
      return Math.max(0, now - startTime);

    case "completed":
      // Prefer executionTimeMs or executionTime if available, even without startedAt
      const execTime =
        executionTimeMs != null ? executionTimeMs : executionTime;
      if (typeof execTime === "number" && execTime >= 0) {
        return execTime;
      }

      // If no execution time, calculate from timestamps
      if (!startedAt) {
        return 0;
      }
      const completedStartTime = Date.parse(startedAt);
      const endTime = endedAt ? Date.parse(endedAt) : now;
      return Math.max(0, endTime - completedStartTime);

    case "rejected":
      return 0;

    default:
      return 0;
  }
}

/**
 * Calculates cumulative duration across all tasks in a job
 * @param {Object} job - Job object with tasks (array or object)
 * @param {number} now - Current timestamp (default: Date.now())
 * @returns {number} Total duration in milliseconds
 */
export function jobCumulativeDurationMs(job, now = Date.now()) {
  const { tasks } = job;

  if (!tasks) {
    return 0;
  }

  let taskList;
  if (Array.isArray(tasks)) {
    taskList = tasks;
  } else if (typeof tasks === "object") {
    taskList = Object.values(tasks);
  } else {
    return 0;
  }

  return taskList.reduce((total, task) => {
    return total + taskDisplayDurationMs(task, now);
  }, 0);
}

// Legacy helpers (kept for compatibility but not used for policy)
export function fmtDuration(ms) {
  if (ms <= 0) return "0s";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    if (remainingSeconds > 0) {
      return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function elapsedBetween(startTime, endTime = Date.now()) {
  return Math.max(0, endTime - startTime);
}
