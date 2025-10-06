/**
 * Job API endpoints for the UI server
 * @module ui/endpoints/job-endpoints
 */

import { listJobs } from "../job-scanner.js";
import { readJob } from "../job-reader.js";
import { transformMultipleJobs } from "../transformers/status-transformer.js";
import {
  aggregateAndSortJobs,
  transformJobListForAPI,
} from "../transformers/list-transformer.js";
import {
  Constants,
  createErrorResponse,
  validateJobId,
} from "../config-bridge.js";

/**
 * Handles GET /api/jobs endpoint
 * @returns {Promise<Object>} Response object
 */
export async function handleJobList() {
  // Instrumentation: log endpoint call
  console.log(`[JobEndpoints] GET /api/jobs called`);

  try {
    // Scan for jobs in both current and complete locations
    const [currentJobIds, completeJobIds] = await Promise.all([
      listJobs("current"),
      listJobs("complete"),
    ]);

    // Instrumentation: log scan results
    console.log(`[JobEndpoints] Job scan results:`, {
      current: currentJobIds.length,
      complete: completeJobIds.length,
    });

    // Read all jobs with retry logic
    const readPromises = [
      ...currentJobIds.map((jobId) => readJob(jobId, "current")),
      ...completeJobIds.map((jobId) => readJob(jobId, "complete")),
    ];

    const readResults = await Promise.all(readPromises);

    // Transform raw job data to UI format
    const transformedJobs = transformMultipleJobs(readResults);

    // Aggregate and sort jobs (current takes precedence over complete)
    const aggregatedJobs = aggregateAndSortJobs(
      transformedJobs.filter((job) => job.location === "current"),
      transformedJobs.filter((job) => job.location === "complete")
    );

    // Transform to API response format
    const apiResponse = transformJobListForAPI(aggregatedJobs);

    // Instrumentation: log successful response
    console.log(`[JobEndpoints] GET /api/jobs successful:`, {
      totalJobs: apiResponse.length,
      fromCurrent: currentJobIds.length,
      fromComplete: completeJobIds.length,
    });

    return {
      ok: true,
      data: apiResponse,
    };
  } catch (error) {
    console.error(`[JobEndpoints] GET /api/jobs error:`, error);

    return createErrorResponse(
      Constants.ERROR_CODES.FS_ERROR,
      "Failed to read job data",
      null
    );
  }
}

/**
 * Handles GET /api/jobs/:jobId endpoint
 * @param {string} jobId - Job ID from URL parameter
 * @returns {Promise<Object>} Response object
 */
export async function handleJobDetail(jobId) {
  // Instrumentation: log endpoint call
  console.log(`[JobEndpoints] GET /api/jobs/${jobId} called`);

  try {
    // Validate job ID format
    if (!validateJobId(jobId)) {
      console.warn(`[JobEndpoints] Invalid job ID format: ${jobId}`);
      return createErrorResponse(
        Constants.ERROR_CODES.BAD_REQUEST,
        "Invalid job ID format",
        jobId
      );
    }

    // Read job with precedence (current first, then complete)
    const readResult = await readJob(jobId);

    if (!readResult.ok) {
      // Job not found in either location
      console.warn(`[JobEndpoints] Job not found: ${jobId}`);
      return createErrorResponse(
        Constants.ERROR_CODES.JOB_NOT_FOUND,
        "Job not found",
        jobId
      );
    }

    // Transform to UI format
    const transformedJob = transformMultipleJobs([readResult])[0];

    if (!transformedJob) {
      console.error(`[JobEndpoints] Failed to transform job: ${jobId}`);
      return createErrorResponse(
        Constants.ERROR_CODES.INVALID_JSON,
        "Invalid job data format",
        jobId
      );
    }

    // Instrumentation: log successful response
    console.log(`[JobEndpoints] GET /api/jobs/${jobId} successful:`, {
      jobId: transformedJob.id,
      status: transformedJob.status,
      progress: transformedJob.progress,
      taskCount: transformedJob.tasks.length,
      location: transformedJob.location,
    });

    return {
      ok: true,
      data: transformedJob,
    };
  } catch (error) {
    console.error(`[JobEndpoints] GET /api/jobs/${jobId} error:`, error);

    return createErrorResponse(
      Constants.ERROR_CODES.FS_ERROR,
      "Failed to read job data",
      jobId
    );
  }
}

/**
 * Gets endpoint statistics for instrumentation
 * @param {Array} jobListResponses - Array of job list response objects
 * @param {Array} jobDetailResponses - Array of job detail response objects
 * @returns {Object} Endpoint statistics
 */
export function getEndpointStats(
  jobListResponses = [],
  jobDetailResponses = []
) {
  const listStats = {
    totalCalls: jobListResponses.length,
    successfulCalls: jobListResponses.filter((r) => r.ok).length,
    failedCalls: jobListResponses.filter((r) => !r.ok).length,
    errorCodes: {},
  };

  const detailStats = {
    totalCalls: jobDetailResponses.length,
    successfulCalls: jobDetailResponses.filter((r) => r.ok).length,
    failedCalls: jobDetailResponses.filter((r) => !r.ok).length,
    errorCodes: {},
  };

  // Count error codes for job list
  jobListResponses
    .filter((r) => !r.ok)
    .forEach((r) => {
      listStats.errorCodes[r.code] = (listStats.errorCodes[r.code] || 0) + 1;
    });

  // Count error codes for job detail
  jobDetailResponses
    .filter((r) => !r.ok)
    .forEach((r) => {
      detailStats.errorCodes[r.code] =
        (detailStats.errorCodes[r.code] || 0) + 1;
    });

  return {
    jobList: listStats,
    jobDetail: detailStats,
    overall: {
      totalCalls: listStats.totalCalls + detailStats.totalCalls,
      successRate:
        listStats.totalCalls + detailStats.totalCalls > 0
          ? ((listStats.successfulCalls + detailStats.successfulCalls) /
              (listStats.totalCalls + detailStats.totalCalls)) *
            100
          : 0,
    },
  };
}
