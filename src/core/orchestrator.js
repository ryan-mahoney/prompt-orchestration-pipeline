// ESM Orchestrator - clean, test-friendly, no JSX or ellipses
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import { spawn as defaultSpawn } from "node:child_process";
import { getConfig, getPipelineConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createTaskFileIO, generateLogName } from "./file-io.js";
import { LogEvent } from "../config/log-events.js";

/**
 * Resolve canonical pipeline directories for the given data root.
 * @param {string} dataDir
 */
function resolveDirs(dataDir) {
  // Normalize incoming dataDir: callers may pass either the project root,
  // the pipeline-data root, or even pipeline-data/pending by mistake.
  // Detect if 'pipeline-data' is present in the provided path and normalize
  // to the canonical pipeline-data root to avoid duplicated segments.
  const normalized = path.normalize(String(dataDir || ""));
  const parts = normalized.split(path.sep).filter(Boolean);
  const idx = parts.lastIndexOf("pipeline-data");
  let root;
  if (idx !== -1) {
    // Preserve original root (drive letter on Windows, '/' on POSIX, or '' for relative)
    const originalRoot = path.parse(normalized).root; // '' | '/' | 'C:\\'
    if (originalRoot) {
      // Prepend original root to preserve absolute / drive-letter semantics
      root = path.join(originalRoot, ...parts.slice(0, idx + 1));
    } else {
      // Relative input -> keep relative result
      root = path.join(...parts.slice(0, idx + 1));
    }
  } else {
    root = path.join(dataDir, "pipeline-data");
  }

  const pending = path.join(root, "pending");
  const current = path.join(root, "current");
  const complete = path.join(root, "complete");
  return { dataDir: root, pending, current, complete };
}

/**
 * Ensure directory exists (mkdir -p).
 */
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Move a file atomically by writing through a tmp file, then rename.
 * If src is on same FS, a regular rename is enough. We keep it simple for tests.
 */
async function moveFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(src, dest);
}

/**
 * Start the orchestrator.
 * - Ensures pipeline dirs
 * - Watches pending/*.json seeds
 * - On add: move to current/{jobId}/seed.json and spawn runner
 *
 * @param {{ dataDir: string, spawn?: typeof defaultSpawn, watcherFactory?: Function, testMode?: boolean }} opts
 * @returns {Promise<{ stop: () => Promise<void> }>}
 */
export async function startOrchestrator(opts) {
  const dataDir = opts?.dataDir;
  if (!dataDir) throw new Error("startOrchestrator: dataDir is required");
  const spawn = opts?.spawn ?? defaultSpawn;
  const watcherFactory = opts?.watcherFactory ?? chokidar.watch;
  const testMode = !!opts?.testMode;

  const logger = createLogger("Orchestrator");

  const dirs = resolveDirs(dataDir);
  await ensureDir(dirs.pending);
  await ensureDir(dirs.current);
  await ensureDir(dirs.complete);

  /** @type {Map<string, import('node:child_process').ChildProcess>} */
  const running = new Map();

  // Guard: if job already running or already in current/, do nothing
  function isJobActive(name) {
    return running.has(name);
  }

  function currentSeedPath(name) {
    return path.join(dirs.current, name, "seed.json");
  }

  async function handleSeedAdd(filePath) {
    if (!filePath || !filePath.endsWith(".json")) return;

    // Extract jobId from filename pattern: ^([A-Za-z0-9-_]+)-seed\.json$
    const base = path.basename(filePath);
    const match = base.match(/^([A-Za-z0-9-_]+)-seed\.json$/);
    if (!match) {
      logger.warn("Rejecting non-id seed file:", { filename: base });
      return;
    }
    const jobId = match[1];

    let seed;
    try {
      const text = await fs.readFile(filePath, "utf8");
      seed = JSON.parse(text);
    } catch {
      // If not valid JSON, ignore and leave file for later/manual cleanup
      return;
    }

    // If already running or already moved to current, skip (idempotent)
    if (isJobActive(jobId)) return;
    const dest = currentSeedPath(jobId);
    try {
      await fs.access(dest);
      // Already picked up
      return;
    } catch {}

    // Move seed to current/{jobId}/seed.json
    try {
      await moveFile(filePath, dest);
    } catch (error) {
      logger.error("Failed to move file", {
        from: filePath,
        to: dest,
        error: error.message,
      });
      throw error; // Re-throw to see the actual error
    }

    // Ensure tasks directory and status file exist in work dir
    const workDir = path.dirname(dest);
    const tasksDir = path.join(workDir, "tasks");
    await fs.mkdir(tasksDir, { recursive: true });

    const statusPath = path.join(workDir, "tasks-status.json");
    try {
      await fs.access(statusPath);
    } catch {
      const status = {
        id: jobId,
        name: seed?.name ?? jobId,
        pipeline: seed?.pipeline, // Include pipeline slug from seed
        createdAt: new Date().toISOString(),
        state: "pending",
        tasks: {}, // Initialize empty tasks object for pipeline runner
      };
      await fs.writeFile(statusPath, JSON.stringify(status, null, 2));

      // Initialize status from artifacts if any exist
      try {
        const { initializeStatusFromArtifacts } = await import(
          "./status-initializer.js"
        );
        const pipelineConfig = getPipelineConfig(seed?.pipeline || "default");
        const pipelineSnapshot = JSON.parse(
          await fs.readFile(pipelineConfig.pipelineJsonPath, "utf8")
        );

        const applyArtifacts = await initializeStatusFromArtifacts({
          jobDir: workDir,
          pipeline: pipelineSnapshot,
        });

        // Apply artifact initialization to the status
        const updatedStatus = applyArtifacts(status);
        await fs.writeFile(statusPath, JSON.stringify(updatedStatus, null, 2));
      } catch (artifactError) {
        // Don't fail job startup if artifact initialization fails, just log
        logger.warn("Failed to initialize status from artifacts", {
          jobId,
          error: artifactError.message,
        });
      }
    }
    // Create fileIO for orchestrator-level logging
    const fileIO = createTaskFileIO({
      workDir,
      taskName: jobId,
      getStage: () => "orchestrator",
      statusPath,
      trackTaskFiles: false,
    });

    // Write job start log
    await fileIO.writeLog(
      generateLogName(jobId, "orchestrator", LogEvent.START),
      JSON.stringify(
        {
          jobId,
          pipeline: seed?.pipeline,
          timestamp: new Date().toISOString(),
          seedSummary: {
            name: seed?.name,
            pipeline: seed?.pipeline,
            keys: Object.keys(seed || {}),
          },
        },
        null,
        2
      ),
      { mode: "replace" }
    );

    // Spawn runner for this job
    const child = spawnRunner(
      logger,
      jobId,
      dirs,
      running,
      spawn,
      testMode,
      seed,
      fileIO
    );
    // child registered inside spawnRunner
    return child;
  }

  // Watch pending directory for seeds
  const watchPattern = path.join(dirs.pending, "*.json");
  const watcher = watcherFactory(watchPattern, {
    ignoreInitial: false,
    awaitWriteFinish: false, // Disable awaitWriteFinish for faster detection
    depth: 0,
  });

  // Wait for watcher to be ready before resolving
  await new Promise((resolve, reject) => {
    watcher.on("ready", () => {
      resolve();
    });

    watcher.on("error", (error) => {
      logger.error("Watcher error", error);
      reject(error);
    });
  });

  watcher.on("add", (file) => {
    // Return promise so tests awaiting the add handler block until processing completes
    // Catch rejections to prevent unhandled promise rejection crashes
    return handleSeedAdd(file).catch((error) => {
      logger.error("Failed to handle seed file", {
        file,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  });

  async function stop() {
    try {
      await watcher.close();
    } catch {}

    // Try graceful shutdown for children
    const kills = [];
    for (const [name, child] of running.entries()) {
      try {
        if (!child.killed) {
          child.kill("SIGTERM");
          // Give tests a chance to simulate exit; then force kill
          setTimeout(() => {
            try {
              !child.killed && child.kill("SIGKILL");
            } catch {}
          }, 500);
        }
      } catch {}
      kills.push(Promise.resolve());
    }
    await Promise.all(kills);
    running.clear();
  }

  return { stop };
}

/**
 * @typedef {Object} TaskFileIO
 * @property {(name: string, content: string, options?: { mode?: 'append'|'replace' }) => Promise<string>} writeLog
 * @property {(name: string, content: string, options?: { mode?: 'append'|'replace' }) => string} writeLogSync
 */

/**
 * Spawn a pipeline runner. In testMode we still call spawn() so tests can assert,
 * but we resolve immediately and let tests drive the lifecycle (emit 'exit', etc.).
 *
 * @param {Object} logger - Logger instance for orchestrator logging
 * @param {string} jobId
 * @param {{dataDir:string,pending:string,current:string,complete:string}} dirs
 * @param {Map<string, import('node:child_process').ChildProcess>} running
 * @param {typeof defaultSpawn} spawn
 * @param {boolean} testMode
 * @param {Object} seed - Seed data containing pipeline information
 * @param {TaskFileIO} fileIO - Task-scoped file I/O interface for writing logs
 */
function spawnRunner(
  logger,
  jobId,
  dirs,
  running,
  spawn,
  testMode,
  seed,
  fileIO
) {
  // Use path relative to this file to avoid process.cwd() issues
  const orchestratorDir = path.dirname(new URL(import.meta.url).pathname);
  const runnerPath = path.join(orchestratorDir, "pipeline-runner.js");

  // Set PO_ROOT for the orchestrator process to match what the runner will use
  const originalPoRoot = process.env.PO_ROOT;
  const poRoot = path.resolve(dirs.dataDir, "..");
  process.env.PO_ROOT = poRoot;

  try {
    const configSnapshot = getConfig();
    const availablePipelines = Object.keys(configSnapshot?.pipelines ?? {});
    const pipelineSlug = seed?.pipeline;

    if (!availablePipelines.length) {
      logger.warn(
        "No pipelines registered in config() when spawnRunner invoked"
      );
    } else if (!availablePipelines.includes(pipelineSlug)) {
      logger.warn("Requested pipeline slug missing from registry snapshot", {
        jobId,
        pipelineSlug,
        availablePipelines,
      });
    }

    if (!pipelineSlug) {
      logger.error("Missing pipeline slug in seed", {
        jobId,
        seed,
        availablePipelines,
      });
      throw new Error(
        "Pipeline slug is required in seed data. Include a 'pipeline' field in your seed."
      );
    }

    let pipelineConfig;
    try {
      pipelineConfig = getPipelineConfig(pipelineSlug);
    } catch (error) {
      logger.error("Pipeline lookup failed", {
        jobId,
        pipelineSlug,
        availablePipelines,
      });
      throw error;
    }

    // Use environment variables with explicit slug propagation
    // PO_ROOT should point to the directory containing pipeline-config
    // In our case, it's the parent of pipeline-data directory
    const env = {
      ...process.env,
      PO_ROOT: poRoot,
      PO_DATA_DIR: dirs.dataDir,
      PO_PENDING_DIR: dirs.pending,
      PO_CURRENT_DIR: dirs.current,
      PO_COMPLETE_DIR: dirs.complete,
      PO_PIPELINE_SLUG: pipelineSlug,
      // Force mock provider for testing
      PO_DEFAULT_PROVIDER: "mock",
    };

    // Always call spawn so tests can capture it
    const child = spawn(process.execPath, [runnerPath, jobId], {
      stdio: ["ignore", "inherit", "inherit"],
      env,
      cwd: process.cwd(),
    });

    running.set(jobId, child);

    child.on("exit", (code, signal) => {
      running.delete(jobId);
      // Note: We intentionally don't write completion logs here because
      // the pipeline-runner moves the job directory from current/ to complete/
      // before exiting. Writing here would create a ghost directory under current/
      // due to the race condition between fs.rename() and this exit handler.
      // The pipeline-runner already writes its own execution logs and runs.jsonl.
      logger.log("Pipeline runner exited", {
        jobId,
        exitCode: code,
        signal: signal,
        completionType: code === 0 ? "success" : "failure",
      });
    });

    child.on("error", (error) => {
      running.delete(jobId);
      // Log spawn errors but don't write to filesystem to avoid race conditions
      logger.error("Pipeline runner spawn error", {
        jobId,
        error: {
          message: error.message,
          name: error.name,
          code: error.code,
        },
      });
    });

    // In test mode: return immediately; in real mode you might await readiness
    if (testMode) {
      return child;
    }

    // Non-test: we can consider "started" immediately for simplicity
    return child;
  } finally {
    // Restore original PO_ROOT
    if (originalPoRoot) {
      process.env.PO_ROOT = originalPoRoot;
    } else {
      delete process.env.PO_ROOT;
    }
  }
}

export default { startOrchestrator };
