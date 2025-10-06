/**
 * Job directory scanner for listing job IDs from pipeline data directories
 * @module ui/job-scanner
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { PATHS, Constants, createErrorResponse } from "./config-bridge.js";

/**
 * Lists job directory names (job IDs) from a specified location
 * @param {string} location - Job location ('current' or 'complete')
 * @returns {Promise<string[]>} Array of job IDs
 */
export async function listJobs(location = "current") {
  if (!Constants.JOB_LOCATIONS.includes(location)) {
    return [];
  }

  const locationPath = PATHS[location];

  try {
    // Check if directory exists
    try {
      await fs.access(locationPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Directory doesn't exist, return empty array
        return [];
      }
      throw error;
    }

    // Read directory entries
    const entries = await fs.readdir(locationPath, { withFileTypes: true });

    // Filter for valid job directories
    const jobIds = entries
      .filter((entry) => {
        // Must be a directory
        if (!entry.isDirectory()) {
          return false;
        }

        // Must match job ID format
        if (!Constants.JOB_ID_REGEX.test(entry.name)) {
          console.warn(
            `Skipping invalid job directory name: ${entry.name} in ${location}`
          );
          return false;
        }

        // Skip hidden/system directories
        if (entry.name.startsWith(".")) {
          return false;
        }

        return true;
      })
      .map((entry) => entry.name);

    return jobIds;
  } catch (error) {
    // Handle permission errors and other FS issues gracefully
    if (error.code === "EACCES" || error.code === "EPERM") {
      console.warn(
        `Permission denied reading ${location} directory: ${error.message}`
      );
      return [];
    }

    // Log other errors but don't throw
    console.warn(`Error reading ${location} directory: ${error.message}`);
    return [];
  }
}

/**
 * Lists all jobs from both current and complete locations
 * @returns {Promise<Object>} Object with current and complete job lists
 */
export async function listAllJobs() {
  const [currentJobs, completeJobs] = await Promise.all([
    listJobs("current"),
    listJobs("complete"),
  ]);

  return {
    current: currentJobs,
    complete: completeJobs,
  };
}

/**
 * Gets job directory statistics for instrumentation
 * @param {string} location - Job location ('current' or 'complete')
 * @returns {Promise<Object>} Directory statistics
 */
export async function getJobDirectoryStats(location = "current") {
  if (!Constants.JOB_LOCATIONS.includes(location)) {
    return {
      location,
      exists: false,
      jobCount: 0,
      error: "Invalid location",
    };
  }

  const locationPath = PATHS[location];

  try {
    await fs.access(locationPath);
    const entries = await fs.readdir(locationPath, { withFileTypes: true });
    const jobCount = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        Constants.JOB_ID_REGEX.test(entry.name) &&
        !entry.name.startsWith(".")
    ).length;

    return {
      location,
      exists: true,
      jobCount,
      totalEntries: entries.length,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        location,
        exists: false,
        jobCount: 0,
        error: "Directory not found",
      };
    }

    return {
      location,
      exists: false,
      jobCount: 0,
      error: error.message,
    };
  }
}
