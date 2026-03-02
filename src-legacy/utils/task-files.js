/**
 * Task files selector utilities.
 *
 * Single source of truth for normalizing `task.files` structure that flows
 * from tasks_status.json into the UI. The enforced contract is:
 *
 *   {
 *     artifacts: string[],
 *     logs: string[],
 *     tmp: string[]
 *   }
 *
 * Any other keys (e.g., legacy "input"/"output") are ignored with a warning.
 */

/**
 * @typedef {Object} TaskFiles
 * @property {string[]} artifacts
 * @property {string[]} logs
 * @property {string[]} tmp
 */

const CATEGORY_KEYS = ["artifacts", "logs", "tmp"];
const LEGACY_KEY_SET = new Set([
  "input",
  "inputs",
  "output",
  "outputs",
  "legacyInput",
  "legacyOutput",
  "inputFiles",
  "outputFiles",
]);

/**
 * Produce a fresh TaskFiles object with empty arrays.
 * @returns {TaskFiles}
 */
export function createEmptyTaskFiles() {
  return { artifacts: [], logs: [], tmp: [] };
}

/**
 * Normalize an unknown value into an array of strings.
 * @param {unknown} value
 * @returns {string[]}
 */
function coerceStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string");
}

/**
 * Emit warnings for unsupported task.files keys while ensuring we do not block execution.
 * @param {string[]} keys
 */
function reportUnsupportedKeys(keys) {
  if (keys.length === 0) return;

  const legacyKeys = keys.filter((key) => LEGACY_KEY_SET.has(key));
  const otherKeys = keys.filter((key) => !LEGACY_KEY_SET.has(key));

  if (legacyKeys.length > 0) {
    console.warn(
      `[task-files] Ignoring unsupported legacy keys: ${legacyKeys.join(", ")}`
    );
  }
  if (otherKeys.length > 0) {
    console.warn(
      `[task-files] Ignoring unsupported task.files keys: ${otherKeys.join(", ")}`
    );
  }
}

/**
 * Normalize an arbitrary input into a strict TaskFiles structure.
 * @param {unknown} candidate
 * @returns {TaskFiles}
 */
export function normalizeTaskFiles(candidate) {
  const safeCandidate =
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate
      : {};

  const unsupportedKeys = Object.keys(safeCandidate).filter(
    (key) => !CATEGORY_KEYS.includes(key)
  );
  reportUnsupportedKeys(unsupportedKeys);

  return {
    artifacts: coerceStringArray(safeCandidate.artifacts),
    logs: coerceStringArray(safeCandidate.logs),
    tmp: coerceStringArray(safeCandidate.tmp),
  };
}

/**
 * Ensure provided task object has a normalized `files` property that matches
 * the enforced contract. Returns the normalized structure for convenience.
 * @param {Record<string, unknown> | null | undefined} task
 * @returns {TaskFiles}
 */
export function ensureTaskFiles(task) {
  const normalized = normalizeTaskFiles(task?.files);
  if (task && typeof task === "object") {
    task.files = normalized;
  }
  return normalized;
}

/**
 * Determine whether a task matches a provided identifier.
 * @param {Record<string, unknown>} task
 * @param {string | number} taskId
 * @returns {boolean}
 */
function matchesTaskIdentifier(task, taskId) {
  if (!task || typeof task !== "object" || taskId == null) return false;
  const target = String(taskId);
  if (task.id != null && String(task.id) === target) return true;
  if (task.name != null && String(task.name) === target) return true;
  return false;
}

/**
 * Locate a task within a provided tasks collection.
 * @param {unknown} tasks
 * @param {string | number} taskId
 * @returns {Record<string, unknown> | null}
 */
function findTaskCandidate(tasks, taskId) {
  if (!tasks || taskId == null) return null;

  if (Array.isArray(tasks)) {
    if (typeof taskId === "number" && tasks[taskId]) {
      const indexedTask = tasks[taskId];
      if (indexedTask && typeof indexedTask === "object") {
        return indexedTask;
      }
    }

    return tasks.find((task) => matchesTaskIdentifier(task, taskId)) ?? null;
  }

  if (typeof tasks === "object") {
    const direct = tasks[taskId];
    if (direct && typeof direct === "object") {
      return direct;
    }

    for (const task of Object.values(tasks)) {
      if (matchesTaskIdentifier(task, taskId)) {
        return task;
      }
    }
  }

  return null;
}

/**
 * Public selector that retrieves a strict TaskFiles structure for a specific task.
 * @param {Object} job
 * @param {string | number} taskId
 * @returns {TaskFiles}
 */
export function getTaskFilesForTask(job, taskId) {
  console.debug("[getTaskFilesForTask] Called with:", { job, taskId });

  if (!job || typeof job !== "object") {
    console.debug("[getTaskFilesForTask] No job or invalid job object");
    return createEmptyTaskFiles();
  }

  const taskCandidate = findTaskCandidate(job.tasks, taskId);
  if (!taskCandidate) {
    console.debug(
      "[getTaskFilesForTask] No task candidate found for taskId:",
      taskId
    );
    return createEmptyTaskFiles();
  }

  const result = ensureTaskFiles(taskCandidate);
  console.debug("[getTaskFilesForTask] Task files result:", { taskId, result });
  return result;
}

/**
 * List task files by type with fallback to empty task files
 * @param {string} jobId - Job ID
 * @param {string} taskId - Task ID
 * @param {string} type - File type (artifacts/logs/tmp)
 * @returns {Promise<string[]>} Array of file names
 */
export async function listTaskFiles(jobId, taskId, type) {
  try {
    console.debug("[listTaskFiles] Called with:", { jobId, taskId, type });

    // Use fetch API directly for consistency with UI
    const apiUrl = new URL(
      `/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
      window.location.origin
    );

    console.debug("[listTaskFiles] Fetching from:", apiUrl.toString());

    const response = await fetch(apiUrl.toString());
    const data = await response.json();

    console.debug("[listTaskFiles] Response:", data);

    if (data.ok && data.data && data.data.files) {
      const fileNames = data.data.files.map((f) => f.name);
      console.debug("[listTaskFiles] Found files:", fileNames);
      return fileNames;
    }

    console.debug("[listTaskFiles] No valid files found in response");
    return [];
  } catch (error) {
    console.error("[listTaskFiles] Error:", error);
    return [];
  }
}

/**
 * Read task file content with proper error handling
 * @param {string} jobId - Job ID
 * @param {string} taskId - Task ID
 * @param {string} type - File type (artifacts/logs/tmp)
 * @param {string} filename - File name
 * @returns {Promise<Object|null>} File object or null if error
 */
export async function readTaskFile(jobId, taskId, type, filename) {
  try {
    console.debug("[readTaskFile] Called with:", {
      jobId,
      taskId,
      type,
      filename,
    });

    // Use fetch API directly for consistency with UI
    const apiUrl = new URL(
      `/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${encodeURIComponent(
        filename
      )}`,
      window.location.origin
    );

    console.debug("[readTaskFile] Fetching from:", apiUrl.toString());

    const response = await fetch(apiUrl.toString());
    const data = await response.json();

    console.debug("[readTaskFile] Response:", data);

    if (data.ok) {
      console.debug("[readTaskFile] File read successfully");
      return data;
    }

    console.error("[readTaskFile] File read failed:", data);
    return null;
  } catch (error) {
    console.error("[readTaskFile] Error:", error);
    return null;
  }
}
