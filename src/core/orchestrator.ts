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

/** Seed filename regex. Captures jobId from {jobId}-seed.json. */
export const SEED_PATTERN = /^([A-Za-z0-9-_]+)-seed\.json$/;

import { join, basename, dirname, resolve } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { watch } from "chokidar";
import { createLogger } from "./logger";
import { createTaskFileIO, generateLogName } from "./file-io";
import { LogEvent, LogFileExtension } from "../config/log-events";
import { getConfig, getPipelineConfig } from "./config";
import { buildReexecArgs } from "../cli/self-reexec";
import { writeJobStatus } from "./status-writer";
import { initializeStatusFromArtifacts } from "./status-initializer";

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
  spawnFn: SpawnFn
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

  void child.exited.then((result) => {
    running.delete(jobId);
    logger.log(`job ${jobId} exited`, {
      code: result.code,
      signal: result.signal,
      completionType: result.completionType,
    });
  });
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

export function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  if (!opts.dataDir) throw new Error("dataDir is required");

  const dirs = resolveDirs(opts.dataDir);
  const factory = opts.watcherFactory ?? ((path, options) => watch(path, options) as unknown as Watcher);
  const logger = createLogger("orchestrator");

  return mkdir(dirs.pending, { recursive: true })
    .then(() => mkdir(dirs.current, { recursive: true }))
    .then(() => mkdir(dirs.complete, { recursive: true }))
    .then(() => new Promise<OrchestratorHandle>((resolve, reject) => {
      const running = new Map<string, ChildHandle>();

      const watcher = factory(join(dirs.pending, "*.json"), {
        ignoreInitial: false,
        depth: 0,
        awaitWriteFinish: false,
      });

      const stop = async (): Promise<void> => {
        await watcher.close();
        await stopChildren(running, logger);
      };

      watcher
        .on("add", (filePath) => {
          handleSeedAdd(filePath, dirs, running, logger, opts).catch((err: unknown) => {
            logger.error(`unhandled error processing seed file ${filePath}`, err);
          });
        })
        .on("error", reject)
        .on("ready", () => resolve({ stop }));
    }));
}
