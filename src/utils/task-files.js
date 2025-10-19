/**
 * Task files selector utilities.
 *
 * Single source of truth for normalizing the `task.files` structure that flows
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
 * Normalize an arbitrary input into the strict TaskFiles structure.
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
 * Ensure the provided task object has a normalized `files` property that matches
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
 * Determine whether a task matches the provided identifier.
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
 * Locate a task within the provided tasks collection.
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
 * Public selector that retrieves the strict TaskFiles structure for a specific task.
 * @param {Object} job
 * @param {string | number} taskId
 * @returns {TaskFiles}
 */
export function getTaskFilesForTask(job, taskId) {
  if (!job || typeof job !== "object") {
    return createEmptyTaskFiles();
  }

  const taskCandidate = findTaskCandidate(job.tasks, taskId);
  if (!taskCandidate) {
    return createEmptyTaskFiles();
  }

  return ensureTaskFiles(taskCandidate);
}
