import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  Constants as UniversalConstants,
  type ErrorEnvelope,
  createErrorResponse,
  determineJobStatus,
  getStatusPriority,
  validateJobId,
  validateTaskState,
} from "./config-bridge";

export type { ErrorEnvelope } from "./config-bridge";

export interface ResolvedPaths {
  current: string;
  complete: string;
  pending: string;
  rejected: string;
}

const DEFAULT_ROOT = process.env["PO_ROOT"] ?? process.cwd();

let cachedPaths: ResolvedPaths | null = null;

export const Constants = {
  ...UniversalConstants,
  RETRY_CONFIG: {
    ...UniversalConstants.RETRY_CONFIG,
    DELAY_MS: process.env["NODE_ENV"] === "test" ? 10 : UniversalConstants.RETRY_CONFIG.DELAY_MS,
  },
} as const;

function toRoot(root?: string): string {
  return path.resolve(root ?? DEFAULT_ROOT);
}

export function resolvePipelinePaths(root?: string): ResolvedPaths {
  const base = toRoot(root);
  return {
    current: path.join(base, "pipeline-data", "current"),
    complete: path.join(base, "pipeline-data", "complete"),
    pending: path.join(base, "pipeline-data", "pending"),
    rejected: path.join(base, "pipeline-data", "rejected"),
  };
}

export function initPATHS(root: string): void {
  cachedPaths = resolvePipelinePaths(root);
}

export function resetPATHS(): void {
  cachedPaths = null;
}

export function getPATHS(root?: string): ResolvedPaths {
  if (root) {
    initPATHS(root);
  } else if (!cachedPaths) {
    cachedPaths = resolvePipelinePaths();
  }
  return cachedPaths!;
}

export function getJobPath(jobId: string, location: keyof ResolvedPaths = "current"): string {
  return path.join(getPATHS()[location], jobId);
}

export function getTasksStatusPath(
  jobId: string,
  location: keyof ResolvedPaths = "current",
): string {
  return path.join(getJobPath(jobId, location), "tasks-status.json");
}

export function getSeedPath(jobId: string, location: keyof ResolvedPaths = "current"): string {
  return path.join(getJobPath(jobId, location), "seed.json");
}

export function getTaskPath(
  jobId: string,
  taskName: string,
  location: keyof ResolvedPaths = "current",
): string {
  return path.join(getJobPath(jobId, location), "tasks", taskName);
}

export async function isLocked(jobDir: string): Promise<boolean> {
  try {
    const entries = await readdir(jobDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.endsWith(".lock")) return true;
      if (!entry.isDirectory()) continue;
      const childEntries = await readdir(path.join(jobDir, entry.name), { withFileTypes: true });
      if (childEntries.some((child) => child.name.endsWith(".lock"))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export {
  createErrorResponse,
  determineJobStatus,
  getStatusPriority,
  validateJobId,
  validateTaskState,
};

export const PATHS = getPATHS();

export function asErrorEnvelope(error: unknown, fallbackCode = Constants.ERROR_CODES.FS_ERROR): ErrorEnvelope {
  return createErrorResponse(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
  );
}
