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

  // Priority 1: Task-level currentStage (most specific)
  if (typeof t?.currentStage === "string" && t.currentStage.length > 0) {
    return t.currentStage;
  }

  // Priority 2: Job-level currentStage ONLY if this task IS the current task
  if (
    job?.current === taskId &&
    typeof job?.currentStage === "string" &&
    job.currentStage.length > 0
  ) {
    return job.currentStage;
  }

  // Priority 3: failedStage for failed tasks
  if (typeof t?.failedStage === "string" && t.failedStage.length > 0) {
    return t.failedStage;
  }

  // Priority 4: Error debug info
  if (typeof t?.error?.debug?.stage === "string") {
    return t.error.debug.stage;
  }

  // No stage information available
  return undefined;
}

export function computeDagItems(job, pipeline) {
  const jobTasks = normalizeJobTasks(job?.tasks);
  const pipelineTasks = pipeline?.tasks || [];

  const pipelineItems = pipelineTasks.map((taskId) => {
    const jobTask = jobTasks[taskId];
    return {
      id: taskId,
      status: jobTask ? jobTask.state : "pending",
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
      status: jobTask.state,
      source: "job-extra",
      stage: computeTaskStage(job, taskId),
    };
  });

  return [...pipelineItems, ...jobOnlyItems];
}

export function computeActiveIndex(items) {
  if (!items || items.length === 0) return 0;

  // Find first running task
  const firstRunningIndex = items.findIndex(
    (item) => item.status === "running"
  );
  if (firstRunningIndex !== -1) return firstRunningIndex;

  // Find first failed task
  const firstFailedIndex = items.findIndex((item) => item.status === "failed");
  if (firstFailedIndex !== -1) return firstFailedIndex;

  // Find last completed task
  let lastDoneIndex = -1;
  items.forEach((item, index) => {
    if (item.status === "done") lastDoneIndex = index;
  });

  if (lastDoneIndex !== -1) return lastDoneIndex;
  return 0;
}
