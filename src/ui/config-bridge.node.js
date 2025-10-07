/**
 * Node-specific configuration bridge for server-side UI helpers.
 * This module contains filesystem and path utilities that rely on Node APIs.
 * It should only be imported by server-side modules.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Global constants and contracts for the project data display system
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
  TASK_STATES: ["pending", "running", "done", "error"],

  /**
   * Valid job locations
   * @type {string[]}
   */
  JOB_LOCATIONS: ["current", "complete"],

  /**
   * Status sort order (descending priority)
   * @type {string[]}
   */
  STATUS_ORDER: ["running", "error", "pending", "complete"],

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
    DELAY_MS: process.env.NODE_ENV === "test" ? 10 : 1000,
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

// Get current directory for path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves pipeline data paths relative to the project root
 * @returns {Object} Object containing resolved paths
 */
export function resolvePipelinePaths(root = path.resolve(__dirname, "../..")) {
  const projectRoot = root;

  return {
    current: path.join(projectRoot, "pipeline-data", "current"),
    complete: path.join(projectRoot, "pipeline-data", "complete"),
    pending: path.join(projectRoot, "pipeline-data", "pending"),
    rejected: path.join(projectRoot, "pipeline-data", "rejected"),
  };
}

/**
 * Gets the absolute path to a job directory
 * @param {string} jobId - Job ID
 * @param {string} [location='current'] - Job location ('current' or 'complete')
 * @returns {string} Absolute path to job directory
 */
export function getJobPath(jobId, location = "current") {
  if (!Constants.JOB_LOCATIONS.includes(location)) {
    throw new Error(
      `Invalid location: ${location}. Must be one of: ${Constants.JOB_LOCATIONS.join(", ")}`
    );
  }

  if (!Constants.JOB_ID_REGEX.test(jobId)) {
    throw new Error(
      `Invalid job ID: ${jobId}. Must match ${Constants.JOB_ID_REGEX}`
    );
  }

  const paths = resolvePipelinePaths();
  return path.join(paths[location], jobId);
}

/**
 * Gets the path to tasks-status.json for a job
 * @param {string} jobId - Job ID
 * @param {string} [location='current'] - Job location
 * @returns {string} Path to tasks-status.json
 */
export function getTasksStatusPath(jobId, location = "current") {
  const jobPath = getJobPath(jobId, location);
  return path.join(jobPath, "tasks-status.json");
}

/**
 * Gets the path to seed.json for a job
 * @param {string} jobId - Job ID
 * @param {string} [location='current'] - Job location
 * @returns {string} Path to seed.json
 */
export function getSeedPath(jobId, location = "current") {
  const jobPath = getJobPath(jobId, location);
  return path.join(jobPath, "seed.json");
}

/**
 * Gets the path to a task directory
 * @param {string} jobId - Job ID
 * @param {string} taskName - Task name
 * @param {string} [location='current'] - Job location
 * @returns {string} Path to task directory
 */
export function getTaskPath(jobId, taskName, location = "current") {
  const jobPath = getJobPath(jobId, location);
  return path.join(jobPath, "tasks", taskName);
}

/**
 * Checks if a job directory is locked for writing
 * @param {string} jobDir - Job directory path
 * @returns {Promise<boolean>} True if locked
 */
export async function isLocked(jobDir) {
  try {
    const entries = await fs.readdir(jobDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".lock")) {
        return true;
      }

      if (entry.isDirectory()) {
        const subDirPath = path.join(jobDir, entry.name);
        const subEntries = await fs.readdir(subDirPath, {
          withFileTypes: true,
        });

        for (const subEntry of subEntries) {
          if (subEntry.isFile() && subEntry.name.endsWith(".lock")) {
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    return false;
  }
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
 * Computes job progress percentage
 * @param {Object} tasks - Tasks object from tasks-status.json
 * @returns {number} Progress percentage (0-100)
 */
export function computeProgress(tasks = {}) {
  const taskEntries = Object.entries(tasks);
  if (taskEntries.length === 0) {
    return 0;
  }

  const doneCount = taskEntries.filter(
    ([_, task]) => task.state === "done"
  ).length;
  const progressPct = Math.round((100 * doneCount) / taskEntries.length);

  return progressPct;
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

  if (taskStates.includes("error")) {
    return "error";
  }

  if (taskStates.includes("running")) {
    return "running";
  }

  if (taskStates.every((state) => state === "done")) {
    return "complete";
  }

  return "pending";
}

// Export helper to resolve paths lazily for server use
let _PATHS = null;
export function getPATHS(root) {
  if (!_PATHS) {
    _PATHS = resolvePipelinePaths(root);
  }
  return _PATHS;
}

export const PATHS = getPATHS();
