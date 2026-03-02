import { join, dirname, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { unlink, mkdir, rename, appendFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { getPipelineConfig } from "./config";
import { validatePipelineOrThrow } from "./validation";
import { loadFreshModule } from "./module-loader";
import { writeJobStatus } from "./status-writer";
import { decideTransition } from "./lifecycle-policy";
import { runPipeline } from "./task-runner";
import type { AuditLogEntry } from "./task-runner";
import { ensureTaskSymlinkBridge } from "./symlink-bridge";
import { validateTaskSymlinks, repairTaskSymlinks, cleanupTaskSymlinks } from "./symlink-utils";
import { createTaskFileIO, generateLogName } from "./file-io";
import { LogEvent, LogFileExtension } from "../config/log-events";
import { TaskState } from "../config/statuses";

// ─── Type definitions ─────────────────────────────────────────────────────────

/** Pipeline definition read from pipeline.json. */
export interface PipelineDefinition {
  tasks: Array<string | { name: string }>;
  llm?: Record<string, unknown> | null;
  taskConfig?: Record<string, Record<string, unknown>>;
}

/** Task registry: maps task names to module file paths. */
export type TaskRegistry = Record<string, string>;

/** Seed data read from seed.json. */
export interface SeedData {
  pipeline?: string;
  [key: string]: unknown;
}

/** Per-task execution context passed to the task runner. */
export interface TaskExecutionContext {
  workDir: string;
  taskDir: string;
  seed: SeedData;
  taskName: string;
  taskConfig: Record<string, unknown>;
  statusPath: string;
  jobId: string;
  llmOverride: Record<string, unknown> | null;
  meta: {
    pipelineTasks: Array<string | { name: string }>;
  };
}

/** Result returned by the task runner's runPipeline function. */
export interface TaskRunResult {
  ok: boolean;
  error?: NormalizedError;
  failedStage?: string;
  logs?: Array<TaskLogEntry>;
  context?: Record<string, unknown>;
  refinementAttempts?: number;
}

/** A single entry in the task runner's logs array. */
export interface TaskLogEntry {
  stage: string;
  ok: boolean;
  ms: number;
  error?: unknown;
  skipped?: boolean;
}

/** Normalized error for serialization into status files and logs. */
export interface NormalizedError {
  name?: string;
  message: string;
  stack?: string;
}

/** Operational error metadata attached to thrown errors that carry HTTP-compatible status info.
 *  Used for lifecycle policy blocks and other domain-specific failures.
 *  Thrown as: Object.assign(new Error(message), { httpStatus, error }) */
export interface OperationalErrorMeta {
  httpStatus: number;
  error: string;
}

/** Job status snapshot (subset of fields the runner directly reads/writes). */
export interface JobStatus {
  id: string;
  current: string | null;
  tasks: Record<string, TaskStatus>;
  [key: string]: unknown;
}

/** Per-task status fields managed by the runner. */
export interface TaskStatus {
  state: string;
  startedAt?: string;
  endedAt?: string;
  attempts?: number;
  executionTimeMs?: number;
  refinementAttempts?: number;
  error?: NormalizedError;
  failedStage?: string;
  stageLogPath?: string;
  errorContext?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Completion record appended to runs.jsonl. */
export interface CompletionRecord {
  id: string;
  finishedAt: string;
  tasks: string[];
  totalExecutionTime: number;
  totalRefinementAttempts: number;
  finalArtifacts: string[];
}

/** Resolved runtime configuration for a pipeline job. */
export interface ResolvedJobConfig {
  poRoot: string;
  dataDir: string;
  currentDir: string;
  completeDir: string;
  pipelineSlug: string;
  pipelineJsonPath: string;
  tasksDir: string;
  taskRegistryPath: string; // Fully resolved module path: PO_TASK_REGISTRY or join(tasksDir, "index.js")
  workDir: string;
  statusPath: string;
  startFromTask: string | null;
  runSingleTask: boolean;
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/** Extracts the task name from either a plain string or a named task object. */
export function getTaskName(task: string | { name: string }): string {
  return typeof task === "string" ? task : task.name;
}

/** Normalizes any thrown value into a serializable NormalizedError. */
export function normalizeError(e: unknown): NormalizedError {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  if (e !== null && typeof e === "object" && typeof (e as Record<string, unknown>).message === "string") {
    return { message: (e as { message: string }).message };
  }
  return { message: String(e) };
}

/** Resolves all runtime configuration for a pipeline job from environment variables and seed.json. */
export async function resolveJobConfig(jobId: string): Promise<ResolvedJobConfig> {
  const poRoot = resolve(process.env["PO_ROOT"] ?? process.cwd());
  const dataDir = process.env["PO_DATA_DIR"] ?? "pipeline-data";
  const currentDir = process.env["PO_CURRENT_DIR"] ?? join(poRoot, dataDir, "current");
  const completeDir = process.env["PO_COMPLETE_DIR"] ?? join(poRoot, dataDir, "complete");
  const workDir = join(currentDir, jobId);

  const seedText = await Bun.file(join(workDir, "seed.json")).text();
  const seed = JSON.parse(seedText) as SeedData;

  const pipelineSlug =
    process.env["PO_PIPELINE_SLUG"] ??
    seed.pipeline ??
    (() => { throw new Error("Pipeline slug not found: set PO_PIPELINE_SLUG or include 'pipeline' in seed.json"); })();

  let pipelineJsonPath: string;
  let tasksDir: string;

  const pipelinePath = process.env["PO_PIPELINE_PATH"];
  if (pipelinePath) {
    pipelineJsonPath = pipelinePath;
    tasksDir = join(dirname(pipelinePath), "tasks");
  } else {
    const pipelineConfig = getPipelineConfig(pipelineSlug);
    pipelineJsonPath = pipelineConfig.pipelineJsonPath;
    tasksDir = pipelineConfig.tasksDir;
  }

  const taskRegistryPath = process.env["PO_TASK_REGISTRY"] ?? join(tasksDir, "index.js");
  const startFromTask = process.env["PO_START_FROM_TASK"] ?? null;
  const runSingleTask = process.env["PO_RUN_SINGLE_TASK"] === "true";

  return {
    poRoot,
    dataDir,
    currentDir,
    completeDir,
    pipelineSlug,
    pipelineJsonPath,
    tasksDir,
    taskRegistryPath,
    workDir,
    statusPath: join(workDir, "tasks-status.json"),
    startFromTask,
    runSingleTask,
  };
}

// ─── PID file lifecycle ───────────────────────────────────────────────────────

/** Writes the current process PID to {workDir}/runner.pid. */
export async function writePidFile(workDir: string): Promise<void> {
  await Bun.write(join(workDir, "runner.pid"), `${process.pid}\n`);
}

/** Deletes {workDir}/runner.pid, ignoring ENOENT. */
export async function cleanupPidFile(workDir: string): Promise<void> {
  try {
    await unlink(join(workDir, "runner.pid"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** Synchronously deletes {workDir}/runner.pid, ignoring ENOENT. */
export function cleanupPidFileSync(workDir: string): void {
  try {
    unlinkSync(join(workDir, "runner.pid"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** Registers SIGINT, SIGTERM, and process exit handlers to clean up the PID file. */
export function installSignalHandlers(workDir: string): void {
  process.on("SIGINT", () => {
    cleanupPidFileSync(workDir);
    process.exit();
  });
  process.on("SIGTERM", () => {
    cleanupPidFileSync(workDir);
    process.exit();
  });
  process.on("exit", () => {
    cleanupPidFileSync(workDir);
  });
}

// ─── Pipeline loading ─────────────────────────────────────────────────────────

/** Reads, parses, and validates a pipeline.json file. */
export async function loadPipeline(pipelineJsonPath: string): Promise<PipelineDefinition> {
  const text = await Bun.file(pipelineJsonPath).text();
  const parsed: unknown = JSON.parse(text);
  validatePipelineOrThrow(parsed, pipelineJsonPath);
  return parsed as PipelineDefinition;
}

/** Loads the task registry module and returns its default export. */
export async function loadTaskRegistry(registryPath: string): Promise<TaskRegistry> {
  const mod = await loadFreshModule(registryPath);
  return mod["default"] as TaskRegistry;
}

// ─── Pipeline job entry point ─────────────────────────────────────────────────

/** Runs a pipeline job end-to-end for the given job ID. */
export async function runPipelineJob(jobId: string): Promise<void> {
  let workDir: string | undefined;
  try {
  const config = await resolveJobConfig(jobId);
  workDir = config.workDir;
  await writePidFile(config.workDir);
  installSignalHandlers(config.workDir);

  const pipeline = await loadPipeline(config.pipelineJsonPath);
  const taskRegistry = await loadTaskRegistry(config.taskRegistryPath);

  const statusText = await Bun.file(config.statusPath).text();
  const status = JSON.parse(statusText) as { tasks: Record<string, { state?: string }> };

  const { startFromTask, runSingleTask } = config;

  // ─── Validate startFromTask / runSingleTask config ───────────────────────

  if (runSingleTask && !startFromTask) {
    throw new Error("PO_RUN_SINGLE_TASK requires PO_START_FROM_TASK to be set");
  }

  if (startFromTask) {
    const taskNames = pipeline.tasks.map(getTaskName);
    if (!taskNames.includes(startFromTask)) {
      throw new Error(`Start-from task not found in pipeline: ${startFromTask}`);
    }
  }

  // ─── Task execution loop ─────────────────────────────────────────────────

  const pipelineArtifacts: Record<string, unknown> = {};
  let reachedStartFrom = !startFromTask;

  for (const task of pipeline.tasks) {
    const taskName = getTaskName(task);

    // Skip tasks before startFromTask
    if (!reachedStartFrom) {
      if (taskName === startFromTask) {
        reachedStartFrom = true;
      } else {
        // Load output for already-DONE skipped tasks
        const taskState = status.tasks[taskName]?.state;
        if (taskState === "DONE" || taskState === "done") {
          const outputPath = join(config.workDir, "tasks", taskName, "output.json");
          if (await Bun.file(outputPath).exists()) {
            const outputText = await Bun.file(outputPath).text();
            pipelineArtifacts[taskName] = JSON.parse(outputText) as unknown;
          }
        }
        continue;
      }
    }

    const taskState = status.tasks[taskName]?.state ?? "pending";

    // Handle already-DONE tasks (when resuming without startFromTask)
    if ((taskState === "DONE" || taskState === "done") && !startFromTask) {
      const outputPath = join(config.workDir, "tasks", taskName, "output.json");
      if (await Bun.file(outputPath).exists()) {
        const outputText = await Bun.file(outputPath).text();
        pipelineArtifacts[taskName] = JSON.parse(outputText) as unknown;
      }
      continue;
    }

    // Check lifecycle policy (bypassed when startFromTask is set)
    if (!startFromTask) {
      const taskKeys = pipeline.tasks.map(getTaskName);
      const taskIndex = taskKeys.indexOf(taskName);
      const dependenciesReady = taskKeys
        .slice(0, taskIndex)
        .every((name) => {
          const s = status.tasks[name]?.state;
          return s === "DONE" || s === "done";
        });

      const decision = decideTransition({ op: "start", taskState, dependenciesReady });
      if (!decision.ok) {
        throw Object.assign(
          new Error(`Lifecycle policy blocked task start: ${taskName} (reason: ${decision.reason})`),
          { httpStatus: 409, error: "unsupported_lifecycle" }
        );
      }
    }

    // Update status to RUNNING
    await writeJobStatus(config.workDir, (snapshot) => {
      snapshot.current = taskName;
      const taskEntry = snapshot.tasks[taskName] ?? {};
      taskEntry.state = "running";
      taskEntry.startedAt = new Date().toISOString();
      taskEntry.attempts = (taskEntry.attempts ?? 0) + 1;
      snapshot.tasks[taskName] = taskEntry;
    });

    // ─── Task execution ───────────────────────────────────────────────────

    if (!taskRegistry[taskName]) {
      throw new Error(`Task not registered: ${taskName}`);
    }

    // Resolve task module path
    const relativeModulePath = taskRegistry[taskName];
    const absoluteModulePath = resolve(dirname(config.taskRegistryPath), relativeModulePath);

    // Create task directory
    const taskDir = join(config.workDir, "tasks", taskName);
    await mkdir(taskDir, { recursive: true });

    // Validate and repair task symlinks
    const symlinksValid = await validateTaskSymlinks(config.workDir, taskName, absoluteModulePath, config.poRoot);
    if (!symlinksValid) {
      await repairTaskSymlinks(config.workDir, taskName, absoluteModulePath, config.poRoot);
    }

    // Set up symlink bridge
    const { relocatedEntryPath } = await ensureTaskSymlinkBridge(
      config.workDir,
      taskName,
      dirname(config.taskRegistryPath),
      absoluteModulePath,
      config.poRoot,
    );

    // Create file I/O interface
    let currentStage = "";
    const fileIO = createTaskFileIO({
      workDir: config.workDir,
      taskName,
      getStage: () => currentStage,
      statusPath: config.statusPath,
    });
    void fileIO;

    // Read seed data for context
    const seedText = await Bun.file(join(config.workDir, "seed.json")).text();
    const seed = JSON.parse(seedText) as Record<string, unknown>;

    // Build task execution context
    const taskExecutionContext = {
      workDir: config.workDir,
      taskDir,
      seed,
      taskName,
      taskConfig: (pipeline.taskConfig?.[taskName] ?? {}) as Record<string, unknown>,
      statusPath: config.statusPath,
      jobId,
      llmOverride: (pipeline.llm ?? null) as Record<string, unknown> | null,
      meta: {
        pipelineTasks: pipeline.tasks.map(getTaskName),
      },
    };

    // Delegate to task runner
    const result = await runPipeline(relocatedEntryPath, taskExecutionContext);

    if (result.ok) {
      // Compute execution time from logs
      const executionTimeMs = result.logs
        .filter((log): log is Extract<AuditLogEntry, { ok: true }> => "ok" in log && log.ok === true)
        .reduce((sum, log) => sum + log.ms, 0);

      // Write execution logs
      const logsLogName = generateLogName(taskName, "pipeline", LogEvent.EXECUTION_LOGS, LogFileExtension.JSON);
      await fileIO.writeLog(logsLogName, JSON.stringify(result.logs, null, 2));

      // Update status to DONE
      await writeJobStatus(config.workDir, (snapshot) => {
        const taskEntry = snapshot.tasks[taskName] ?? {};
        taskEntry.state = TaskState.DONE;
        taskEntry.endedAt = new Date().toISOString();
        taskEntry.executionTimeMs = executionTimeMs;
        taskEntry.refinementAttempts = ((result.context as unknown) as Record<string, unknown>)["refinementAttempts"] as number | undefined ?? 0;
        snapshot.tasks[taskName] = taskEntry;
      });

      // Add task output to pipelineArtifacts
      const outputPath = join(config.workDir, "tasks", taskName, "output.json");
      if (await Bun.file(outputPath).exists()) {
        const outputText = await Bun.file(outputPath).text();
        pipelineArtifacts[taskName] = JSON.parse(outputText) as unknown;
      }
    } else {
      // Write execution logs
      const logsLogName = generateLogName(taskName, "pipeline", LogEvent.EXECUTION_LOGS, LogFileExtension.JSON);
      await fileIO.writeLog(logsLogName, JSON.stringify(result.logs, null, 2));

      // Write failure details
      const failureLogName = generateLogName(taskName, "pipeline", LogEvent.FAILURE_DETAILS, LogFileExtension.JSON);
      await fileIO.writeLog(failureLogName, JSON.stringify(result.error, null, 2));

      // Update status to FAILED
      await writeJobStatus(config.workDir, (snapshot) => {
        const raw = (snapshot.tasks[taskName] ?? {}) as Record<string, unknown>;
        raw["state"] = TaskState.FAILED;
        raw["endedAt"] = new Date().toISOString();
        raw["error"] = { name: result.error.name, message: result.error.message, stack: result.error.stack };
        raw["failedStage"] = result.failedStage;
        raw["stageLogPath"] = result.error.debug?.logPath;
        raw["errorContext"] = result.error.debug as unknown as Record<string, unknown>;
        snapshot.tasks[taskName] = raw as typeof snapshot.tasks[string];
      });

      process.exit(1);
    }

    // Exit after target task in single-task mode
    if (runSingleTask) break;
  }

  // On full pipeline completion (not single-task mode), finalize the job
  if (!runSingleTask) {
    const finalStatusText = await Bun.file(config.statusPath).text();
    const finalStatus = JSON.parse(finalStatusText) as JobStatus;
    await completeJob(config, finalStatus, pipelineArtifacts);
  }
  } catch (err) {
    console.error("Unhandled error in runPipelineJob:", err);
    if (workDir !== undefined) {
      await cleanupPidFile(workDir);
    }
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 5000).unref();
    process.exit(1);
  }
}

// ─── Pipeline completion ──────────────────────────────────────────────────────

/** Finalizes a completed job: cleans up PID, moves directory, writes runs.jsonl, cleans symlinks. */
export async function completeJob(
  config: ResolvedJobConfig,
  status: JobStatus,
  pipelineArtifacts: Record<string, unknown>
): Promise<void> {
  // Delete runner.pid before the directory move so the registered cleanup path is never stale
  await cleanupPidFile(config.workDir);

  const jobId = basename(config.workDir);
  const destDir = join(config.completeDir, jobId);

  // Create complete/ directory if needed
  await mkdir(config.completeDir, { recursive: true });

  // Move job directory from current/ to complete/
  await rename(config.workDir, destDir);

  // Build completion record
  const taskNames = Object.keys(status.tasks);
  const totalExecutionTime = taskNames.reduce(
    (sum, name) => sum + (status.tasks[name]?.executionTimeMs ?? 0),
    0
  );
  const totalRefinementAttempts = taskNames.reduce(
    (sum, name) => sum + (status.tasks[name]?.refinementAttempts ?? 0),
    0
  );

  const record: CompletionRecord = {
    id: status.id,
    finishedAt: new Date().toISOString(),
    tasks: taskNames,
    totalExecutionTime,
    totalRefinementAttempts,
    finalArtifacts: Object.keys(pipelineArtifacts),
  };

  // Append to runs.jsonl (directory already exists from mkdir above)
  await appendFile(join(config.completeDir, "runs.jsonl"), JSON.stringify(record) + "\n");

  // Clean up task symlinks in the completed directory
  await cleanupTaskSymlinks(destDir);
}

// ─── Direct execution mode ────────────────────────────────────────────────────

/** Returns true when this module is the entry point (not imported). */
export function isDirectSourceExecution(): boolean {
  // Bun.main is the resolved path of the entry point
  if (typeof Bun !== "undefined" && typeof Bun.main === "string") {
    if (import.meta.url === Bun.main) return true;
    const mainUrl = Bun.main.startsWith("file://") ? Bun.main : pathToFileURL(Bun.main).href;
    if (import.meta.url === mainUrl) return true;
  }
  // Strip file:// prefix and compare against argv[1]
  if (import.meta.url.startsWith("file://")) {
    const argv1 = process.argv[1] ?? "";
    if (argv1 && import.meta.url === pathToFileURL(argv1).href) return true;
  }
  // Basename fallback
  return basename(process.argv[1] ?? "") === "pipeline-runner.ts";
}

if (isDirectSourceExecution()) {
  process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err);
    setTimeout(() => process.exit(1), 100).unref();
  });
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    setTimeout(() => process.exit(1), 100).unref();
  });
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: pipeline-runner.ts <jobId>");
    process.exit(1);
  }
  runPipelineJob(jobId);
}
