/**
 * Job Change Detector for identifying job-related file changes
 * Determines which job a file change belongs to and categorizes the change type
 */

import path from "path";

/**
 * Categorize a file change by type
 * @param {string} filePath - The changed file path
 * @returns {Object|null} Change information or null if not a job-related file
 */
export function detectJobChange(filePath) {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Extract job ID from path
  const jobId = extractJobId(normalizedPath);
  if (!jobId) {
    return null; // Not a job-related file
  }

  // Categorize the change type
  const category = categorizeChange(normalizedPath);
  if (!category) {
    return null; // Not a relevant job file
  }

  return {
    jobId,
    category,
    filePath: normalizedPath,
  };
}

/**
 * Extract job ID from file path
 * @param {string} filePath - Normalized file path
 * @returns {string|null} Job ID or null if not a job directory
 */
function extractJobId(filePath) {
  // Look for pipeline-data/{current|complete}/{job_id}/ pattern
  const jobPattern = /pipeline-data\/(current|complete)\/([A-Za-z0-9_-]+)\//;
  const match = filePath.match(jobPattern);

  if (match && match[2]) {
    return match[2];
  }

  return null;
}

/**
 * Categorize the type of job change
 * @param {string} filePath - Normalized file path
 * @returns {string|null} Change category or null if not relevant
 */
function categorizeChange(filePath) {
  // Check for tasks-status.json (status change)
  if (filePath.endsWith("/tasks-status.json")) {
    return "status";
  }

  // Check for task artifacts (anything under tasks/**)
  if (filePath.includes("/tasks/")) {
    return "task";
  }

  // Check for seed.json
  if (filePath.endsWith("/seed.json")) {
    return "seed";
  }

  return null; // Not a relevant job file
}

/**
 * Get the location (current or complete) from file path
 * @param {string} filePath - Normalized file path
 * @returns {string|null} "current" or "complete" or null
 */
export function getJobLocation(filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const locationPattern = /pipeline-data\/(current|complete)\//;
  const match = normalizedPath.match(locationPattern);

  return match ? match[1] : null;
}
