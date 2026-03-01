import { normalizeTaskFiles } from "../../utils/task-files.js";
import { derivePipelineMetadata } from "../../utils/pipelines.js";
import {
  calculateJobCosts,
  formatCostDataForAPI,
} from "../../utils/token-cost-calculator.js";
import {
  VALID_TASK_STATES,
  normalizeTaskState,
  deriveJobStatusFromTasks,
  TaskState,
} from "../../config/statuses.js";

/**
 * Compute job status object { status, progress } and emit warnings for unknown states.
 * Tests expect console.warn to be called for unknown states with substring:
 *   Unknown task state "..."
 */
export function computeJobStatus(tasksInput, existingProgress = null) {
  // Guard invalid input
  if (
    !tasksInput ||
    typeof tasksInput !== "object" ||
    Array.isArray(tasksInput)
  ) {
    return { status: "pending", progress: existingProgress ?? 0 };
  }

  // Normalize task states, and detect unknown states
  const names = Object.keys(tasksInput);
  if (names.length === 0)
    return { status: "pending", progress: existingProgress ?? 0 };

  let unknownStatesFound = new Set();

  const normalized = {};
  for (const name of names) {
    const t = tasksInput[name];
    const state = t && typeof t === "object" ? t.state : undefined;

    const normalizedState = normalizeTaskState(state);

    // Track unknown states for warning
    if (state != null && state !== normalizedState) {
      unknownStatesFound.add(state);
    }

    normalized[name] = { state: normalizedState };
  }

  // Warn for unknown states
  for (const s of unknownStatesFound) {
    console.warn(`Unknown task state "${s}"`);
  }

  const status = deriveJobStatusFromTasks(Object.values(normalized));
  // Use existing progress if provided, otherwise default to 0
  // Progress is pre-calculated in task-statuses.json, not computed from task states
  const progress = existingProgress !== null ? existingProgress : 0;

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

    const finalState = normalizeTaskState(rawState);

    // Warn for invalid states (different from normalized)
    if (rawState != null && rawState !== finalState) {
      console.warn(`Invalid task state "${rawState}"`);
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
 *  - tasks: object keyed by task name
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

  const tasks = transformTasks(raw.tasks);
  const jobStatusObj = computeJobStatus(tasks, raw.progress);
  const jobFiles = normalizeTaskFiles(raw.files);

  // Calculate costs for this job
  const costs = calculateJobCosts(raw);
  const costData = formatCostDataForAPI(costs);

  const job = {
    id: jobId, // API expects 'id' not 'jobId'
    name: title, // API expects 'name' not 'title'
    jobId, // Keep jobId for backward compatibility
    title, // Keep title for backward compatibility
    status: jobStatusObj.status,
    progress: jobStatusObj.progress,
    createdAt,
    updatedAt,
    location: resolvedLocation,
    tasks, // API expects 'tasks' array
    files: jobFiles,
    costs: costData, // Add cost data to job response
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
