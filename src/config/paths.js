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
 * Get the exact pending filename for a given job ID
 * @param {string} baseDir - Base data directory
 * @param {string} jobId - Job ID
 * @returns {string} Full path to pending seed file
 */
function getPendingSeedPath(baseDir, jobId) {
  const paths = resolvePipelinePaths(baseDir);
  return path.join(paths.pending, `${jobId}-seed.json`);
}

/**
 * Get the current seed file path for a given job ID
 * @param {string} baseDir - Base data directory
 * @param {string} jobId - Job ID
 * @returns {string} Full path to current seed file
 */
function getCurrentSeedPath(baseDir, jobId) {
  const paths = resolvePipelinePaths(baseDir);
  return path.join(paths.current, jobId, "seed.json");
}

/**
 * Get the complete seed file path for a given job ID
 * @param {string} baseDir - Base data directory
 * @param {string} jobId - Job ID
 * @returns {string} Full path to complete seed file
 */
function getCompleteSeedPath(baseDir, jobId) {
  const paths = resolvePipelinePaths(baseDir);
  return path.join(paths.complete, jobId, "seed.json");
}

/**
 * Get the job directory path for a given job ID and location
 * @param {string} baseDir - Base data directory
 * @param {string} jobId - Job ID
 * @param {string} location - Job location ('current', 'complete', 'pending')
 * @returns {string} Full path to job directory
 */
function getJobDirectoryPath(baseDir, jobId, location) {
  const paths = resolvePipelinePaths(baseDir);
  return path.join(paths[location], jobId);
}

/**
 * Get the job metadata file path for a given job ID
 * @param {string} baseDir - Base data directory
 * @param {string} jobId - Job ID
 * @param {string} location - Job location ('current', 'complete')
 * @returns {string} Full path to job metadata file
 */
function getJobMetadataPath(baseDir, jobId, location = "current") {
  const jobDir = getJobDirectoryPath(baseDir, jobId, location);
  return path.join(jobDir, "job.json");
}

/**
 * Get the pipeline snapshot file path for a given job ID
 * @param {string} baseDir - Base data directory
 * @param {string} jobId - Job ID
 * @param {string} location - Job location ('current', 'complete')
 * @returns {string} Full path to pipeline snapshot file
 */
function getJobPipelinePath(baseDir, jobId, location = "current") {
  const jobDir = getJobDirectoryPath(baseDir, jobId, location);
  return path.join(jobDir, "pipeline.json");
}

export {
  resolvePipelinePaths,
  getPendingSeedPath,
  getCurrentSeedPath,
  getCompleteSeedPath,
  getJobDirectoryPath,
  getJobMetadataPath,
  getJobPipelinePath,
};
