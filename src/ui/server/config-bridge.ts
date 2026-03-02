import {
  JobLocation,
  TaskState,
  deriveJobStatusFromTasks,
  normalizeTaskState,
} from "../../config/statuses";

export interface ErrorEnvelope {
  ok: false;
  code: string;
  message: string;
  path?: string;
}

export const Constants = {
  JOB_ID_REGEX: /^[A-Za-z0-9-_]+$/,
  TASK_STATES: Object.freeze(Object.values(TaskState)),
  JOB_LOCATIONS: Object.freeze(Object.values(JobLocation)),
  STATUS_ORDER: Object.freeze(["running", "error", "pending", "complete"]),
  FILE_LIMITS: Object.freeze({ MAX_FILE_SIZE: 5 * 1024 * 1024 }),
  RETRY_CONFIG: Object.freeze({ MAX_ATTEMPTS: 3, DELAY_MS: 10 }),
  SSE_CONFIG: Object.freeze({ DEBOUNCE_MS: 200 }),
  ERROR_CODES: Object.freeze({
    NOT_FOUND: "NOT_FOUND",
    INVALID_JSON: "INVALID_JSON",
    FS_ERROR: "FS_ERROR",
    JOB_NOT_FOUND: "JOB_NOT_FOUND",
    BAD_REQUEST: "BAD_REQUEST",
  }),
} as const;

const STATUS_PRIORITY = new Map<string, number>([
  ["running", 4],
  ["error", 3],
  ["pending", 2],
  ["complete", 1],
]);

export function validateJobId(jobId: string): boolean {
  return typeof jobId === "string" && jobId !== "" && Constants.JOB_ID_REGEX.test(jobId);
}

export function validateTaskState(state: string): boolean {
  return (Constants.TASK_STATES as readonly string[]).includes(state);
}

export function getStatusPriority(status: string): number {
  return STATUS_PRIORITY.get(status) ?? 0;
}

export function determineJobStatus(tasks: Record<string, { state: string }>): string {
  const normalizedTasks = Object.values(tasks).map((task) => ({
    state: task.state,
  }));
  const status = deriveJobStatusFromTasks(normalizedTasks);
  return status === "failed" ? "error" : status;
}

export function createErrorResponse(
  code: string,
  message: string,
  path?: string,
): ErrorEnvelope {
  return path === undefined ? { ok: false, code, message } : { ok: false, code, message, path };
}
