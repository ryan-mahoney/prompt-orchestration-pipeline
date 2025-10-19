/**
 * Status transformer
 *
 * Responsibilities:
 *  - Normalize a raw tasks-status.json object into a job detail shape used by the UI
 *  - Compute job-level status and progress per docs/project-data-display.md (0.2)
 *  - Emit a warnings array (e.g., job id mismatch) but do not throw
 *
 * Exports expected by tests:
 *  - transformJobStatus(rawJobData, jobId, location) -> job object | null
 *  - computeJobStatus(tasks) -> { status, progress }
 *  - transformTasks(rawTasks) -> Array<task>
 *  - transformMultipleJobs(jobReadResults) -> Array<job>
 *  - getTransformationStats(readResults, transformedJobs) -> stats object
 *
 * Notes:
 *  - jobId is the directory name and is authoritative; raw.id may mismatch
 *  - Progress calculation: round(100 * done_count / max(1, total_tasks))
 *  - Job status rules:
 *      - error if any task error
 *      - running if any task running and none error
 *      - complete if all tasks done
 *      - pending otherwise
 */

import * as configBridge from "../config-bridge.browser.js";

// Known/valid task states for basic validation
const VALID_TASK_STATES = new Set(["pending", "running", "done", "error"]);

// Legacy/alternative states mapping -> canonical
const LEGACY_STATE_MAP = {
  failed: "error",
};

/**
 * Compute progress percentage from tasks mapping.
 * Accepts tasks object where each value may have a `state` property.
 */
export function computeProgress(tasks = {}) {
  if (!tasks || typeof tasks !== "object") return 0;
  const names = Object.keys(tasks);
  const total = names.length;
  if (total === 0) return 0;
  const doneCount = names.filter((n) => tasks[n]?.state === "done").length;
  return Math.round((100 * doneCount) / Math.max(1, total));
}

/**
 * Determine job-level status from tasks mapping.
 */
export function determineJobStatus(tasks = {}) {
  if (!tasks || typeof tasks !== "object") return "pending";
  const names = Object.keys(tasks);
  if (names.length === 0) return "pending";

  const states = names.map((n) => tasks[n]?.state);

  if (states.includes("error")) return "error";
  if (states.includes("running")) return "running";
  if (states.every((s) => s === "done")) return "complete";
  return "pending";
}

/**
 * Compute job status object { status, progress } and emit warnings for unknown states.
 * Tests expect console.warn to be called for unknown states with substring:
 *   Unknown task state "..."
 */
export function computeJobStatus(tasksInput) {
  // Guard invalid input
  if (
    !tasksInput ||
    typeof tasksInput !== "object" ||
    Array.isArray(tasksInput)
  ) {
    return { status: "pending", progress: 0 };
  }

  // Normalize task states, and detect unknown states
  const names = Object.keys(tasksInput);
  if (names.length === 0) return { status: "pending", progress: 0 };

  let unknownStatesFound = new Set();

  const normalized = {};
  for (const name of names) {
    const t = tasksInput[name];
    const state = t && typeof t === "object" ? t.state : undefined;
    const effectiveState =
      state != null &&
      Object.prototype.hasOwnProperty.call(LEGACY_STATE_MAP, state)
        ? LEGACY_STATE_MAP[state]
        : state;

    if (effectiveState == null || !VALID_TASK_STATES.has(effectiveState)) {
      if (state != null && !VALID_TASK_STATES.has(effectiveState)) {
        unknownStatesFound.add(state);
      }
      normalized[name] = { state: "pending" };
    } else {
      normalized[name] = { state: effectiveState };
    }
  }

  // Warn for unknown states
  for (const s of unknownStatesFound) {
    console.warn(`Unknown task state "${s}"`);
  }

  const progress = computeProgress(normalized);
  const status = determineJobStatus(normalized);

  return { status, progress };
}

/**
 * Transform raw tasks object -> ordered array of task objects.
 * - Returns [] for invalid inputs
 * - Missing or invalid state -> "pending" and console.warn with:
 *   Invalid task state "invalid-state"
 */
export function transformTasks(rawTasks) {
  if (!rawTasks || typeof rawTasks !== "object" || Array.isArray(rawTasks)) {
    return [];
  }

  const out = [];

  for (const [name, raw] of Object.entries(rawTasks || {})) {
    const rawState =
      raw && typeof raw === "object" && "state" in raw ? raw.state : undefined;
    const mappedState =
      rawState != null &&
      Object.prototype.hasOwnProperty.call(LEGACY_STATE_MAP, rawState)
        ? LEGACY_STATE_MAP[rawState]
        : rawState;

    let finalState = "pending";
    if (mappedState != null && VALID_TASK_STATES.has(mappedState)) {
      finalState = mappedState;
    } else if (rawState != null && !VALID_TASK_STATES.has(mappedState)) {
      // Invalid state value provided
      console.warn(`Invalid task state "${rawState}"`);
      finalState = "pending";
    } else {
      // missing state -> pending (no warn required by tests)
      finalState = "pending";
    }

    const task = {
      name,
      state: finalState,
    };

    if (raw && typeof raw === "object") {
      if ("startedAt" in raw) task.startedAt = raw.startedAt;
      if ("endedAt" in raw) task.endedAt = raw.endedAt;
      if ("attempts" in raw) task.attempts = raw.attempts;
      if ("executionTimeMs" in raw) task.executionTimeMs = raw.executionTimeMs;

      // Prefer new files.* schema, fallback to legacy artifacts
      if ("files" in raw && raw.files && typeof raw.files === "object") {
        task.files = {
          artifacts: Array.isArray(raw.files.artifacts)
            ? raw.files.artifacts.slice()
            : [],
          logs: Array.isArray(raw.files.logs) ? raw.files.logs.slice() : [],
          tmp: Array.isArray(raw.files.tmp) ? raw.files.tmp.slice() : [],
        };
      }
      if ("artifacts" in raw) task.artifacts = raw.artifacts;
    }

    out.push(task);
  }

  return out;
}

/**
 * Transform a single raw job payload into the canonical job object expected by UI/tests.
 *
 * Tests expect:
 *  - Signature transformJobStatus(rawJobData, jobId, location)
 *  - Return null for invalid raw inputs (null/undefined/non-object)
 *  - On ID mismatch, include a warnings array containing:
 *      'Job ID mismatch: JSON has "different-id", using directory name "job-123"'
 *  - Fallbacks:
 *      name => "Unnamed Job"
 *      updatedAt => createdAt
 *  - tasks normalized via transformTasks
 *  - status/progress via computeJobStatus (operate on the raw tasks object)
 *
 * Note: older code returned { ok: true, job } style; tests expect a plain job object.
 */
export function transformJobStatus(raw, jobId, location) {
  // Validate raw input: tests expect null for invalid raw
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const warnings = [];

  // ID mismatch warning (tests expect exact substring)
  if ("id" in raw && String(raw.id) !== String(jobId)) {
    const msg = `Job ID mismatch: JSON has "${raw.id}", using directory name "${jobId}"`;
    warnings.push(msg);
    console.warn(msg);
  }

  // name fallback
  const name = raw.name || "Unnamed Job";

  // createdAt/updatedAt handling
  const createdAt = raw.createdAt || null;
  const updatedAt = raw.updatedAt || createdAt || null;

  // Tasks normalization
  let tasksArray = [];
  if (
    !("tasks" in raw) ||
    typeof raw.tasks !== "object" ||
    raw.tasks === null
  ) {
    // tests expect that invalid tasks are treated as empty array (not an error)
    tasksArray = [];
  } else {
    tasksArray = transformTasks(raw.tasks);
  }

  // Compute status/progress based on the raw tasks mapping (so computeJobStatus sees unknown states)
  const jobStatusObj = computeJobStatus(raw.tasks);

  // Attach job-level files with safe defaults
  let jobFiles = { artifacts: [], logs: [], tmp: [] };
  if ("files" in raw && raw.files && typeof raw.files === "object") {
    jobFiles = {
      artifacts: Array.isArray(raw.files.artifacts)
        ? raw.files.artifacts.slice()
        : [],
      logs: Array.isArray(raw.files.logs) ? raw.files.logs.slice() : [],
      tmp: Array.isArray(raw.files.tmp) ? raw.files.tmp.slice() : [],
    };
  }

  const job = {
    id: jobId,
    name,
    status: jobStatusObj.status,
    progress: jobStatusObj.progress,
    createdAt,
    updatedAt,
    location,
    tasks: tasksArray,
    files: jobFiles,
  };

  if (warnings.length > 0) job.warnings = warnings;

  return job;
}

/**
 * Transform multiple job read results (as returned by readJob and job scanner logic)
 * - Logs "Transforming N jobs" (tests assert this substring)
 * - Filters out failed reads (ok !== true)
 * - Uses transformJobStatus for each successful read
 * - Preserves order of reads as provided
 */
export function transformMultipleJobs(jobReadResults = []) {
  const total = Array.isArray(jobReadResults) ? jobReadResults.length : 0;
  console.log(`Transforming ${total} jobs`);

  if (!Array.isArray(jobReadResults) || jobReadResults.length === 0) return [];

  const out = [];
  for (const r of jobReadResults) {
    if (!r || r.ok !== true) continue;
    // r.data is expected to be the raw job JSON
    const raw = r.data || {};
    // jobId and location metadata may be present on the read result (tests attach them)
    const jobId = r.jobId || (raw && raw.id) || undefined;
    const location = r.location || raw.location || undefined;
    // If jobId is missing, skip (defensive)
    if (!jobId) continue;
    const transformed = transformJobStatus(raw, jobId, location);
    if (transformed) out.push(transformed);
  }
  return out;
}

/**
 * Compute transformation statistics used by tests:
 * - totalRead: total read attempts
 * - successfulReads: count of readResults with ok === true
 * - successfulTransforms: transformedJobs.length
 * - failedTransforms: successfulReads - successfulTransforms
 * - transformationRate: Math.round(successfulTransforms / totalRead * 100) or 0
 * - statusDistribution: counts of statuses in transformedJobs
 */
export function getTransformationStats(readResults = [], transformedJobs = []) {
  const totalRead = Array.isArray(readResults) ? readResults.length : 0;
  const successfulReads = Array.isArray(readResults)
    ? readResults.filter((r) => r && r.ok === true).length
    : 0;
  const successfulTransforms = Array.isArray(transformedJobs)
    ? transformedJobs.length
    : 0;
  const failedTransforms = Math.max(0, successfulReads - successfulTransforms);
  const transformationRate =
    totalRead === 0 ? 0 : Math.round((successfulTransforms / totalRead) * 100);

  const statusDistribution = {};
  for (const j of transformedJobs || []) {
    if (!j || !j.status) continue;
    statusDistribution[j.status] = (statusDistribution[j.status] || 0) + 1;
  }

  return {
    totalRead,
    successfulReads,
    successfulTransforms,
    failedTransforms,
    transformationRate,
    statusDistribution,
  };
}
