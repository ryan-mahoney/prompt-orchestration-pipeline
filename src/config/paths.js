/**
 * Path resolution utilities for pipeline data directories
 * @module config/paths
 */

import path from "path";

/**
 * Resolve pipeline data directory paths from a base directory
 * @param {string} baseDir - Base data directory
 * @returns {Object} Object containing resolved paths
 */
function resolvePipelinePaths(baseDir) {
  return {
    pending: path.join(baseDir, "pipeline-data", "pending"),
    current: path.join(baseDir, "pipeline-data", "current"),
    complete: path.join(baseDir, "pipeline-data", "complete"),
  };
}

/**
 * Get the exact pending filename for a given job name
 * @param {string} baseDir - Base data directory
 * @param {string} jobName - Job name
 * @returns {string} Full path to pending seed file
 */
function getPendingSeedPath(baseDir, jobName) {
  const paths = resolvePipelinePaths(baseDir);
  return path.join(paths.pending, `${jobName}-seed.json`);
}

/**
 * Get the current seed file path for a given job name
 * @param {string} baseDir - Base data directory
 * @param {string} jobName - Job name
 * @returns {string} Full path to current seed file
 */
function getCurrentSeedPath(baseDir, jobName) {
  const paths = resolvePipelinePaths(baseDir);
  return path.join(paths.current, jobName, "seed.json");
}

/**
 * Get the complete seed file path for a given job name
 * @param {string} baseDir - Base data directory
 * @param {string} jobName - Job name
 * @returns {string} Full path to complete seed file
 */
function getCompleteSeedPath(baseDir, jobName) {
  const paths = resolvePipelinePaths(baseDir);
  return path.join(paths.complete, jobName, "seed.json");
}

export {
  resolvePipelinePaths,
  getPendingSeedPath,
  getCurrentSeedPath,
  getCompleteSeedPath,
};
