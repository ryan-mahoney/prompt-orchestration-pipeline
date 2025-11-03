/**
 * Universal configuration bridge for UI helpers.
 * Works in both browser and Node environments.
 */

/**
 * Global constants and contracts for project data display system
 * @namespace Constants
 */
export const Constants = {
  /**
   * Job ID validation regex
   * @type {RegExp}
   */
  JOB_ID_REGEX: /^[A-Za-z0-9-_]+$/,

  /**
   * Valid task states
   * @type {string[]}
   */
  TASK_STATES: ["pending", "running", "done", "failed"],

  /**
   * Valid job locations
   * @type {string[]}
   */
  JOB_LOCATIONS: ["current", "complete"],

  /**
   * Status sort order (descending priority)
   * @type {string[]}
   */
  STATUS_ORDER: ["running", "failed", "pending", "complete"],

  /**
   * File size limits for reading
   * @type {Object}
   */
  FILE_LIMITS: {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  },

  /**
   * Retry configuration for atomic reads
   * @type {Object}
   */
  RETRY_CONFIG: {
    MAX_ATTEMPTS: 3,
    DELAY_MS: 1000,
  },

  /**
   * SSE debounce configuration
   * @type {Object}
   */
  SSE_CONFIG: {
    DEBOUNCE_MS: 200,
  },

  /**
   * Error codes for structured error responses
   * @type {Object}
   */
  ERROR_CODES: {
    NOT_FOUND: "not_found",
    INVALID_JSON: "invalid_json",
    FS_ERROR: "fs_error",
    JOB_NOT_FOUND: "job_not_found",
    BAD_REQUEST: "bad_request",
  },
};

/**
 * Validates a job ID against the global contract
 * @param {string} jobId - Job ID to validate
 * @returns {boolean} True if valid
 */
export function validateJobId(jobId) {
  return Constants.JOB_ID_REGEX.test(jobId);
}

/**
 * Validates a task state against the global contract
 * @param {string} state - Task state to validate
 * @returns {boolean} True if valid
 */
export function validateTaskState(state) {
  return Constants.TASK_STATES.includes(state);
}

/**
 * Gets the status sort priority for a job status
 * @param {string} status - Job status
 * @returns {number} Sort priority (lower number = higher priority)
 */
export function getStatusPriority(status) {
  const index = Constants.STATUS_ORDER.indexOf(status);
  return index === -1 ? Constants.STATUS_ORDER.length : index;
}

/**
 * Determines job status based on task states
 * @param {Object} tasks - Tasks object from tasks-status.json
 * @returns {string} Job status
 */
export function determineJobStatus(tasks = {}) {
  const taskEntries = Object.entries(tasks);

  if (taskEntries.length === 0) {
    return "pending";
  }

  const taskStates = taskEntries.map(([_, task]) => task.state);

  if (taskStates.includes("failed")) {
    return "failed";
  }

  if (taskStates.includes("running")) {
    return "running";
  }

  if (taskStates.every((state) => state === "done")) {
    return "complete";
  }

  return "pending";
}

/**
 * Creates a structured error response
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {string} [path] - Optional file path
 * @returns {Object} Structured error object
 */
export function createErrorResponse(code, message, path = null) {
  const error = {
    ok: false,
    code,
    message,
  };

  if (path) {
    error.path = path;
  }

  return error;
}
