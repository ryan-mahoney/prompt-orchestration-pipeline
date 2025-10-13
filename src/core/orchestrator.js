// ESM Orchestrator - clean, test-friendly, no JSX or ellipses
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import { spawn as defaultSpawn } from "node:child_process";

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
      console.warn("Rejecting non-id seed file:", base);
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
    console.log(`[Orchestrator] Moving file from ${filePath} to ${dest}`);
    try {
      await moveFile(filePath, dest);
      console.log(`[Orchestrator] ✓ Successfully moved file to ${dest}`);
    } catch (error) {
      console.log(`[Orchestrator] ✗ Failed to move file: ${error.message}`);
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
      const pipelineId = "pl-" + Math.random().toString(36).slice(2, 10);
      const status = {
        id: jobId,
        name: seed?.name ?? jobId,
        pipelineId,
        createdAt: new Date().toISOString(),
        state: "pending",
        tasks: {}, // Initialize empty tasks object for pipeline runner
      };
      await fs.writeFile(statusPath, JSON.stringify(status, null, 2));
    }
    // Spawn runner for this job
    const child = spawnRunner(jobId, dirs, running, spawn, testMode);
    // child registered inside spawnRunner
    return child;
  }

  // Watch pending directory for seeds
  const watchPattern = path.join(dirs.pending, "*.json");
  console.log("Orchestrator watching pattern:", watchPattern);
  const watcher = watcherFactory(watchPattern, {
    ignoreInitial: false,
    awaitWriteFinish: false, // Disable awaitWriteFinish for faster detection
    depth: 0,
  });

  // Wait for watcher to be ready before resolving
  await new Promise((resolve, reject) => {
    watcher.on("ready", () => {
      console.log("Orchestrator watcher is ready");
      resolve();
    });

    watcher.on("error", (error) => {
      console.log("Orchestrator watcher error:", error);
      reject(error);
    });
  });

  watcher.on("add", (file) => {
    console.log("Orchestrator detected file add:", file);
    // Return the promise so tests awaiting the add handler block until processing completes
    return handleSeedAdd(file);
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
 * Spawn a pipeline runner. In testMode we still call spawn() so tests can assert,
 * but we resolve immediately and let tests drive the lifecycle (emit 'exit', etc.).
 *
 * @param {string} jobId
 * @param {{dataDir:string,pending:string,current:string,complete:string}} dirs
 * @param {Map<string, import('node:child_process').ChildProcess>} running
 * @param {typeof defaultSpawn} spawn
 * @param {boolean} testMode
 */
function spawnRunner(jobId, dirs, running, spawn, testMode) {
  const runnerPath = path.join(
    process.cwd(),
    "src",
    "core",
    "pipeline-runner.js"
  );

  // Use environment variables if set, otherwise fall back to demo config
  const env = {
    ...process.env,
    PO_DATA_DIR: dirs.dataDir,
    PO_PENDING_DIR: dirs.pending,
    PO_CURRENT_DIR: dirs.current,
    PO_COMPLETE_DIR: dirs.complete,
    PO_PIPELINE_PATH:
      process.env.PO_PIPELINE_PATH ||
      path.join(process.cwd(), "demo", "pipeline-config", "pipeline.json"),
    PO_TASK_REGISTRY:
      process.env.PO_TASK_REGISTRY ||
      path.join(process.cwd(), "demo", "pipeline-config", "tasks", "index.js"),
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

  child.on("exit", () => {
    running.delete(jobId);
  });
  child.on("error", () => {
    running.delete(jobId);
  });

  // In test mode: return immediately; in real mode you might await readiness
  if (testMode) {
    return child;
  }

  // Non-test: we can consider "started" immediately for simplicity
  return child;
}

export default { startOrchestrator };
