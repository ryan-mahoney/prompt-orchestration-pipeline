import { normalizeTaskState } from "../config/statuses.js";

export const countCompleted = (job) => {
  const list = Array.isArray(job?.tasks)
    ? job.tasks
    : Object.values(job?.tasks || {});
  return list.filter((t) => t?.state === "done" || t?.state === "completed")
    .length;
};

export const DisplayCategory = Object.freeze({
  ERRORS: "errors",
  CURRENT: "current",
  COMPLETE: "complete",
});

export function classifyJobForDisplay(job) {
  if (!job) return DisplayCategory.CURRENT;

  const tasks = Array.isArray(job?.tasks)
    ? job.tasks
    : Object.values(job?.tasks || {});

  const normalizedStates = tasks.map((task) => normalizeTaskState(task?.state));

  // Precedence: errors > current > complete > fallback to current
  if (
    job.status === "failed" ||
    normalizedStates.some((state) => state === "failed")
  ) {
    return DisplayCategory.ERRORS;
  }

  if (
    job.status === "running" ||
    normalizedStates.some((state) => state === "running")
  ) {
    return DisplayCategory.CURRENT;
  }

  if (tasks.length > 0 && normalizedStates.every((state) => state === "done")) {
    return DisplayCategory.COMPLETE;
  }

  return DisplayCategory.CURRENT;
}
