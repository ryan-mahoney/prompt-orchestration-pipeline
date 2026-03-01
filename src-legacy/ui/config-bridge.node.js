/**
 * Node-specific configuration bridge for server-side UI helpers.
 * This module contains filesystem and path utilities that rely on Node APIs.
 * It should only be imported by server-side modules.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TaskState,
  JobStatus,
  JobLocation,
  deriveJobStatusFromTasks,
} from "../config/statuses.js";

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
  TASK_STATES: Object.values(TaskState),

  /**
   * Valid job locations
   * @type {string[]}
   */
  JOB_LOCATIONS: Object.values(JobLocation),

  /**
   * Status sort order (descending priority)
   * @type {string[]}
   */
  STATUS_ORDER: [
    JobStatus.RUNNING,
    JobStatus.FAILED,
    JobStatus.PENDING,
    JobStatus.COMPLETE,
  ],

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
 * Resolves pipeline data directory roots relative to project root
 * @returns {Object} Object containing resolved directory paths (current/complete/pending/rejected)
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
 * Gets absolute path to a job directory
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
 * Gets path to tasks-status.json for a job
 * @param {string} jobId - Job ID
 * @param {string} [location='current'] - Job location
 * @returns {string} Path to tasks-status.json
 */
export function getTasksStatusPath(jobId, location = "current") {
  const jobPath = getJobPath(jobId, location);
  return path.join(jobPath, "tasks-status.json");
}

/**
 * Gets path to seed.json for a job
 * @param {string} jobId - Job ID
 * @param {string} [location='current'] - Job location
 * @returns {string} Path to seed.json
 */
export function getSeedPath(jobId, location = "current") {
  const jobPath = getJobPath(jobId, location);
  return path.join(jobPath, "seed.json");
}

/**
 * Gets path to a task directory
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
 * Determines job status based on task states
 * @param {Object} tasks - Tasks object from tasks-status.json
 * @returns {string} Job status
 */
export function determineJobStatus(tasks = {}) {
  return deriveJobStatusFromTasks(Object.values(tasks));
}

// Export helper to resolve paths lazily for server use
let _PATHS = null;

/**
 * Initialize cached PATHS for a given project root.
 * Callers should use this when they need PATHS tied to a specific root.
 * Returns the resolved paths.
 */
export function initPATHS(root) {
  // If root is falsy, resolvePipelinePaths will use the default project root
  _PATHS = resolvePipelinePaths(root || path.resolve(__dirname, "../.."));
  return _PATHS;
}

/**
 * Reset cached PATHS so future calls will re-resolve.
 * Useful in tests or server code that needs to change the project root at runtime.
 */
export function resetPATHS() {
  _PATHS = null;
}

/**
 * Get the cached PATHS. If a root argument is provided, re-initialize the cache
 * for backward-compatible callers that pass a root to getPATHS(root).
 *
 * If not initialized, initialize with the PO_ROOT environment variable if available,
 * otherwise use the default project root (two levels up from this file).
 */
export function getPATHS(root) {
  if (root) {
    _PATHS = resolvePipelinePaths(root);
    return _PATHS;
  }
  if (!_PATHS) {
    // Use PO_ROOT environment variable if available, otherwise use default project root
    const effectiveRoot =
      process.env.PO_ROOT || path.resolve(__dirname, "../..");
    _PATHS = resolvePipelinePaths(effectiveRoot);
  }
  return _PATHS;
}

// Convenience export for existing callsites
export const PATHS = getPATHS();
