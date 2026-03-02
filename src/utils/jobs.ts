import type { JobSummary } from "../ui/components/types";

export function countCompleted(job: Pick<JobSummary, "tasks">): number {
  const tasks = Array.isArray(job.tasks) ? job.tasks : Object.values(job.tasks);
  return tasks.filter((task) => task.state === "done").length;
}
