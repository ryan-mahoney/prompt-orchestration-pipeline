function mapJobStateToDagState(jobState) {
  switch (jobState) {
    case "done":
      return "succeeded";
    case "running":
    case "processing":
    case "in_progress":
    case "active":
      return "active";
    case "error":
    case "failed":
      return "error";
    case "pending":
    case "queued":
    case "created":
      return "pending";
    case "skipped":
    case "canceled":
      return "succeeded";
    default:
      return "pending";
  }
}

function normalizeJobTasks(tasks) {
  if (!tasks) return {};

  if (Array.isArray(tasks)) {
    const taskMap = {};
    for (const task of tasks) {
      const taskId = task?.name || task?.id;
      if (taskId) taskMap[taskId] = task;
    }
    return taskMap;
  }

  return tasks;
}

export function computeTaskStage(job, taskId) {
  const tasks = normalizeJobTasks(job?.tasks);
  const t = tasks?.[taskId];

  if (typeof t?.currentStage === "string" && t.currentStage.length > 0) {
    return t.currentStage;
  }
  if (
    job?.current === taskId &&
    typeof job?.currentStage === "string" &&
    job.currentStage.length > 0
  ) {
    return job.currentStage;
  }
  if (t?.failedStage) {
    return t.failedStage;
  }
  if (t?.error?.debug?.stage) {
    return t.error.debug.stage;
  }
  return undefined;
}

export function computeDagItems(job, pipeline) {
  const jobTasks = normalizeJobTasks(job?.tasks);
  const pipelineTasks = pipeline?.tasks || [];

  const pipelineItems = pipelineTasks.map((taskId) => {
    const jobTask = jobTasks[taskId];
    return {
      id: taskId,
      status: jobTask ? mapJobStateToDagState(jobTask.state) : "pending",
      source: "pipeline",
      stage: computeTaskStage(job, taskId),
    };
  });

  const pipelineTaskIds = new Set(pipelineTasks);
  const jobOnlyTaskIds = Object.keys(jobTasks).filter(
    (taskId) => !pipelineTaskIds.has(taskId)
  );

  const jobOnlyItems = jobOnlyTaskIds.map((taskId) => {
    const jobTask = jobTasks[taskId];
    return {
      id: taskId,
      status: mapJobStateToDagState(jobTask.state),
      source: "job-extra",
      stage: computeTaskStage(job, taskId),
    };
  });

  return [...pipelineItems, ...jobOnlyItems];
}

export function computeActiveIndex(items) {
  if (!items || items.length === 0) return 0;

  const firstActiveIndex = items.findIndex((item) => item.status === "active");
  if (firstActiveIndex !== -1) return firstActiveIndex;

  const firstErrorIndex = items.findIndex((item) => item.status === "error");
  if (firstErrorIndex !== -1) return firstErrorIndex;

  let lastSucceededIndex = -1;
  items.forEach((item, index) => {
    if (item.status === "succeeded") lastSucceededIndex = index;
  });

  if (lastSucceededIndex !== -1) return lastSucceededIndex;
  return 0;
}
