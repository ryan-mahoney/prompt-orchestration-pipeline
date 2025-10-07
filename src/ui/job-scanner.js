/**
 * Job scanner utilities
 * - listJobs(location) -> array of job IDs (directory names)
 * - listAllJobs() -> { current: [], complete: [] }
 * - getJobDirectoryStats(location) -> info about the directory
 *
 * Behavior guided by docs/project-data-display.md and tests/job-scanner.test.js
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import * as configBridge from "./config-bridge.js";

/**
 * List job directory names for a given location.
 * Returns [] for invalid location, missing directory, or on permission errors.
 */
export async function listJobs(location) {
  if (!configBridge || !configBridge.Constants) {
    // Defensive: if Constants not available, return empty
    return [];
  }

  if (!configBridge.Constants.JOB_LOCATIONS.includes(location)) {
    return [];
  }

  // Primary: use mocked PATHS (tests spy on this getter). Fallbacks:
  //  - configBridge.getPATHS() if available
  //  - environment PO_<LOCATION>_DIR (used by orchestrator/tests)
  //  - default pipeline-data/<location> under cwd
  const dirPath =
    configBridge.PATHS?.[location] ??
    (typeof configBridge.getPATHS === "function" &&
      configBridge.getPATHS()[location]) ??
    process.env[`PO_${location.toUpperCase()}_DIR`] ??
    path.join(process.cwd(), "pipeline-data", location);

  if (!dirPath) {
    return [];
  }

  try {
    // Check existence/access first to provide clearer handling in tests
    await fs.access(dirPath);
  } catch (err) {
    // Directory doesn't exist or access denied -> return empty
    return [];
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const jobs = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const name = entry.name;

      // Skip hidden directories
      if (name.startsWith(".")) {
        continue;
      }

      // Validate job ID format
      if (!configBridge.Constants.JOB_ID_REGEX.test(name)) {
        console.warn(`Skipping invalid job directory name: ${name}`);
        continue;
      }

      jobs.push(name);
    }

    return jobs;
  } catch (err) {
    // Permission errors or other fs errors: log and return empty
    console.warn(
      `Error reading ${location} directory: ${err?.message || String(err)}`
    );
    return [];
  }
}

/**
 * List jobs from both current and complete locations.
 */
export async function listAllJobs() {
  const current = await listJobs("current");
  const complete = await listJobs("complete");

  return { current, complete };
}

/**
 * Return basic stats about a job directory location.
 * { location, exists, jobCount, totalEntries, error? }
 */
export async function getJobDirectoryStats(location) {
  if (!configBridge || !configBridge.Constants) {
    return {
      location,
      exists: false,
      jobCount: 0,
      totalEntries: 0,
      error: "Invalid location",
    };
  }

  if (!configBridge.Constants.JOB_LOCATIONS.includes(location)) {
    return {
      location,
      exists: false,
      jobCount: 0,
      totalEntries: 0,
      error: "Invalid location",
    };
  }

  const dirPath =
    configBridge.PATHS?.[location] ??
    (typeof configBridge.getPATHS === "function" &&
      configBridge.getPATHS()[location]) ??
    process.env[`PO_${location.toUpperCase()}_DIR`] ??
    path.join(process.cwd(), "pipeline-data", location);

  if (!dirPath) {
    return {
      location,
      exists: false,
      jobCount: 0,
      totalEntries: 0,
      error: "Directory not found",
    };
  }

  try {
    await fs.access(dirPath);
  } catch (err) {
    // Directory does not exist
    if (err && err.code === "ENOENT") {
      return {
        location,
        exists: false,
        jobCount: 0,
        totalEntries: 0,
        error: "Directory not found",
      };
    }
    return {
      location,
      exists: false,
      jobCount: 0,
      totalEntries: 0,
      error: err?.message || String(err),
    };
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const totalEntries = entries.length;
    let jobCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (!configBridge.Constants.JOB_ID_REGEX.test(name)) continue;
      jobCount += 1;
    }

    return {
      location,
      exists: true,
      jobCount,
      totalEntries,
    };
  } catch (err) {
    // Permission or other error while reading
    return {
      location,
      exists: false,
      jobCount: 0,
      totalEntries: 0,
      error: err?.message || String(err),
    };
  }
}
