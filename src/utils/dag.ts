import { formatStepName } from "../ui/components/dag-shared";
import type { DagItem, JobDetail, PipelineType, TaskStateObject } from "../ui/components/types";

function normalizeTasks(tasks: JobDetail["tasks"]): TaskStateObject[] {
  return Array.isArray(tasks) ? tasks : Object.values(tasks);
}

export function computeDagItems(job: JobDetail, pipeline: Pick<PipelineType, "tasks"> | { tasks: string[] }): DagItem[] {
  const taskMap = Object.fromEntries(normalizeTasks(job.tasks).map((task) => [task.name, task] as const));
  const pipelineTasks = pipeline.tasks.map((task) => typeof task === "string" ? task : task.name);

  return pipelineTasks.map((taskId) => {
    const task = taskMap[taskId];
    return {
      id: taskId,
      status: task?.state ?? "pending",
      stage: task?.currentStage ?? task?.failedStage ?? task?.stage ?? null,
      title: formatStepName(taskId),
      subtitle: null,
      body: task?.error?.message ?? null,
      startedAt: task?.startedAt ?? 0,
      endedAt: task?.endedAt ?? null,
      restartCount: task?.restartCount ?? 0,
    } satisfies DagItem;
  });
}

export function computeActiveIndex(items: DagItem[]): number {
  const running = items.findIndex((item) => item.status === "running");
  if (running >= 0) return running;
  const failed = items.findIndex((item) => item.status === "failed");
  if (failed >= 0) return failed;
  return -1;
}
