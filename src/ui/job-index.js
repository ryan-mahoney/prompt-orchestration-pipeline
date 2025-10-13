/**
 * Job indexing utilities for slug-to-ID resolution
 *
 * Exports:
 *  - resolveSlugToLatestJobId(slug) -> Promise<string|null>
 *  - buildJobIndex() -> Promise<{jobsById, latestJobByPipelineSlug}>
 *  - isValidPipelineSlug(slug) -> boolean
 *
 * This module provides functionality to resolve pipeline slugs (e.g., "content-generation")
 * to the latest job ID for that pipeline, enabling backward compatibility with legacy URLs.
 */

import { listJobs } from "./job-scanner.js";
import { readJob } from "./job-reader.js";
import * as configBridge from "./config-bridge.js";

// Cache indexes to avoid rebuilding on every request
let cachedIndex = null;
let indexBuiltAt = null;
const INDEX_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validate if a string looks like a pipeline slug.
 * Pipeline slugs are typically kebab-case identifiers like "content-generation".
 */
export function isValidPipelineSlug(slug) {
  if (typeof slug !== "string" || slug.length === 0) {
    return false;
  }

  // Pipeline slugs should be lowercase, alphanumeric with hyphens, no special chars
  const slugPattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;
  if (!slugPattern.test(slug)) {
    return false;
  }

  // Additional validation: shouldn't look like a job ID (which are typically random strings)
  // Job IDs usually have mixed case, numbers, and are longer
  if (slug.length > 50 || /[A-Z]/.test(slug) || /\d{3,}/.test(slug)) {
    return false;
  }

  return true;
}

/**
 * Build an index of jobs by ID and by pipeline slug.
 * Scans both current and complete locations to build comprehensive mapping.
 */
export async function buildJobIndex() {
  console.log("[JobIndex] Building job index...");

  const jobsById = new Map();
  const latestJobByPipelineSlug = new Map();

  try {
    // Get all job IDs from both locations
    const currentIds = await listJobs("current");
    const completeIds = await listJobs("complete");

    const allJobIds = [...(currentIds || []), ...(completeIds || [])];
    console.log(`[JobIndex] Found ${allJobIds.length} jobs to index`);

    // Read all jobs to extract pipeline information
    const jobReadPromises = allJobIds.map(async (jobId) => {
      try {
        const jobResult = await readJob(jobId);
        if (jobResult && jobResult.ok && jobResult.data) {
          return {
            jobId,
            jobData: jobResult.data,
            location: jobResult.location,
          };
        }
        return null;
      } catch (error) {
        console.warn(`[JobIndex] Failed to read job ${jobId}:`, error.message);
        return null;
      }
    });

    const jobResults = await Promise.all(jobReadPromises);
    const validJobs = jobResults.filter(Boolean);

    console.log(`[JobIndex] Successfully read ${validJobs.length} jobs`);

    // Build indexes
    for (const { jobId, jobData, location } of validJobs) {
      // Index by ID
      jobsById.set(jobId, {
        jobId,
        jobData,
        location,
        updatedAt:
          jobData.updatedAt || jobData.createdAt || new Date(0).toISOString(),
      });

      // Extract pipeline slug and index by slug
      const pipelineSlug = extractPipelineSlug(jobData);
      if (pipelineSlug && isValidPipelineSlug(pipelineSlug)) {
        const existing = latestJobByPipelineSlug.get(pipelineSlug);

        // Keep the most recently updated job for each slug
        if (
          !existing ||
          new Date(jobData.updatedAt || jobData.createdAt) >
            new Date(existing.updatedAt)
        ) {
          latestJobByPipelineSlug.set(pipelineSlug, {
            jobId,
            jobData,
            location,
            updatedAt:
              jobData.updatedAt ||
              jobData.createdAt ||
              new Date(0).toISOString(),
          });
        }
      }
    }

    console.log(
      `[JobIndex] Built index: ${jobsById.size} jobs by ID, ${latestJobByPipelineSlug.size} unique pipeline slugs`
    );

    return {
      jobsById,
      latestJobByPipelineSlug,
    };
  } catch (error) {
    console.error("[JobIndex] Error building job index:", error);
    return {
      jobsById: new Map(),
      latestJobByPipelineSlug: new Map(),
    };
  }
}

/**
 * Extract pipeline slug from job data.
 * Looks for common fields that might contain the pipeline identifier.
 */
function extractPipelineSlug(jobData) {
  if (!jobData || typeof jobData !== "object") {
    return null;
  }

  // Try different fields where pipeline slug might be stored
  const candidates = [
    jobData.pipelineId,
    jobData.pipelineSlug,
    jobData.name, // Sometimes the name contains the pipeline slug
    jobData.pipeline?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      // Extract slug from candidate if it contains more than just the slug
      const slugMatch = candidate.match(/([a-z][a-z0-9-]*[a-z0-9])/);
      if (slugMatch && isValidPipelineSlug(slugMatch[1])) {
        return slugMatch[1];
      }
    }
  }

  return null;
}

/**
 * Get or build the cached job index.
 * Returns cached index if still valid, otherwise rebuilds it.
 */
async function getCachedIndex() {
  const now = Date.now();

  // Check if cache is still valid
  if (cachedIndex && indexBuiltAt && now - indexBuiltAt < INDEX_TTL_MS) {
    console.log("[JobIndex] Using cached index");
    return cachedIndex;
  }

  // Build new index
  console.log("[JobIndex] Building fresh index (cache expired or empty)");
  cachedIndex = await buildJobIndex();
  indexBuiltAt = now;

  return cachedIndex;
}

/**
 * Resolve a pipeline slug to the latest job ID for that pipeline.
 * Returns null if slug is invalid, no jobs found, or resolution fails.
 */
export async function resolveSlugToLatestJobId(slug) {
  console.log(`[JobIndex] Resolving slug: ${slug}`);

  // Validate slug format first
  if (!isValidPipelineSlug(slug)) {
    console.warn(`[JobIndex] Invalid slug format: ${slug}`);
    return null;
  }

  try {
    const index = await getCachedIndex();
    const latestJob = index.latestJobByPipelineSlug.get(slug);

    if (latestJob) {
      console.log(
        `[JobIndex] Resolved slug '${slug}' to job ID '${latestJob.jobId}'`
      );
      return latestJob.jobId;
    } else {
      console.log(`[JobIndex] No jobs found for slug: ${slug}`);
      return null;
    }
  } catch (error) {
    console.error(`[JobIndex] Error resolving slug '${slug}':`, error);
    return null;
  }
}

/**
 * Clear the cached index (useful for testing or force refresh).
 */
export function clearIndexCache() {
  console.log("[JobIndex] Clearing index cache");
  cachedIndex = null;
  indexBuiltAt = null;
}

/**
 * Get index statistics for debugging and monitoring.
 */
export async function getIndexStats() {
  try {
    const index = await getCachedIndex();
    return {
      jobsByIdCount: index.jobsById.size,
      pipelineSlugCount: index.latestJobByPipelineSlug.size,
      indexBuiltAt,
      cacheAge: indexBuiltAt ? Date.now() - indexBuiltAt : null,
    };
  } catch (error) {
    console.error("[JobIndex] Error getting index stats:", error);
    return {
      jobsByIdCount: 0,
      pipelineSlugCount: 0,
      indexBuiltAt: null,
      cacheAge: null,
      error: error.message,
    };
  }
}
