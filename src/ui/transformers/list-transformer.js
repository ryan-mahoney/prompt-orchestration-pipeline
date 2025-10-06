/**
 * List aggregation transformer for merging and sorting jobs from multiple locations
 * @module ui/transformers/list-transformer
 */

import { Constants } from "../config-bridge.js";

/**
 * Merges and sorts job lists from current and complete locations
 * @param {Array} currentJobs - Jobs from current location
 * @param {Array} completeJobs - Jobs from complete location
 * @returns {Array} Merged and sorted job list
 */
export function aggregateAndSortJobs(currentJobs = [], completeJobs = []) {
  // Ensure arrays
  const current = Array.isArray(currentJobs) ? currentJobs : [];
  const complete = Array.isArray(completeJobs) ? completeJobs : [];

  // Instrumentation: log aggregation start
  console.log(`[ListTransformer] Aggregating jobs:`, {
    currentJobs: current.length,
    completeJobs: complete.length,
  });

  try {
    // Create a map to handle precedence (current wins over complete)
    const jobMap = new Map();

    // Add complete jobs first (lower precedence)
    complete.forEach((job) => {
      if (job && job.id) {
        jobMap.set(job.id, { ...job, _source: "complete" });
      }
    });

    // Add current jobs (higher precedence - overwrites complete)
    current.forEach((job) => {
      if (job && job.id) {
        jobMap.set(job.id, { ...job, _source: "current" });
      }
    });

    // Convert map to array and sort
    const allJobs = Array.from(jobMap.values());
    const sortedJobs = sortJobs(allJobs);

    // Instrumentation: log aggregation results
    console.log(`[ListTransformer] Aggregation completed:`, {
      totalJobs: sortedJobs.length,
      fromCurrent: currentJobs.length,
      fromComplete: completeJobs.length,
      duplicatesResolved:
        currentJobs.length + completeJobs.length - sortedJobs.length,
    });

    return sortedJobs;
  } catch (error) {
    console.error(`[ListTransformer] Error aggregating jobs:`, error);
    return [];
  }
}

/**
 * Sorts jobs according to global contracts status order and creation time
 * @param {Array} jobs - Array of job objects
 * @returns {Array} Sorted job array
 */
export function sortJobs(jobs) {
  if (!Array.isArray(jobs)) {
    return [];
  }

  // Filter out invalid jobs
  const validJobs = jobs.filter(
    (job) =>
      job && typeof job === "object" && job.id && job.status && job.createdAt
  );

  if (validJobs.length === 0) {
    return [];
  }

  // Sort by status priority first, then by creation time
  return validJobs.sort((a, b) => {
    // Compare by status priority
    const statusPriorityA = getStatusPriority(a.status);
    const statusPriorityB = getStatusPriority(b.status);

    if (statusPriorityA !== statusPriorityB) {
      return statusPriorityB - statusPriorityA; // Higher priority first
    }

    // Same status, sort by creation time (ascending)
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();

    if (timeA !== timeB) {
      return timeA - timeB; // Older first
    }

    // Same creation time, sort by ID for stability
    return a.id.localeCompare(b.id);
  });
}

/**
 * Gets the priority value for a job status (higher = more important)
 * @param {string} status - Job status
 * @returns {number} Priority value
 */
export function getStatusPriority(status) {
  const priorities = {
    running: 4,
    error: 3,
    pending: 2,
    complete: 1,
  };

  return priorities[status] || 0;
}

/**
 * Groups jobs by status for UI display
 * @param {Array} jobs - Array of job objects
 * @returns {Object} Jobs grouped by status
 */
export function groupJobsByStatus(jobs) {
  if (!Array.isArray(jobs)) {
    return {};
  }

  const groups = {
    running: [],
    error: [],
    pending: [],
    complete: [],
  };

  jobs.forEach((job) => {
    if (job && job.status && groups[job.status]) {
      groups[job.status].push(job);
    }
  });

  // Instrumentation: log grouping results
  const groupStats = Object.entries(groups).reduce(
    (stats, [status, jobList]) => {
      stats[status] = jobList.length;
      return stats;
    },
    {}
  );

  console.log(`[ListTransformer] Jobs grouped by status:`, groupStats);

  return groups;
}

/**
 * Creates job list summary statistics
 * @param {Array} jobs - Array of job objects
 * @returns {Object} Summary statistics
 */
export function getJobListStats(jobs) {
  if (!Array.isArray(jobs)) {
    return {
      total: 0,
      byStatus: {},
      byLocation: {},
      averageProgress: 0,
    };
  }

  const byStatus = {};
  const byLocation = {};
  let totalProgress = 0;
  let validJobs = 0;

  jobs.forEach((job) => {
    if (job && job.status) {
      // Count by status
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;

      // Count by location
      byLocation[job.location] = (byLocation[job.location] || 0) + 1;

      // Sum progress
      if (typeof job.progress === "number") {
        totalProgress += job.progress;
        validJobs++;
      }
    }
  });

  const stats = {
    total: jobs.length,
    byStatus,
    byLocation,
    averageProgress: validJobs > 0 ? Math.floor(totalProgress / validJobs) : 0,
  };

  // Instrumentation: log summary statistics
  console.log(`[ListTransformer] Job list statistics:`, stats);

  return stats;
}

/**
 * Filters jobs based on search criteria
 * @param {Array} jobs - Array of job objects
 * @param {string} searchTerm - Search term
 * @param {Object} filters - Filter criteria
 * @returns {Array} Filtered job array
 */
export function filterJobs(jobs, searchTerm = "", filters = {}) {
  if (!Array.isArray(jobs)) {
    return [];
  }

  const lowerSearchTerm = searchTerm.toLowerCase();

  return jobs.filter((job) => {
    if (!job) return false;

    // Apply search filter
    if (searchTerm) {
      const matchesName = job.name?.toLowerCase().includes(lowerSearchTerm);
      const matchesId = job.id?.toLowerCase().includes(lowerSearchTerm);
      if (!matchesName && !matchesId) {
        return false;
      }
    }

    // Apply status filter
    if (filters.status && job.status !== filters.status) {
      return false;
    }

    // Apply location filter
    if (filters.location && job.location !== filters.location) {
      return false;
    }

    return true;
  });
}

/**
 * Transforms job list for API response format
 * @param {Array} jobs - Array of job objects
 * @returns {Array} API-ready job list
 */
export function transformJobListForAPI(jobs) {
  if (!Array.isArray(jobs)) {
    return [];
  }

  return jobs
    .map((job) => {
      if (!job) return null;

      // Extract only the fields needed for the list API
      return {
        id: job.id,
        name: job.name,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        location: job.location,
      };
    })
    .filter((job) => job !== null);
}

/**
 * Gets aggregation statistics for instrumentation
 * @param {Array} currentJobs - Jobs from current location
 * @param {Array} completeJobs - Jobs from complete location
 * @param {Array} aggregatedJobs - Final aggregated jobs
 * @returns {Object} Aggregation statistics
 */
export function getAggregationStats(currentJobs, completeJobs, aggregatedJobs) {
  const totalInput = currentJobs.length + completeJobs.length;
  const totalOutput = aggregatedJobs.length;
  const duplicates = totalInput - totalOutput;

  const statusDistribution = {};
  aggregatedJobs.forEach((job) => {
    statusDistribution[job.status] = (statusDistribution[job.status] || 0) + 1;
  });

  const locationDistribution = {};
  aggregatedJobs.forEach((job) => {
    locationDistribution[job.location] =
      (locationDistribution[job.location] || 0) + 1;
  });

  return {
    totalInput,
    totalOutput,
    duplicates,
    efficiency: totalInput > 0 ? (totalOutput / totalInput) * 100 : 0,
    statusDistribution,
    locationDistribution,
  };
}
