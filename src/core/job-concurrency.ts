import { join } from "node:path";

export interface JobSlotLease {
  jobId: string;
  pid: number | null;
  acquiredAt: string;
  source: "orchestrator" | "restart" | "task-start";
  slotPath: string;
}

export interface QueuedJobSummary {
  jobId: string;
  seedPath: string;
  queuedAt: string | null;
  name: string | null;
  pipeline: string | null;
}

export interface StaleJobSlot {
  jobId: string;
  slotPath: string;
  reason: "missing_current_job" | "missing_pid" | "dead_pid" | "invalid_json";
}

export interface JobConcurrencyStatus {
  limit: number;
  runningCount: number;
  availableSlots: number;
  queuedCount: number;
  activeJobs: JobSlotLease[];
  queuedJobs: QueuedJobSummary[];
  staleSlots: StaleJobSlot[];
}

export type AcquireJobSlotResult =
  | { ok: true; lease: JobSlotLease }
  | { ok: false; reason: "limit_reached"; status: JobConcurrencyStatus };

export interface AcquireJobSlotOptions {
  dataDir: string;
  jobId: string;
  maxConcurrentJobs: number;
  source: JobSlotLease["source"];
  pid?: number | null;
}

export interface ConcurrencyRuntimePaths {
  runtimeDir: string;
  lockDir: string;
  runningJobsDir: string;
}

export function getConcurrencyRuntimePaths(dataDir: string): ConcurrencyRuntimePaths {
  const runtimeDir = join(dataDir, "runtime");
  return {
    runtimeDir,
    lockDir: join(runtimeDir, "lock"),
    runningJobsDir: join(runtimeDir, "running-jobs"),
  };
}
