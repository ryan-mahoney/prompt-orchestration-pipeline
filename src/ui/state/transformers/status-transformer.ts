import {
  deriveJobStatusFromTasks,
  normalizeTaskState,
} from "../../../config/statuses";
import type {
  CanonicalJob,
  CanonicalTask,
  ComputedStatus,
  JobReadResult,
  TransformationStats,
} from "../types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTaskFiles(value: unknown): CanonicalTask["files"] {
  const record = asRecord(value);
  return {
    artifacts: Array.isArray(record?.["artifacts"]) ? (record["artifacts"] as string[]) : [],
    logs: Array.isArray(record?.["logs"]) ? (record["logs"] as string[]) : [],
    tmp: Array.isArray(record?.["tmp"]) ? (record["tmp"] as string[]) : [],
  };
}

function toTask(name: string, value: unknown): CanonicalTask {
  const task = asRecord(value) ?? {};
  return {
    name,
    state: normalizeTaskState(task["state"]),
    files: asTaskFiles(task["files"]),
    startedAt: typeof task["startedAt"] === "string" ? task["startedAt"] : null,
    endedAt: typeof task["endedAt"] === "string" ? task["endedAt"] : null,
    attempts: typeof task["attempts"] === "number" ? task["attempts"] : undefined,
    executionTimeMs:
      typeof task["executionTimeMs"] === "number" ? task["executionTimeMs"] : undefined,
    refinementAttempts:
      typeof task["refinementAttempts"] === "number"
        ? task["refinementAttempts"]
        : undefined,
    stageLogPath: typeof task["stageLogPath"] === "string" ? task["stageLogPath"] : undefined,
    errorContext: task["errorContext"],
    currentStage: typeof task["currentStage"] === "string" ? task["currentStage"] : undefined,
    failedStage: typeof task["failedStage"] === "string" ? task["failedStage"] : undefined,
    artifacts: task["artifacts"],
    error: asRecord(task["error"]) as CanonicalTask["error"],
  };
}

function getStatusValue(status: string): string {
  return status === "failed" ? "error" : status;
}

function getProgress(tasks: CanonicalTask[], existingProgress?: number): number {
  if (typeof existingProgress === "number") return existingProgress;
  if (tasks.length === 0) return 0;

  const done = tasks.filter((task) => task.state === "done").length;
  return Math.floor((done / tasks.length) * 100);
}

function getTitle(raw: Record<string, unknown>, jobId: string): string {
  const title = raw["title"] ?? raw["name"];
  return typeof title === "string" && title.trim() !== "" ? title : jobId;
}

function getCosts(raw: Record<string, unknown>): Record<string, unknown> {
  return asRecord(raw["costs"]) ?? {};
}

export function computeJobStatus(tasksInput: unknown, existingProgress?: number): ComputedStatus {
  const tasks = Object.values(transformTasks(tasksInput));
  if (tasks.length === 0) {
    return { status: "pending", progress: 0 };
  }

  return {
    status: getStatusValue(deriveJobStatusFromTasks(tasks)),
    progress: getProgress(tasks, existingProgress),
  };
}

export function transformTasks(rawTasks: unknown): Record<string, CanonicalTask> {
  if (Array.isArray(rawTasks)) {
    return Object.fromEntries(
      rawTasks.map((task, index) => {
        const record = asRecord(task);
        const name = typeof record?.["name"] === "string" ? (record["name"] as string) : `task-${index + 1}`;
        return [name, toTask(name, task)];
      }),
    );
  }

  const record = asRecord(rawTasks);
  if (!record) return {};

  return Object.fromEntries(Object.entries(record).map(([name, task]) => [name, toTask(name, task)]));
}

export function transformJobStatus(raw: unknown, jobId: string, location: string): CanonicalJob | null {
  const record = asRecord(raw);
  if (!record) return null;

  const rawJobId = record["jobId"];
  if (typeof rawJobId === "string" && rawJobId !== jobId) {
    console.warn(`job id mismatch: expected "${jobId}" but received "${rawJobId}"`);
  }

  const tasks = transformTasks(record["tasks"]);
  const computed = computeJobStatus(tasks, typeof record["progress"] === "number" ? record["progress"] : undefined);
  const title = getTitle(record, jobId);

  return {
    id: jobId,
    jobId,
    name: title,
    title,
    status: computed.status,
    progress: computed.progress,
    createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : null,
    updatedAt: typeof record["updatedAt"] === "string" ? record["updatedAt"] : null,
    location,
    tasks,
    files: asRecord(record["files"]) ?? {},
    costs: getCosts(record),
    pipeline: typeof record["pipeline"] === "string" ? record["pipeline"] : undefined,
    pipelineLabel:
      typeof record["pipelineLabel"] === "string" ? record["pipelineLabel"] : undefined,
    pipelineConfig: asRecord(record["pipelineConfig"]) ?? undefined,
    current: record["current"],
    currentStage: record["currentStage"],
    warnings: Array.isArray(record["warnings"]) ? (record["warnings"] as string[]) : undefined,
  };
}

export function transformMultipleJobs(jobReadResults: JobReadResult[]): CanonicalJob[] {
  return jobReadResults
    .filter((result) => result.ok)
    .map((result) => transformJobStatus(result.data, result.jobId, result.location))
    .filter((job): job is CanonicalJob => job !== null);
}

export function getTransformationStats(
  readResults: JobReadResult[],
  transformedJobs: CanonicalJob[],
): TransformationStats {
  const successfulReads = readResults.filter((result) => result.ok).length;
  const statusDistribution = transformedJobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalRead: readResults.length,
    successfulReads,
    successfulTransforms: transformedJobs.length,
    failedTransforms: successfulReads - transformedJobs.length,
    transformationRate: successfulReads === 0 ? 0 : transformedJobs.length / successfulReads,
    statusDistribution,
  };
}
