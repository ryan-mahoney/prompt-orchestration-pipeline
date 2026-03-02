import type { ErrorEnvelope } from "./config-bridge";
import {
  Constants,
  createErrorResponse,
  getTasksStatusPath,
  isLocked,
  validateJobId,
} from "./config-bridge-node";
import { getFileReadingStats, readFileWithRetry } from "./file-reader";

export interface JobReadSuccess {
  ok: true;
  data: Record<string, unknown>;
  location: string;
  path: string;
  jobId: string;
  locked?: boolean;
}

export type JobReadResult = JobReadSuccess | (ErrorEnvelope & { jobId: string; location: string });

export interface JobReadingStats {
  totalJobs: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorTypes: Record<string, number>;
  locations: Record<string, number>;
}

const READ_LOCATIONS = ["current", "complete"] as const;

export async function readJob(jobId: string): Promise<JobReadResult> {
  if (!validateJobId(jobId)) {
    return { ...createErrorResponse(Constants.ERROR_CODES.BAD_REQUEST, "invalid job id"), jobId, location: "" };
  }

  for (const location of READ_LOCATIONS) {
    const path = getTasksStatusPath(jobId, location);
    const result = await readFileWithRetry(path);
    if (!result.ok) {
      if (result.code === Constants.ERROR_CODES.NOT_FOUND) continue;
      return { ...result, jobId, location };
    }

    return {
      ok: true,
      data: result.data as Record<string, unknown>,
      location,
      path,
      jobId,
      locked: await isLocked(path.replace(/\/tasks-status\.json$/, "")),
    };
  }

  return {
    ...createErrorResponse(Constants.ERROR_CODES.JOB_NOT_FOUND, `job "${jobId}" was not found`),
    jobId,
    location: "",
  };
}

export function readMultipleJobs(jobIds: string[]): Promise<JobReadResult[]> {
  return Promise.all(jobIds.map((jobId) => readJob(jobId)));
}

export function getJobReadingStats(jobIds: string[], results: JobReadResult[]): JobReadingStats {
  const fileStats = getFileReadingStats(jobIds, results);
  const locations = results.reduce<Record<string, number>>((acc, result) => {
    if (result.ok) acc[result.location] = (acc[result.location] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalJobs: jobIds.length,
    successCount: fileStats.successCount,
    errorCount: fileStats.errorCount,
    successRate: fileStats.successRate,
    errorTypes: fileStats.errorTypes,
    locations,
  };
}
