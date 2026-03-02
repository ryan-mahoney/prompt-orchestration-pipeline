export type TaskStateValue = "pending" | "running" | "done" | "failed";
export type JobStatusValue = "pending" | "running" | "failed" | "complete";
export type JobLocationValue = "pending" | "current" | "complete" | "rejected";

export const TaskState = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const satisfies Record<string, TaskStateValue>);

export const JobStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  FAILED: "failed",
  COMPLETE: "complete",
} as const satisfies Record<string, JobStatusValue>);

export const JobLocation = Object.freeze({
  PENDING: "pending",
  CURRENT: "current",
  COMPLETE: "complete",
  REJECTED: "rejected",
} as const satisfies Record<string, JobLocationValue>);

export const VALID_TASK_STATES: ReadonlySet<string> = new Set<TaskStateValue>([
  TaskState.PENDING,
  TaskState.RUNNING,
  TaskState.DONE,
  TaskState.FAILED,
]);

export const VALID_JOB_STATUSES: ReadonlySet<string> = new Set<JobStatusValue>([
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.FAILED,
  JobStatus.COMPLETE,
]);

export const VALID_JOB_LOCATIONS: ReadonlySet<string> = new Set<JobLocationValue>([
  JobLocation.PENDING,
  JobLocation.CURRENT,
  JobLocation.COMPLETE,
  JobLocation.REJECTED,
]);

const TASK_STATE_SYNONYMS: Readonly<Record<string, TaskStateValue>> = Object.freeze({
  error: "failed",
  succeeded: "done",
});

const JOB_STATUS_SYNONYMS: Readonly<Record<string, JobStatusValue>> = Object.freeze({
  completed: "complete",
  error: "failed",
});

export function normalizeTaskState(state: unknown): TaskStateValue {
  if (typeof state !== "string") return "pending";
  const normalized = state.toLowerCase().trim();
  const synonym = TASK_STATE_SYNONYMS[normalized];
  if (synonym !== undefined) return synonym;
  if (VALID_TASK_STATES.has(normalized)) return normalized as TaskStateValue;
  return "pending";
}

export function normalizeJobStatus(status: unknown): JobStatusValue {
  if (typeof status !== "string") return "pending";
  const normalized = status.toLowerCase().trim();
  const synonym = JOB_STATUS_SYNONYMS[normalized];
  if (synonym !== undefined) return synonym;
  if (VALID_JOB_STATUSES.has(normalized)) return normalized as JobStatusValue;
  return "pending";
}

export function deriveJobStatusFromTasks(
  tasks: ReadonlyArray<{ state: unknown }>,
): JobStatusValue {
  if (!Array.isArray(tasks) || tasks.length === 0) return "pending";

  let hasRunning = false;
  let hasPending = false;

  for (const task of tasks) {
    const state = normalizeTaskState(task.state);
    if (state === "failed") return "failed";
    if (state === "running") hasRunning = true;
    if (state === "pending") hasPending = true;
  }

  if (hasRunning) return "running";
  if (hasPending) return "pending";
  return "complete";
}
