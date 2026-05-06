/** Options for starting the orchestrator. */
export interface OrchestratorOptions {
  /** Root directory for pipeline data. Normalized to canonical pipeline-data/ root. */
  dataDir: string;
  /** Injection point for process spawner. Defaults to Bun.spawn. */
  spawn?: SpawnFn;
  /** Injection point for filesystem watcher factory. Defaults to chokidar.watch. */
  watcherFactory?: WatcherFactory;
}

/** Handle returned by startOrchestrator for lifecycle control. */
export interface OrchestratorHandle {
  stop: () => Promise<void>;
}

/** Resolved canonical directory paths for the pipeline data lifecycle. */
interface ResolvedDirs {
  dataDir: string;
  pending: string;
  current: string;
  complete: string;
  rejected: string;
}

/** Parsed seed file content (fields consumed by orchestrator). */
interface SeedData {
  name?: string;
  pipeline: string;
  [key: string]: unknown;
}

/** Initial job status written to tasks-status.json. */
interface JobStatusInit {
  id: string;
  name: string;
  pipeline: string;
  createdAt: string;
  state: "pending";
  tasks: Record<string, { state: "pending" }>;
}

/** Structured start log entry. */
interface StartLogEntry {
  jobId: string;
  pipeline: string;
  timestamp: string;
  seedSummary: {
    name: string;
    pipeline: string;
    keys: string[];
  };
}

/** Minimal watcher interface matching chokidar's used surface. */
interface Watcher {
  on(event: "add", cb: (path: string) => void): Watcher;
  on(event: "ready", cb: () => void): Watcher;
  on(event: "error", cb: (err: Error) => void): Watcher;
  close(): Promise<void>;
}

/** Factory function that creates a filesystem watcher. */
type WatcherFactory = (path: string, options: Record<string, unknown>) => Watcher;

/**
 * Spawn function signature matching Bun.spawn's used surface.
 * Throws synchronously on spawn failure (e.g. binary not found, permission denied).
 * Callers must catch spawn errors distinctly from child exit failures.
 */
type SpawnFn = (cmd: string[], options: {
  env: Record<string, string>;
  stdin: "ignore";
  stdout: "inherit";
  stderr: "inherit";
}) => ChildHandle;

/** Result of a child process exit, capturing all diagnostic fields. */
interface ChildExitResult {
  /** Exit code, or null if terminated by signal. */
  code: number | null;
  /** Signal name (e.g. "SIGTERM"), or null if exited normally. */
  signal: string | null;
  /** Completion classification: "success" (code 0), "failure" (non-zero code), or "signal" (killed). */
  completionType: "success" | "failure" | "signal";
}

/** Minimal child process handle for tracking. */
interface ChildHandle {
  readonly pid: number;
  /** Resolves with structured exit details when the process terminates. */
  readonly exited: Promise<ChildExitResult>;
  kill(signal?: number): void;
}

interface SpawnedRunner {
  pid: number;
  kill?: () => void;
}

/** Seed filename regex. Captures jobId from {jobId}-seed.json. */
export const SEED_PATTERN = /^([A-Za-z0-9-_]+)-seed\.json$/;

import { join, basename, dirname, resolve } from "node:path";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { watch } from "chokidar";
import { createLogger } from "./logger";
import { createTaskFileIO, generateLogName } from "./file-io";
import { LogEvent, LogFileExtension } from "../config/log-events";
import { getConfig, getOrchestratorConfig, getPipelineConfig } from "./config";
import { buildReexecArgs } from "../cli/self-reexec";
import { writeJobStatus } from "./status-writer";
import { initializeStatusFromArtifacts } from "./status-initializer";
import {
  listQueuedSeeds,
  releaseJobSlot,
  tryAcquireJobSlot,
  updateJobSlotPid,
} from "./job-concurrency";

/**
 * Normalize any path that may already include `pipeline-data` (or subdirs
 * beneath it) to the canonical pipeline-data root, then return the four
 * canonical directory paths used throughout the orchestrator.
 */
export function resolveDirs(dataDir: string): ResolvedDirs {
  const absDataDir = resolve(dataDir);
  const parts = absDataDir.split("/");
  const idx = parts.lastIndexOf("pipeline-data");

  const root =
    idx !== -1
      ? parts.slice(0, idx + 1).join("/") || "/"
      : join(absDataDir, "pipeline-data");

  return {
    dataDir: root,
    pending: join(root, "pending"),
    current: join(root, "current"),
    complete: join(root, "complete"),
    rejected: join(root, "rejected"),
  };
}

export function createDefaultSpawn(): SpawnFn {
  return (cmd, options) => {
    const proc = Bun.spawn(cmd, {
      env: options.env,
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
    });

    const exited: Promise<ChildExitResult> = proc.exited.then(() => {
      const code = proc.exitCode;
      const signal = proc.signalCode ?? null;
      let completionType: ChildExitResult["completionType"];
      if (signal !== null) {
        completionType = "signal";
      } else if (code === 0) {
        completionType = "success";
      } else {
        completionType = "failure";
      }
      return { code, signal, completionType };
    });

    return {
      pid: proc.pid,
      exited,
      kill: (sig) => proc.kill(sig),
    };
  };
}

export async function spawnRunner(
  jobId: string,
  seed: SeedData,
  dirs: ResolvedDirs,
  running: Map<string, ChildHandle>,
  logger: ReturnType<typeof createLogger>,
  spawnFn: SpawnFn,
  onExit?: (jobId: string) => void | Promise<void>,
): Promise<void> {
  if (!seed.pipeline) {
    throw new Error(`seed.pipeline is required for job ${jobId}`);
  }

  const poRoot = dirname(dirs.dataDir);
  getPipelineConfig(seed.pipeline, poRoot);

  const parentEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );

  const env: Record<string, string> = {
    ...parentEnv,
    PO_ROOT: poRoot,
    PO_DATA_DIR: dirs.dataDir,
    PO_PENDING_DIR: dirs.pending,
    PO_CURRENT_DIR: dirs.current,
    PO_COMPLETE_DIR: dirs.complete,
    PO_PIPELINE_SLUG: seed.pipeline,
    PO_DEFAULT_PROVIDER: getConfig().llm.defaultProvider,
  };

  const reexec = buildReexecArgs(["_run-job", jobId]);
  const cmd = [reexec.execPath, ...reexec.args];

  let child: ChildHandle;
  try {
    child = spawnFn(cmd, {
      env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (err) {
    logger.error(`spawn error for job ${jobId}`, err);
    return;
  }

  running.set(jobId, child);

  void child.exited
    .then(async (result) => {
      running.delete(jobId);
      logger.log(`job ${jobId} exited`, {
        code: result.code,
        signal: result.signal,
        completionType: result.completionType,
      });
      if (!onExit) return;
      try {
        await onExit(jobId);
      } catch (err) {
        logger.error(`child exit cleanup failed for job ${jobId}`, err);
      }
    })
    .catch((err) => {
      logger.error(`failed while waiting for job ${jobId} exit`, err);
    });
}

export interface HandleChildExitOptions {
  dataDir: string;
  jobId: string;
  triggerDrain: () => void;
  lockTimeoutMs?: number;
}

export async function handleChildExit(opts: HandleChildExitOptions): Promise<void> {
  try {
    await releaseJobSlot(opts.dataDir, opts.jobId, opts.lockTimeoutMs);
  } finally {
    opts.triggerDrain();
  }
}

async function scaffoldJobDir(
  jobId: string,
  seed: SeedData,
  dirs: ResolvedDirs,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const jobDir = join(dirs.current, jobId);
  await mkdir(join(jobDir, "tasks"), { recursive: true });

  let pipelineTasks: string[] = [];
  try {
    const pipelineCfg = getPipelineConfig(seed.pipeline);
    const pipelineJson = JSON.parse(await Bun.file(pipelineCfg.pipelineJsonPath).text()) as Record<string, unknown>;
    if (Array.isArray(pipelineJson["tasks"])) {
      pipelineTasks = (pipelineJson["tasks"] as unknown[]).map((t) =>
        typeof t === "string" ? t : (t as Record<string, string>)["name"] ?? ""
      ).filter(Boolean);
    }
  } catch {
    logger.warn(`could not read pipeline config for ${seed.pipeline}; tasks will start empty`);
  }

  const status: JobStatusInit = {
    id: jobId,
    name: seed.name ?? jobId,
    pipeline: seed.pipeline,
    createdAt: new Date().toISOString(),
    state: "pending",
    tasks: Object.fromEntries(pipelineTasks.map((name) => [name, { state: "pending" as const }])),
  };

  await Bun.write(
    join(jobDir, "tasks-status.json"),
    JSON.stringify(status, null, 2)
  );

  const normalizedPipelineTasks = pipelineTasks.map((name) => ({ id: name }));
  try {
    const applyArtifacts = await initializeStatusFromArtifacts({ jobDir, pipeline: { tasks: normalizedPipelineTasks } });
    await writeJobStatus(jobDir, applyArtifacts);
  } catch {
    logger.warn(`status-initializer unavailable or failed for job ${jobId}; proceeding with base status`);
  }

  const fileIO = createTaskFileIO({
    workDir: jobDir,
    taskName: "orchestrator",
    getStage: () => "init",
    statusPath: join(jobDir, "tasks-status.json"),
    trackTaskFiles: false,
  });

  const startLog: StartLogEntry = {
    jobId,
    pipeline: seed.pipeline,
    timestamp: new Date().toISOString(),
    seedSummary: {
      name: seed.name ?? jobId,
      pipeline: seed.pipeline,
      keys: Object.keys(seed),
    },
  };

  const logName = generateLogName("orchestrator", "init", LogEvent.START, LogFileExtension.JSON);
  await fileIO.writeLog(logName, JSON.stringify(startLog, null, 2), { mode: "replace" });
}

export async function handleSeedAdd(
  filePath: string,
  dirs: ResolvedDirs,
  running: Map<string, ChildHandle>,
  logger: ReturnType<typeof createLogger>,
  opts: OrchestratorOptions
): Promise<void> {
  const filename = basename(filePath);
  const match = filename.match(SEED_PATTERN);

  if (!match) {
    logger.warn(`ignoring non-seed file: ${filename}`);
    return;
  }

  const jobId = match[1]!;

  let raw: string;
  try {
    raw = await Bun.file(filePath).text();
  } catch (err) {
    logger.warn(`failed to read ${filename}`, err);
    return;
  }

  let seed: SeedData;
  try {
    seed = JSON.parse(raw) as SeedData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`invalid JSON in ${filename}: ${message}`);
    return;
  }

  if (running.has(jobId)) return;

  const jobDir = join(dirs.current, jobId);
  const seedDest = join(jobDir, "seed.json");
  if (await Bun.file(seedDest).exists()) return;

  await mkdir(jobDir, { recursive: true });
  try {
    await rename(filePath, seedDest);
  } catch (err) {
    logger.error(`failed to move seed file for job ${jobId}`, err);
    throw err;
  }
  await scaffoldJobDir(jobId, seed, dirs, logger);

  const spawnFn = opts.spawn ?? createDefaultSpawn();
  try {
    await spawnRunner(jobId, seed, dirs, running, logger, spawnFn);
  } catch (err) {
    logger.error(`failed to spawn runner for job ${jobId}`, err);
  }
}

export async function stopChildren(
  running: Map<string, ChildHandle>,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  const entries = [...running.entries()];

  await Promise.all(
    entries.map(async ([jobId, child]) => {
      child.kill(15); // SIGTERM

      const graceful = await Promise.race([
        child.exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);

      if (!graceful) {
        child.kill(9); // SIGKILL

        const killed = await Promise.race([
          child.exited.then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000)),
        ]);

        if (!killed) {
          logger.warn(`child ${jobId} (pid ${child.pid}) did not exit after SIGKILL; treating as abandoned`);
        }
      }
    })
  );

  running.clear();
}

const MAX_PENDING_SEED_FAILURES = 3;
const pendingSeedFailures = new Map<string, { count: number; signature: string }>();

export interface DrainPendingQueueOptions {
  dataDir: string;
  maxConcurrentJobs: number;
  lockTimeoutMs: number;
  spawnRunner: (jobId: string, seed: SeedData) => Promise<SpawnedRunner>;
}

export interface DrainPendingQueueResult {
  promoted: string[];
  remaining: number;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function promoteSeedFile(
  pendingSeedPath: string,
  currentJobDir: string,
): Promise<void> {
  await mkdir(currentJobDir, { recursive: true });
  await rename(pendingSeedPath, join(currentJobDir, "seed.json"));
}

async function restoreSeedFile(currentJobDir: string, pendingSeedPath: string): Promise<void> {
  const currentSeedPath = join(currentJobDir, "seed.json");
  try {
    await rename(currentSeedPath, pendingSeedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await rm(currentJobDir, { recursive: true, force: true });
}

async function rejectSeedFile(
  dataDir: string,
  jobId: string,
  seedPath: string,
  reason: string,
  message: string,
): Promise<void> {
  const rejectedJobDir = join(dataDir, "rejected", jobId);
  await mkdir(rejectedJobDir, { recursive: true });
  try {
    await rename(seedPath, join(rejectedJobDir, "seed.json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await writeFile(
    join(rejectedJobDir, "rejection.json"),
    JSON.stringify({
      jobId,
      reason,
      message,
      rejectedAt: new Date().toISOString(),
    }),
  );
  pendingSeedFailures.delete(jobId);
}

function recordPendingSeedFailure(jobId: string, signature: string): number {
  const current = pendingSeedFailures.get(jobId);
  const count = current && current.signature === signature ? current.count + 1 : 1;
  pendingSeedFailures.set(jobId, { count, signature });
  return count;
}

function clearPendingSeedFailure(jobId: string): void {
  pendingSeedFailures.delete(jobId);
}

async function readPendingSeed(seedPath: string): Promise<
  | { ok: true; seed: SeedData }
  | { ok: false; reason: "missing" | "invalid"; message: string }
> {
  let raw: string;
  try {
    raw = await Bun.file(seedPath).text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: "missing", message };
    return { ok: false, reason: "invalid", message };
  }
  try {
    return { ok: true, seed: JSON.parse(raw) as SeedData };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function drainPendingQueue(
  opts: DrainPendingQueueOptions,
): Promise<DrainPendingQueueResult> {
  const { dataDir, maxConcurrentJobs, lockTimeoutMs, spawnRunner } = opts;
  const logger = createLogger("orchestrator");
  const queued = await listQueuedSeeds(dataDir);
  const promoted: string[] = [];

  for (let i = 0; i < queued.length; i++) {
    const { jobId, seedPath } = queued[i]!;

    const parsedSeed = await readPendingSeed(seedPath);
    if (!parsedSeed.ok) {
      logger.warn(`failed to read queued seed ${jobId}-seed.json (${parsedSeed.reason}): ${parsedSeed.message}`);
      const failures = recordPendingSeedFailure(jobId, `${parsedSeed.reason}:${queued[i]!.queuedAt}:${parsedSeed.message}`);
      if (failures >= MAX_PENDING_SEED_FAILURES) {
        try {
          await rejectSeedFile(dataDir, jobId, seedPath, parsedSeed.reason, parsedSeed.message);
          logger.warn(`rejected queued seed ${jobId}-seed.json after ${failures} failed reads`);
        } catch (rejectErr) {
          logger.error(`failed to reject queued seed ${jobId}-seed.json`, rejectErr);
        }
      }
      continue;
    }

    const acquired = await tryAcquireJobSlot({
      dataDir,
      jobId,
      maxConcurrentJobs,
      source: "orchestrator",
      lockTimeoutMs,
    });
    if (!acquired.ok) {
      if (acquired.reason === "limit_reached") {
        return { promoted, remaining: (await listQueuedSeeds(dataDir)).length };
      }
      logger.warn(`job slot already held for ${jobId}; skipping queued seed`);
      continue;
    }

    const currentJobDir = join(dataDir, "current", jobId);
    if (await dirExists(currentJobDir)) {
      await releaseJobSlot(dataDir, jobId, lockTimeoutMs);
      logger.warn(`current job directory already exists for ${jobId}; skipping promotion`);
      continue;
    }

    try {
      await promoteSeedFile(seedPath, currentJobDir);
    } catch (err) {
      await releaseJobSlot(dataDir, jobId, lockTimeoutMs);
      logger.error(`failed to promote seed file for job ${jobId}`, err);
      continue;
    }

    let spawned: SpawnedRunner;
    try {
      spawned = await spawnRunner(jobId, parsedSeed.seed);
    } catch (err) {
      await releaseJobSlot(dataDir, jobId, lockTimeoutMs);
      try {
        await restoreSeedFile(currentJobDir, seedPath);
      } catch (restoreErr) {
        logger.error(`failed to restore queued seed after spawn failure for job ${jobId}`, restoreErr);
      }
      const message = err instanceof Error ? err.message : String(err);
      const failures = recordPendingSeedFailure(jobId, `spawn:${message}`);
      if (failures >= MAX_PENDING_SEED_FAILURES) {
        try {
          await rejectSeedFile(dataDir, jobId, seedPath, "spawn_failed", message);
          logger.error(`rejected queued seed ${jobId} after ${failures} spawn failures`, err);
        } catch (rejectErr) {
          logger.error(`failed to reject queued seed after spawn failures for job ${jobId}`, rejectErr);
        }
      }
      logger.error(`failed to spawn queued job ${jobId}`, err);
      continue;
    }

    try {
      await updateJobSlotPid(dataDir, jobId, spawned.pid, lockTimeoutMs);
    } catch (err) {
      logger.error(`failed to record runner pid for job ${jobId}`, err);
      spawned.kill?.();
      try {
        await releaseJobSlot(dataDir, jobId, lockTimeoutMs);
      } catch (releaseErr) {
        logger.error(`failed to release slot after pid update failure for job ${jobId}`, releaseErr);
      }
      try {
        await restoreSeedFile(currentJobDir, seedPath);
      } catch (restoreErr) {
        logger.error(`failed to restore queued seed after pid update failure for job ${jobId}`, restoreErr);
      }
      const message = err instanceof Error ? err.message : String(err);
      const failures = recordPendingSeedFailure(jobId, `pid:${message}`);
      if (failures >= MAX_PENDING_SEED_FAILURES) {
        try {
          await rejectSeedFile(dataDir, jobId, seedPath, "pid_update_failed", message);
        } catch (rejectErr) {
          logger.error(`failed to reject queued seed after pid update failures for job ${jobId}`, rejectErr);
        }
      }
      continue;
    }
    clearPendingSeedFailure(jobId);
    promoted.push(jobId);
  }

  return { promoted, remaining: (await listQueuedSeeds(dataDir)).length };
}

export function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  if (!opts.dataDir) throw new Error("dataDir is required");

  const dirs = resolveDirs(opts.dataDir);
  const factory = opts.watcherFactory ?? ((path, options) => watch(path, options) as unknown as Watcher);
  const logger = createLogger("orchestrator");
  const orchestratorConfig = getOrchestratorConfig();
  const maxConcurrentJobs = orchestratorConfig.maxConcurrentJobs;
  const lockTimeoutMs = orchestratorConfig.lockFileTimeout;

  return mkdir(dirs.pending, { recursive: true })
    .then(() => mkdir(dirs.current, { recursive: true }))
    .then(() => mkdir(dirs.complete, { recursive: true }))
    .then(() => mkdir(dirs.rejected, { recursive: true }))
    .then(() => new Promise<OrchestratorHandle>((resolve, reject) => {
      const running = new Map<string, ChildHandle>();
      const spawnFn = opts.spawn ?? createDefaultSpawn();

      let isDraining = false;
      let pendingDrain = false;
      let stopped = false;
      let activeDrain: Promise<void> | null = null;
      const triggerDrain = (): void => {
        if (stopped) return;
        if (isDraining) {
          pendingDrain = true;
          return;
        }
        isDraining = true;
        activeDrain = (async () => {
          try {
            do {
              if (stopped) return;
              pendingDrain = false;
              await drainPendingQueue({
                dataDir: dirs.dataDir,
                maxConcurrentJobs,
                lockTimeoutMs,
                spawnRunner: spawnRunnerForJob,
              });
            } while (pendingDrain);
          } catch (err) {
            logger.error("drainPendingQueue failed", err);
          } finally {
            isDraining = false;
            activeDrain = null;
          }
        })();
      };

      const onChildExit = (jobId: string): Promise<void> => {
        if (stopped) return Promise.resolve();
        return handleChildExit({ dataDir: dirs.dataDir, jobId, triggerDrain, lockTimeoutMs });
      };

      const spawnRunnerForJob = async (jobId: string, seed: SeedData): Promise<SpawnedRunner> => {
        await scaffoldJobDir(jobId, seed, dirs, logger);
        await spawnRunner(jobId, seed, dirs, running, logger, spawnFn, onChildExit);
        const child = running.get(jobId);
        if (!child) throw new Error(`spawnRunner did not register child for ${jobId}`);
        return { pid: child.pid, kill: () => child.kill(15) };
      };

      const watcher = factory(join(dirs.pending, "*.json"), {
        ignoreInitial: false,
        depth: 0,
        awaitWriteFinish: false,
      });

      const stop = async (): Promise<void> => {
        stopped = true;
        await watcher.close();
        if (activeDrain) await activeDrain;
        await stopChildren(running, logger);
      };

      watcher
        .on("add", () => triggerDrain())
        .on("error", reject)
        .on("ready", () => resolve({ stop }));
    }));
}
