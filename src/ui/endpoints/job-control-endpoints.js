import fs from "fs";
import path from "path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import {
  resetJobToCleanSlate,
  initializeJobArtifacts,
  writeJobStatus,
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

    const { fromTask } = body;

    // Begin restart guard
    beginRestart(jobId);

    try {
      // Reset job: clean-slate or partial from a specific task
      const { resetJobFromTask } = await import("../../core/status-writer.js");
      if (fromTask) {
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
    };

    const child = spawn(process.execPath, [runnerPath, jobId], {
      env,
      stdio: "ignore",
      detached: true,
    });

    // Unref() child process so it runs in the background
    child.unref();

    // Send success response
    sendJson(res, 202, {
      ok: true,
      jobId,
      mode: "clean-slate",
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
