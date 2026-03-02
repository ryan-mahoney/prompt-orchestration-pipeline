import { join } from "node:path";
import type { JobLocationValue } from "./statuses";

export interface PipelinePaths {
  readonly pending: string;
  readonly current: string;
  readonly complete: string;
  readonly rejected: string;
}

export function resolvePipelinePaths(baseDir: string): PipelinePaths {
  return {
    pending: join(baseDir, "pipeline-data", "pending"),
    current: join(baseDir, "pipeline-data", "current"),
    complete: join(baseDir, "pipeline-data", "complete"),
    rejected: join(baseDir, "pipeline-data", "rejected"),
  };
}

export function getPendingSeedPath(baseDir: string, jobId: string): string {
  return join(baseDir, "pipeline-data", "pending", `${jobId}-seed.json`);
}

export function getCurrentSeedPath(baseDir: string, jobId: string): string {
  return join(baseDir, "pipeline-data", "current", jobId, "seed.json");
}

export function getCompleteSeedPath(baseDir: string, jobId: string): string {
  return join(baseDir, "pipeline-data", "complete", jobId, "seed.json");
}

export function getJobDirectoryPath(
  baseDir: string,
  jobId: string,
  location: JobLocationValue,
): string {
  return join(baseDir, "pipeline-data", location, jobId);
}

export function getJobMetadataPath(
  baseDir: string,
  jobId: string,
  location: JobLocationValue = "current",
): string {
  return join(getJobDirectoryPath(baseDir, jobId, location), "job.json");
}

export function getJobPipelinePath(
  baseDir: string,
  jobId: string,
  location: JobLocationValue = "current",
): string {
  return join(getJobDirectoryPath(baseDir, jobId, location), "pipeline.json");
}
