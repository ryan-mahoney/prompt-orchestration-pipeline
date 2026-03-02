import type { JobDetail, TaskFiles, TaskStateObject } from "../ui/components/types";

const EMPTY_FILES: TaskFiles = { artifacts: [], logs: [], tmp: [] };

export function createEmptyTaskFiles(): TaskFiles {
  return EMPTY_FILES;
}

export function getTaskFilesForTask(job: Pick<JobDetail, "tasks">, taskId: string): TaskFiles {
  const task = (Array.isArray(job.tasks)
    ? job.tasks.find((item) => item.name === taskId)
    : job.tasks[taskId]) as TaskStateObject | undefined;

  return task?.files ?? EMPTY_FILES;
}
