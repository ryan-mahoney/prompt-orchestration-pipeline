/**
 * List transformer utilities
 *
 * Exports:
 *  - aggregateAndSortJobs(currentJobs, completeJobs)
 *  - sortJobs(jobs)
 *  - getStatusPriority(status)
 *  - groupJobsByStatus(jobs)
 *  - getJobListStats(jobs)
 *  - filterJobs(jobs, searchTerm, options)
 *  - transformJobListForAPI(jobs)
 *  - getAggregationStats(currentJobs, completeJobs, aggregatedJobs)
 *
 * Behavior guided by tests in tests/list-transformer.test.js and docs/project-data-display.md
 */

import * as configBridge from "../config-bridge.browser.js";

export function getStatusPriority(status) {
  // Map to numeric priority where higher = higher priority
  switch (status) {
    case "running":
      return 4;
    case "error":
      return 3;
    case "pending":
      return 2;
    case "complete":
      return 1;
    default:
      return 0;
  }
}

/**
 * Validate a job object minimally: must have id, status, and createdAt
 */
function isValidJob(job) {
  if (!job || typeof job !== "object") return false;
  if (!job.id) return false;
  if (!job.status) return false;
  if (!job.createdAt) return false;
  return true;
}

/**
 * Sort jobs by status priority (descending), then createdAt ascending, then id ascending.
 * Filters out invalid jobs.
 */
export function sortJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  const filtered = jobs.filter(isValidJob).slice();

  filtered.sort((a, b) => {
    const pa = getStatusPriority(a.status);
    const pb = getStatusPriority(b.status);

    if (pa !== pb) return pb - pa; // higher priority first

    // parse createdAt; if invalid, treat as 0
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;

    if (ta !== tb) return ta - tb; // older first

    // stable tie-breaker by id
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return filtered;
}

/**
 * Merge current and complete job lists with precedence: current wins.
 * Returns sorted result using sortJobs.
 */
export function aggregateAndSortJobs(currentJobs, completeJobs) {
  try {
    const cur = Array.isArray(currentJobs) ? currentJobs : [];
    const comp = Array.isArray(completeJobs) ? completeJobs : [];

    const map = new Map();

    // Add complete jobs first
    for (const j of comp) {
      if (!j || !j.id) continue;
      map.set(j.id, j);
    }

    // Override with current jobs (precedence)
    for (const j of cur) {
      if (!j || !j.id) continue;
      map.set(j.id, j);
    }

    const aggregated = Array.from(map.values());

    return sortJobs(aggregated);
  } catch (err) {
    console.error("Error aggregating jobs:", err);
    return [];
  }
}

/**
 * Group jobs into buckets by status.
 * Unknown statuses are ignored.
 */
export function groupJobsByStatus(jobs) {
  const buckets = {
    running: [],
    error: [],
    pending: [],
    complete: [],
  };

  if (!Array.isArray(jobs)) return buckets;

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const status = job.status;
    if (!status || !buckets[status]) continue;
    buckets[status].push(job);
  }

  return buckets;
}

/**
 * Compute job list statistics:
 *  - total
 *  - byStatus: counts
 *  - byLocation: counts
 *  - averageProgress: floor average of available progress values (0 if none)
 */
export function getJobListStats(jobs = []) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return {
      total: 0,
      byStatus: {},
      byLocation: {},
      averageProgress: 0,
    };
  }

  const byStatus = {};
  const byLocation = {};
  let progressSum = 0;
  let progressCount = 0;
  let total = 0;

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    total += 1;

    if (job.status) {
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    }

    if (job.location) {
      byLocation[job.location] = (byLocation[job.location] || 0) + 1;
    }

    if (typeof job.progress === "number" && !Number.isNaN(job.progress)) {
      progressSum += job.progress;
      progressCount += 1;
    }
  }

  const averageProgress =
    progressCount === 0 ? 0 : Math.floor(progressSum / progressCount);

  return {
    total,
    byStatus,
    byLocation,
    averageProgress,
  };
}

/**
 * Filter jobs by search term (matches id or name, case-insensitive) and options {status, location}
 * Returns jobs in original order (filtered).
 */
export function filterJobs(jobs, searchTerm = "", options = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  const term = (searchTerm || "").trim().toLowerCase();

  return jobs.filter((job) => {
    if (!job || typeof job !== "object") return false;

    if (options && options.status && job.status !== options.status)
      return false;
    if (options && options.location && job.location !== options.location)
      return false;

    if (!term) return true;

    const hay = `${job.name || ""} ${job.id || ""}`.toLowerCase();
    return hay.includes(term);
  });
}

/**
 * Transform job list for API: pick only allowed fields and drop nulls
 */
export function transformJobListForAPI(jobs = []) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  const allowed = [
    "id",
    "name",
    "status",
    "progress",
    "createdAt",
    "updatedAt",
    "location",
  ];

  const out = [];
  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const obj = {};
    for (const k of allowed) {
      if (k in job) obj[k] = job[k];
    }
    out.push(obj);
  }

  return out;
}

/**
 * Compute aggregation diagnostics
 */
export function getAggregationStats(
  currentJobs = [],
  completeJobs = [],
  aggregatedJobs = []
) {
  const current = Array.isArray(currentJobs) ? currentJobs : [];
  const complete = Array.isArray(completeJobs) ? completeJobs : [];
  const aggregated = Array.isArray(aggregatedJobs) ? aggregatedJobs : [];

  const totalInput = current.length + complete.length;

  // duplicates: ids present in both
  const compIds = new Set(complete.map((j) => j && j.id).filter(Boolean));
  const curIds = new Set(current.map((j) => j && j.id).filter(Boolean));

  let duplicates = 0;
  for (const id of curIds) {
    if (compIds.has(id)) duplicates += 1;
  }

  const totalOutput = aggregated.length;
  const efficiency =
    totalInput === 0 ? 0 : Math.round((totalOutput / totalInput) * 100);

  const statusDistribution = {};
  const locationDistribution = {};

  for (const j of aggregated) {
    if (!j || typeof j !== "object") continue;
    if (j.status)
      statusDistribution[j.status] = (statusDistribution[j.status] || 0) + 1;
    if (j.location)
      locationDistribution[j.location] =
        (locationDistribution[j.location] || 0) + 1;
  }

  return {
    totalInput,
    totalOutput,
    duplicates,
    efficiency,
    statusDistribution,
    locationDistribution,
  };
}
