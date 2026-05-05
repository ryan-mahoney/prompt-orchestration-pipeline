import path from "node:path";

import { getConfig } from "../../../core/config";
import {
  getJobConcurrencyStatus,
  type JobConcurrencyStatus,
  type JobSlotLease,
  type StaleJobSlot,
} from "../../../core/job-concurrency";
import { sendJson } from "../utils/http-utils";

type PublicLease = Omit<JobSlotLease, "slotPath">;
type PublicStaleSlot = Omit<StaleJobSlot, "slotPath">;

interface PublicConcurrencyStatus extends Omit<JobConcurrencyStatus, "activeJobs" | "staleSlots"> {
  activeJobs: PublicLease[];
  staleSlots: PublicStaleSlot[];
}

function stripSlotPath<T extends { slotPath: string }>(entry: T): Omit<T, "slotPath"> {
  const { slotPath: _slotPath, ...rest } = entry;
  return rest;
}

function toPublicStatus(status: JobConcurrencyStatus): PublicConcurrencyStatus {
  return {
    ...status,
    activeJobs: status.activeJobs.map(stripSlotPath),
    staleSlots: status.staleSlots.map(stripSlotPath),
  };
}

export async function handleConcurrencyStatus(dataDir: string): Promise<Response> {
  const { maxConcurrentJobs, lockFileTimeout } = getConfig().orchestrator;
  const status = await getJobConcurrencyStatus(
    path.join(dataDir, "pipeline-data"),
    maxConcurrentJobs,
    lockFileTimeout,
  );
  return sendJson(200, { ok: true, data: toPublicStatus(status) });
}
