import * as configBridge from "../config-bridge.browser.js";
import { normalizeTaskFiles } from "../../utils/task-files.js";
import { derivePipelineMetadata } from "../../utils/pipelines.js";

const VALID_TASK_STATES = new Set(["pending", "running", "done", "error"]);
const LEGACY_STATE_MAP = { failed: "error" };

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
 * Transform raw task input into a canonical object keyed by task name.
 * - Returns {} for invalid inputs
 * - Missing or invalid state -> "pending" with console.warn for invalid values
 */
export function transformTasks(rawTasks) {
  if (!rawTasks) return {};

  let entries = [];

  if (Array.isArray(rawTasks)) {
    entries = rawTasks.map((raw, index) => {
      const inferredName =
        raw?.name || raw?.id || raw?.taskId || `task-${index + 1}`;
      return [inferredName, raw];
    });
  } else if (typeof rawTasks === "object") {
    entries = Object.entries(rawTasks);
  } else {
    return {};
  }

  const normalized = {};

  for (const [name, raw] of entries) {
    if (typeof name !== "string" || name.length === 0) continue;

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
      console.warn(`Invalid task state "${rawState}"`);
      finalState = "pending";
    }

    const task = {
      state: finalState,
    };

    if (raw && typeof raw === "object") {
      if ("startedAt" in raw) task.startedAt = raw.startedAt;
      if ("endedAt" in raw) task.endedAt = raw.endedAt;
      if ("attempts" in raw) task.attempts = raw.attempts;
      if ("executionTimeMs" in raw) task.executionTimeMs = raw.executionTimeMs;
      if ("refinementAttempts" in raw)
        task.refinementAttempts = raw.refinementAttempts;
      if ("stageLogPath" in raw) task.stageLogPath = raw.stageLogPath;
      if ("errorContext" in raw) task.errorContext = raw.errorContext;

      if (typeof raw.currentStage === "string" && raw.currentStage.length > 0) {
        task.currentStage = raw.currentStage;
      }
      if (typeof raw.failedStage === "string" && raw.failedStage.length > 0) {
        task.failedStage = raw.failedStage;
      }

      task.files = normalizeTaskFiles(raw?.files);
      if ("artifacts" in raw) task.artifacts = raw.artifacts;

      if ("error" in raw) {
        if (
          raw.error &&
          typeof raw.error === "object" &&
          !Array.isArray(raw.error)
        ) {
          task.error = { ...raw.error };
        } else if (raw.error != null) {
          task.error = { message: String(raw.error) };
        } else {
          task.error = null;
        }
      }
    } else {
      task.files = normalizeTaskFiles();
    }

    task.name =
      raw && typeof raw === "object" && "name" in raw ? raw.name : name;

    normalized[name] = task;
  }

  return normalized;
}

/**
 * Transform a single raw job payload into canonical job object expected by UI/tests.
 *
 * Output schema:
 *  - jobId: string
 *  - title: string
 *  - status: canonical job status
 *  - progress: number 0-100
 *  - createdAt / updatedAt: ISO strings | null
 *  - location: lifecycle bucket
 *  - current / currentStage: stage metadata (optional)
 *  - tasksStatus: object keyed by task name
 *  - files: normalized job-level files
 */
export function transformJobStatus(raw, jobId, location) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const warnings = [];

  // Check for job ID mismatch (supports both legacy and canonical)
  const rawJobId = raw.jobId || raw.id;
  if (rawJobId && String(rawJobId) !== String(jobId)) {
    const msg = `Job ID mismatch: JSON has "${rawJobId}", using directory name "${jobId}"`;
    warnings.push(msg);
    console.warn(msg);
  }

  const title = raw.title || raw.name || "Unnamed Job";
  const createdAt = raw.createdAt || null;
  const updatedAt = raw.updatedAt || raw.lastUpdated || createdAt || null;
  const resolvedLocation = location || raw.location || null;

  // Support both canonical (tasksStatus) and legacy (tasks) schema
  const tasksStatus = transformTasks(raw.tasksStatus || raw.tasks);
  const jobStatusObj = computeJobStatus(tasksStatus);

  const jobFiles = normalizeTaskFiles(raw.files);

  const job = {
    jobId,
    title,
    status: jobStatusObj.status,
    progress: jobStatusObj.progress,
    createdAt,
    updatedAt,
    location: resolvedLocation,
    tasksStatus,
    files: jobFiles,
  };

  if (raw.current != null) job.current = raw.current;
  if (raw.currentStage != null) job.currentStage = raw.currentStage;
  if (raw.lastUpdated && !job.updatedAt) job.updatedAt = raw.lastUpdated;

  const { pipeline, pipelineLabel } = derivePipelineMetadata(raw);

  if (pipeline != null) {
    job.pipeline = pipeline;
  }
  if (pipelineLabel != null) {
    job.pipelineLabel = pipelineLabel;
  }

  if (raw.pipelineConfig) {
    job.pipelineConfig = raw.pipelineConfig;
  }

  if (warnings.length > 0) {
    job.warnings = warnings;
  }

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
    // r.data is expected to be raw job JSON
    const raw = r.data || {};
    // jobId and location metadata may be present on read result (tests attach them)
    const jobId = r.jobId || (raw && (raw.jobId || raw.id)) || undefined;
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
