/**
 * Pure mapping utilities for DAG visualization
 * Converts job + pipeline data into presentable DAG items with deterministic ordering
 */

/**
 * Maps task states from job data to standardized DAG states
 * @param {string} jobState - Raw state from job task
 * @returns {string} Mapped state for DAG visualization
 */
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

/**
 * Normalizes job tasks to a lookup object regardless of input format
 * @param {Object|Array|null} tasks - Job tasks as object map or array
 * @returns {Object} Tasks normalized to object lookup by id/name
 */
function normalizeJobTasks(tasks) {
  if (!tasks) return {};

  if (Array.isArray(tasks)) {
    // Convert array to object lookup using name or id as key
    const taskMap = {};
    for (const task of tasks) {
      const taskId = task?.name || task?.id;
      if (taskId) {
        taskMap[taskId] = task;
      }
    }
    return taskMap;
  }

  // Already an object, return as-is
  return tasks;
}

/**
 * Computes the stage for a specific task based on job data
 * @param {Object|null} job - Job object containing current task and stage info
 * @param {string} taskId - ID of the task to compute stage for
 * @returns {string|undefined} Stage name if available, undefined otherwise
 */
export function computeTaskStage(job, taskId) {
  const tasks = normalizeJobTasks(job?.tasks);
  const t = tasks?.[taskId];

  // Priority 1: Per-task currentStage
  if (typeof t?.currentStage === "string" && t.currentStage.length > 0) {
    return t.currentStage;
  }

  // Priority 2: Job-level currentStage when job.current equals the task id/name
  if (
    job?.current === taskId &&
    typeof job?.currentStage === "string" &&
    job.currentStage.length > 0
  ) {
    return job.currentStage;
  }

  // Priority 3: Failed stage from task
  if (t?.failedStage) {
    return t.failedStage;
  }

  // Priority 4: Failed stage from error debug info
  if (t?.error?.debug?.stage) {
    return t.error.debug.stage;
  }

  return undefined;
}

/**
 * Computes DAG items from job and pipeline data with deterministic ordering
 * @param {Object|null} job - Job object containing tasks
 * @param {Object|null} pipeline - Pipeline object containing canonical task order
 * @returns {Array} Array of DAG items with id, status, source, and stage metadata
 */
export function computeDagItems(job, pipeline) {
  const jobTasks = normalizeJobTasks(job?.tasks);
  const pipelineTasks = pipeline?.tasks || [];

  // Start with pipeline tasks (canonical order)
  const pipelineItems = pipelineTasks.map((taskId) => {
    const jobTask = jobTasks[taskId];
    return {
      id: taskId,
      status: jobTask ? mapJobStateToDagState(jobTask.state) : "pending",
      source: "pipeline",
      stage: computeTaskStage(job, taskId),
    };
  });

  // Find tasks that are in job but not in pipeline
  const pipelineTaskIds = new Set(pipelineTasks);
  const jobOnlyTaskIds = Object.keys(jobTasks).filter(
    (taskId) => !pipelineTaskIds.has(taskId)
  );

  // Preserve job order for job-only tasks
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

/**
 * Computes the active index for DAG items following deterministic rules
 * 1. First active task
 * 2. First error task if no active
 * 3. Last succeeded task if no active or error
 * 4. Index 0 if no active, error, or succeeded
 * @param {Array} items - Array of DAG items
 * @returns {number} Index of the active item
 */
export function computeActiveIndex(items) {
  if (!items || items.length === 0) {
    return 0;
  }

  // Rule 1: First active task
  const firstActiveIndex = items.findIndex((item) => item.status === "active");
  if (firstActiveIndex !== -1) {
    return firstActiveIndex;
  }

  // Rule 2: First error task if no active
  const firstErrorIndex = items.findIndex((item) => item.status === "error");
  if (firstErrorIndex !== -1) {
    return firstErrorIndex;
  }

  // Rule 3: Last succeeded task if no active or error
  let lastSucceededIndex = -1;
  items.forEach((item, index) => {
    if (item.status === "succeeded") {
      lastSucceededIndex = index;
    }
  });

  if (lastSucceededIndex !== -1) {
    return lastSucceededIndex;
  }

  // Rule 4: Index 0 if no active, error, or succeeded
  return 0;
}
