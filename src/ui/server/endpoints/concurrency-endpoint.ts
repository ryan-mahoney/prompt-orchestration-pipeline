import { getPipelineDataDir } from "../../../config/paths";
import { getConfig } from "../../../core/config";
import {
  getJobConcurrencyStatus,
  type JobConcurrencyStatus,
} from "../../../core/job-concurrency";
import { sendJson } from "../utils/http-utils";

interface PublicConcurrencyStatus {
  limit: number;
  runningCount: number;
  availableSlots: number;
  queuedCount: number;
  activeJobs: Array<{
    jobId: string;
    pid: number | null;
    acquiredAt: string;
    source: "orchestrator" | "restart" | "task-start";
  }>;
  queuedJobs: Array<{
    jobId: string;
    queuedAt: string | null;
    name: string | null;
    pipeline: string | null;
  }>;
  staleSlots: Array<{
    jobId: string;
    reason: "missing_current_job" | "missing_pid" | "dead_pid" | "invalid_json";
  }>;
}

function toPublicStatus(status: JobConcurrencyStatus): PublicConcurrencyStatus {
  return {
    limit: status.limit,
    runningCount: status.runningCount,
    availableSlots: status.availableSlots,
    queuedCount: status.queuedCount,
    activeJobs: status.activeJobs.map((job) => ({
      jobId: job.jobId,
      pid: job.pid,
      acquiredAt: job.acquiredAt,
      source: job.source,
    })),
    queuedJobs: status.queuedJobs.map((job) => ({
      jobId: job.jobId,
      queuedAt: job.queuedAt,
      name: job.name,
      pipeline: job.pipeline,
    })),
    staleSlots: status.staleSlots.map((slot) => ({
      jobId: slot.jobId,
      reason: slot.reason,
    })),
  };
}

export async function handleConcurrencyStatus(dataDir: string): Promise<Response> {
  try {
    const orchestrator = getConfig().orchestrator;
    const maxConcurrentJobs = orchestrator?.maxConcurrentJobs ?? 3;
    const lockFileTimeout = orchestrator?.lockFileTimeout ?? 30_000;
    const status = await getJobConcurrencyStatus(
      getPipelineDataDir(dataDir),
      maxConcurrentJobs,
      lockFileTimeout,
    );
    const response = sendJson(200, { ok: true, data: toPublicStatus(status) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load concurrency status";
    return sendJson(500, { ok: false, code: "status_unavailable", message });
  }
}
