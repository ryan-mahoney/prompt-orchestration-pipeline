import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { createErrorResponse } from "../config-bridge";
import { Constants } from "../config-bridge-node";
import { readJob } from "../job-reader";
import { sendJson } from "../utils/http-utils";
import { getJobDirectoryPath } from "../../../config/paths";
import { readJobStatus, resetJobToCleanSlate, resetSingleTask, writeJobStatus } from "../../../core/status-writer";

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

async function killProcess(pid: number): Promise<{ killed: boolean; signal: string | null }> {
  try {
    process.kill(pid, 15); // SIGTERM
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      return { killed: false, signal: null };
    }
    throw err;
  }

  // Do not hold the HTTP request open while waiting for shutdown.
  const timer = setTimeout(() => {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    try {
      process.kill(pid, 9); // SIGKILL
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        console.error(`[handleJobStop] Failed to SIGKILL pid ${pid}:`, err);
      }
    }
  }, 1500);
  timer.unref();

  return { killed: true, signal: "SIGTERM" };
}

async function cleanupRunnerPid(jobDir: string): Promise<void> {
  try {
    await unlink(path.join(jobDir, "runner.pid"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function resolveJobLifecycle(dataDir: string, jobId: string): Promise<string | null> {
  const result = await readJob(jobId);
  if (!result.ok) return null;
  return result.location;
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

    // Read status to check if the job is currently running
    const status = await readJobStatus(jobDir);
    if (status?.state === "running") {
      return sendJson(409, createErrorResponse("job_running", "Job is currently running"));
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

      if (resetTask) {
        const task = snapshot.tasks[resetTask];
        if (task) {
          task.state = "pending";
          task.currentStage = null;
          delete task.failedStage;
          delete task.error;
          task.attempts = 0;
          task.refinementAttempts = 0;
          task.tokenUsage = [];
        }
      }

      snapshot.current = null;
      snapshot.currentStage = null;
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
