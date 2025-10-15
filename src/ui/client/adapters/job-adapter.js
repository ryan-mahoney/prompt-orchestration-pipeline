/**
 * Job Adapter
 *
 * Purpose:
 * - Normalize API payloads (/api/jobs and /api/jobs/:id) into a stable UI-facing shape.
 * - Provide sensible defaults for missing optional fields.
 * - Be backward compatible with legacy/demo payload shapes.
 *
 * Defaults:
 * - progress: 0
 * - name: ''
 * - createdAt: null
 * - updatedAt: null
 * - tasks: []
 *
 * Normalization rules:
 * - Task state mapping: only 'pending'|'running'|'done'|'error' are allowed; unknown -> 'pending'
 * - If apiJob.progress is a valid number, use it; otherwise compute:
 *     progress = round(100 * done_count / max(1, total_tasks))
 * - If tasks is an object keyed by task name, convert to array with `name` field.
 * - Timestamps remain ISO strings (no UI formatting).
 *
 * Exports:
 * - adaptJobSummary(apiJob) -> summary props for lists
 * - adaptJobDetail(apiDetail) -> full job detail props for details view
 *
 * Implementation notes:
 * - Pure functions, no IO.
 * - Returns a normalized object; includes optional `__warnings` array for non-fatal issues.
 */

const ID_REGEX = /^[A-Za-z0-9-_]+$/;
const ALLOWED_STATES = new Set(["pending", "running", "done", "error"]);

/**
 * Normalize a raw task state into canonical enum.
 * Returns { state, warning? } where warning is a string if normalization occured.
 */
function normalizeTaskState(raw) {
  if (!raw || typeof raw !== "string")
    return { state: "pending", warning: "missing_state" };
  const s = raw.toLowerCase();
  if (ALLOWED_STATES.has(s)) return { state: s };
  return { state: "pending", warning: `unknown_state:${raw}` };
}

/**
 * Convert tasks input into an object of normalized task objects keyed by task name.
 * Accepts:
 * - object keyed by taskName -> taskObj (preferred canonical shape)
 * - array of task objects (with optional name) - converted to object
 */
function normalizeTasks(rawTasks) {
  if (!rawTasks) return { tasks: {}, warnings: [] };
  const warnings = [];

  if (typeof rawTasks === "object" && !Array.isArray(rawTasks)) {
    // Object shape - canonical format
    const tasks = {};
    Object.entries(rawTasks).forEach(([name, t]) => {
      const ns = normalizeTaskState(t && t.state);
      if (ns.warning) warnings.push(`${name}:${ns.warning}`);
      tasks[name] = {
        name,
        state: ns.state,
        startedAt: t && t.startedAt ? String(t.startedAt) : null,
        endedAt: t && t.endedAt ? String(t.endedAt) : null,
        attempts:
          typeof (t && t.attempts) === "number" ? t.attempts : undefined,
        executionTimeMs:
          typeof (t && t.executionTimeMs) === "number"
            ? t.executionTimeMs
            : undefined,
        artifacts: Array.isArray(t && t.artifacts)
          ? t.artifacts.slice()
          : undefined,
      };
    });
    return { tasks, warnings };
  }

  if (Array.isArray(rawTasks)) {
    // Array shape - convert to object for backward compatibility
    const tasks = {};
    rawTasks.forEach((t, idx) => {
      const name = t && t.name ? String(t.name) : `task-${idx}`;
      const ns = normalizeTaskState(t && t.state);
      if (ns.warning) warnings.push(`${name}:${ns.warning}`);
      tasks[name] = {
        name,
        state: ns.state,
        startedAt: t && t.startedAt ? String(t.startedAt) : null,
        endedAt: t && t.endedAt ? String(t.endedAt) : null,
        attempts:
          typeof (t && t.attempts) === "number" ? t.attempts : undefined,
        executionTimeMs:
          typeof (t && t.executionTimeMs) === "number"
            ? t.executionTimeMs
            : undefined,
        artifacts: Array.isArray(t && t.artifacts)
          ? t.artifacts.slice()
          : undefined,
      };
    });
    return { tasks, warnings };
  }

  return { tasks: {}, warnings: ["invalid_tasks_shape"] };
}

/**
 * Compute progress from tasks if progress not present.
 * Uses formula: round(100 * done_count / max(1, total_tasks))
 */
function computeProgressFromTasks(tasks) {
  const taskList = Object.values(tasks);
  const total = Math.max(1, taskList.length);
  const done = taskList.reduce(
    (acc, t) => acc + (t.state === "done" ? 1 : 0),
    0
  );
  return Math.round((100 * done) / total);
}

/**
 * Derive status from tasks when status is missing/invalid.
 * Rules:
 * - error if any task state === 'error'
 * - running if >=1 running and none error
 * - complete if all done
 * - pending otherwise
 */
function deriveStatusFromTasks(tasks) {
  const taskList = Object.values(tasks);
  if (!Array.isArray(taskList) || taskList.length === 0) return "pending";
  if (taskList.some((t) => t.state === "error")) return "error";
  if (taskList.some((t) => t.state === "running")) return "running";
  if (taskList.every((t) => t.state === "done")) return "complete";
  return "pending";
}

/**
 * Clamp number to 0..100 and ensure integer.
 */
function clampProgress(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * adaptJobSummary(apiJob)
 * - apiJob: object roughly matching docs 0.5 /api/jobs entry.
 * Returns normalized summary object for UI consumption.
 */
export function adaptJobSummary(apiJob = {}) {
  const warnings = [];

  // Basic extraction with defaults
  const rawId = apiJob.id || apiJob.jobId || apiJob.name || null;
  if (!rawId || typeof rawId !== "string") warnings.push("missing_id");
  const id = rawId && typeof rawId === "string" ? rawId : null;

  if (id && !ID_REGEX.test(id)) warnings.push("id_mismatch");

  const name =
    typeof apiJob.name === "string"
      ? apiJob.name
      : typeof apiJob.title === "string"
        ? apiJob.title
        : "";

  // Normalize tasks
  const { tasks, warnings: taskWarnings } = normalizeTasks(
    apiJob.tasks || apiJob.tasksStatus || apiJob.taskList
  );
  warnings.push(...taskWarnings);

  // Progress
  let progress = 0;
  if (typeof apiJob.progress === "number" && !Number.isNaN(apiJob.progress)) {
    progress = clampProgress(apiJob.progress);
  } else {
    progress = computeProgressFromTasks(tasks);
  }

  // Status
  let status =
    typeof apiJob.status === "string" &&
    ["running", "error", "pending", "complete"].includes(apiJob.status)
      ? apiJob.status
      : null;
  if (!status) {
    status = deriveStatusFromTasks(tasks);
  }

  const createdAt = apiJob.createdAt ? String(apiJob.createdAt) : null;
  const updatedAt = apiJob.updatedAt ? String(apiJob.updatedAt) : null;
  const location = apiJob.location === "complete" ? "complete" : "current";

  // Derived counts
  const taskList = Object.values(tasks);
  const taskCount = taskList.length;
  const doneCount = taskList.reduce(
    (acc, t) => acc + (t.state === "done" ? 1 : 0),
    0
  );

  const out = {
    id,
    // pipelineId is used by UI components as the identity/key; mirror id here
    pipelineId: id,
    name,
    status,
    progress,
    createdAt,
    updatedAt,
    location,
    taskCount,
    doneCount,
    tasks,
  };

  if (warnings.length > 0) out.__warnings = warnings;
  return out;
}

/**
 * adaptJobDetail(apiDetail)
 * - apiDetail: object roughly matching docs 0.5 /api/jobs/:jobId detail schema.
 * Returns a normalized detailed job object for UI consumption.
 */
export function adaptJobDetail(apiDetail = {}) {
  const warnings = [];

  const id = apiDetail.id || null;
  if (!id) warnings.push("missing_id");

  // Tasks can be array (detail) or object (legacy)
  const { tasks, warnings: taskWarnings } = normalizeTasks(
    apiDetail.tasks ||
      apiDetail.tasksObj ||
      apiDetail.tasksStatus ||
      apiDetail.tasks
  );
  warnings.push(...taskWarnings);

  // Keep top-level name/status/progress fields, fallback to summary adapter behavior
  const summaryLike = adaptJobSummary({
    id,
    name: apiDetail.name,
    status: apiDetail.status,
    progress: apiDetail.progress,
    createdAt: apiDetail.createdAt,
    updatedAt: apiDetail.updatedAt,
    location: apiDetail.location,
    tasks, // pass normalized tasks so progress/status derive consistently
  });

  const detailOut = {
    ...summaryLike,
    // Ensure tasks exist as array of normalized task objects
    tasks,
    // Preserve pipeline property if present in API response
    ...(apiDetail.pipeline && { pipeline: apiDetail.pipeline }),
    // Include any metadata or original fields the UI may use (do not include raw artifacts content)
    raw: undefined, // intentional placeholder to indicate raw content is not included
  };

  if (warnings.length > 0)
    detailOut.__warnings = (detailOut.__warnings || []).concat(warnings);
  return detailOut;
}
