/**
 * Status transformer for converting raw job data to UI-ready format
 * @module ui/transformers/status-transformer
 */

import { Constants } from "../config-bridge.js";

/**
 * Transforms raw job data to UI-ready format with computed status and progress
 * @param {Object} rawJobData - Raw job data from tasks-status.json
 * @param {string} jobId - Job ID (directory name)
 * @param {string} location - Job location ('current' or 'complete')
 * @returns {Object|null} Transformed job data or null if invalid
 */
export function transformJobStatus(rawJobData, jobId, location) {
  // Instrumentation: log transformation start
  console.log(`[StatusTransformer] Transforming job ${jobId} from ${location}`);

  if (!rawJobData || typeof rawJobData !== "object") {
    console.warn(`[StatusTransformer] Invalid raw job data for ${jobId}`);
    return null;
  }

  try {
    // Compute overall job status and progress
    const { status, progress } = computeJobStatus(rawJobData.tasks);

    // Transform tasks array
    const tasks = transformTasks(rawJobData.tasks);

    // Build the transformed job object
    const transformedJob = {
      id: jobId, // Always use directory name as authoritative ID
      name: rawJobData.name || "Unnamed Job",
      status,
      progress,
      createdAt: rawJobData.createdAt,
      updatedAt: rawJobData.updatedAt || rawJobData.createdAt,
      location,
      tasks,
    };

    // Add warnings if there are any issues
    const warnings = [];
    if (rawJobData.id && rawJobData.id !== jobId) {
      warnings.push(
        `Job ID mismatch: JSON has "${rawJobData.id}", using directory name "${jobId}"`
      );
    }

    if (warnings.length > 0) {
      transformedJob.warnings = warnings;
      console.warn(`[StatusTransformer] Warnings for job ${jobId}:`, warnings);
    }

    // Instrumentation: log successful transformation
    console.log(`[StatusTransformer] Successfully transformed job ${jobId}:`, {
      status,
      progress,
      taskCount: tasks.length,
    });

    return transformedJob;
  } catch (error) {
    console.error(
      `[StatusTransformer] Error transforming job ${jobId}:`,
      error
    );
    return null;
  }
}

/**
 * Computes overall job status and progress percentage
 * @param {Object} tasks - Raw tasks object from tasks-status.json
 * @returns {Object} Status and progress information
 */
export function computeJobStatus(tasks) {
  if (!tasks || typeof tasks !== "object") {
    return { status: "pending", progress: 0 };
  }

  const taskEntries = Object.entries(tasks);
  const totalTasks = taskEntries.length;

  // Count task states
  let doneCount = 0;
  let runningCount = 0;
  let errorCount = 0;
  let pendingCount = 0;

  taskEntries.forEach(([taskName, task]) => {
    const state = task?.state || "pending";

    // Handle unknown states by treating as pending with warning
    if (!Constants.TASK_STATES.includes(state)) {
      console.warn(
        `[StatusTransformer] Unknown task state "${state}" for task "${taskName}", treating as pending`
      );
      pendingCount++;
      return;
    }

    switch (state) {
      case "done":
        doneCount++;
        break;
      case "running":
        runningCount++;
        break;
      case "error":
        errorCount++;
        break;
      case "pending":
      default:
        pendingCount++;
        break;
    }
  });

  // Determine overall job status according to global contracts
  let status;
  if (errorCount > 0) {
    status = "error";
  } else if (runningCount > 0) {
    status = "running";
  } else if (doneCount === totalTasks && totalTasks > 0) {
    status = "complete";
  } else {
    status = "pending";
  }

  // Compute progress percentage
  const progress = Math.round((100 * doneCount) / Math.max(1, totalTasks));

  // Instrumentation: log status computation
  console.log(`[StatusTransformer] Status computed:`, {
    totalTasks,
    doneCount,
    runningCount,
    errorCount,
    pendingCount,
    status,
    progress,
  });

  return { status, progress };
}

/**
 * Transforms raw tasks object to UI-ready tasks array
 * @param {Object} rawTasks - Raw tasks object from tasks-status.json
 * @returns {Array} Transformed tasks array
 */
export function transformTasks(rawTasks) {
  if (!rawTasks || typeof rawTasks !== "object") {
    return [];
  }

  return Object.entries(rawTasks).map(([taskName, rawTask]) => {
    const task = {
      name: taskName,
      state: rawTask.state || "pending",
    };

    // Add optional fields if present
    if (rawTask.startedAt) task.startedAt = rawTask.startedAt;
    if (rawTask.endedAt) task.endedAt = rawTask.endedAt;
    if (rawTask.attempts !== undefined) task.attempts = rawTask.attempts;
    if (rawTask.executionTimeMs !== undefined)
      task.executionTimeMs = rawTask.executionTimeMs;
    if (rawTask.artifacts) task.artifacts = rawTask.artifacts;

    // Validate task state
    if (!Constants.TASK_STATES.includes(task.state)) {
      console.warn(
        `[StatusTransformer] Invalid task state "${task.state}" for task "${taskName}", defaulting to "pending"`
      );
      task.state = "pending";
    }

    return task;
  });
}

/**
 * Transforms multiple jobs in batch with instrumentation
 * @param {Array} jobReadResults - Array of job read results from job-reader
 * @returns {Array} Array of transformed job data
 */
export function transformMultipleJobs(jobReadResults) {
  console.log(`[StatusTransformer] Transforming ${jobReadResults.length} jobs`);

  const startTime = Date.now();
  const results = jobReadResults
    .filter((result) => result.ok)
    .map((result) =>
      transformJobStatus(
        result.data,
        result.jobId || result.data.id,
        result.location
      )
    )
    .filter((job) => job !== null);

  const endTime = Date.now();
  const duration = endTime - startTime;

  // Instrumentation: log batch transformation stats
  console.log(`[StatusTransformer] Batch transformation completed:`, {
    totalJobs: jobReadResults.length,
    successfulTransforms: results.length,
    failedTransforms: jobReadResults.length - results.length,
    durationMs: duration,
    jobsPerSecond: results.length / (duration / 1000),
  });

  return results;
}

/**
 * Gets transformation statistics for instrumentation
 * @param {Array} jobReadResults - Original job read results
 * @param {Array} transformedJobs - Transformed job data
 * @returns {Object} Transformation statistics
 */
export function getTransformationStats(jobReadResults, transformedJobs) {
  const totalRead = jobReadResults.length;
  const successfulReads = jobReadResults.filter((r) => r.ok).length;
  const successfulTransforms = transformedJobs.length;
  const failedTransforms = successfulReads - successfulTransforms;

  const statusDistribution = {};
  transformedJobs.forEach((job) => {
    statusDistribution[job.status] = (statusDistribution[job.status] || 0) + 1;
  });

  return {
    totalRead,
    successfulReads,
    successfulTransforms,
    failedTransforms,
    transformationRate:
      totalRead > 0 ? (successfulTransforms / totalRead) * 100 : 0,
    statusDistribution,
  };
}
