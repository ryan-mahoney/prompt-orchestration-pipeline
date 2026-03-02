import { mkdir, rename, appendFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { Database } from "bun:sqlite";
import { LogFileExtension, isValidLogEvent, isValidLogFileExtension } from "../config/log-events";
import { writeJobStatus } from "./status-writer";
import { executeBatch, validateBatchOptions } from "./batch-runner";
import type { BatchOptions, BatchResult } from "./batch-runner";

export type WriteMode = "replace" | "append";

export interface WriteOptions {
  mode?: WriteMode;
}

export interface DBOptions {
  readonly?: boolean;
  create?: boolean;
  [key: string]: unknown;
}

export interface TaskFileIOConfig {
  workDir: string;
  taskName: string;
  getStage: () => string;
  statusPath: string;
  trackTaskFiles?: boolean;
}

export interface TaskFileIO {
  writeArtifact(name: string, content: string, options?: WriteOptions): Promise<void>;
  writeLog(name: string, content: string, options?: WriteOptions): Promise<void>;
  writeTmp(name: string, content: string, options?: WriteOptions): Promise<void>;
  readArtifact(name: string): Promise<string>;
  readLog(name: string): Promise<string>;
  readTmp(name: string): Promise<string>;
  getTaskDir(): string;
  writeLogSync(name: string, content: string, options?: WriteOptions): void;
  getCurrentStage(): string;
  getDB(options?: DBOptions): Database;
  runBatch(options: BatchOptions): Promise<BatchResult>;
}

export interface ParsedLogName {
  taskName: string;
  stage: string;
  event: string;
  ext: string;
}

export const LOG_NAME_PATTERN = /^(?<taskName>[^-]+)-(?<stage>[^-]+)-(?<event>[^.]+)\.(?<ext>.+)$/;

export const SUBDIR_ARTIFACTS = "artifacts" as const;
export const SUBDIR_LOGS = "logs" as const;
export const SUBDIR_TMP = "tmp" as const;

export function parseLogName(fileName: unknown): ParsedLogName | null {
  if (typeof fileName !== "string") return null;
  const match = LOG_NAME_PATTERN.exec(fileName);
  if (!match?.groups) return null;
  return {
    taskName: match.groups["taskName"]!,
    stage: match.groups["stage"]!,
    event: match.groups["event"]!,
    ext: match.groups["ext"]!,
  };
}

export function validateLogName(fileName: unknown): boolean {
  return parseLogName(fileName) !== null;
}

export function getLogPattern(
  taskName = "*",
  stage = "*",
  event = "*",
  ext = "*",
): string {
  return `${taskName}-${stage}-${event}.${ext}`;
}

export function generateLogName(
  taskName: string,
  stage: string,
  event: string,
  ext: string = LogFileExtension.TEXT,
): string {
  if (!taskName) throw new Error("generateLogName: taskName is required");
  if (!stage) throw new Error("generateLogName: stage is required");
  if (!event) throw new Error("generateLogName: event is required");
  if (!ext) throw new Error("generateLogName: ext is required");
  if (!isValidLogEvent(event)) throw new Error(`generateLogName: invalid event "${event}"`);
  if (!isValidLogFileExtension(ext)) throw new Error(`generateLogName: invalid ext "${ext}"`);
  return `${taskName}-${stage}-${event}.${ext}`;
}

/**
 * @internal Shared write helper for all async write methods.
 * Replace mode: write to temp file then atomically rename.
 * Append mode: append directly.
 * Both modes lazily create parent directories.
 */
export async function writeFileScoped(
  filePath: string,
  content: string,
  mode: WriteMode,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  if (mode === "append") {
    await appendFile(filePath, content);
  } else {
    const tmpPath = `${filePath}.tmp`;
    await Bun.write(tmpPath, content);
    await rename(tmpPath, filePath);
  }
}

type FileCategory = "artifacts" | "logs" | "tmp";

interface FilesRecord {
  artifacts?: string[];
  logs?: string[];
  tmp?: string[];
}

interface TaskRecord {
  files?: FilesRecord;
  [key: string]: unknown;
}

/**
 * @internal Async status tracking helper shared by all async write methods.
 * Ensures the filename is recorded (deduplicated) in the global files list
 * and optionally in the task-level files list.
 */
export async function trackFile(
  jobDir: string,
  category: FileCategory,
  fileName: string,
  taskName: string,
  trackTaskFiles: boolean,
): Promise<void> {
  await writeJobStatus(jobDir, (snapshot: Record<string, unknown>) => {
    const files = (snapshot["files"] ?? {}) as FilesRecord;
    snapshot["files"] = files;

    const globalList = (files[category] ?? []) as string[];
    files[category] = globalList;
    if (!globalList.includes(fileName)) {
      globalList.push(fileName);
    }

    if (trackTaskFiles) {
      const tasks = (snapshot["tasks"] ?? {}) as Record<string, TaskRecord>;
      snapshot["tasks"] = tasks;

      const task = (tasks[taskName] ?? {}) as TaskRecord;
      tasks[taskName] = task;

      const taskFiles = (task.files ?? {}) as FilesRecord;
      task.files = taskFiles;

      const taskList = (taskFiles[category] ?? []) as string[];
      taskFiles[category] = taskList;
      if (!taskList.includes(fileName)) {
        taskList.push(fileName);
      }
    }
  });
}

/**
 * @internal Synchronous status writer for writeLogSync and getDB.
 * Reads tasks-status.json, applies updater, writes back as pretty-printed JSON.
 * Falls back to a minimal default snapshot on missing or invalid JSON.
 * No temp-file-rename, no async queue participation.
 */
export function writeJobStatusSync(
  jobDir: string,
  updater: (snapshot: Record<string, unknown>) => void,
): void {
  const statusPath = join(jobDir, "tasks-status.json");
  let snapshot: Record<string, unknown>;
  try {
    const raw = readFileSync(statusPath, "utf-8");
    snapshot = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    snapshot = {
      id: basename(jobDir),
      state: "pending",
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    };
  }
  updater(snapshot);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(statusPath, JSON.stringify(snapshot, null, 2));
}

export function createTaskFileIO(config: TaskFileIOConfig): TaskFileIO {
  const { workDir, taskName, statusPath, getStage } = config;
  const trackTaskFilesEnabled = config.trackTaskFiles ?? true;

  const artifactsDir = join(workDir, "files", SUBDIR_ARTIFACTS);
  const logsDir = join(workDir, "files", SUBDIR_LOGS);
  const tmpDir = join(workDir, "files", SUBDIR_TMP);
  const taskDir = join(workDir, "tasks", taskName);
  const jobDir = dirname(statusPath);

  async function writeScoped(
    dir: string,
    category: FileCategory,
    name: string,
    content: string,
    options?: WriteOptions,
  ): Promise<void> {
    const filePath = join(dir, name);
    const mode = options?.mode ?? "replace";
    await writeFileScoped(filePath, content, mode);
    await trackFile(jobDir, category, name, taskName, trackTaskFilesEnabled);
  }

  function getDB(options?: DBOptions): Database {
    const dbPath = join(artifactsDir, "run.db");

    if (options?.readonly) {
      if (!existsSync(dbPath)) {
        throw new Error(`Database not found: ${dbPath}`);
      }
      return new Database(dbPath, { readonly: true });
    }

    mkdirSync(artifactsDir, { recursive: true });
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");

    writeJobStatusSync(jobDir, (snapshot: Record<string, unknown>) => {
      const files = (snapshot["files"] ?? {}) as FilesRecord;
      snapshot["files"] = files;
      const artifactsList = (files.artifacts ?? []) as string[];
      files.artifacts = artifactsList;
      if (!artifactsList.includes("run.db")) {
        artifactsList.push("run.db");
      }

      if (trackTaskFilesEnabled) {
        const tasks = (snapshot["tasks"] ?? {}) as Record<string, TaskRecord>;
        snapshot["tasks"] = tasks;
        const task = (tasks[taskName] ?? {}) as TaskRecord;
        tasks[taskName] = task;
        const taskFiles = (task.files ?? {}) as FilesRecord;
        task.files = taskFiles;
        const taskArtifactsList = (taskFiles.artifacts ?? []) as string[];
        taskFiles.artifacts = taskArtifactsList;
        if (!taskArtifactsList.includes("run.db")) {
          taskArtifactsList.push("run.db");
        }
      }
    });

    return db;
  }

  return {
    async writeArtifact(name, content, options) {
      await writeScoped(artifactsDir, "artifacts", name, content, options);
    },

    async writeLog(name, content, options) {
      if (!validateLogName(name)) {
        throw new Error(`Invalid log filename: "${name}"`);
      }
      await writeScoped(logsDir, "logs", name, content, options);
    },

    async writeTmp(name, content, options) {
      await writeScoped(tmpDir, "tmp", name, content, options);
    },

    async readArtifact(name) {
      return Bun.file(join(artifactsDir, name)).text();
    },

    async readLog(name) {
      return Bun.file(join(logsDir, name)).text();
    },

    async readTmp(name) {
      return Bun.file(join(tmpDir, name)).text();
    },

    getTaskDir() {
      return taskDir;
    },

    getCurrentStage() {
      return getStage();
    },

    writeLogSync(name, content, options) {
      if (!validateLogName(name)) {
        throw new Error(`Invalid log filename: "${name}"`);
      }
      const filePath = join(logsDir, name);
      const mode = options?.mode ?? "replace";

      mkdirSync(dirname(filePath), { recursive: true });

      if (mode === "append") {
        appendFileSync(filePath, content);
      } else {
        const tmpPath = `${filePath}.tmp`;
        writeFileSync(tmpPath, content);
        renameSync(tmpPath, filePath);
      }

      writeJobStatusSync(jobDir, (snapshot: Record<string, unknown>) => {
        const files = (snapshot["files"] ?? {}) as FilesRecord;
        snapshot["files"] = files;
        const logsList = (files.logs ?? []) as string[];
        files.logs = logsList;
        if (!logsList.includes(name)) {
          logsList.push(name);
        }

        if (trackTaskFilesEnabled) {
          const tasks = (snapshot["tasks"] ?? {}) as Record<string, TaskRecord>;
          snapshot["tasks"] = tasks;
          const task = (tasks[taskName] ?? {}) as TaskRecord;
          tasks[taskName] = task;
          const taskFiles = (task.files ?? {}) as FilesRecord;
          task.files = taskFiles;
          const taskLogsList = (taskFiles.logs ?? []) as string[];
          taskFiles.logs = taskLogsList;
          if (!taskLogsList.includes(name)) {
            taskLogsList.push(name);
          }
        }
      });
    },

    getDB,

    async runBatch(options: BatchOptions): Promise<BatchResult> {
      validateBatchOptions(options);
      const db = getDB();
      try {
        return await executeBatch(db, options);
      } finally {
        db.close();
      }
    },
  };
}
