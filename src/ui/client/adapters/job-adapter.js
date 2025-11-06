import { derivePipelineMetadata } from "../../../utils/pipelines.js";
import {
  normalizeTaskState,
  deriveJobStatusFromTasks,
} from "../../../config/statuses.js";

/**
 * Normalize a raw task state into canonical enum.
 * Returns { state, warning? } where warning is a string if normalization occurred.
 */
function normalizeTaskStateWithWarning(raw) {
  if (!raw || typeof raw !== "string")
    return { state: "pending", warning: "missing_state" };

  const normalizedState = normalizeTaskState(raw);

  if (raw !== normalizedState) {
    return { state: normalizedState, warning: `unknown_state:${raw}` };
  }

  return { state: normalizedState };
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
      const ns = normalizeTaskStateWithWarning(t && t.state);
      if (ns.warning) warnings.push(`${name}:${ns.warning}`);
      const taskObj = {
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
        // Preserve stage metadata for DAG visualization
        ...(typeof t?.currentStage === "string" && t.currentStage.length > 0
          ? { currentStage: t.currentStage }
          : {}),
        ...(typeof t?.failedStage === "string" && t.failedStage.length > 0
          ? { failedStage: t.failedStage }
          : {}),
        // Prefer new files.* schema, fallback to legacy artifacts
        files:
          t && t.files
            ? {
                artifacts: Array.isArray(t.files.artifacts)
                  ? t.files.artifacts.slice()
                  : [],
                logs: Array.isArray(t.files.logs) ? t.files.logs.slice() : [],
                tmp: Array.isArray(t.files.tmp) ? t.files.tmp.slice() : [],
              }
            : {
                artifacts: [],
                logs: [],
                tmp: [],
              },
        artifacts: Array.isArray(t && t.artifacts)
          ? t.artifacts.slice()
          : undefined,
        // Preserve tokenUsage if present
        ...(t && t.tokenUsage ? { tokenUsage: t.tokenUsage } : {}),
      };
      tasks[name] = taskObj;
    });
    return { tasks, warnings };
  }

  if (Array.isArray(rawTasks)) {
    // Array shape - convert to object for backward compatibility
    const tasks = {};
    rawTasks.forEach((t, idx) => {
      const name = t && t.name ? String(t.name) : `task-${idx}`;
      const ns = normalizeTaskStateWithWarning(t && t.state);
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
        // Preserve stage metadata for DAG visualization
        ...(typeof t?.currentStage === "string" && t.currentStage.length > 0
          ? { currentStage: t.currentStage }
          : {}),
        ...(typeof t?.failedStage === "string" && t.failedStage.length > 0
          ? { failedStage: t.failedStage }
          : {}),
        artifacts: Array.isArray(t && t.artifacts)
          ? t.artifacts.slice()
          : undefined,
        // Preserve tokenUsage if present
        ...(t && t.tokenUsage ? { tokenUsage: t.tokenUsage } : {}),
      };
    });
    return { tasks, warnings };
  }

  return { tasks: {}, warnings: ["invalid_tasks_shape"] };
}

/**
 * Clamp number to 0..100 and ensure integer.
 */
function clampProgress(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Compute summary stats from normalized tasks.
 */
function computeJobSummaryStats(tasks) {
  const taskList = Object.values(tasks);
  const taskCount = taskList.length;
  const doneCount = taskList.reduce(
    (acc, t) => acc + (t.state === "done" ? 1 : 0),
    0
  );
  const status = deriveJobStatusFromTasks(Object.values(tasks));
  const progress =
    taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;
  return { status, progress, doneCount, taskCount };
}

/**
 * adaptJobSummary(apiJob)
 * - apiJob: object roughly matching docs 0.5 /api/jobs entry.
 * Returns normalized summary object for UI consumption.
 */
export function adaptJobSummary(apiJob) {
  // Demo-only: read canonical fields strictly
  const id = apiJob.jobId;
  const name = apiJob.title || "";
  const rawTasks = apiJob.tasks;
  const location = apiJob.location;

  // Job-level stage metadata
  const current = apiJob.current;
  const currentStage = apiJob.currentStage;

  const { tasks, warnings } = normalizeTasks(rawTasks);

  // Use API status and progress as source of truth, fall back to task-based computation only when missing
  const apiStatus = apiJob.status;
  const apiProgress = apiJob.progress;
  const derivedStats = computeJobSummaryStats(tasks);

  const job = {
    id,
    jobId: id,
    name,
    status: apiStatus || derivedStats.status,
    progress: apiProgress ?? derivedStats.progress,
    taskCount: derivedStats.taskCount,
    doneCount: derivedStats.doneCount,
    location,
    tasks,
  };

  // Preserve job-level stage metadata
  if (current != null) job.current = current;
  if (currentStage != null) job.currentStage = currentStage;

  // Optional/metadata fields (preserve if present)
  if ("createdAt" in apiJob) job.createdAt = apiJob.createdAt;
  if ("updatedAt" in apiJob) job.updatedAt = apiJob.updatedAt;

  // Pipeline metadata
  const { pipeline, pipelineLabel } = derivePipelineMetadata(apiJob);
  if (pipeline != null) job.pipeline = pipeline;
  if (pipelineLabel != null) job.pipelineLabel = pipelineLabel;

  // Costs summary from API
  if (apiJob.costsSummary) {
    job.costsSummary = {
      totalTokens: apiJob.costsSummary.totalTokens || 0,
      totalInputTokens: apiJob.costsSummary.totalInputTokens || 0,
      totalOutputTokens: apiJob.costsSummary.totalOutputTokens || 0,
      totalCost: apiJob.costsSummary.totalCost || 0,
      totalInputCost: apiJob.costsSummary.totalInputCost || 0,
      totalOutputCost: apiJob.costsSummary.totalOutputCost || 0,
    };
    // Add top-level numeric mirrors for convenience
    job.totalCost = job.costsSummary.totalCost;
    job.totalTokens = job.costsSummary.totalTokens;
  }

  // Include warnings for debugging
  if (warnings.length > 0) job.__warnings = warnings;

  return job;
}

/**
 * adaptJobDetail(apiDetail)
 * - apiDetail: object roughly matching docs 0.5 /api/jobs/:jobId detail schema.
 * Returns a normalized detailed job object for UI consumption.
 */
export function adaptJobDetail(apiDetail) {
  // Demo-only: read canonical fields strictly
  const id = apiDetail.jobId;
  const name = apiDetail.title || "";
  const rawTasks = apiDetail.tasks;
  const location = apiDetail.location;

  // Job-level stage metadata
  const current = apiDetail.current;
  const currentStage = apiDetail.currentStage;

  const { tasks, warnings } = normalizeTasks(rawTasks);

  // Use API status and progress as source of truth, fall back to task-based computation only when missing
  const apiStatus = apiDetail.status;
  const apiProgress = apiDetail.progress;
  const derivedStats = computeJobSummaryStats(tasks);

  const detail = {
    id,
    jobId: id,
    name,
    status: apiStatus || derivedStats.status,
    progress: apiProgress ?? derivedStats.progress,
    taskCount: derivedStats.taskCount,
    doneCount: derivedStats.doneCount,
    location,
    tasks,
  };

  // Preserve job-level stage metadata
  if (current != null) detail.current = current;
  if (currentStage != null) detail.currentStage = currentStage;

  // Optional/metadata fields (preserve if present)
  if ("createdAt" in apiDetail) detail.createdAt = apiDetail.createdAt;
  if ("updatedAt" in apiDetail) detail.updatedAt = apiDetail.updatedAt;

  // Pipeline metadata
  const { pipeline, pipelineLabel } = derivePipelineMetadata(apiDetail);
  if (pipeline != null) detail.pipeline = pipeline;
  if (pipelineLabel != null) detail.pipelineLabel = pipelineLabel;

  // Preserve job detail costs
  if (apiDetail.costs) {
    detail.costs = apiDetail.costs;
  }

  // Include warnings for debugging
  if (warnings.length > 0) detail.__warnings = warnings;

  return detail;
}
