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
 * Computes DAG items from job and pipeline data with deterministic ordering
 * @param {Object|null} job - Job object containing tasks
 * @param {Object|null} pipeline - Pipeline object containing canonical task order
 * @returns {Array} Array of DAG items with id, status, and source metadata
 */
export function computeDagItems(job, pipeline) {
  const jobTasks = job?.tasks || {};
  const pipelineTasks = pipeline?.tasks || [];

  // Start with pipeline tasks (canonical order)
  const pipelineItems = pipelineTasks.map((taskId) => {
    const jobTask = jobTasks[taskId];
    return {
      id: taskId,
      status: jobTask ? mapJobStateToDagState(jobTask.state) : "pending",
      source: "pipeline",
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
