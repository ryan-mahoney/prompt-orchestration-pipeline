import fs from "fs";
import path from "path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import {
  resetJobToCleanSlate,
  resetJobFromTask,
  resetSingleTask,
  initializeJobArtifacts,
  writeJobStatus,
  readJobStatus,
} from "../../core/status-writer.js";
import { getPipelineConfig } from "../../core/config.js";
import {
  getPendingSeedPath,
  resolvePipelinePaths,
  getJobDirectoryPath,
  getJobMetadataPath,
  getJobPipelinePath,
} from "../../config/paths.js";
import { readRawBody } from "../utils/http-utils.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory restart guard to prevent duplicate concurrent restarts per job
const restartingJobs = new Set();

// In-memory start guard to prevent duplicate concurrent starts per job
const startingJobs = new Set();

// In-memory stop guard to prevent duplicate concurrent stops per job
const stoppingJobs = new Set();

// Helper functions for restart guard
function isRestartInProgress(jobId) {
  return restartingJobs.has(jobId);
}

function beginRestart(jobId) {
  restartingJobs.add(jobId);
}

function endRestart(jobId) {
  restartingJobs.delete(jobId);
}

// Helper functions for start guard
function isStartInProgress(jobId) {
  return startingJobs.has(jobId);
}

function beginStart(jobId) {
  startingJobs.add(jobId);
}

function endStart(jobId) {
  startingJobs.delete(jobId);
}

// Helper functions for stop guard
function isStopInProgress(jobId) {
  return stoppingJobs.has(jobId);
}

function beginStop(jobId) {
  stoppingJobs.add(jobId);
}

function endStop(jobId) {
  stoppingJobs.delete(jobId);
}

/**
 * Validate that all upstream tasks are DONE
 * @param {Object} params - Parameters object
 * @param {Array} params.jobPipelineTasks - Pipeline tasks array from pipeline.json
 * @param {string} params.targetTaskId - Target task ID to validate
 * @param {Object} params.snapshotTasks - Tasks from tasks-status.json snapshot
 * @returns {Object} Validation result { ok: true } or { ok: false, code: "dependencies_not_satisfied", missing: [names] }
 */
function validateUpstreamDone({
  jobPipelineTasks,
  targetTaskId,
  snapshotTasks,
}) {
  // Helper function to extract task name from string or object
  const getTaskName = (t) => (typeof t === "string" ? t : t.name);

  // Derive ordered task names from pipeline config
  const orderedTaskNames = (jobPipelineTasks || []).map(getTaskName);

  // Find target task index
  const targetIndex = orderedTaskNames.indexOf(targetTaskId);
  if (targetIndex === -1) {
    return { ok: false, code: "task_not_found" };
  }

  // Get upstream tasks (all tasks before target)
  const upstreamTasks = orderedTaskNames.slice(0, targetIndex);

  // Check if all upstream tasks are DONE
  const missing = [];
  for (const taskName of upstreamTasks) {
    const taskState = snapshotTasks[taskName]?.state;
    if (taskState !== "done") {
      missing.push(taskName);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: "dependencies_not_satisfied",
      missing,
    };
  }

  return { ok: true };
}

/**
 * Resolve job lifecycle directory deterministically
 * @param {string} dataDir - Base data directory
 * @param {string} jobId - Job identifier
 * @returns {Promise<string|null>} One of "current", "complete", "rejected", or null if job not found
 */
async function resolveJobLifecycle(dataDir, jobId) {
  const currentJobDir = getJobDirectoryPath(dataDir, jobId, "current");
  const completeJobDir = getJobDirectoryPath(dataDir, jobId, "complete");
  const rejectedJobDir = getJobDirectoryPath(dataDir, jobId, "rejected");

  // Check in order of preference: current > complete > rejected
  const currentExists = await exists(currentJobDir);
  const completeExists = await exists(completeJobDir);
  const rejectedExists = await exists(rejectedJobDir);

  if (currentExists) {
    return "current";
  }

  if (completeExists) {
    return "complete";
  }

  if (rejectedExists) {
    return "rejected";
  }

  // Job not found in any lifecycle
  return null;
}

const exists = async (p) =>
  fs.promises
    .access(p)
    .then(() => true)
    .catch(() => false);

/**
 * Handle POST /api/jobs/:jobId/rescan
 */
export async function handleJobRescan(req, res, jobId, dataDir, sendJson) {
  try {
    // Validate jobId
    if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
      sendJson(res, 400, {
        ok: false,
        error: "bad_request",
        message: "jobId is required",
      });
      return;
    }

    // Resolve job lifecycle
    const lifecycle = await resolveJobLifecycle(dataDir, jobId);
    if (!lifecycle) {
      sendJson(res, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job not found",
      });
      return;
    }

    // Determine job directory
    const jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle);

    // Read job metadata to get pipeline slug
    const jobMetaPath = path.join(jobDir, "job.json");
    let jobMeta;
    try {
      const content = await fs.promises.readFile(jobMetaPath, "utf8");
      jobMeta = JSON.parse(content);
    } catch (error) {
      console.error(`Error reading job metadata for ${jobId}:`, error);
      sendJson(res, 500, {
        ok: false,
        code: "internal_error",
        message: "Failed to read job metadata",
      });
      return;
    }

    const pipelineSlug = jobMeta.pipeline;
    if (!pipelineSlug) {
      sendJson(res, 500, {
        ok: false,
        code: "invalid_job_metadata",
        message: "Job metadata missing pipeline slug",
      });
      return;
    }

    // Get authoritative source pipeline config
    let sourcePipelinePath;
    try {
      const config = await getPipelineConfig(pipelineSlug);
      sourcePipelinePath = config.pipelineJsonPath;
    } catch (error) {
      console.error(
        `Error getting pipeline config for ${pipelineSlug}:`,
        error
      );
      sendJson(res, 404, {
        ok: false,
        code: "pipeline_not_found",
        message: `Pipeline configuration not found for slug: ${pipelineSlug}`,
      });
      return;
    }

    let sourcePipeline;
    try {
      const content = await fs.promises.readFile(sourcePipelinePath, "utf8");
      sourcePipeline = JSON.parse(content);
    } catch (error) {
      console.error(
        `Error reading source pipeline config for ${pipelineSlug}:`,
        error
      );
      sendJson(res, 404, {
        ok: false,
        code: "pipeline_config_not_found",
        message: `Pipeline configuration not found for slug: ${pipelineSlug}`,
      });
      return;
    }

    // Read job's local pipeline config
    const jobPipelinePath = path.join(jobDir, "pipeline.json");
    let jobPipeline;
    try {
      const content = await fs.promises.readFile(jobPipelinePath, "utf8");
      jobPipeline = JSON.parse(content);
    } catch (error) {
      console.error(`Error reading job pipeline config for ${jobId}:`, error);
      sendJson(res, 500, {
        ok: false,
        code: "internal_error",
        message: "Failed to read job pipeline configuration",
      });
      return;
    }

    // Helper function to extract task name from string or object
    const getTaskName = (t) => (typeof t === "string" ? t : t.name);

    // Calculate added and removed tasks
    const existingTaskNames = new Set(
      (jobPipeline.tasks || []).map(getTaskName)
    );
    const sourceTaskNames = new Set(
      (sourcePipeline.tasks || []).map(getTaskName)
    );

    const added = (sourcePipeline.tasks || []).filter(
      (t) => !existingTaskNames.has(getTaskName(t))
    );
    const removed = (jobPipeline.tasks || []).filter(
      (t) => !sourceTaskNames.has(getTaskName(t))
    );

    if (added.length === 0 && removed.length === 0) {
      sendJson(res, 200, {
        ok: true,
        added: [],
        removed: [],
      });
      return;
    }

    // Update job's pipeline.json with full synchronization
    jobPipeline.tasks = JSON.parse(JSON.stringify(sourcePipeline.tasks || []));
    await fs.promises.writeFile(
      jobPipelinePath,
      JSON.stringify(jobPipeline, null, 2)
    );

    // Create directories for all tasks in synchronized pipeline
    const addedTaskNames = [];
    for (const task of jobPipeline.tasks || []) {
      const taskName = getTaskName(task);
      const taskDir = path.join(jobDir, "tasks", taskName);
      await fs.promises.mkdir(taskDir, { recursive: true });

      // Track which tasks were newly added for response
      if (added.some((t) => getTaskName(t) === taskName)) {
        addedTaskNames.push(taskName);
      }
    }

    // Update tasks-status.json with reconstruction logic
    await writeJobStatus(jobDir, (snapshot) => {
      const oldTasks = snapshot.tasks || {};
      const newTasksStatus = {};

      // Iterate through source pipeline tasks in order
      for (const task of sourcePipeline.tasks || []) {
        const taskName = getTaskName(task);

        if (oldTasks[taskName]) {
          // Preserve existing state for tasks that remain
          newTasksStatus[taskName] = oldTasks[taskName];
        } else {
          // Initialize new state for added tasks
          newTasksStatus[taskName] = {
            state: "pending",
            currentStage: null,
            attempts: 0,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          };
        }
      }

      snapshot.tasks = newTasksStatus;
      return snapshot;
    });

    sendJson(res, 200, {
      ok: true,
      added: addedTaskNames,
      removed: removed.map(getTaskName),
    });
  } catch (error) {
    console.error(`Error handling POST /api/jobs/${jobId}/rescan:`, error);
    sendJson(res, 500, {
      ok: false,
      code: "internal_error",
      message: "Internal server error",
    });
  }
}

/**
 * Handle POST /api/jobs/:jobId/restart
 */
export async function handleJobRestart(req, res, jobId, dataDir, sendJson) {
  try {
    // Validate jobId
    if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
      sendJson(res, 400, {
        ok: false,
        error: "bad_request",
        message: "jobId is required",
      });
      return;
    }

    // Resolve job lifecycle
    const lifecycle = await resolveJobLifecycle(dataDir, jobId);
    if (!lifecycle) {
      sendJson(res, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job not found",
      });
      return;
    }

    // Move job to current directory if it's not already there
    let jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle);

    if (lifecycle !== "current") {
      const sourcePath = getJobDirectoryPath(dataDir, jobId, lifecycle);
      const targetPath = getJobDirectoryPath(dataDir, jobId, "current");

      // Atomically move job to current directory
      await fs.promises.rename(sourcePath, targetPath);
      jobDir = targetPath;
    }

    // Check if job is already running
    const statusPath = path.join(jobDir, "tasks-status.json");

    let snapshot;
    try {
      const content = await fs.promises.readFile(statusPath, "utf8");
      snapshot = JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, {
          ok: false,
          code: "job_not_found",
          message: "Job status file not found",
        });
        return;
      }
      throw error;
    }

    // Guard against running jobs
    if (snapshot.state === "running") {
      sendJson(res, 409, {
        ok: false,
        code: "job_running",
        message: "Job is currently running",
      });
      return;
    }

    // Guard against concurrent restarts
    if (isRestartInProgress(jobId)) {
      sendJson(res, 409, {
        ok: false,
        code: "job_running",
        message: "Job restart is already in progress",
      });
      return;
    }

    // Parse optional fromTask from request body for targeted restart
    let body = {};
    try {
      const rawBody = await readRawBody(req);
      if (rawBody && rawBody.length > 0) {
        const bodyString = rawBody.toString("utf8");
        body = JSON.parse(bodyString);
      }
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: "bad_request",
        message: "Invalid JSON in request body",
      });
      return;
    }

    const { fromTask, singleTask } = body;

    // Begin restart guard
    beginRestart(jobId);

    try {
      // Reset job: clean-slate, partial from a specific task, or single task
      if (fromTask && singleTask === true) {
        await resetSingleTask(jobDir, fromTask, { clearTokenUsage: true });
      } else if (fromTask) {
        await resetJobFromTask(jobDir, fromTask, { clearTokenUsage: true });
      } else {
        await resetJobToCleanSlate(jobDir, { clearTokenUsage: true });
      }
    } finally {
      // Always end restart guard
      endRestart(jobId);
    }

    // Spawn detached pipeline-runner process
    const runnerPath = path.join(__dirname, "../../core/pipeline-runner.js");
    const base = process.env.PO_ROOT || dataDir;
    const env = {
      ...process.env,
      PO_ROOT: base,
      PO_DATA_DIR: path.join(base, "pipeline-data"),
      PO_PENDING_DIR: path.join(base, "pipeline-data", "pending"),
      PO_CURRENT_DIR: path.join(base, "pipeline-data", "current"),
      PO_COMPLETE_DIR: path.join(base, "pipeline-data", "complete"),
      ...(fromTask && { PO_START_FROM_TASK: fromTask }),
      ...(singleTask && { PO_RUN_SINGLE_TASK: "true" }),
    };

    const child = spawn(process.execPath, [runnerPath, jobId], {
      env,
      stdio: "ignore",
      detached: true,
    });

    // Unref() child process so it runs in the background
    child.unref();

    // Send success response
    const mode =
      fromTask && singleTask === true
        ? "single-task"
        : fromTask
          ? "partial"
          : "clean-slate";
    sendJson(res, 202, {
      ok: true,
      jobId,
      mode,
      spawned: true,
    });
  } catch (error) {
    console.error(`Error handling POST /api/jobs/${jobId}/restart:`, error);

    // Clean up restart guard on error
    if (isRestartInProgress(jobId)) {
      endRestart(jobId);
    }

    if (error.code === "ENOENT") {
      sendJson(res, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job directory not found",
      });
    } else if (error.code === "spawn failed") {
      sendJson(res, 500, {
        ok: false,
        code: "spawn_failed",
        message: error.message || "Failed to spawn pipeline runner",
      });
    } else if (error.httpStatus === 409) {
      // Handle lifecycle policy errors from pipeline-runner
      sendJson(res, 409, {
        ok: false,
        code: error.error || "unsupported_lifecycle",
        message: error.message || "Operation not allowed by lifecycle policy",
        ...(error.reason && { reason: error.reason }),
      });
    } else {
      sendJson(res, 500, {
        ok: false,
        code: "internal_error",
        message: "Internal server error",
      });
    }
  }
}

/**
 * Handle POST /api/jobs/:jobId/stop
 */
export async function handleJobStop(req, res, jobId, dataDir, sendJson) {
  try {
    // Validate jobId
    if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
      sendJson(res, 400, {
        ok: false,
        code: "bad_request",
        message: "jobId is required",
      });
      return;
    }

    // Resolve job lifecycle
    const lifecycle = await resolveJobLifecycle(dataDir, jobId);
    if (!lifecycle) {
      sendJson(res, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job not found",
      });
      return;
    }

    // Concurrency: if isStopInProgress(jobId) return 409
    if (isStopInProgress(jobId)) {
      sendJson(res, 409, {
        ok: false,
        code: "job_running",
        message: "Job stop is already in progress",
      });
      return;
    }

    // beginStop(jobId) before doing work; ensure endStop(jobId) in finally
    beginStop(jobId);

    try {
      // Determine job directory; if not in current, rename into current (mirror restart)
      let jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle);

      if (lifecycle !== "current") {
        const sourcePath = getJobDirectoryPath(dataDir, jobId, lifecycle);
        const targetPath = getJobDirectoryPath(dataDir, jobId, "current");

        // Atomically move job to current directory
        await fs.promises.rename(sourcePath, targetPath);
        jobDir = targetPath;
      }

      let pidFound = false;
      let usedSignal = null;
      let resetTask = null;

      // Read PID from path.join(jobDir, "runner.pid")
      const pidPath = path.join(jobDir, "runner.pid");
      const pidExists = await exists(pidPath);

      if (pidExists) {
        try {
          const pidContent = await fs.promises.readFile(pidPath, "utf8");
          const pid = parseInt(pidContent.trim(), 10);

          if (isNaN(pid)) {
            // Treat as no runner (remove file)
            await fs.promises.unlink(pidPath).catch(() => {}); // Ignore ENOENT
          } else {
            pidFound = true;

            try {
              // Try process.kill(pid, "SIGTERM")
              process.kill(pid, "SIGTERM");
              usedSignal = "SIGTERM";

              // Wait 1500ms
              await new Promise((resolve) => setTimeout(resolve, 1500));

              // If process still exists: try process.kill(pid, 0) to check
              try {
                process.kill(pid, 0); // Check if process exists
                // If we get here, process still exists, try SIGKILL
                process.kill(pid, "SIGKILL");
                usedSignal = "SIGKILL";
              } catch (checkError) {
                // ESRCH means process is gone (SIGTERM worked or process ended naturally)
                if (checkError.code !== "ESRCH") {
                  throw checkError;
                }
                // Keep usedSignal as "SIGTERM"
              }
            } catch (killError) {
              if (killError.code === "ESRCH") {
                // Process was already dead, no signal was sent
                usedSignal = null;
              } else {
                // Non-ESRCH errors → 500 spawn_failed/internal with message
                throw killError;
              }
            }
          }
        } catch (error) {
          // Remove runner.pid regardless after attempts (unlink ignoring ENOENT)
          await fs.promises.unlink(pidPath).catch(() => {});
          throw error;
        }

        // Remove runner.pid regardless after attempts (unlink ignoring ENOENT)
        await fs.promises.unlink(pidPath).catch(() => {});
      }

      // Status reset:
      // Read tasks-status.json via readJobStatus
      const snapshot = await readJobStatus(jobDir);
      if (!snapshot) {
        sendJson(res, 500, {
          ok: false,
          code: "internal_error",
          message: "Failed to read job status",
        });
        return;
      }

      // Determine running taskId:
      let runningTaskId = null;
      if (
        snapshot.current &&
        typeof snapshot.current === "string" &&
        snapshot.tasks[snapshot.current]?.state === "running"
      ) {
        runningTaskId = snapshot.current;
      } else {
        // Else find first key in snapshot.tasks with state === "running"
        for (const taskId of Object.keys(snapshot.tasks || {})) {
          if (snapshot.tasks[taskId].state === "running") {
            runningTaskId = taskId;
            break;
          }
        }
      }

      // If running taskId found: await resetSingleTask(jobDir, taskId, { clearTokenUsage: true })
      if (runningTaskId) {
        resetTask = runningTaskId;
        await resetSingleTask(jobDir, runningTaskId, { clearTokenUsage: true });
      }

      // Always normalize root fields afterward:
      await writeJobStatus(jobDir, (s) => {
        s.current = null;
        s.currentStage = null;
        return s;
      });

      // Response: sendJson 200 with { ok: true, jobId, stopped: Boolean(pidFound), resetTask: taskId || null, signal: usedSignal || null }
      sendJson(res, 200, {
        ok: true,
        jobId,
        stopped: pidFound,
        resetTask: resetTask,
        signal: usedSignal,
      });
    } finally {
      // Always endStop(jobId)
      endStop(jobId);
    }
  } catch (error) {
    console.error(`Error handling POST /api/jobs/${jobId}/stop:`, error);

    // Clean up stop guard on error

    if (error.code === "ENOENT") {
      sendJson(res, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job directory not found",
      });
    } else if (error.code === "spawn_failed") {
      sendJson(res, 500, {
        ok: false,
        code: "spawn_failed",
        message: error.message || "Failed to stop pipeline runner",
      });
    } else {
      sendJson(res, 500, {
        ok: false,
        code: "internal_error",
        message: "Internal server error",
      });
    }
  }
}

/**
 * Handle POST /api/jobs/:jobId/tasks/:taskId/start
 */
export async function handleTaskStart(
  req,
  res,
  jobId,
  taskId,
  dataDir,
  sendJson
) {
  try {
    // Validate jobId and taskId
    if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
      sendJson(res, 400, {
        ok: false,
        error: "bad_request",
        message: "jobId is required",
      });
      return;
    }

    if (!taskId || typeof taskId !== "string" || taskId.trim() === "") {
      sendJson(res, 400, {
        ok: false,
        error: "bad_request",
        message: "taskId is required",
      });
      return;
    }

    // Resolve job lifecycle
    const lifecycle = await resolveJobLifecycle(dataDir, jobId);
    if (!lifecycle) {
      sendJson(res, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job not found",
      });
      return;
    }

    // Move job to current directory if it's not already there (same logic as restart)
    let jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle);

    if (lifecycle !== "current") {
      const sourcePath = getJobDirectoryPath(dataDir, jobId, lifecycle);
      const targetPath = getJobDirectoryPath(dataDir, jobId, "current");

      // Atomically move job to current directory
      await fs.promises.rename(sourcePath, targetPath);
      jobDir = targetPath;
    }

    // Read snapshot from tasks-status.json
    const statusPath = path.join(jobDir, "tasks-status.json");
    let snapshot;
    try {
      const content = await fs.promises.readFile(statusPath, "utf8");
      snapshot = JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, {
          ok: false,
          code: "job_not_found",
          message: "Job status file not found",
        });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(res, 500, {
          ok: false,
          code: "internal_error",
          message: "Invalid job status JSON",
        });
        return;
      }
      throw error;
    }

    // Guard job not running
    if (snapshot.state === "running") {
      sendJson(res, 409, {
        ok: false,
        code: "job_running",
        message: "Job is currently running; start is unavailable",
      });
      return;
    }

    // Check if any task is currently running
    const hasRunningTask = Object.values(snapshot.tasks || {}).some(
      (task) => task.state === "running"
    );
    if (hasRunningTask) {
      sendJson(res, 409, {
        ok: false,
        code: "job_running",
        message: "Job is currently running; start is unavailable",
      });
      return;
    }

    // Validate task existence
    if (!snapshot.tasks || !snapshot.tasks[taskId]) {
      sendJson(res, 400, {
        ok: false,
        code: "task_not_found",
        message: "Task not found in job",
      });
      return;
    }

    // Validate task state is Pending
    if (snapshot.tasks[taskId].state !== "pending") {
      sendJson(res, 400, {
        ok: false,
        code: "task_not_pending",
        message: "Task is not in pending state",
      });
      return;
    }

    // Read job pipeline config
    const jobPipelinePath = getJobPipelinePath(dataDir, jobId, "current");
    let jobPipeline;
    try {
      const content = await fs.promises.readFile(jobPipelinePath, "utf8");
      jobPipeline = JSON.parse(content);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        code: "pipeline_config_not_found",
        message: "Pipeline configuration not found",
      });
      return;
    }

    // Validate dependencies via validateUpstreamDone
    const depCheck = validateUpstreamDone({
      jobPipelineTasks: jobPipeline.tasks,
      targetTaskId: taskId,
      snapshotTasks: snapshot.tasks,
    });

    if (!depCheck.ok) {
      if (depCheck.code === "dependencies_not_satisfied") {
        sendJson(res, 409, {
          ok: false,
          code: "dependencies_not_satisfied",
          message: `Dependencies not satisfied for task: ${depCheck.missing.join(", ")}`,
        });
        return;
      }
      // Handle other validation errors
      sendJson(res, 400, {
        ok: false,
        code: depCheck.code,
        message: "Task validation failed",
      });
      return;
    }

    // Start guard: prevent duplicate starts
    if (isStartInProgress(jobId)) {
      sendJson(res, 409, {
        ok: false,
        code: "job_running",
        message: "Task start is already in progress",
      });
      return;
    }

    beginStart(jobId);

    try {
      // Spawn detached runner (mirror restart code)
      const runnerPath = path.join(__dirname, "../../core/pipeline-runner.js");
      const base = process.env.PO_ROOT || dataDir;
      const env = {
        ...process.env,
        PO_ROOT: base,
        PO_DATA_DIR: path.join(base, "pipeline-data"),
        PO_PENDING_DIR: path.join(base, "pipeline-data", "pending"),
        PO_CURRENT_DIR: path.join(base, "pipeline-data", "current"),
        PO_COMPLETE_DIR: path.join(base, "pipeline-data", "complete"),
        PO_START_FROM_TASK: taskId,
        PO_RUN_SINGLE_TASK: "true",
      };

      const child = spawn(process.execPath, [runnerPath, jobId], {
        env,
        stdio: "ignore",
        detached: true,
      });

      child.unref();
    } finally {
      // Always end start guard
      endStart(jobId);
    }

    // Send success response
    sendJson(res, 202, {
      ok: true,
      jobId,
      taskId,
      mode: "single-task-start",
      spawned: true,
    });
  } catch (error) {
    console.error(
      `Error handling POST /api/jobs/${jobId}/tasks/${taskId}/start:`,
      error
    );

    // Clean up start guard on error
    if (isStartInProgress(jobId)) {
      endStart(jobId);
    }

    if (error.code === "ENOENT") {
      sendJson(res, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job directory not found",
      });
    } else if (error.code === "spawn failed") {
      sendJson(res, 500, {
        ok: false,
        code: "spawn_failed",
        message: error.message || "Failed to spawn pipeline runner",
      });
    } else if (error.httpStatus === 409) {
      // Handle lifecycle policy errors from pipeline-runner
      sendJson(res, 409, {
        ok: false,
        code: error.error || "unsupported_lifecycle",
        message: error.message || "Operation not allowed by lifecycle policy",
        ...(error.reason && { reason: error.reason }),
      });
    } else {
      sendJson(res, 500, {
        ok: false,
        code: "internal_error",
        message: "Internal server error",
      });
    }
  }
}

// Export restart guard functions for testing
export { isRestartInProgress, beginRestart, endRestart, resolveJobLifecycle };

// Export start guard functions for testing
export { isStartInProgress, beginStart, endStart };

// Export stop guard functions for testing
export { isStopInProgress, beginStop, endStop };
