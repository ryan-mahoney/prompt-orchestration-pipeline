import { getPipelineConfig } from "../../../core/config";
import { aggregateAndSortJobs, transformJobListForAPI } from "../../state/transformers/list-transformer";
import { transformJobStatus, transformMultipleJobs } from "../../state/transformers/status-transformer";
import { createErrorResponse } from "../config-bridge";
import { Constants, validateJobId } from "../config-bridge-node";
import { readMultipleJobs, readJob } from "../job-reader";
import { listAllJobs } from "../job-scanner";
import { sendJson } from "../utils/http-utils";

async function loadPipelineJson(slug: string): Promise<Record<string, unknown> | null> {
  try {
    const cfg = getPipelineConfig(slug);
    return JSON.parse(await Bun.file(cfg.pipelineJsonPath).text()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleJobList(): Promise<Response> {
  const listed = await listAllJobs();
  const [current, complete] = await Promise.all([
    readMultipleJobs(listed.current),
    readMultipleJobs(listed.complete),
  ]);
  const jobs = aggregateAndSortJobs(transformMultipleJobs(current), transformMultipleJobs(complete));

  const slugs = [...new Set(jobs.filter((j) => j.pipeline && !j.pipelineConfig).map((j) => j.pipeline!))];
  const configs = await Promise.all(slugs.map(loadPipelineJson));
  const configMap = new Map(slugs.map((s, i) => [s, configs[i]]));

  for (const job of jobs) {
    if (!job.pipeline || job.pipelineConfig) continue;
    const cached = configMap.get(job.pipeline);
    if (cached) job.pipelineConfig = cached;
  }

  return sendJson(200, { ok: true, data: transformJobListForAPI(jobs, { includePipelineMetadata: true }) });
}

export async function handleJobDetail(jobId: string): Promise<Response> {
  if (!validateJobId(jobId)) {
    return sendJson(400, createErrorResponse(Constants.ERROR_CODES.BAD_REQUEST, "invalid job id"));
  }

  const result = await readJob(jobId);
  if (!result.ok) {
    const status = result.code === Constants.ERROR_CODES.JOB_NOT_FOUND ? 404 : 400;
    return sendJson(status, result);
  }

  const job = transformJobStatus(result.data, jobId, result.location);
  if (!job) {
    return sendJson(500, createErrorResponse(Constants.ERROR_CODES.INVALID_JSON, "job status is malformed"));
  }

  if (job.pipeline) {
    job.pipelineConfig = await loadPipelineJson(job.pipeline) ?? undefined;
  }

  const [apiJob] = transformJobListForAPI([job], { includePipelineMetadata: true });
  return sendJson(200, { ok: true, data: apiJob });
}
