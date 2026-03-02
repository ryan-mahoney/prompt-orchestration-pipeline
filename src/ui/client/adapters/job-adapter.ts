import { deriveJobStatusFromTasks, normalizeJobStatus, normalizeTaskState } from "../../../config/statuses";
import type {
  AllowedActions,
  CostsSummary,
  CurrentTaskInfo,
  NormalizedJobDetail,
  NormalizedJobSummary,
  NormalizedTask,
  TaskCostBreakdown,
  TaskFiles,
} from "../types";

const EMPTY_FILES: TaskFiles = { artifacts: [], logs: [], tmp: [] };
const EMPTY_COSTS: CostsSummary = {
  totalTokens: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCost: 0,
  totalInputCost: 0,
  totalOutputCost: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeFiles(files: unknown): TaskFiles {
  if (!isRecord(files)) return EMPTY_FILES;
  return {
    artifacts: Array.isArray(files["artifacts"]) ? files["artifacts"].filter((x): x is string => typeof x === "string") : [],
    logs: Array.isArray(files["logs"]) ? files["logs"].filter((x): x is string => typeof x === "string") : [],
    tmp: Array.isArray(files["tmp"]) ? files["tmp"].filter((x): x is string => typeof x === "string") : [],
  };
}

function normalizeTask(name: string, rawTask: unknown): NormalizedTask {
  const task = isRecord(rawTask) ? rawTask : {};
  return {
    name,
    state: normalizeTaskState(task["state"]),
    startedAt: toStringOrNull(task["startedAt"]),
    endedAt: toStringOrNull(task["endedAt"]),
    attempts: typeof task["attempts"] === "number" ? task["attempts"] : undefined,
    executionTimeMs: typeof task["executionTimeMs"] === "number" ? task["executionTimeMs"] : undefined,
    currentStage: typeof task["currentStage"] === "string" ? task["currentStage"] : undefined,
    failedStage: typeof task["failedStage"] === "string" ? task["failedStage"] : undefined,
    files: normalizeFiles(task["files"]),
    artifacts: Array.isArray(task["artifacts"]) ? task["artifacts"].filter((x): x is string => typeof x === "string") : undefined,
    tokenUsage: isRecord(task["tokenUsage"]) ? task["tokenUsage"] : undefined,
    error: isRecord(task["error"]) ? task["error"] : undefined,
  };
}

function normalizeCurrent(current: unknown): CurrentTaskInfo | null {
  if (typeof current === "string") return { taskName: current };
  if (!isRecord(current) || typeof current["taskName"] !== "string") return null;
  return {
    taskName: current["taskName"],
    stage: typeof current["stage"] === "string" ? current["stage"] : undefined,
  };
}

function getDisplayCategory(status: string): string {
  if (status === "failed") return "errors";
  if (status === "complete") return "complete";
  return "current";
}

function getWarnings(rawTasks: unknown): string[] {
  if (rawTasks == null) return [];
  if (Array.isArray(rawTasks) || isRecord(rawTasks)) return [];
  return ["Unsupported task collection shape"];
}

function normalizeCostsSummary(costs: unknown): CostsSummary {
  if (!isRecord(costs)) return EMPTY_COSTS;
  return {
    totalTokens: toNumber(costs["totalTokens"]),
    totalInputTokens: toNumber(costs["totalInputTokens"]),
    totalOutputTokens: toNumber(costs["totalOutputTokens"]),
    totalCost: toNumber(costs["totalCost"]),
    totalInputCost: toNumber(costs["totalInputCost"]),
    totalOutputCost: toNumber(costs["totalOutputCost"]),
  };
}

function normalizeCostBreakdown(costs: unknown): Record<string, TaskCostBreakdown> | undefined {
  if (!isRecord(costs)) return undefined;
  const entries = Object.entries(costs).flatMap(([name, value]) => {
    if (!isRecord(value)) return [];
    return [[name, {
      inputTokens: toNumber(value["inputTokens"]),
      outputTokens: toNumber(value["outputTokens"]),
      inputCost: toNumber(value["inputCost"]),
      outputCost: toNumber(value["outputCost"]),
      totalCost: toNumber(value["totalCost"]),
    } satisfies TaskCostBreakdown] as const];
  });
  return Object.fromEntries(entries);
}

export function normalizeTasks(rawTasks: unknown): Record<string, NormalizedTask> {
  if (rawTasks == null) return {};

  if (Array.isArray(rawTasks)) {
    return Object.fromEntries(rawTasks.map((task, index) => {
      const record = isRecord(task) ? task : {};
      const name = typeof record["name"] === "string" ? record["name"] : `task-${index}`;
      return [name, normalizeTask(name, record)] as const;
    }));
  }

  if (isRecord(rawTasks)) {
    return Object.fromEntries(Object.entries(rawTasks).map(([name, task]) => {
      return [name, normalizeTask(name, task)] as const;
    }));
  }

  return {};
}

function adaptBaseJob(apiJob: Record<string, unknown>): NormalizedJobSummary {
  const rawTasks = apiJob["tasks"] ?? apiJob["tasksStatus"];
  const tasks = normalizeTasks(rawTasks);
  const taskList = Object.values(tasks);
  const doneCount = taskList.filter((task) => task.state === "done").length;
  const taskCount = taskList.length;
  const inferredStatus = deriveJobStatusFromTasks(taskList);
  const status = normalizeJobStatus(apiJob["status"] ?? inferredStatus);
  const progress = typeof apiJob["progress"] === "number"
    ? apiJob["progress"]
    : taskCount === 0 ? 0 : Math.floor((doneCount / taskCount) * 100);

  return {
    id: typeof apiJob["id"] === "string" ? apiJob["id"] : String(apiJob["jobId"] ?? ""),
    jobId: typeof apiJob["jobId"] === "string" ? apiJob["jobId"] : String(apiJob["id"] ?? ""),
    name: typeof apiJob["name"] === "string"
      ? apiJob["name"]
      : typeof apiJob["title"] === "string" ? apiJob["title"] : "",
    status,
    progress,
    taskCount,
    doneCount,
    location: typeof apiJob["location"] === "string" ? apiJob["location"] : "current",
    tasks,
    current: normalizeCurrent(apiJob["current"]),
    currentStage: typeof apiJob["currentStage"] === "string" ? apiJob["currentStage"] : undefined,
    createdAt: typeof apiJob["createdAt"] === "string" ? apiJob["createdAt"] : undefined,
    updatedAt: typeof apiJob["updatedAt"] === "string" ? apiJob["updatedAt"] : undefined,
    pipeline: typeof apiJob["pipeline"] === "string" ? apiJob["pipeline"] : undefined,
    pipelineLabel: typeof apiJob["pipelineLabel"] === "string" ? apiJob["pipelineLabel"] : undefined,
    pipelineConfig: typeof apiJob["pipelineConfig"] === "object" && apiJob["pipelineConfig"] !== null
      ? apiJob["pipelineConfig"] as Record<string, unknown>
      : undefined,
    costsSummary: normalizeCostsSummary(apiJob["costsSummary"]),
    totalCost: toNumber(apiJob["totalCost"], normalizeCostsSummary(apiJob["costsSummary"]).totalCost),
    totalTokens: toNumber(apiJob["totalTokens"], normalizeCostsSummary(apiJob["costsSummary"]).totalTokens),
    displayCategory: getDisplayCategory(status),
    __warnings: getWarnings(rawTasks),
  };
}

export function adaptJobSummary(apiJob: Record<string, unknown>): NormalizedJobSummary {
  return adaptBaseJob(apiJob);
}

export function adaptJobDetail(apiDetail: Record<string, unknown>): NormalizedJobDetail {
  return {
    ...adaptBaseJob(apiDetail),
    costs: normalizeCostBreakdown(apiDetail["costs"]),
  };
}

export function deriveAllowedActions(
  adaptedJob: NormalizedJobSummary,
  pipelineTasks: string[],
): AllowedActions {
  const taskStates = Object.values(adaptedJob.tasks);
  const isRunning = adaptedJob.status === "running" || taskStates.some((task) => task.state === "running");
  if (isRunning) return { start: false, restart: false };

  const start = pipelineTasks.some((taskName, index) => {
    const task = adaptedJob.tasks[taskName];
    if (!task || task.state !== "pending") return false;
    return pipelineTasks.slice(0, index).every((dependency) => adaptedJob.tasks[dependency]?.state === "done");
  });

  return {
    start,
    restart: true,
  };
}
