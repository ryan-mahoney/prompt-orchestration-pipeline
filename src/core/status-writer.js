import fs from "node:fs/promises";
import path from "node:path";
import { TaskState } from "../config/statuses.js";
import { createJobLogger } from "./logger.js";

// Per-job write queues to serialize writes to tasks-status.json
const writeQueues = new Map(); // Map<string jobDir, Promise<any>>

/**
 * Atomic status writer utility for tasks-status.json
 *
 * Provides atomic updates to job status files with proper error handling
 * and shape validation for the new status schema.
 */

/**
 * Default status shape for new files
 */
function createDefaultStatus(jobId) {
  return {
    id: jobId,
    state: TaskState.PENDING,
    current: null,
    currentStage: null,
    lastUpdated: new Date().toISOString(),
    tasks: {},
    files: {
      artifacts: [],
      logs: [],
      tmp: [],
    },
  };
}

/**
 * Reads and parses tasks-status.json, creates default if missing
 */
async function readStatusFile(statusPath, jobId) {
  try {
    const content = await fs.readFile(statusPath, "utf8");
    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, return default structure
      return createDefaultStatus(jobId);
    }
    if (error instanceof SyntaxError) {
      // Invalid JSON, log warning and return default
      console.warn(
        `Invalid JSON in ${statusPath}, creating new status:`,
        error.message
      );
      return createDefaultStatus(jobId);
    }
    throw error;
  }
}

/**
 * Atomic write using temp file + rename pattern
 */
async function atomicWrite(filePath, data) {
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    // Clean up temp file if write failed
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Validates that the status snapshot has required structure.
 *
 * This function preserves all unknown fields, including optional numeric fields
 * like `snapshot.progress`. Only the required root fields are validated and
 * fixed if missing or malformed. Extra fields are passed through unchanged.
 *
 * @param {Object} snapshot - The status snapshot to validate
 * @returns {Object} The validated and normalized snapshot
 */
function validateStatusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Status snapshot must be an object");
  }

  // Ensure required root fields exist
  if (typeof snapshot.state !== "string") {
    snapshot.state = TaskState.PENDING;
  }
  if (snapshot.current !== null && typeof snapshot.current !== "string") {
    snapshot.current = null;
  }
  if (
    snapshot.currentStage !== null &&
    typeof snapshot.currentStage !== "string"
  ) {
    snapshot.currentStage = null;
  }

  // Ensure timestamp exists
  if (!snapshot.lastUpdated || typeof snapshot.lastUpdated !== "string") {
    snapshot.lastUpdated = new Date().toISOString();
  }

  // Ensure tasks object exists
  if (!snapshot.tasks || typeof snapshot.tasks !== "object") {
    snapshot.tasks = {};
  }

  // Ensure files object exists with proper structure
  if (!snapshot.files || typeof snapshot.files !== "object") {
    snapshot.files = { artifacts: [], logs: [], tmp: [] };
  } else {
    // Ensure each files array exists
    for (const type of ["artifacts", "logs", "tmp"]) {
      if (!Array.isArray(snapshot.files[type])) {
        snapshot.files[type] = [];
      }
    }
  }

  return snapshot;
}

/**
 * Atomically updates tasks-status.json with the provided update function
 *
 * @param {string} jobDir - Job directory path containing tasks-status.json
 * @param {Function} updateFn - Function that receives and mutates the status snapshot
 * @returns {Promise<Object>} The updated status snapshot
 *
 * Example:
 * await writeJobStatus(jobDir, (snapshot) => {
 *   snapshot.current = "task-1";
 *   snapshot.currentStage = "processing";
 *   snapshot.tasks["task-1"].currentStage = "processing";
 *   snapshot.tasks["task-1"].state = "running";
 * });
 */
export async function writeJobStatus(jobDir, updateFn) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  if (typeof updateFn !== "function") {
    throw new Error("updateFn must be a function");
  }

  const statusPath = path.join(jobDir, "tasks-status.json");
  const jobId = path.basename(jobDir);
  const logger = createJobLogger("StatusWriter", jobId);

  // Get or create the write queue for this job directory
  const prev = writeQueues.get(jobDir) || Promise.resolve();
  let resultSnapshot;

  const next = prev
    .then(async () => {
      // Read existing status or create default
      const current = await readStatusFile(statusPath, jobId);

      // Validate basic structure
      const validated = validateStatusSnapshot(current);

      // Apply user updates
      let maybeUpdated;
      try {
        maybeUpdated = updateFn(validated);
      } catch (error) {
        logger.error("Error executing update function:", error);
        throw new Error(`Update function failed: ${error.message}`);
      }
      const snapshot = validateStatusSnapshot(
        maybeUpdated === undefined ? validated : maybeUpdated
      );

      snapshot.lastUpdated = new Date().toISOString();

      // Atomic write
      await atomicWrite(statusPath, snapshot);

      // Emit SSE event for tasks-status.json change using logger
      try {
        const eventData = {
          path: path.join(jobDir, "tasks-status.json"),
          id: jobId,
          jobId,
        };
        await logger.sse("state:change", eventData);
      } catch (error) {
        // Don't fail the write if SSE emission fails
        logger.error("Failed to emit SSE event:", error);
      }

      // Emit lifecycle_block event if update contains lifecycle block reason
      if (snapshot.lifecycleBlockReason) {
        try {
          const lifecycleEventData = {
            jobId,
            taskId: snapshot.lifecycleBlockTaskId,
            op: snapshot.lifecycleBlockOp,
            reason: snapshot.lifecycleBlockReason,
          };
          await logger.sse("lifecycle_block", lifecycleEventData);
        } catch (error) {
          // Don't fail the write if SSE emission fails
          logger.error("Failed to emit lifecycle_block SSE event:", error);
        }
      }

      logger.groupEnd();
      resultSnapshot = snapshot;
    })
    .catch((e) => {
      throw e;
    });

  // Store the promise chain and set up cleanup
  writeQueues.set(
    jobDir,
    next.finally(() => {})
  );

  return next.then(() => resultSnapshot);
}

/**
 * Reads tasks-status.json with proper error handling
 *
 * @param {string} jobDir - Job directory path
 * @returns {Promise<Object|null>} Status snapshot or null if file cannot be read
 */
export async function readJobStatus(jobDir) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  const statusPath = path.join(jobDir, "tasks-status.json");

  try {
    // Check if file exists first
    await fs.access(statusPath);

    const content = await fs.readFile(statusPath, "utf8");
    const parsed = JSON.parse(content);
    return validateStatusSnapshot(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      console.warn(
        `Invalid JSON in ${statusPath}, cannot read status:`,
        error.message
      );
      return null;
    }
    console.warn(`Failed to read status from ${jobDir}:`, error.message);
    return null;
  }
}

/**
 * Utility to update task-specific fields atomically
 *
 * @param {string} jobDir - Job directory path
 * @param {string} taskId - Task identifier
 * @param {Function} taskUpdateFn - Function that receives and mutates the task object
 * @returns {Promise<Object>} The updated status snapshot
 */
export async function updateTaskStatus(jobDir, taskId, taskUpdateFn) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  if (!taskId || typeof taskId !== "string") {
    throw new Error("taskId must be a non-empty string");
  }

  if (typeof taskUpdateFn !== "function") {
    throw new Error("taskUpdateFn must be a function");
  }

  const jobId = path.basename(jobDir);
  const logger = createJobLogger("StatusWriter", jobId);

  // Get or create the write queue for this job directory
  const prev = writeQueues.get(jobDir) || Promise.resolve();
  let resultSnapshot;

  const next = prev
    .then(async () => {
      const statusPath = path.join(jobDir, "tasks-status.json");

      // Read existing status or create default
      const current = await readStatusFile(statusPath, jobId);
      const validated = validateStatusSnapshot(current);

      // Ensure task exists
      if (!validated.tasks[taskId]) {
        validated.tasks[taskId] = {};
      }

      const task = validated.tasks[taskId];

      // Apply task updates
      const result = taskUpdateFn(task);
      if (result !== undefined) {
        validated.tasks[taskId] = result;
      }

      validated.lastUpdated = new Date().toISOString();

      // Atomic write
      await atomicWrite(statusPath, validated);

      // Emit task:updated SSE event after successful write
      try {
        const eventData = {
          jobId,
          taskId,
          task: validated.tasks[taskId],
        };
        await logger.sse("task:updated", eventData);
      } catch (error) {
        // Don't fail the write if SSE emission fails
        logger.error("Failed to emit task:updated SSE event:", error);
      }

      resultSnapshot = validated;
    })
    .catch((e) => {
      throw e;
    });

  // Store the promise chain and set up cleanup
  writeQueues.set(
    jobDir,
    next.finally(() => {})
  );

  return next.then(() => resultSnapshot);
}

/**
 * Reset a job from a specific task onward, preserving prior completed tasks
 *
 * @param {string} jobDir - Job directory path containing tasks-status.json
 * @param {string} fromTask - Task identifier to restart from (inclusive)
 * @param {Object} options - Reset options
 * @param {boolean} [options.clearTokenUsage=true] - Whether to clear token usage arrays
 * @returns {Promise<Object>} The updated status snapshot
 */
export async function resetJobFromTask(
  jobDir,
  fromTask,
  { clearTokenUsage = true } = {}
) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  if (!fromTask || typeof fromTask !== "string") {
    throw new Error("fromTask must be a non-empty string");
  }

  return writeJobStatus(jobDir, (snapshot) => {
    // Reset root-level status
    snapshot.state = TaskState.PENDING;
    snapshot.current = null;
    snapshot.currentStage = null;
    snapshot.progress = 0;
    snapshot.lastUpdated = new Date().toISOString();

    // Ensure tasks object exists
    if (!snapshot.tasks || typeof snapshot.tasks !== "object") {
      snapshot.tasks = {};
    }

    // Compute progress based on preserved (done) tasks before fromTask
    let doneCount = 0;
    const taskKeys = Object.keys(snapshot.tasks);
    for (const taskId of taskKeys) {
      if (snapshot.tasks[taskId]?.state === TaskState.DONE) {
        doneCount++;
      }
    }
    snapshot.progress =
      taskKeys.length > 0 ? (doneCount / taskKeys.length) * 100 : 0;

    // Reset tasks from fromTask onward to pending; keep earlier tasks as-is
    for (const taskId of taskKeys) {
      const task = snapshot.tasks[taskId];
      if (!task) continue; // ensure task object exists

      const shouldReset =
        taskKeys.indexOf(taskId) >= taskKeys.indexOf(fromTask);
      if (shouldReset) {
        // Reset task state and metadata
        task.state = TaskState.PENDING;
        task.currentStage = null;

        // Remove error-related fields
        delete task.failedStage;
        delete task.error;

        // Reset counters
        task.attempts = 0;
        task.refinementAttempts = 0;

        // Clear token usage if requested
        if (clearTokenUsage) {
          task.tokenUsage = [];
        }
      }
      // If task appears before fromTask and is not done, keep its state untouched
      // This preserves upstream work if user restarts from a mid-pipeline task
    }

    // Preserve files.* arrays - do not modify them
    // This ensures generated files are preserved during restart

    return snapshot;
  });
}

/**
 * Reset a job and all its tasks to clean-slate state atomically
 *
 * @param {string} jobDir - Job directory path containing tasks-status.json
 * @param {Object} options - Reset options
 * @param {boolean} [options.clearTokenUsage=true] - Whether to clear token usage arrays
 * @returns {Promise<Object>} The updated status snapshot
 */
export async function resetJobToCleanSlate(
  jobDir,
  { clearTokenUsage = true } = {}
) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  return writeJobStatus(jobDir, (snapshot) => {
    // Reset root-level status
    snapshot.state = TaskState.PENDING;
    snapshot.current = null;
    snapshot.currentStage = null;
    snapshot.progress = 0;
    snapshot.lastUpdated = new Date().toISOString();

    // Reset all tasks
    if (snapshot.tasks && typeof snapshot.tasks === "object") {
      for (const taskId of Object.keys(snapshot.tasks)) {
        const task = snapshot.tasks[taskId];

        // Reset task state
        task.state = TaskState.PENDING;
        task.currentStage = null;

        // Remove error-related fields
        delete task.failedStage;
        delete task.error;

        // Reset counters
        task.attempts = 0;
        task.refinementAttempts = 0;

        // Clear token usage if requested
        if (clearTokenUsage) {
          task.tokenUsage = [];
        }
      }
    }

    // Preserve files.* arrays - do not modify them
    // This ensures generated files are preserved during restart

    return snapshot;
  });
}

/**
 * Reset a single task to pending state without affecting other tasks
 *
 * @param {string} jobDir - Job directory path containing tasks-status.json
 * @param {string} taskId - Task identifier to reset
 * @param {Object} options - Reset options
 * @param {boolean} [options.clearTokenUsage=true] - Whether to clear token usage arrays
 * @returns {Promise<Object>} The updated status snapshot
 */
export async function resetSingleTask(
  jobDir,
  taskId,
  { clearTokenUsage = true } = {}
) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  if (!taskId || typeof taskId !== "string") {
    throw new Error("taskId must be a non-empty string");
  }

  return writeJobStatus(jobDir, (snapshot) => {
    // Ensure tasks object exists
    if (!snapshot.tasks || typeof snapshot.tasks !== "object") {
      snapshot.tasks = {};
    }

    // Ensure the target task exists
    if (!snapshot.tasks[taskId]) {
      snapshot.tasks[taskId] = {};
    }

    const task = snapshot.tasks[taskId];

    // Reset only the target task state and metadata
    task.state = TaskState.PENDING;
    task.currentStage = null;

    // Remove error-related fields
    delete task.failedStage;
    delete task.error;

    // Reset counters
    task.attempts = 0;
    task.refinementAttempts = 0;

    // Clear token usage if requested
    if (clearTokenUsage) {
      task.tokenUsage = [];
    }

    // Update lastUpdated timestamp
    snapshot.lastUpdated = new Date().toISOString();

    // Do not modify:
    // - Any other tasks within snapshot.tasks
    // - snapshot.files.artifacts|logs|tmp
    // - Root-level fields other than lastUpdated

    return snapshot;
  });
}

/**
 * Consolidated path jail security validation with generic error messages
 * @param {string} filename - Filename to validate
 * @returns {Object|null} Validation result or null if valid
 */
function validateFilePath(filename) {
  // Check for path traversal patterns
  if (filename.includes("..")) {
    console.error("Path security: path traversal detected", { filename });
    return {
      allowed: false,
      message: "Path validation failed",
    };
  }

  // Check for absolute paths (POSIX, Windows, backslashes, ~)
  if (
    path.isAbsolute(filename) ||
    /^[a-zA-Z]:/.test(filename) ||
    filename.includes("\\") ||
    filename.startsWith("~")
  ) {
    console.error("Path security: absolute path detected", { filename });
    return {
      allowed: false,
      message: "Path validation failed",
    };
  }

  // Check for empty filename
  if (!filename || filename.trim() === "") {
    console.error("Path security: empty filename detected");
    return {
      allowed: false,
      message: "Path validation failed",
    };
  }

  // Path is valid
  return null;
}

/**
 * Initialize job-level artifact index and copy artifacts to job directory
 * @param {string} jobDir - Job directory path
 * @param {Array} uploadArtifacts - Array of {filename, content} objects
 * @returns {Promise<void>}
 */
export async function initializeJobArtifacts(jobDir, uploadArtifacts = []) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  if (!Array.isArray(uploadArtifacts)) {
    throw new Error("uploadArtifacts must be an array");
  }

  if (uploadArtifacts.length === 0) {
    return;
  }

  const jobFilesDir = path.join(jobDir, "files");
  const jobArtifactsDir = path.join(jobFilesDir, "artifacts");

  await fs.mkdir(jobFilesDir, { recursive: true });
  await fs.mkdir(jobArtifactsDir, { recursive: true });

  for (const artifact of uploadArtifacts) {
    const { filename, content } = artifact || {};

    if (!filename || typeof filename !== "string") {
      continue; // Skip invalid entries rather than throwing
    }

    // Validate filename using the consolidated function
    const validation = validateFilePath(filename);
    if (validation) {
      console.error("Path security: skipping invalid artifact", {
        filename,
        reason: validation.message,
      });
      continue; // Skip invalid filenames rather than throwing
    }

    const artifactPath = path.join(jobArtifactsDir, filename);
    await fs.writeFile(artifactPath, content);
  }
}
