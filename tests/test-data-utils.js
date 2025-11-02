/**
 * Test data utilities for creating ephemeral job trees
 * @module test-data-utils
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Validates job ID format according to global contracts
 * @param {string} jobId - Job ID to validate
 * @returns {boolean} True if valid
 */
export function isValidJobId(jobId) {
  return /^[A-Za-z0-9-_]+$/.test(jobId);
}

/**
 * Creates a temporary job tree for testing
 * @param {Object} options - Configuration options
 * @param {string} [options.location='current'] - 'current' or 'complete'
 * @param {string} [options.jobId] - Job ID (auto-generated if not provided)
 * @param {Object} [options.tasksStatus] - tasks-status.json content
 * @param {Object} [options.seed] - seed.json content
 * @param {Object} [options.tasks] - Task artifacts
 * @returns {Promise<Object>} Job tree information
 */
export async function createJobTree(options = {}) {
  const {
    location = "current",
    jobId = `test-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    tasksStatus = null,
    seed = null,
    tasks = {},
  } = options;

  if (!isValidJobId(jobId)) {
    throw new Error(
      `Invalid job ID format: ${jobId}. Must match ^[A-Za-z0-9-_]+$`
    );
  }

  if (location !== "current" && location !== "complete") {
    throw new Error(
      `Invalid location: ${location}. Must be 'current' or 'complete'`
    );
  }

  // Create temp directory
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-tree-"));

  // Create pipeline-data structure
  const pipelineDataDir = path.join(tempDir, "pipeline-data");
  await fs.mkdir(pipelineDataDir, { recursive: true });

  const locationDir = path.join(pipelineDataDir, location);
  await fs.mkdir(locationDir, { recursive: true });

  const jobDir = path.join(locationDir, jobId);
  await fs.mkdir(jobDir, { recursive: true });

  // Create tasks directory
  const tasksDir = path.join(jobDir, "tasks");
  await fs.mkdir(tasksDir, { recursive: true });

  // Generate default tasks-status.json if not provided
  const defaultTasksStatus = {
    id: jobId,
    name: `Test Job ${jobId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: {},
  };

  const finalTasksStatus = tasksStatus || defaultTasksStatus;

  // Ensure ID matches jobId (prefer jobId per global contracts)
  if (finalTasksStatus.id !== jobId) {
    console.warn(
      `Warning: tasks-status.json id (${finalTasksStatus.id}) does not match jobId (${jobId}). Preferring jobId.`
    );
    finalTasksStatus.id = jobId;
  }

  // Write tasks-status.json
  await fs.writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify(finalTasksStatus, null, 2)
  );

  // Write seed.json if provided
  if (seed) {
    await fs.writeFile(
      path.join(jobDir, "seed.json"),
      JSON.stringify(seed, null, 2)
    );
  }

  // Create task artifacts
  for (const [taskName, taskData] of Object.entries(tasks)) {
    const taskDir = path.join(tasksDir, taskName);
    await fs.mkdir(taskDir, { recursive: true });

    if (taskData.output) {
      await fs.writeFile(
        path.join(taskDir, "output.json"),
        JSON.stringify(taskData.output, null, 2)
      );
    }

    if (taskData.letter) {
      await fs.writeFile(
        path.join(taskDir, "letter.json"),
        JSON.stringify(taskData.letter, null, 2)
      );
    }

    if (taskData.executionLogs) {
      await fs.writeFile(
        path.join(taskDir, "execution-logs.json"),
        JSON.stringify(taskData.executionLogs, null, 2)
      );
    }
  }

  return {
    tempDir,
    pipelineDataDir,
    locationDir,
    jobDir,
    jobId,
    location,
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Cleanup warning:", error.message);
      }
    },
  };
}

/**
 * Creates a valid tasks-status.json object
 * @param {Object} options - Task status options
 * @param {string} options.jobId - Job ID
 * @param {string} [options.name] - Job name
 * @param {Object} options.tasks - Task definitions
 * @returns {Object} Valid tasks-status.json object
 */
export function createTasksStatus(options) {
  const {
    jobId,
    name = `Job ${jobId}`,
    tasks = {},
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
  } = options;

  if (!isValidJobId(jobId)) {
    throw new Error(`Invalid job ID: ${jobId}`);
  }

  // Validate task states
  const validStates = ["pending", "running", "done", "error"];
  for (const [taskName, task] of Object.entries(tasks)) {
    if (!validStates.includes(task.state)) {
      throw new Error(
        `Invalid task state for ${taskName}: ${task.state}. Must be one of: ${validStates.join(", ")}`
      );
    }
  }

  return {
    id: jobId,
    name,
    createdAt,
    updatedAt,
    tasks,
  };
}

export function createTask(options) {
  const {
    state,
    startedAt,
    endedAt,
    attempts,
    executionTimeMs,
    artifacts = [],
    currentStage,
    failedStage,
    files,
  } = options;

  const validStates = ["pending", "running", "done", "error"];
  if (!validStates.includes(state)) {
    throw new Error(
      `Invalid task state: ${state}. Must be one of: ${validStates.join(", ")}`
    );
  }

  const task = { state };

  if (startedAt) task.startedAt = startedAt;
  if (endedAt) task.endedAt = endedAt;
  if (attempts !== undefined) task.attempts = attempts;
  if (executionTimeMs !== undefined) task.executionTimeMs = executionTimeMs;
  if (artifacts.length > 0) task.artifacts = artifacts;
  if (currentStage) task.currentStage = currentStage;
  if (failedStage) task.failedStage = failedStage;
  if (files) task.files = files;

  return task;
}

/**
 * Creates multiple job trees for testing aggregation scenarios
 * @param {Array} jobConfigs - Array of job configurations
 * @returns {Promise<Object>} Multiple job trees
 */
export async function createMultipleJobTrees(jobConfigs) {
  const jobTrees = [];

  for (const config of jobConfigs) {
    const jobTree = await createJobTree(config);
    jobTrees.push(jobTree);
  }

  return {
    jobTrees,
    cleanup: async () => {
      for (const jobTree of jobTrees) {
        await jobTree.cleanup();
      }
    },
  };
}

/**
 * Creates a lock file in a job directory
 * @param {string} jobDir - Job directory path
 * @param {string} [lockName='job.lock'] - Lock file name
 * @returns {Promise<string>} Path to lock file
 */
export async function createLockFile(jobDir, lockName = "job.lock") {
  const lockPath = path.join(jobDir, lockName);
  await fs.writeFile(lockPath, `Locked at ${new Date().toISOString()}`);
  return lockPath;
}

/**
 * Removes a lock file
 * @param {string} lockPath - Path to lock file
 * @returns {Promise<void>}
 */
export async function removeLockFile(lockPath) {
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    // Ignore if already removed
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}
