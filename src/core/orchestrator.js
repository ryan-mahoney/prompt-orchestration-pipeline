// ESM
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import chokidar from "chokidar";
import { spawn } from "node:child_process";
import url from "node:url";
import { validateSeed, formatValidationErrors } from "./validation.js";
import { getConfig } from "./config.js";
import { withRetry } from "./retry.js";
import {
  resolvePipelinePaths,
  getPendingSeedPath,
  getCurrentSeedPath,
} from "../config/paths.js";

/**
 * Start the orchestrator to watch for and process pending seed files
 * @param {Object} options
 * @param {string} options.dataDir - Base data directory
 * @param {boolean} [options.autoStart=true] - Whether to start watching immediately
 * @returns {Promise<{ stop: () => Promise<void> }>} Orchestrator instance with stop function
 */
export async function startOrchestrator({ dataDir, autoStart = true }) {
  const paths = resolvePipelinePaths(dataDir);
  const runningProcesses = new Map();
  let watcher = null;

  // Ensure directories exist
  await fs.mkdir(paths.pending, { recursive: true });
  await fs.mkdir(paths.current, { recursive: true });
  await fs.mkdir(paths.complete, { recursive: true });

  // Start existing pipelines in current directory
  const existingJobs = await listCurrentJobs(paths.current);
  for (const jobName of existingJobs) {
    ensureRunner(jobName, paths, runningProcesses);
  }

  if (autoStart) {
    const config = getConfig();
    watcher = chokidar
      .watch(path.join(paths.pending, "*-seed.json"), {
        awaitWriteFinish: {
          stabilityThreshold: config.orchestrator.watchStabilityThreshold,
          pollInterval: config.orchestrator.watchPollInterval,
        },
      })
      .on("add", (seedPath) => onSeedAdded(seedPath, paths, runningProcesses));
  }

  /**
   * Stop the orchestrator and clean up resources
   */
  async function stop() {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }

    // Stop all running processes
    for (const [name, info] of runningProcesses) {
      info.process.kill("SIGTERM");
    }

    // Skip the shutdown timeout in test environment
    if (process.env.NODE_ENV !== "test") {
      const config = getConfig();
      await new Promise((r) =>
        setTimeout(r, config.orchestrator.shutdownTimeout)
      );
    }

    // Force kill any remaining processes
    for (const [name, info] of runningProcesses) {
      if (!info.process.killed) info.process.kill("SIGKILL");
    }

    runningProcesses.clear();
  }

  return { stop };
}

/**
 * Handle a new seed file being added to the pending directory
 * @param {string} seedPath - Path to the seed file
 * @param {Object} paths - Resolved pipeline paths
 * @param {Map} runningProcesses - Map of running processes
 */
async function onSeedAdded(seedPath, paths, runningProcesses) {
  const base = path.basename(seedPath);
  const name = base.replace(/-seed\.json$/, "");
  const workDir = path.join(paths.current, name);
  const lockFile = path.join(paths.current, `${name}.lock`);

  try {
    // Try to acquire lock
    await fs.writeFile(lockFile, process.pid.toString(), { flag: "wx" });
  } catch (err) {
    if (err.code === "EEXIST") return; // Already being processed
    throw err;
  }

  try {
    // Create work directory (fails if already exists)
    try {
      await fs.mkdir(workDir, { recursive: false });
    } catch (err) {
      if (err.code === "EEXIST") return; // Already processed
      throw err;
    }

    // Read and validate seed
    const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));

    const validation = validateSeed(seed);
    if (!validation.valid) {
      const errorMsg = formatValidationErrors(validation.errors);
      console.error(`Invalid seed file ${base}:\n${errorMsg}`);

      // Move invalid seed to rejected directory
      const rejectedDir = path.join(path.dirname(paths.pending), "rejected");
      await fs.mkdir(rejectedDir, { recursive: true });
      const rejectedPath = path.join(rejectedDir, base);
      await fs.rename(seedPath, rejectedPath);
      return;
    }

    const pipelineId = makeId();

    // Write seed.json to current directory
    await atomicWrite(
      path.join(workDir, "seed.json"),
      JSON.stringify(seed, null, 2)
    );

    // Write tasks status
    await atomicWrite(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify(
        {
          pipelineId,
          name,
          current: null,
          createdAt: new Date().toISOString(),
          tasks: {},
        },
        null,
        2
      )
    );

    // Create tasks directory
    await fs.mkdir(path.join(workDir, "tasks"), { recursive: true });

    // Remove the original pending file once current/{name}/seed.json exists
    await fs.unlink(seedPath);
  } finally {
    // Release lock
    try {
      await fs.unlink(lockFile);
    } catch {}
  }

  // Start runner after all file operations are complete
  ensureRunner(name, paths, runningProcesses);
}

/**
 * Ensure a pipeline runner is running for the given job name
 * @param {string} name - Job name
 * @param {Object} paths - Resolved pipeline paths
 * @param {Map} runningProcesses - Map of running processes
 */
function ensureRunner(name, paths, runningProcesses) {
  if (runningProcesses.has(name)) return;

  const config = getConfig();

  // Wrap process spawn in retry logic (fire-and-forget)
  withRetry(() => spawnRunner(name, paths, runningProcesses), {
    maxAttempts: config.orchestrator.processSpawnRetries,
    initialDelay: config.orchestrator.processSpawnRetryDelay,
    onRetry: ({ attempt, delay, error }) => {
      console.warn(
        `Failed to start pipeline ${name} (attempt ${attempt}): ${error.message}. Retrying in ${delay}ms...`
      );
    },
    shouldRetry: (error) => {
      // Don't retry if the error is due to missing files or invalid config
      const nonRetryableCodes = ["ENOENT", "EACCES", "MODULE_NOT_FOUND"];
      const nonRetryableMessages = ["Invalid pipeline"];
      if (error.code && nonRetryableCodes.includes(error.code)) {
        return false;
      }
      if (error.message && nonRetryableMessages.includes(error.message)) {
        return false;
      }
      return true;
    },
  }).catch((error) => {
    console.error(
      `Failed to start pipeline ${name} after ${config.orchestrator.processSpawnRetries} attempts:`,
      error
    );
    // Move to dead letter queue
    moveToDeadLetter(name, paths, error).catch((dlqError) => {
      console.error(`Failed to move ${name} to dead letter queue:`, dlqError);
    });
  });
}

/**
 * Spawn a pipeline runner process
 * @param {string} name - Job name
 * @param {Object} paths - Resolved pipeline paths
 * @param {Map} runningProcesses - Map of running processes
 * @returns {Promise<void>}
 */
function spawnRunner(name, paths, runningProcesses) {
  return new Promise((resolve, reject) => {
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const runnerPath = path.join(__dirname, "pipeline-runner.js");

    const env = {
      ...process.env,
      PO_ROOT: process.cwd(),
      PO_DATA_DIR: path.relative(process.cwd(), path.dirname(paths.pending)),
      PO_CURRENT_DIR: paths.current,
      PO_COMPLETE_DIR: paths.complete,
      PO_CONFIG_DIR: path.join(process.cwd(), "pipeline-config"),
      PO_PIPELINE_PATH: path.join(
        process.cwd(),
        "pipeline-config",
        "pipeline.json"
      ),
      PO_TASK_REGISTRY: path.join(
        process.cwd(),
        "pipeline-config",
        "tasks/index.js"
      ),
    };

    const child = spawn(process.execPath, [runnerPath, name], {
      stdio: ["ignore", "inherit", "inherit"],
      env,
      cwd: process.cwd(),
    });

    // Track if process started successfully
    let started = false;

    // Consider spawn successful after a short delay
    const startupTimeout = setTimeout(() => {
      started = true;
      resolve();
    }, 100);

    runningProcesses.set(name, {
      process: child,
      startedAt: new Date().toISOString(),
      name,
    });

    child.on("exit", (code, signal) => {
      clearTimeout(startupTimeout);
      runningProcesses.delete(name);
      if (code !== 0) {
        console.error(
          `Pipeline ${name} exited with code ${code}, signal ${signal}`
        );
      } else {
        console.log(`Pipeline ${name} completed successfully`);
      }
    });

    child.on("error", (err) => {
      clearTimeout(startupTimeout);
      runningProcesses.delete(name);
      if (!started) {
        reject(err);
      } else {
        console.error(`Pipeline ${name} encountered error:`, err);
      }
    });
  });
}

/**
 * Move a failed job to the dead letter queue
 * @param {string} name - Job name
 * @param {Object} paths - Resolved pipeline paths
 * @param {Error} error - Error that caused the failure
 */
async function moveToDeadLetter(name, paths, error) {
  const workDir = path.join(paths.current, name);
  const deadLetterDir = path.join(path.dirname(paths.pending), "dead-letter");
  await fs.mkdir(deadLetterDir, { recursive: true });

  const errorLog = {
    name,
    error: {
      message: error.message,
      stack: error.stack,
    },
    timestamp: new Date().toISOString(),
    attempts: getConfig().orchestrator.processSpawnRetries,
  };

  await atomicWrite(
    path.join(deadLetterDir, `${name}-error.json`),
    JSON.stringify(errorLog, null, 2)
  );

  // Move the work directory to dead letter
  const deadLetterWorkDir = path.join(deadLetterDir, name);
  try {
    await fs.rename(workDir, deadLetterWorkDir);
  } catch (err) {
    // If rename fails, try to copy
    console.warn(`Could not move ${name} to dead letter, attempting copy`);
    try {
      await copyDirRecursive(workDir, deadLetterWorkDir);
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (copyErr) {
      console.error(`Failed to copy ${name} to dead letter:`, copyErr);
    }
  }
}

/**
 * List all current job directories
 * @param {string} currentDir - Current directory path
 * @returns {Promise<string[]>} Array of job names
 */
async function listCurrentJobs(currentDir) {
  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Generate a unique pipeline ID
 * @returns {string} Pipeline ID
 */
function makeId() {
  return (
    "pl-" +
    new Date().toISOString().replaceAll(/[:.]/g, "-") +
    "-" +
    crypto.randomBytes(3).toString("hex")
  );
}

/**
 * Write a file atomically using a temporary file
 * @param {string} file - Target file path
 * @param {string} data - Data to write
 */
async function atomicWrite(file, data) {
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/**
 * Copy a directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDirRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
