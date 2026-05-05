export type JobState = "pending" | "running" | "done" | "failed";

type TaskState = "pending" | "running" | "done" | "failed";

export interface FilesManifest {
  artifacts: string[];
  logs: string[];
  tmp: string[];
}

export interface TaskEntry {
  state?: TaskState;
  currentStage?: string | null;
  failedStage?: string;
  error?: string;
  attempts?: number;
  restartCount?: number;
  refinementAttempts?: number;
  tokenUsage?: unknown[];
  startedAt?: string;
  endedAt?: string;
  files?: FilesManifest;
  [key: string]: unknown;
}

export interface StatusSnapshot {
  id: string;
  state: JobState;
  current: string | null;
  currentStage: string | null;
  lastUpdated: string;
  progress?: number;
  tasks: Record<string, TaskEntry>;
  files: FilesManifest;
  lifecycleBlockReason?: string;
  lifecycleBlockTaskId?: string;
  lifecycleBlockOp?: string;
  [key: string]: unknown;
}

export type StatusUpdateFn = (snapshot: StatusSnapshot) => StatusSnapshot | void;
export type TaskUpdateFn = (task: TaskEntry) => TaskEntry | void;

export interface ResetOptions {
  clearTokenUsage?: boolean;
}

export interface UploadArtifact {
  filename: string;
  content: string;
}

export const STATUS_FILENAME = "tasks-status.json";

import { rename, unlink, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createJobLogger } from "./logger";

export function validateFilePath(filename: string): boolean {
  if (!filename || typeof filename !== "string") {
    console.error("validateFilePath: filename must be a non-empty string");
    return false;
  }
  if (filename.includes("..")) {
    console.error("validateFilePath: filename must not contain '..'");
    return false;
  }
  if (filename.includes("\\")) {
    console.error("validateFilePath: filename must not contain '\\'");
    return false;
  }
  if (filename.startsWith("/")) {
    console.error("validateFilePath: filename must not be an absolute path");
    return false;
  }
  return true;
}

export function createDefaultStatus(jobDir: string): StatusSnapshot {
  return {
    id: basename(jobDir),
    state: "pending",
    current: null,
    currentStage: null,
    lastUpdated: new Date().toISOString(),
    tasks: {},
    files: { artifacts: [], logs: [], tmp: [] },
  };
}

export function validateStatusSnapshot(snapshot: unknown, jobDir: string): StatusSnapshot {
  if (typeof snapshot !== "object" || snapshot === null) {
    return createDefaultStatus(jobDir);
  }

  const s = snapshot as Record<string, unknown>;

  if (typeof s["id"] !== "string") s["id"] = basename(jobDir);
  if (typeof s["state"] !== "string") s["state"] = "pending";
  if (typeof s["current"] !== "string" && s["current"] !== null) s["current"] = null;
  if (typeof s["currentStage"] !== "string" && s["currentStage"] !== null) s["currentStage"] = null;
  if (typeof s["lastUpdated"] !== "string") s["lastUpdated"] = new Date().toISOString();
  if (typeof s["tasks"] !== "object" || s["tasks"] === null || Array.isArray(s["tasks"])) s["tasks"] = {};

  if (typeof s["files"] !== "object" || s["files"] === null || Array.isArray(s["files"])) {
    s["files"] = { artifacts: [], logs: [], tmp: [] };
  } else {
    const files = s["files"] as Record<string, unknown>;
    if (!Array.isArray(files["artifacts"])) files["artifacts"] = [];
    if (!Array.isArray(files["logs"])) files["logs"] = [];
    if (!Array.isArray(files["tmp"])) files["tmp"] = [];
  }

  return s as unknown as StatusSnapshot;
}

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    await Bun.write(tmp, content);
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

const writeQueues = new Map<string, Promise<StatusSnapshot>>();

export async function readJobStatus(jobDir: string): Promise<StatusSnapshot | null> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }

  const statusPath = join(jobDir, STATUS_FILENAME);
  try {
    const text = await Bun.file(statusPath).text();
    const raw = JSON.parse(text);
    return validateStatusSnapshot(raw, jobDir);
  } catch (err) {
    console.warn(`readJobStatus: could not read ${statusPath}`, err);
    return null;
  }
}

export function updateTaskStatus(jobDir: string, taskId: string, taskUpdateFn: TaskUpdateFn): Promise<StatusSnapshot> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("taskId must be a non-empty string");
  }
  if (typeof taskUpdateFn !== "function") {
    throw new Error("taskUpdateFn must be a function");
  }

  const statusPath = join(jobDir, STATUS_FILENAME);
  const jobId = basename(jobDir);

  const prev = writeQueues.get(jobDir) ?? Promise.resolve(createDefaultStatus(jobDir));
  const next = prev.catch(() => {}).then(() => runTaskWrite());
  writeQueues.set(jobDir, next);
  return next;

  async function runTaskWrite(): Promise<StatusSnapshot> {
    let raw: unknown;
    try {
      const text = await Bun.file(statusPath).text();
      raw = JSON.parse(text);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || err instanceof SyntaxError) {
        raw = createDefaultStatus(jobDir);
      } else {
        throw err;
      }
    }

    const snapshot = validateStatusSnapshot(raw, jobDir);

    if (!snapshot.tasks[taskId]) {
      snapshot.tasks[taskId] = {};
    }

    const task = snapshot.tasks[taskId];
    const result = taskUpdateFn(task);
    if (result !== undefined) {
      snapshot.tasks[taskId] = result;
    }

    snapshot.lastUpdated = new Date().toISOString();

    await atomicWrite(statusPath, JSON.stringify(snapshot, null, 2));

    const logger = createJobLogger("status-writer", jobId);
    try {
      logger.sse("task:updated", { jobId, taskId, task: snapshot.tasks[taskId] });
    } catch (err) {
      logger.error("SSE task:updated emission failed", err);
    }

    return snapshot;
  }
}

export function resetJobFromTask(jobDir: string, fromTask: string, options?: ResetOptions): Promise<StatusSnapshot> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }
  if (typeof fromTask !== "string" || fromTask.length === 0) {
    throw new Error("fromTask must be a non-empty string");
  }

  return writeJobStatus(jobDir, (snapshot) => {
    const taskKeys = Object.keys(snapshot.tasks);

    snapshot.state = "pending";
    snapshot.current = null;
    snapshot.currentStage = null;

    const fromIndex = taskKeys.indexOf(fromTask);
    const resetKeys = fromIndex === -1 ? [] : taskKeys.slice(fromIndex);

    for (const key of resetKeys) {
      const task = snapshot.tasks[key]!;
      task.state = "pending";
      task.currentStage = null;
      delete task.failedStage;
      delete task.error;
      task.attempts = 0;
      task.restartCount = 0;
      task.refinementAttempts = 0;
      if (options?.clearTokenUsage !== false) {
        task.tokenUsage = [];
      }
    }
  });
}

export function resetJobToCleanSlate(jobDir: string, options?: ResetOptions): Promise<StatusSnapshot> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }

  return writeJobStatus(jobDir, (snapshot) => {
    snapshot.state = "pending";
    snapshot.current = null;
    snapshot.currentStage = null;
    snapshot.progress = 0;

    for (const key of Object.keys(snapshot.tasks)) {
      const task = snapshot.tasks[key]!;
      task.state = "pending";
      task.currentStage = null;
      delete task.failedStage;
      delete task.error;
      task.attempts = 0;
      task.restartCount = 0;
      task.refinementAttempts = 0;
      if (options?.clearTokenUsage !== false) {
        task.tokenUsage = [];
      }
    }
  });
}

export function resetSingleTask(jobDir: string, taskId: string, options?: ResetOptions): Promise<StatusSnapshot> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("taskId must be a non-empty string");
  }

  return writeJobStatus(jobDir, (snapshot) => {
    if (!snapshot.tasks[taskId]) {
      snapshot.tasks[taskId] = {};
    }

    const task = snapshot.tasks[taskId]!;
    task.state = "pending";
    task.currentStage = null;
    delete task.failedStage;
    delete task.error;
    task.attempts = 0;
    task.restartCount = 0;
    task.refinementAttempts = 0;
    if (options?.clearTokenUsage !== false) {
      task.tokenUsage = [];
    }
  });
}

export async function initializeJobArtifacts(jobDir: string, uploadArtifacts?: UploadArtifact[]): Promise<void> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }
  if (uploadArtifacts !== undefined && !Array.isArray(uploadArtifacts)) {
    throw new Error("uploadArtifacts must be an array");
  }

  const artifacts = uploadArtifacts ?? [];
  const artifactsDir = join(jobDir, "files", "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  for (const artifact of artifacts) {
    if (!artifact.filename) continue;
    if (!validateFilePath(artifact.filename)) continue;

    const targetPath = join(artifactsDir, artifact.filename);
    if (artifact.filename.includes("/")) {
      await mkdir(join(targetPath, ".."), { recursive: true });
    }
    await Bun.write(targetPath, artifact.content);
  }
}

export function writeJobStatus(jobDir: string, updateFn: StatusUpdateFn): Promise<StatusSnapshot> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }
  if (typeof updateFn !== "function") {
    throw new Error("updateFn must be a function");
  }

  const statusPath = join(jobDir, STATUS_FILENAME);
  const jobId = basename(jobDir);

  const prev = writeQueues.get(jobDir) ?? Promise.resolve(createDefaultStatus(jobDir));
  const next = prev.catch(() => {}).then(() => runWrite());
  writeQueues.set(jobDir, next);
  return next;

  async function runWrite(): Promise<StatusSnapshot> {
    let raw: unknown;
    try {
      const text = await Bun.file(statusPath).text();
      raw = JSON.parse(text);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || err instanceof SyntaxError) {
        raw = createDefaultStatus(jobDir);
      } else {
        throw err;
      }
    }

    let snapshot = validateStatusSnapshot(raw, jobDir);

    let result: StatusSnapshot | void;
    try {
      result = updateFn(snapshot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Update function failed: ${msg}`);
    }

    if (result !== undefined) {
      snapshot = result;
    }

    snapshot = validateStatusSnapshot(snapshot, jobDir);
    snapshot.lastUpdated = new Date().toISOString();

    await atomicWrite(statusPath, JSON.stringify(snapshot, null, 2));

    const logger = createJobLogger("status-writer", jobId);
    try {
      logger.sse("state:change", { path: statusPath, id: snapshot.id, jobId });
    } catch (err) {
      logger.error("SSE state:change emission failed", err);
    }

    if (snapshot.lifecycleBlockReason) {
      try {
        logger.sse("lifecycle_block", {
          jobId,
          taskId: snapshot.lifecycleBlockTaskId,
          op: snapshot.lifecycleBlockOp,
          reason: snapshot.lifecycleBlockReason,
        });
      } catch (err) {
        logger.error("SSE lifecycle_block emission failed", err);
      }
    }

    return snapshot;
  }
}
