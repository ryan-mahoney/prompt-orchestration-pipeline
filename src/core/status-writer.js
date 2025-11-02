import fs from "node:fs/promises";
import path from "node:path";

// Lazy import SSE registry to avoid circular dependencies
let sseRegistry = null;
async function getSSERegistry() {
  if (!sseRegistry) {
    try {
      const module = await import("../ui/sse.js");
      sseRegistry = module.sseRegistry;
    } catch (error) {
      // SSE not available in all environments
      return null;
    }
  }
  return sseRegistry;
}

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
    state: "pending",
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
 * Validates that the status snapshot has required structure
 */
function validateStatusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Status snapshot must be an object");
  }

  // Ensure required root fields exist
  if (typeof snapshot.state !== "string") {
    snapshot.state = "pending";
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

  // Read existing status or create default
  let snapshot = await readStatusFile(statusPath, jobId);

  // Validate basic structure
  snapshot = validateStatusSnapshot(snapshot);

  // Apply user updates
  try {
    const result = updateFn(snapshot);
    // If updateFn returns a value, use it as the new snapshot
    if (result !== undefined) {
      snapshot = result;
    }
  } catch (error) {
    throw new Error(`Update function failed: ${error.message}`);
  }

  // Validate final structure
  snapshot = validateStatusSnapshot(snapshot);

  // Update timestamp
  snapshot.lastUpdated = new Date().toISOString();

  // Atomic write
  await atomicWrite(statusPath, snapshot);

  // Emit SSE event for tasks-status.json change
  const registry = await getSSERegistry();
  if (registry) {
    try {
      registry.broadcast({
        type: "state:change",
        data: {
          path: path.join(jobDir, "tasks-status.json"),
          id: jobId,
        },
      });
    } catch (error) {
      // Don't fail the write if SSE emission fails
      console.warn(`Failed to emit SSE event: ${error.message}`);
    }
  }

  return snapshot;
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

  return writeJobStatus(jobDir, (snapshot) => {
    // Ensure task exists
    if (!snapshot.tasks[taskId]) {
      snapshot.tasks[taskId] = {};
    }

    const task = snapshot.tasks[taskId];

    // Apply task updates
    const result = taskUpdateFn(task);
    if (result !== undefined) {
      snapshot.tasks[taskId] = result;
    }

    return snapshot;
  });
}
