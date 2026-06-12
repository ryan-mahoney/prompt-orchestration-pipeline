import { join, dirname, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { unlink, mkdir, rename, appendFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { getConfig, getPipelineConfig } from "./config";
import { validatePipelineOrThrow } from "./validation";
import { loadFreshModule } from "./module-loader";
import { atomicWrite, writeJobStatus, type GateInfo } from "./status-writer";
import { decideTransition } from "./lifecycle-policy";
import { runPipeline } from "./task-runner";
import type { AuditLogEntry, PipelineResult } from "./task-runner";
import type { TaskStateValue } from "../config/statuses";
import { ensureTaskSymlinkBridge } from "./symlink-bridge";
import { validateTaskSymlinks, repairTaskSymlinks, cleanupTaskSymlinks } from "./symlink-utils";
import { createTaskFileIO, generateLogName } from "./file-io";
import { LogEvent, LogFileExtension } from "../config/log-events";
import { TaskState, normalizeTaskState } from "../config/statuses";
import { releaseJobSlot } from "./job-concurrency";
import { ControlValidationError, parseControlFile, validateControlDirectives, type ControlDirectives } from "./control";
import { appendRunEvent } from "./run-events";
import {
  getTaskName,
  normalizePipelineTasks,
  normalizeTaskEntry,
  type PipelineDefinition,
  type PipelineTaskEntry,
} from "./pipeline-definition";

export { getTaskName, normalizeTaskEntry };
export type { PipelineDefinition, PipelineTaskEntry };

// ─── Type definitions ─────────────────────────────────────────────────────────

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
    pipelineTasks: Array<string | PipelineTaskEntry>;
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
  restartCount?: number;
  retrying?: boolean;
  nextRetryAt?: string;
  lastRetryError?: NormalizedError;
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

async function loadDoneArtifact(
  workDir: string,
  taskName: string,
  pipelineArtifacts: Record<string, unknown>,
): Promise<void> {
  if (Object.hasOwn(pipelineArtifacts, taskName)) return;
  const outputPath = join(workDir, "tasks", taskName, "output.json");
  if (await Bun.file(outputPath).exists()) {
    const outputText = await Bun.file(outputPath).text();
    pipelineArtifacts[taskName] = JSON.parse(outputText) as unknown;
  }
}

async function readControlDirectives(taskDir: string): Promise<ControlDirectives | null> {
  const controlFile = Bun.file(join(taskDir, "control.json"));
  if (!(await controlFile.exists())) return null;
  return parseControlFile(await controlFile.text());
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function validateControlDirectivesForCurrentRun(
  directives: ControlDirectives,
  ctx: {
    pipelineTasks: PipelineTaskEntry[];
    taskStates: Record<string, string>;
    registryKeys: string[];
    emittingTask: string;
  },
): void {
  const existingByName = new Map(ctx.pipelineTasks.map((task) => [task.name, task]));
  const patch = directives.patch;
  if (!patch) {
    validateControlDirectives(directives, ctx);
    return;
  }

  const violations: string[] = [];
  const registryKeySet = new Set(ctx.registryKeys);
  const addForValidation: PipelineTaskEntry[] = [];
  const seenAddNames = new Set<string>();

  for (const entry of patch.add) {
    if (seenAddNames.has(entry.name)) {
      violations.push(`patch.add task name '${entry.name}' is duplicated within the batch`);
      continue;
    }
    seenAddNames.add(entry.name);

    const existing = existingByName.get(entry.name);
    if (!existing) {
      addForValidation.push(entry);
      continue;
    }

    const existingTaskKey = existing.task ?? existing.name;
    const entryTaskKey = entry.task ?? entry.name;
    if (existingTaskKey !== entryTaskKey) {
      violations.push(`patch.add task name '${entry.name}' already exists with a different task key`);
    }
    if (!sameJsonValue(existing.config, entry.config)) {
      violations.push(`patch.add task name '${entry.name}' already exists with different config`);
    }
    if (!sameJsonValue(existing.gate, entry.gate)) {
      violations.push(`patch.add task name '${entry.name}' already exists with different gate`);
    }
    if (!registryKeySet.has(entryTaskKey)) {
      violations.push(`patch.add task '${entry.name}' references unregistered task key '${entryTaskKey}'`);
    }
  }

  if (violations.length > 0) {
    throw new ControlValidationError(violations);
  }

  validateControlDirectives(
    {
      ...directives,
      patch: {
        ...patch,
        add: addForValidation,
      },
    },
    ctx,
  );
}

async function applyPipelinePatch(
  pipelinePath: string,
  directives: ControlDirectives,
  emittingTask: string,
): Promise<{ pipeline: PipelineDefinition; added: PipelineTaskEntry[]; insertAfter: string | null }> {
  const pipeline = await loadPipeline(pipelinePath);
  const patch = directives.patch;
  if (!patch) return { pipeline, added: [], insertAfter: null };

  const insertAfter = patch.insertAfter ?? emittingTask;
  const existingNames = new Set(pipeline.tasks.map(getTaskName));
  const added = patch.add.filter((entry) => !existingNames.has(entry.name));
  if (added.length === 0) return { pipeline, added, insertAfter };

  const insertAfterIndex = pipeline.tasks.findIndex((entry) => getTaskName(entry) === insertAfter);
  const nextTasks = [...pipeline.tasks];
  nextTasks.splice(insertAfterIndex + 1, 0, ...added);
  const nextPipeline: PipelineDefinition = { ...pipeline, tasks: nextTasks };

  await atomicWrite(pipelinePath, `${JSON.stringify(nextPipeline, null, 2)}\n`);
  return { pipeline: nextPipeline, added, insertAfter };
}

function buildTaskRecordFromPipeline(
  pipeline: PipelineDefinition,
  existing: Record<string, TaskStatus>,
): Record<string, TaskStatus> {
  const rebuilt: Record<string, TaskStatus> = {};
  const namesInPipeline = new Set<string>();

  for (const task of normalizePipelineTasks(pipeline)) {
    namesInPipeline.add(task.name);
    rebuilt[task.name] = existing[task.name] ?? { state: TaskState.PENDING };
  }

  for (const [name, status] of Object.entries(existing)) {
    if (!namesInPipeline.has(name)) {
      rebuilt[name] = status;
    }
  }

  return rebuilt;
}

async function applyControlStatus(args: {
  workDir: string;
  pipeline: PipelineDefinition;
  taskName: string;
  executionTimeMs: number;
  refinementAttempts: number;
  endedAt?: string;
  directives: ControlDirectives | null;
  gate: GateInfo | null;
}): Promise<void> {
  const endedAt = args.endedAt ?? new Date().toISOString();
  await writeJobStatus(args.workDir, (snapshot) => {
    const existingTasks = snapshot.tasks as Record<string, TaskStatus>;
    snapshot.tasks = buildTaskRecordFromPipeline(args.pipeline, existingTasks) as typeof snapshot.tasks;

    const taskEntry = snapshot.tasks[args.taskName] ?? {};
    taskEntry.state = TaskState.DONE;
    taskEntry.endedAt = endedAt;
    taskEntry.executionTimeMs = args.executionTimeMs;
    taskEntry.refinementAttempts = args.refinementAttempts;
    if (args.directives !== null) {
      taskEntry.controlApplied = true;
    }
    delete taskEntry.retrying;
    delete taskEntry.nextRetryAt;
    delete taskEntry.lastRetryError;
    snapshot.tasks[args.taskName] = taskEntry;

    for (const skip of args.directives?.skip ?? []) {
      const skipEntry = (snapshot.tasks[skip.task] ?? { state: TaskState.PENDING }) as TaskStatus;
      if (normalizeTaskState(skipEntry.state) === TaskState.PENDING) {
        skipEntry.state = TaskState.SKIPPED;
        skipEntry.skipReason = skip.reason;
        skipEntry.skippedBy = args.taskName;
        snapshot.tasks[skip.task] = skipEntry as typeof snapshot.tasks[string];
      }
    }

    if (args.gate !== null) {
      snapshot.state = "waiting";
      snapshot.current = null;
      snapshot.currentStage = null;
      snapshot.gate = args.gate;
    }
  });
}

async function applyControlFileIfPresent(args: {
  config: ResolvedJobConfig;
  taskRegistry: TaskRegistry;
  taskName: string;
  selectedEntry: PipelineTaskEntry;
  executionTimeMs: number;
  refinementAttempts: number;
  endedAt?: string;
}): Promise<{ gate: GateInfo | null } | null> {
  const taskDir = join(args.config.workDir, "tasks", args.taskName);
  const directives = await readControlDirectives(taskDir);
  if (directives === null) return null;

  const controlPipeline = await loadPipeline(args.config.pipelineJsonPath);
  const controlPipelineTasks = normalizePipelineTasks(controlPipeline);
  const controlStatusText = await Bun.file(args.config.statusPath).text();
  const controlStatus = JSON.parse(controlStatusText) as { tasks: Record<string, { state?: string }> };
  validateControlDirectivesForCurrentRun(directives, {
    pipelineTasks: controlPipelineTasks,
    taskStates: getTaskStateMap(controlStatus.tasks, controlPipelineTasks),
    registryKeys: Object.keys(args.taskRegistry),
    emittingTask: args.taskName,
  });

  const patchResult = await applyPipelinePatch(args.config.pipelineJsonPath, directives, args.taskName);
  const gate = buildGateInfo(args.taskName, directives, args.selectedEntry);
  await applyControlStatus({
    workDir: args.config.workDir,
    pipeline: patchResult.pipeline,
    taskName: args.taskName,
    executionTimeMs: args.executionTimeMs,
    refinementAttempts: args.refinementAttempts,
    endedAt: args.endedAt,
    directives,
    gate,
  });

  if (directives.patch) {
    await appendRunEvent(args.config.workDir, {
      type: "patch_applied",
      task: args.taskName,
      added: patchResult.added.map((entry) => entry.name),
      insertAfter: patchResult.insertAfter ?? args.taskName,
      at: new Date().toISOString(),
    });
  }

  if (directives.skip && directives.skip.length > 0) {
    await appendRunEvent(args.config.workDir, {
      type: "skip_applied",
      task: args.taskName,
      skipped: directives.skip.map((skip) => ({ task: skip.task, reason: skip.reason })),
      at: new Date().toISOString(),
    });
  }

  if (gate !== null) {
    await appendRunEvent(args.config.workDir, {
      type: "gate_created",
      afterTask: gate.afterTask,
      message: gate.message,
      at: new Date().toISOString(),
    });
  }

  return { gate };
}

async function failControlValidation(args: {
  workDir: string;
  dataDir: string;
  jobId: string;
  taskName: string;
  error: ControlValidationError;
}): Promise<never> {
  const normalized = normalizeError(args.error);
  await appendRunEvent(args.workDir, {
    type: "control_invalid",
    task: args.taskName,
    message: normalized.message,
    at: new Date().toISOString(),
  });

  await writeJobStatus(args.workDir, (snapshot) => {
    snapshot.state = "failed";
    snapshot.current = args.taskName;
    snapshot.currentStage = null;
    const raw = (snapshot.tasks[args.taskName] ?? {}) as Record<string, unknown>;
    raw["state"] = TaskState.FAILED;
    raw["endedAt"] = new Date().toISOString();
    raw["error"] = { name: normalized.name, message: normalized.message, stack: normalized.stack };
    raw["failedStage"] = "control";
    delete raw["stageLogPath"];
    delete raw["errorContext"];
    delete raw["retrying"];
    delete raw["nextRetryAt"];
    delete raw["lastRetryError"];
    snapshot.tasks[args.taskName] = raw as typeof snapshot.tasks[string];
  });

  await releaseJobSlotBestEffort(args.dataDir, args.jobId);
  process.exit(1);
}

function buildGateInfo(
  taskName: string,
  directives: ControlDirectives | null,
  selectedEntry: PipelineTaskEntry,
): GateInfo | null {
  const requestedAt = new Date().toISOString();
  const directivePause = directives?.pause;
  if (directivePause) {
    return {
      afterTask: taskName,
      message: directivePause.message,
      artifacts: directivePause.artifacts,
      requestedAt,
    };
  }

  if (selectedEntry.gate === undefined || selectedEntry.gate === false) return null;

  const defaultMessage = `Review task '${taskName}' before continuing.`;
  if (selectedEntry.gate === true) {
    return {
      afterTask: taskName,
      message: defaultMessage,
      requestedAt,
    };
  }

  return {
    afterTask: taskName,
    message: selectedEntry.gate.message ?? defaultMessage,
    artifacts: selectedEntry.gate.artifacts,
    requestedAt,
  };
}

function getTaskStateMap(
  statusTasks: Record<string, { state?: string }>,
  pipelineTasks: PipelineTaskEntry[],
): Record<string, string> {
  const taskStates: Record<string, string> = {};
  for (const task of pipelineTasks) {
    taskStates[task.name] = normalizeTaskState(statusTasks[task.name]?.state ?? TaskState.PENDING);
  }
  for (const [name, status] of Object.entries(statusTasks)) {
    taskStates[name] = normalizeTaskState(status.state ?? TaskState.PENDING);
  }
  return taskStates;
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

  const runScopedPipelineJsonPath = join(workDir, "pipeline.json");
  if (await Bun.file(runScopedPipelineJsonPath).exists()) {
    pipelineJsonPath = runScopedPipelineJsonPath;
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

/** Registers SIGINT, SIGTERM, SIGHUP, and process exit handlers to release the job slot and clean up the PID file. */
export function installSignalHandlers(workDir: string, dataDir: string, jobId: string): void {
  let shuttingDown = false;
  const handle = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await releaseJobSlot(dataDir, jobId);
    } catch (err) {
      console.error(`failed to release job slot for ${jobId} during shutdown`, err);
    }
    try {
      cleanupPidFileSync(workDir);
    } catch (err) {
      console.error(`failed to clean runner pid for ${jobId} during shutdown`, err);
    } finally {
      process.exit();
    }
  };
  process.once("SIGINT", handle);
  process.once("SIGTERM", handle);
  process.once("SIGHUP", handle);
  process.on("exit", () => {
    cleanupPidFileSync(workDir);
  });
}

async function releaseJobSlotBestEffort(dataDir: string, jobId: string): Promise<void> {
  try {
    await releaseJobSlot(dataDir, jobId);
  } catch (err) {
    console.error(`failed to release job slot for ${jobId}`, err);
  }
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

const INITIAL_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;
const RETRY_BACKOFF_MULTIPLIER = 2;

/** Runs a pipeline job end-to-end for the given job ID. */
export async function runPipelineJob(jobId: string): Promise<void> {
  let workDir: string | undefined;
  let activeTaskName: string | null = null;
  const poRoot = resolve(process.env["PO_ROOT"] ?? process.cwd());
  let dataDir: string | undefined = resolve(poRoot, process.env["PO_DATA_DIR"] ?? "pipeline-data");
  try {
  const config = await resolveJobConfig(jobId);
  workDir = config.workDir;
  dataDir = resolve(config.poRoot, config.dataDir);
  await writePidFile(config.workDir);
  installSignalHandlers(config.workDir, dataDir, jobId);

  const initialPipeline = await loadPipeline(config.pipelineJsonPath);
  const taskRegistry = await loadTaskRegistry(config.taskRegistryPath);

  const { startFromTask, runSingleTask } = config;

  // ─── Validate startFromTask / runSingleTask config ───────────────────────

  if (runSingleTask && !startFromTask) {
    throw new Error("PO_RUN_SINGLE_TASK requires PO_START_FROM_TASK to be set");
  }

  if (startFromTask) {
    const taskNames = initialPipeline.tasks.map(getTaskName);
    if (!taskNames.includes(startFromTask)) {
      throw new Error(`Start-from task not found in pipeline: ${startFromTask}`);
    }
  }

  // ─── Task execution loop ─────────────────────────────────────────────────

  const pipelineArtifacts: Record<string, unknown> = {};

  while (true) {
    const pipeline = await loadPipeline(config.pipelineJsonPath);
    const pipelineTasks = normalizePipelineTasks(pipeline);
    const statusText = await Bun.file(config.statusPath).text();
    const status = JSON.parse(statusText) as { tasks: Record<string, { state?: string }> };

    let selectedEntry: PipelineTaskEntry | null = null;
    let selectedTaskState: TaskStateValue = TaskState.PENDING;
    let reachedStartFrom = !startFromTask;
    let replayedControl = false;

    for (const entry of pipelineTasks) {
      const taskName = entry.name;
      const taskStatus = status.tasks[taskName] as TaskStatus | undefined;
      const taskState = normalizeTaskState(taskStatus?.state ?? TaskState.PENDING);

      if (!reachedStartFrom) {
        if (taskName === startFromTask) {
          reachedStartFrom = true;
        } else {
          if (taskState === TaskState.DONE) {
            await loadDoneArtifact(config.workDir, taskName, pipelineArtifacts);
          }
          continue;
        }
      }

      if (taskState === TaskState.DONE) {
        if (taskStatus?.controlApplied !== true) {
          try {
            const appliedControl = await applyControlFileIfPresent({
              config,
              taskRegistry,
              taskName,
              selectedEntry: entry,
              executionTimeMs: typeof taskStatus?.executionTimeMs === "number" ? taskStatus.executionTimeMs : 0,
              refinementAttempts: typeof taskStatus?.refinementAttempts === "number" ? taskStatus.refinementAttempts : 0,
              endedAt: typeof taskStatus?.endedAt === "string" ? taskStatus.endedAt : undefined,
            });
            if (appliedControl !== null) {
              if (appliedControl.gate !== null) {
                activeTaskName = null;
                await releaseJobSlotBestEffort(dataDir, jobId);
                return;
              }
              replayedControl = true;
              break;
            }
          } catch (error) {
            if (!(error instanceof ControlValidationError)) throw error;
            activeTaskName = null;
            await failControlValidation({
              workDir: config.workDir,
              dataDir,
              jobId,
              taskName,
              error,
            });
          }
        }
        await loadDoneArtifact(config.workDir, taskName, pipelineArtifacts);
        continue;
      }

      if (taskState === TaskState.SKIPPED) {
        continue;
      }

      selectedEntry = entry;
      selectedTaskState = taskState;
      break;
    }

    if (replayedControl) {
      continue;
    }

    if (selectedEntry === null) {
      break;
    }

    const taskName = selectedEntry.name;
    const taskState = selectedTaskState;

    let predecessorsReady = true;
    for (const entry of pipelineTasks) {
      if (entry.name === taskName) break;
      const state = normalizeTaskState(status.tasks[entry.name]?.state ?? TaskState.PENDING);
      if (state !== TaskState.DONE && state !== TaskState.SKIPPED) {
        predecessorsReady = false;
        break;
      }
    }

    // Check lifecycle policy (bypassed when startFromTask is set)
    if (!startFromTask) {
      const decision = decideTransition({ op: "start", taskState, dependenciesReady: predecessorsReady });
      if (!decision.ok) {
        throw Object.assign(
          new Error(`Lifecycle policy blocked task start: ${taskName} (reason: ${decision.reason})`),
          { httpStatus: 409, error: "unsupported_lifecycle" }
        );
      }
    }

    // Update status to RUNNING
    activeTaskName = taskName;
    await writeJobStatus(config.workDir, (snapshot) => {
      snapshot.state = "running";
      snapshot.current = taskName;
      snapshot.currentStage = null;
      const taskEntry = snapshot.tasks[taskName] ?? {};
      taskEntry.state = "running";
      taskEntry.startedAt = new Date().toISOString();
      taskEntry.attempts = (taskEntry.attempts ?? 0) + 1;
      delete taskEntry.endedAt;
      delete taskEntry.failedStage;
      delete taskEntry.error;
      delete taskEntry.stageLogPath;
      delete taskEntry.errorContext;
      delete taskEntry.retrying;
      delete taskEntry.nextRetryAt;
      delete taskEntry.lastRetryError;
      snapshot.tasks[taskName] = taskEntry;
    });

    // ─── Task execution ───────────────────────────────────────────────────

    const taskKey = selectedEntry.task ?? selectedEntry.name;
    if (!taskRegistry[taskKey]) {
      throw new Error(`Task not registered: ${taskKey}`);
    }

    // Resolve task module path
    const relativeModulePath = taskRegistry[taskKey];
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
      taskConfig: {
        ...(pipeline.taskConfig?.[taskName] ?? {}),
        ...(selectedEntry.config ?? {}),
      },
      statusPath: config.statusPath,
      jobId,
      llmOverride: (pipeline.llm ?? null) as Record<string, unknown> | null,
      meta: {
        pipelineTasks: pipelineTasks.map((entry) => entry.name),
      },
    };

    // Delegate to task runner with bounded retry loop.
    // Guard against partial test mocks or malformed runtime config.
    const configuredMaxAttempts = getConfig().taskRunner?.maxAttempts;
    const maxAttempts = Number.isInteger(configuredMaxAttempts) ? configuredMaxAttempts : 3;
    const cap = Math.max(1, maxAttempts);

    let result: PipelineResult | undefined;
    for (let attempt = 1; attempt <= cap; attempt++) {
      result = await runPipeline(relocatedEntryPath, taskExecutionContext);
      const failedResult = result; // const binding lets TypeScript narrow the union after the ok check below
      if (failedResult.ok) break;
      if (attempt >= cap) break;

      const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * RETRY_BACKOFF_MULTIPLIER ** (attempt - 1),
        MAX_RETRY_DELAY_MS,
      );
      const nextRetryAt = new Date(Date.now() + delay).toISOString();

      await writeJobStatus(config.workDir, (snapshot) => {
        const entry = snapshot.tasks[taskName] ?? {};
        const currentAttempts = typeof entry.attempts === "number" ? entry.attempts : attempt;
        entry.state = "running";
        entry.attempts = currentAttempts + 1;
        entry.restartCount = (entry.restartCount ?? 0) + 1;
        entry.retrying = true;
        entry.nextRetryAt = nextRetryAt;
        entry.lastRetryError = failedResult.error;
        delete entry.failedStage;
        delete entry.error;
        snapshot.tasks[taskName] = entry;
      });

      await Bun.sleep(delay);
    }

    if (!result) throw new Error("Retry loop produced no result");

    if (result.ok) {
      // Compute execution time from logs
      const executionTimeMs = result.logs
        .filter((log): log is Extract<AuditLogEntry, { ok: true }> => "ok" in log && log.ok === true)
        .reduce((sum, log) => sum + log.ms, 0);

      // Write execution logs
      const logsLogName = generateLogName(taskName, "pipeline", LogEvent.EXECUTION_LOGS, LogFileExtension.JSON);
      await fileIO.writeLog(logsLogName, JSON.stringify(result.logs, null, 2));

      const refinementAttempts =
        (((result.context as unknown) as Record<string, unknown>)["refinementAttempts"] as number | undefined) ?? 0;
      let appliedControl: { gate: GateInfo | null } | null = null;

      try {
        appliedControl = await applyControlFileIfPresent({
          config,
          taskRegistry,
          taskName,
          selectedEntry,
          executionTimeMs,
          refinementAttempts,
        });
      } catch (error) {
        if (!(error instanceof ControlValidationError)) throw error;
        activeTaskName = null;
        await failControlValidation({
          workDir: config.workDir,
          dataDir,
          jobId,
          taskName,
          error,
        });
      }

      if (appliedControl === null) {
        const gate = buildGateInfo(taskName, null, selectedEntry);
        await applyControlStatus({
          workDir: config.workDir,
          pipeline,
          taskName,
          executionTimeMs,
          refinementAttempts,
          directives: null,
          gate,
        });

        if (gate !== null) {
          await appendRunEvent(config.workDir, {
            type: "gate_created",
            afterTask: gate.afterTask,
            message: gate.message,
            at: new Date().toISOString(),
          });
          activeTaskName = null;
          await releaseJobSlotBestEffort(dataDir, jobId);
          return;
        }
      } else if (appliedControl.gate !== null) {
        activeTaskName = null;
        await releaseJobSlotBestEffort(dataDir, jobId);
        return;
      }
      activeTaskName = null;

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
        snapshot.state = "failed";
        snapshot.current = taskName;
        const raw = (snapshot.tasks[taskName] ?? {}) as Record<string, unknown>;
        raw["state"] = TaskState.FAILED;
        raw["endedAt"] = new Date().toISOString();
        raw["error"] = { name: result.error.name, message: result.error.message, stack: result.error.stack };
        raw["failedStage"] = result.failedStage;
        raw["stageLogPath"] = result.error.debug?.logPath;
        raw["errorContext"] = result.error.debug as unknown as Record<string, unknown>;
        delete raw["retrying"];
        delete raw["nextRetryAt"];
        delete raw["lastRetryError"];
        snapshot.tasks[taskName] = raw as typeof snapshot.tasks[string];
      });
      activeTaskName = null;

      await releaseJobSlotBestEffort(dataDir, jobId);
      process.exit(1);
    }

    // Exit after target task in single-task mode
    if (runSingleTask) break;
  }

  // On full pipeline completion (not single-task mode), finalize the job
  if (!runSingleTask) {
    await writeJobStatus(config.workDir, (snapshot) => {
      snapshot.state = "done";
      snapshot.current = null;
      snapshot.currentStage = null;
    });
    const finalStatusText = await Bun.file(config.statusPath).text();
    const finalStatus = JSON.parse(finalStatusText) as JobStatus;
    await completeJob(config, finalStatus, pipelineArtifacts);
  }
  await releaseJobSlotBestEffort(dataDir, jobId);
  } catch (err) {
    const normalized = normalizeError(err);
    console.error(normalized.message);
    if (workDir !== undefined) {
      try {
        const failureIO = createTaskFileIO({
          workDir,
          taskName: "orchestrator",
          trackTaskFiles: false,
          getStage: () => "runPipelineJob",
          statusPath: join(workDir, "tasks-status.json"),
        });
        const failureLogName = generateLogName(
          "orchestrator",
          "runPipelineJob",
          LogEvent.FAILURE_DETAILS,
          LogFileExtension.JSON,
        );
        await failureIO.writeLog(failureLogName, JSON.stringify(normalized, null, 2));
      } catch {
        // Do not mask the original failure if log-write fails
      }
      if (activeTaskName !== null) {
        try {
          const failedTaskName = activeTaskName;
          const failedAt = new Date().toISOString();
          await writeJobStatus(workDir, (snapshot) => {
            snapshot.state = "failed";
            snapshot.current = failedTaskName;
            snapshot.currentStage = null;
            const existing = snapshot.tasks[failedTaskName] ?? {};
            const taskEntry: Partial<TaskStatus> & Record<string, unknown> = {
              ...existing,
              state: TaskState.FAILED,
              endedAt: failedAt,
              failedStage: "orchestrator",
              error: normalized,
              currentStage: null,
            };
            delete taskEntry.retrying;
            delete taskEntry.nextRetryAt;
            delete taskEntry.lastRetryError;
            snapshot.tasks[failedTaskName] = taskEntry as typeof snapshot.tasks[string];
          });
        } catch {
          // Do not mask the original failure if status finalization fails
        }
      }
      try {
        await cleanupPidFile(workDir);
      } catch {
        // Do not mask the original failure if PID cleanup fails
      }
    }
    if (dataDir !== undefined) {
      await releaseJobSlotBestEffort(dataDir, jobId);
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
