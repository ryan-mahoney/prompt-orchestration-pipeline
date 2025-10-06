/**
 * Job status reader with atomic read operations and lock awareness
 * @module ui/job-reader
 */

import {
  getJobPath,
  getTasksStatusPath,
  isLocked,
  Constants,
  createErrorResponse,
} from "./config-bridge.js";
import { readFileWithRetry } from "./file-reader.js";

/**
 * Locates and reads a job by job ID with precedence rules
 * @param {string} jobId - Job ID to locate
 * @returns {Promise<Object>} Job data with location or error
 */
export async function readJob(jobId) {
  // Validate job ID
  if (!Constants.JOB_ID_REGEX.test(jobId)) {
    return createErrorResponse(
      Constants.ERROR_CODES.BAD_REQUEST,
      `Invalid job ID format: ${jobId}`
    );
  }

  // Check both locations with precedence: current first
  const locations = ["current", "complete"];

  for (const location of locations) {
    const jobPath = getJobPath(jobId, location);
    const tasksStatusPath = getTasksStatusPath(jobId, location);

    console.log(`Checking job ${jobId} in ${location}:`, {
      jobPath,
      tasksStatusPath,
      jobExists: await checkJobExists(jobPath),
    });

    try {
      // Check if job directory exists
      const jobExists = await checkJobExists(jobPath);
      if (!jobExists) {
        console.log(`Job ${jobId} not found in ${location}`);
        continue;
      }

      // Check if job is locked
      const locked = await isLocked(jobPath);
      if (locked) {
        console.log(`Job ${jobId} in ${location} is locked, retrying...`);
        const result = await readJobWithLockRetry(jobId, location);
        if (result.ok) {
          return result;
        }
        continue;
      }

      // Read tasks-status.json
      const readResult = await readFileWithRetry(tasksStatusPath);
      if (readResult.ok) {
        // Validate job data structure
        const validation = validateJobData(readResult.data, jobId);
        if (!validation.valid) {
          console.warn(
            `Job data validation failed for ${jobId} in ${location}:`,
            validation.error
          );
          continue; // Try next location or return error
        }

        return {
          ok: true,
          data: readResult.data,
          location,
          path: jobPath,
          warnings: validation.warnings,
        };
      }

      // If we get here, the file exists but couldn't be read
      console.warn(
        `Failed to read tasks-status.json for job ${jobId} in ${location}:`,
        readResult
      );
    } catch (error) {
      console.warn(
        `Error checking job ${jobId} in ${location}:`,
        error.message
      );
    }
  }

  // Job not found in either location
  return createErrorResponse(
    Constants.ERROR_CODES.JOB_NOT_FOUND,
    `Job not found: ${jobId}`
  );
}

/**
 * Checks if a job directory exists
 * @param {string} jobPath - Job directory path
 * @returns {Promise<boolean>} True if job exists
 */
async function checkJobExists(jobPath) {
  try {
    const { promises: fs } = await import("node:fs");
    const stats = await fs.stat(jobPath);
    return stats.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Reads a job with retry logic for locked directories
 * @param {string} jobId - Job ID
 * @param {string} location - Job location
 * @returns {Promise<Object>} Job data or error
 */
async function readJobWithLockRetry(jobId, location) {
  const jobPath = getJobPath(jobId, location);
  const tasksStatusPath = getTasksStatusPath(jobId, location);

  for (
    let attempt = 1;
    attempt <= Constants.RETRY_CONFIG.MAX_ATTEMPTS;
    attempt++
  ) {
    // Wait before retry
    if (attempt > 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, Constants.RETRY_CONFIG.DELAY_MS)
      );
    }

    // Check if still locked
    const locked = await isLocked(jobPath);
    if (locked) {
      console.log(
        `Job ${jobId} still locked on attempt ${attempt}/${Constants.RETRY_CONFIG.MAX_ATTEMPTS}`
      );
      continue;
    }

    // Try to read the file
    const readResult = await readFileWithRetry(tasksStatusPath);
    if (readResult.ok) {
      // Validate job data structure
      const validation = validateJobData(readResult.data, jobId);
      if (!validation.valid) {
        console.warn(
          `Job data validation failed for ${jobId} after lock retry:`,
          validation.error
        );
        return createErrorResponse(
          Constants.ERROR_CODES.BAD_REQUEST,
          `Invalid job data: ${validation.error}`
        );
      }

      console.log(
        `Successfully read job ${jobId} after ${attempt} lock retries`
      );
      return {
        ok: true,
        data: readResult.data,
        location,
        path: jobPath,
        warnings: validation.warnings,
      };
    }

    // If we can't read the file even after lock is gone, return error
    return readResult;
  }

  // All retries exhausted
  return createErrorResponse(
    Constants.ERROR_CODES.FS_ERROR,
    `Job ${jobId} remains locked after ${Constants.RETRY_CONFIG.MAX_ATTEMPTS} attempts`
  );
}

/**
 * Reads multiple jobs in parallel
 * @param {string[]} jobIds - Array of job IDs
 * @returns {Promise<Object[]>} Array of job read results
 */
export async function readMultipleJobs(jobIds) {
  const results = await Promise.all(jobIds.map((jobId) => readJob(jobId)));

  // Log statistics for instrumentation
  const successCount = results.filter((r) => r.ok).length;
  const errorCount = results.length - successCount;

  if (errorCount > 0) {
    console.log(
      `Read ${successCount}/${results.length} jobs successfully, ${errorCount} errors`
    );
  }

  return results;
}

/**
 * Gets job reading statistics for instrumentation
 * @param {string[]} jobIds - Array of job IDs that were read
 * @param {Object[]} results - Array of read results
 * @returns {Object} Reading statistics
 */
export function getJobReadingStats(jobIds, results) {
  const totalJobs = jobIds.length;
  const successCount = results.filter((r) => r.ok).length;
  const errorCount = totalJobs - successCount;

  const errorTypes = {};
  const locations = {};

  results.forEach((result) => {
    if (result.ok) {
      locations[result.location] = (locations[result.location] || 0) + 1;
    } else {
      errorTypes[result.code] = (errorTypes[result.code] || 0) + 1;
    }
  });

  return {
    totalJobs,
    successCount,
    errorCount,
    successRate: totalJobs > 0 ? (successCount / totalJobs) * 100 : 0,
    errorTypes,
    locations,
  };
}

/**
 * Validates job data structure against global contracts
 * @param {Object} jobData - Job data from tasks-status.json
 * @param {string} jobId - Expected job ID
 * @returns {Object} Validation result
 */
export function validateJobData(jobData, jobId) {
  if (!jobData || typeof jobData !== "object") {
    return {
      valid: false,
      error: "Job data must be an object",
    };
  }

  // Check required fields
  const requiredFields = ["id", "name", "createdAt", "tasks"];
  for (const field of requiredFields) {
    if (!(field in jobData)) {
      return {
        valid: false,
        error: `Missing required field: ${field}`,
      };
    }
  }

  // Check ID mismatch
  if (jobData.id !== jobId) {
    console.warn(
      `Job ID mismatch: expected ${jobId}, found ${jobData.id}. Preferring job directory name.`
    );
  }

  // Validate tasks structure
  if (typeof jobData.tasks !== "object" || jobData.tasks === null) {
    return {
      valid: false,
      error: "Tasks must be an object",
    };
  }

  // Validate individual task states
  for (const [taskName, task] of Object.entries(jobData.tasks)) {
    if (typeof task !== "object" || task === null) {
      return {
        valid: false,
        error: `Task ${taskName} must be an object`,
      };
    }

    if (!task.state) {
      return {
        valid: false,
        error: `Task ${taskName} missing state field`,
      };
    }

    if (!Constants.TASK_STATES.includes(task.state)) {
      console.warn(
        `Unknown task state for ${taskName}: ${task.state}. Treating as pending.`
      );
    }
  }

  return {
    valid: true,
    warnings: jobData.id !== jobId ? ["Job ID mismatch"] : [],
  };
}
