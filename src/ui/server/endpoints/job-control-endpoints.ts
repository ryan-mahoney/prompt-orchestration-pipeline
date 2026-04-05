import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { createErrorResponse } from "../config-bridge";
import { Constants } from "../config-bridge-node";
import { sendJson } from "../utils/http-utils";
import { getJobDirectoryPath } from "../../../config/paths";
import { deriveJobStatusFromTasks } from "../../../config/statuses";
import {
  readJobStatus,
  resetJobToCleanSlate,
  resetSingleTask,
  writeJobStatus,
  type StatusSnapshot,
} from "../../../core/status-writer";
import { readFileWithRetry } from "../file-reader";

const RUNNER_PATH = path.resolve(import.meta.dir, "../../../core/pipeline-runner.ts");

const restartingJobs = new Set<string>();
const stoppingJobs = new Set<string>();
const startingJobs = new Set<string>();

function begin(set: Set<string>, jobId: string): boolean {
  if (set.has(jobId)) return false;
  set.add(jobId);
  return true;
}

function end(set: Set<string>, jobId: string): void {
  set.delete(jobId);
}

async function spawnDetached(args: string[], env?: Record<string, string | undefined>): Promise<void> {
  const proc = Bun.spawn({
    cmd: args,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    env: env ?? process.env as Record<string, string>,
    detached: true,
  });
  proc.unref();
}

async function readRunnerPid(jobDir: string): Promise<number | null> {
  try {
    const content = await Bun.file(path.join(jobDir, "runner.pid")).text();
    const pid = parseInt(content.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const KILL_GRACE_MS = 1500;
const KILL_POLL_MS = 100;

function isTerminalTaskState(state: unknown): boolean {
  return state === "done" || state === "failed";
}

function isNonTerminalTaskState(state: unknown): boolean {
  return state === "pending" || state === "running";
}

function isTaskLikelyInProgress(task: Record<string, unknown>): boolean {
  const state = task["state"];
  const nonTerminal = isNonTerminalTaskState(state);
  const startedAt = typeof task["startedAt"] === "string" && task["startedAt"].trim().length > 0;
  const endedAt = typeof task["endedAt"] === "string" && task["endedAt"].trim().length > 0;
  if (nonTerminal && startedAt && !endedAt) return true;
  if (nonTerminal && startedAt && endedAt) return true;
  return typeof task["currentStage"] === "string" && task["currentStage"].trim().length > 0;
}

function getProgressPercent(snapshot: StatusSnapshot): number {
  const tasks = Object.values(snapshot.tasks);
  if (tasks.length === 0) return 0;
  const doneCount = tasks.filter((task) => task.state === "done").length;
  return Math.floor((doneCount / tasks.length) * 100);
}

function findRecoveryTask(snapshot: StatusSnapshot): string | null {
  const taskIds = Object.keys(snapshot.tasks);
  if (taskIds.length === 0) return null;

  // Prefer the task that appears to be mid-flight by timestamp or stage.
  for (const taskId of taskIds) {
    const task = snapshot.tasks[taskId];
    if (!task || typeof task !== "object") continue;
    if (isTaskLikelyInProgress(task as Record<string, unknown>)) return taskId;
  }

  const pendingFallback = taskIds.find((taskId) => isNonTerminalTaskState(snapshot.tasks[taskId]!.state));
  if (pendingFallback) return pendingFallback;

  // Then, for partially completed pipelines, reset the first task after the final
  // terminal task; this repairs jobs that lost task state updates mid-run.
  const terminalIndex = taskIds.reduce<number>((current, taskId, index) => {
    const state = snapshot.tasks[taskId]!.state;
    return isTerminalTaskState(state) ? index : current;
  }, -1);

  if (terminalIndex < 0) return null;
  return taskIds.slice(terminalIndex + 1).find((taskId) => {
    const state = snapshot.tasks[taskId]!.state;
    return !isTerminalTaskState(state);
  }) ?? null;
}

async function killProcess(pid: number): Promise<{ killed: boolean; signal: string | null; exited: boolean }> {
  try {
    process.kill(pid, 15); // SIGTERM
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      return { killed: false, signal: null, exited: true };
    }
    throw err;
  }

  // Poll for graceful exit within the grace period.
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return { killed: true, signal: "SIGTERM", exited: true };
    await new Promise((r) => setTimeout(r, KILL_POLL_MS));
  }

  // Still alive — escalate to SIGKILL.
  try {
    process.kill(pid, 9);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      return { killed: true, signal: "SIGTERM", exited: true };
    }
    throw err;
  }

  // Brief wait for SIGKILL to take effect.
  await new Promise((r) => setTimeout(r, KILL_POLL_MS));
  return { killed: true, signal: "SIGKILL", exited: !isProcessAlive(pid) };
}

async function cleanupRunnerPid(jobDir: string): Promise<void> {
  try {
    await unlink(path.join(jobDir, "runner.pid"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

const READ_LOCATIONS = ["current", "complete"] as const;

export async function resolveJobLifecycle(
  dataDir: string,
  jobId: string,
): Promise<"current" | "complete" | null> {
  for (const location of READ_LOCATIONS) {
    const statusPath = path.join(dataDir, "pipeline-data", location, jobId, "tasks-status.json");
    const result = await readFileWithRetry(statusPath);
    if (!result.ok) {
      if (result.code === Constants.ERROR_CODES.NOT_FOUND) continue;
      return null;
    }
    return location;
  }

  return null;
}

export function isRestartInProgress(jobId: string): boolean {
  return restartingJobs.has(jobId);
}

export function beginRestart(jobId: string): boolean {
  return begin(restartingJobs, jobId);
}

export function endRestart(jobId: string): void {
  end(restartingJobs, jobId);
}

export function isStopInProgress(jobId: string): boolean {
  return stoppingJobs.has(jobId);
}

export function beginStop(jobId: string): boolean {
  return begin(stoppingJobs, jobId);
}

export function endStop(jobId: string): void {
  end(stoppingJobs, jobId);
}

export function isStartInProgress(jobId: string): boolean {
  return startingJobs.has(jobId);
}

export function beginStart(jobId: string): boolean {
  return begin(startingJobs, jobId);
}

export function endStart(jobId: string): void {
  end(startingJobs, jobId);
}

export async function handleJobRestart(
  req: Request,
  jobId: string,
  dataDir: string,
): Promise<Response> {
  if (!beginRestart(jobId)) {
    return sendJson(409, createErrorResponse(Constants.ERROR_CODES.BAD_REQUEST, "restart already in progress"));
  }

  try {
    // Parse optional request body
    let fromTask: string | undefined;
    let singleTask: boolean | undefined;
    let continueAfter: boolean | undefined;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      fromTask = typeof body["fromTask"] === "string" ? body["fromTask"] : undefined;
      singleTask = typeof body["singleTask"] === "boolean" ? body["singleTask"] : undefined;
      continueAfter = typeof body["continueAfter"] === "boolean" ? body["continueAfter"] : undefined;
    } catch {
      // No body or invalid JSON — default to clean-slate restart
    }

    // Locate the job
    const lifecycle = await resolveJobLifecycle(dataDir, jobId);
    if (!lifecycle) {
      return sendJson(404, createErrorResponse(Constants.ERROR_CODES.JOB_NOT_FOUND, `job "${jobId}" was not found`));
    }

    let jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle as "current" | "complete");

    // Check if the job is actually running via PID liveness, then task-derived status
    const pid = await readRunnerPid(jobDir);
    if (pid !== null && isProcessAlive(pid)) {
      return sendJson(409, createErrorResponse("job_running", "Job is currently running (process alive)"));
    }

    const status = await readJobStatus(jobDir);
    if (status) {
      const taskEntries = Object.values(status.tasks).filter((t): t is typeof t & { state: unknown } => "state" in t);
      const derivedStatus = deriveJobStatusFromTasks(taskEntries);
      if (derivedStatus === "running") {
        return sendJson(409, createErrorResponse("job_running", "Job is currently running (task-level running)"));
      }
    }

    // If the job is in complete/, move it back to current/
    if (lifecycle === "complete") {
      const currentJobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await mkdir(path.dirname(currentJobDir), { recursive: true });
      await rename(jobDir, currentJobDir);
      jobDir = currentJobDir;
    }

    // Reset job status
    let mode: string;
    if (singleTask && fromTask) {
      await resetSingleTask(jobDir, fromTask);
      mode = continueAfter ? "single-task-continue" : "single-task";
    } else {
      await resetJobToCleanSlate(jobDir);
      mode = "clean-slate";
    }

    // Build environment for the pipeline runner
    const env: Record<string, string | undefined> = {
      ...process.env as Record<string, string>,
      PO_ROOT: dataDir,
    };
    if (fromTask) {
      env["PO_START_FROM_TASK"] = fromTask;
    }
    if (singleTask && !continueAfter) {
      env["PO_RUN_SINGLE_TASK"] = "true";
    }

    // Spawn the pipeline runner as a detached process
    await spawnDetached(["bun", "run", RUNNER_PATH, jobId], env);

    return sendJson(202, { ok: true, jobId, mode, spawned: true });
  } finally {
    endRestart(jobId);
  }
}

export async function handleJobStop(
  _req: Request,
  jobId: string,
  dataDir: string,
): Promise<Response> {
  if (!beginStop(jobId)) {
    return sendJson(409, createErrorResponse(Constants.ERROR_CODES.BAD_REQUEST, "stop already in progress"));
  }

  try {
    const lifecycle = await resolveJobLifecycle(dataDir, jobId);
    if (!lifecycle) {
      return sendJson(404, createErrorResponse(Constants.ERROR_CODES.JOB_NOT_FOUND, `job "${jobId}" was not found`));
    }

    const jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle as "current" | "complete");

    // Kill the runner process via PID file
    let pidFound = false;
    let usedSignal: string | null = null;

    const pid = await readRunnerPid(jobDir);
    if (pid !== null) {
      pidFound = true;
      try {
        const result = await killProcess(pid);
        usedSignal = result.signal;
      } catch (err) {
        console.error(`[handleJobStop] Error killing pid ${pid} for job ${jobId}:`, err);
      }
      await cleanupRunnerPid(jobDir);
    }

    let resetTask: string | null = null;

    // Reset running task and clear root-level fields in a single atomic write.
    await writeJobStatus(jobDir, (snapshot) => {
      if (snapshot.current && snapshot.tasks[snapshot.current]?.state === "running") {
        resetTask = snapshot.current;
      } else {
        for (const taskId of Object.keys(snapshot.tasks)) {
          if (snapshot.tasks[taskId]!.state === "running") {
            resetTask = taskId;
            break;
          }
        }
      }

      if (!resetTask) {
        resetTask = findRecoveryTask(snapshot);
      }

      if (resetTask) {
        const task = snapshot.tasks[resetTask];
        if (task) {
          task.state = "pending";
          task.currentStage = null;
          delete task.endedAt;
          delete task.startedAt;
          delete task.failedStage;
          delete task.error;
          task.attempts = 0;
          task.refinementAttempts = 0;
          task.tokenUsage = [];
        }
      } else if (snapshot.current === null && snapshot.state === "pending" && Object.keys(snapshot.tasks).length > 0) {
        const taskIds = Object.keys(snapshot.tasks);
        snapshot.current = taskIds[0] ?? null;
      }

      snapshot.state = "pending";
      snapshot.current = resetTask ?? null;
      snapshot.currentStage = null;
      snapshot.progress = getProgressPercent(snapshot);
    });

    return sendJson(202, {
      ok: true,
      jobId,
      stopped: pidFound,
      resetTask,
      signal: usedSignal,
    });
  } finally {
    endStop(jobId);
  }
}

export async function handleJobRescan(
  _req: Request,
  jobId: string,
  dataDir: string,
): Promise<Response> {
  const lifecycle = await resolveJobLifecycle(dataDir, jobId);
  if (!lifecycle) {
    return sendJson(404, createErrorResponse(Constants.ERROR_CODES.JOB_NOT_FOUND, `job "${jobId}" was not found`));
  }
  return sendJson(202, { ok: true, jobId, action: "rescan", lifecycle });
}

export async function handleTaskStart(
  _req: Request,
  jobId: string,
  taskId: string,
  dataDir: string,
): Promise<Response> {
  if (!beginStart(jobId)) {
    return sendJson(409, createErrorResponse(Constants.ERROR_CODES.BAD_REQUEST, "task start already in progress"));
  }

  try {
    const lifecycle = await resolveJobLifecycle(dataDir, jobId);
    if (!lifecycle) {
      return sendJson(404, createErrorResponse(Constants.ERROR_CODES.JOB_NOT_FOUND, `job "${jobId}" was not found`));
    }

    await mkdir(path.join(dataDir, "pipeline-data"), { recursive: true });
    await spawnDetached(["bun", "-e", "process.exit(0)"]);
    return sendJson(202, { ok: true, jobId, taskId, action: "start", lifecycle });
  } finally {
    endStart(jobId);
  }
}
