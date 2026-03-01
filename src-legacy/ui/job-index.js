/**
 * Job index and cache utilities
 *
 * Provides a centralized jobsById cache and indexing functionality
 * for improved performance and single source of truth for job data.
 *
 * Exports:
 *  - JobIndex class for managing job cache
 *  - createJobIndex() -> JobIndex instance
 *  - getJobIndex() -> singleton JobIndex instance
 */

import { listAllJobs } from "./job-scanner.js";
import { readJob } from "./job-reader.js";
import { transformJobStatus } from "./transformers/status-transformer.js";
import * as configBridge from "./config-bridge.js";

/**
 * JobIndex class for managing job cache and indexing
 */
export class JobIndex {
  constructor() {
    this.jobsById = new Map();
    this.lastRefresh = null;
    this.refreshInProgress = false;
  }

  /**
   * Refresh the job index by scanning all job locations
   * Returns Promise<void>
   */
  async refresh() {
    if (this.refreshInProgress) {
      return; // Avoid concurrent refreshes
    }

    this.refreshInProgress = true;

    try {
      console.log("[JobIndex] Starting refresh");

      // Clear current index
      this.jobsById.clear();

      // Get all job IDs from all locations
      const { current, complete } = await listAllJobs();
      const currentIds = current || [];
      const completeIds = complete || [];
      const allJobIds = [...new Set([...currentIds, ...completeIds])];

      // Read all jobs and populate index
      const readPromises = allJobIds.map(async (jobId) => {
        try {
          // Try each location until we find the job
          let result = null;
          const locations = ["current", "complete", "pending", "rejected"];

          for (const location of locations) {
            result = await readJob(jobId, location);
            if (result.ok) {
              break;
            }
          }

          if (result && result.ok) {
            // Transform to canonical schema before caching
            const canonicalJob = transformJobStatus(
              result.data,
              jobId,
              result.location
            );

            if (canonicalJob) {
              this.jobsById.set(jobId, {
                ...canonicalJob,
                location: result.location,
                path: result.path,
              });
            }
          }
        } catch (error) {
          console.warn(
            `[JobIndex] Failed to read job ${jobId}:`,
            error?.message
          );
        }
      });

      await Promise.all(readPromises);
      this.lastRefresh = new Date();

      console.log(
        `[JobIndex] Refresh complete: ${this.jobsById.size} jobs indexed`
      );
    } catch (error) {
      console.error("[JobIndex] Refresh failed:", error);
      throw error;
    } finally {
      this.refreshInProgress = false;
    }
  }

  /**
   * Get a job by ID from the cache
   * Returns job data or null if not found
   */
  getJob(jobId) {
    return this.jobsById.get(jobId) || null;
  }

  /**
   * Get all jobs from the cache
   * Returns Array of job data
   */
  getAllJobs() {
    return Array.from(this.jobsById.values());
  }

  /**
   * Get jobs by location
   * Returns Array of job data for specified location
   */
  getJobsByLocation(location) {
    return this.getAllJobs().filter((job) => job.location === location);
  }

  /**
   * Check if a job exists in the cache
   * Returns boolean
   */
  hasJob(jobId) {
    return this.jobsById.has(jobId);
  }

  /**
   * Get job count
   * Returns number of jobs in cache
   */
  getJobCount() {
    return this.jobsById.size;
  }

  /**
   * Get index statistics
   * Returns object with index metadata
   */
  getStats() {
    const jobs = this.getAllJobs();
    const locations = {};

    jobs.forEach((job) => {
      locations[job.location] = (locations[job.location] || 0) + 1;
    });

    return {
      totalJobs: this.jobsById.size,
      lastRefresh: this.lastRefresh,
      refreshInProgress: this.refreshInProgress,
      locations,
    };
  }

  /**
   * Clear the cache
   */
  clear() {
    this.jobsById.clear();
    this.lastRefresh = null;
    console.log("[JobIndex] Cache cleared");
  }

  /**
   * Update or add a single job in the cache
   * Useful for real-time updates
   */
  updateJob(jobId, jobData, location, path) {
    // Transform to canonical schema before caching
    const canonicalJob = transformJobStatus(jobData, jobId, location);

    if (canonicalJob) {
      this.jobsById.set(jobId, {
        ...canonicalJob,
        location,
        path,
      });
      console.log(`[JobIndex] Updated job ${jobId} in cache`);
    } else {
      console.warn(`[JobIndex] Failed to transform job ${jobId} for cache`);
    }
  }

  /**
   * Remove a job from the cache
   */
  removeJob(jobId) {
    const removed = this.jobsById.delete(jobId);
    if (removed) {
      console.log(`[JobIndex] Removed job ${jobId} from cache`);
    }
    return removed;
  }
}

// Singleton instance
let jobIndexInstance = null;

/**
 * Create a new JobIndex instance
 * Returns JobIndex
 */
export function createJobIndex() {
  return new JobIndex();
}

/**
 * Get the singleton JobIndex instance
 * Returns JobIndex
 */
export function getJobIndex() {
  if (!jobIndexInstance) {
    jobIndexInstance = createJobIndex();
  }
  return jobIndexInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetJobIndex() {
  jobIndexInstance = null;
}
