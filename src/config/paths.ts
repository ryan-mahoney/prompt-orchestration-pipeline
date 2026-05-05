import { join } from "node:path";
import type { JobLocationValue } from "./statuses";

export interface PipelinePaths {
  readonly pending: string;
  readonly current: string;
  readonly complete: string;
  readonly rejected: string;
}

export function getPipelineDataDir(baseDir: string): string {
  return join(baseDir, "pipeline-data");
}

export function resolvePipelinePaths(baseDir: string): PipelinePaths {
  const dataDir = getPipelineDataDir(baseDir);
  return {
    pending: join(dataDir, "pending"),
    current: join(dataDir, "current"),
    complete: join(dataDir, "complete"),
    rejected: join(dataDir, "rejected"),
  };
}

export function getPendingSeedPath(baseDir: string, jobId: string): string {
  return join(getPipelineDataDir(baseDir), "pending", `${jobId}-seed.json`);
}

export function getCurrentSeedPath(baseDir: string, jobId: string): string {
  return join(getPipelineDataDir(baseDir), "current", jobId, "seed.json");
}

export function getCompleteSeedPath(baseDir: string, jobId: string): string {
  return join(getPipelineDataDir(baseDir), "complete", jobId, "seed.json");
}

export function getJobDirectoryPath(
  baseDir: string,
  jobId: string,
  location: JobLocationValue,
): string {
  return join(getPipelineDataDir(baseDir), location, jobId);
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
