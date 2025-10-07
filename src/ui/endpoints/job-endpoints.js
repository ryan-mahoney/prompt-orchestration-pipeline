/**
 * Job endpoints (logic-only)
 *
 * Exports:
 *  - handleJobList() -> { ok: true, data: [...] } | error envelope
 *  - handleJobDetail(jobId) -> { ok: true, data: {...} } | error envelope
 *  - getEndpointStats(jobListResponses, jobDetailResponses) -> stats object
 *
 * These functions return structured results (not HTTP responses) so the server
 * can map them to HTTP status codes. Tests mock underlying modules and expect
 * these functions to call the mocked methods in particular ways.
 */

import { listJobs } from "../job-scanner.js";
import { readJob } from "../job-reader.js";
import { transformMultipleJobs } from "../transformers/status-transformer.js";
import {
  aggregateAndSortJobs,
  transformJobListForAPI,
} from "../transformers/list-transformer.js";
import * as configBridge from "../config-bridge.js";

/**
 * Return a list of job summaries suitable for the API.
 *
 * Behavior (matching tests):
 *  - call listJobs("current") then listJobs("complete")
 *  - for each id (current then complete), call readJob(id, location)
 *  - collect read results into an array and pass to transformMultipleJobs()
 *  - aggregate current/complete via aggregateAndSortJobs and finally transformJobListForAPI
 */
export async function handleJobList() {
  console.log("[JobEndpoints] GET /api/jobs called");
  try {
    const currentIds = await listJobs("current");
    const completeIds = await listJobs("complete");

    // Read jobs in two phases to respect precedence and match test expectations:
    // 1) read all currentIds with location "current"
    // 2) read completeIds with location "complete" only for ids not present in currentIds
    const currentSet = new Set(currentIds || []);
    const readResults = [];

    // Read current jobs (preserve order)
    const currentPromises = (currentIds || []).map(async (id) => {
      const res = await readJob(id, "current");
      // attach metadata expected by tests
      return res
        ? { ...res, jobId: id, location: "current" }
        : { ok: false, jobId: id, location: "current" };
    });
    const currentResults = await Promise.all(currentPromises);
    readResults.push(...currentResults);

    // Read complete jobs that were not present in current
    const completeToRead = (completeIds || []).filter(
      (id) => !currentSet.has(id)
    );
    const completePromises = completeToRead.map(async (id) => {
      console.log("handleJobList: readJob(complete) ->", id);
      const res = await readJob(id, "complete");
      return res
        ? { ...res, jobId: id, location: "complete" }
        : { ok: false, jobId: id, location: "complete" };
    });
    const completeResults = await Promise.all(completePromises);
    readResults.push(...completeResults);

    // Invoke status transformer over all read results (tests expect this)
    const transformed = transformMultipleJobs(readResults);

    // Split transformed into current/complete buckets
    const currentJobs = (transformed || []).filter(
      (j) => j.location === "current"
    );
    const completeJobs = (transformed || []).filter(
      (j) => j.location === "complete"
    );

    const aggregated = aggregateAndSortJobs(currentJobs, completeJobs);

    const payload = transformJobListForAPI(aggregated);

    return { ok: true, data: payload };
  } catch (err) {
    console.error("handleJobList error:", err);
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.FS_ERROR,
      "Failed to read job data"
    );
  }
}

/**
 * Return detailed job info for a single jobId.
 * Behavior (matching tests):
 *  - validate jobId using configBridge.validateJobId
 *  - call readJob(jobId)
 *  - pass [readResult] to transformMultipleJobs and return the transformed job
 */
export async function handleJobDetail(jobId) {
  if (!configBridge.validateJobId(jobId)) {
    console.warn("[JobEndpoints] Invalid job ID format");
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.BAD_REQUEST,
      "Invalid job ID format",
      jobId
    );
  }

  try {
    const readRes = await readJob(jobId);

    if (!readRes || !readRes.ok) {
      // Propagate or return job_not_found style envelope
      if (readRes && readRes.code) return readRes;
      return configBridge.createErrorResponse(
        configBridge.Constants.ERROR_CODES.JOB_NOT_FOUND,
        "Job not found",
        jobId
      );
    }

    const transformed = transformMultipleJobs([readRes]);
    const job = (transformed && transformed[0]) || null;
    if (!job) {
      return configBridge.createErrorResponse(
        configBridge.Constants.ERROR_CODES.FS_ERROR,
        "Invalid job data",
        jobId
      );
    }

    return { ok: true, data: job };
  } catch (err) {
    console.error("handleJobDetail error:", err);
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.FS_ERROR,
      "Failed to read job detail",
      jobId
    );
  }
}

/**
 * Compute endpoint statistics for test assertions.
 * jobListResponses/jobDetailResponses are arrays of response envelopes.
 */
export function getEndpointStats(
  jobListResponses = [],
  jobDetailResponses = []
) {
  const summarize = (arr = []) => {
    const totalCalls = arr.length;
    let successfulCalls = 0;
    let failedCalls = 0;
    const errorCodes = {};
    for (const r of arr) {
      if (r && r.ok) successfulCalls += 1;
      else {
        failedCalls += 1;
        const code = r && r.code ? r.code : "unknown";
        errorCodes[code] = (errorCodes[code] || 0) + 1;
      }
    }
    return { totalCalls, successfulCalls, failedCalls, errorCodes };
  };

  const jl = summarize(jobListResponses);
  const jd = summarize(jobDetailResponses);

  const overallTotal = jl.totalCalls + jd.totalCalls;
  const overallSuccess = jl.successfulCalls + jd.successfulCalls;
  const successRate =
    overallTotal === 0 ? 0 : Math.round((overallSuccess / overallTotal) * 100);

  return {
    jobList: jl,
    jobDetail: jd,
    overall: {
      totalCalls: overallTotal,
      successRate,
    },
  };
}
