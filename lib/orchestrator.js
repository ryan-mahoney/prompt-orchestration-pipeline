// ESM
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import chokidar from "chokidar";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const PENDING_DIR = path.join(ROOT, "pipeline-pending");
const CURRENT_DIR = path.join(ROOT, "pipeline-current");

// Track running processes to prevent duplicates and enable management
const runningProcesses = new Map();

bootstrap();

async function bootstrap() {
  await fs.mkdir(PENDING_DIR, { recursive: true });
  await fs.mkdir(CURRENT_DIR, { recursive: true });

  // Resume any in-progress pipelines
  for (const name of await listDirs(CURRENT_DIR)) {
    ensureRunner(name);
  }

  // Watch for new seeds
  chokidar
    .watch(path.join(PENDING_DIR, "*-seed.json"), {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })
    .on("add", onSeed);

  // Graceful shutdown handler
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function onSeed(seedPath) {
  const base = path.basename(seedPath);
  const name = base.replace(/-seed\.json$/, "");
  const workDir = path.join(CURRENT_DIR, name);

  // Use a lock file to prevent race conditions
  const lockFile = path.join(CURRENT_DIR, `${name}.lock`);

  try {
    // Atomic lock creation
    await fs.writeFile(lockFile, process.pid.toString(), { flag: "wx" });
  } catch (err) {
    if (err.code === "EEXIST") {
      // Another process is handling this seed
      return;
    }
    throw err;
  }

  try {
    // Idempotent: skip if work dir already exists
    try {
      await fs.mkdir(workDir, { recursive: false });
    } catch (err) {
      if (err.code === "EEXIST") {
        return;
      }
      throw err;
    }

    const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));
    const pipelineId = makeId();

    await atomicWrite(
      path.join(workDir, "seed.json"),
      JSON.stringify(seed, null, 2)
    );
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

    // Create tasks directory structure
    await fs.mkdir(path.join(workDir, "tasks"), { recursive: true });

    // Keep the seed in pending as an audit trail
    ensureRunner(name);
  } finally {
    // Clean up lock file
    try {
      await fs.unlink(lockFile);
    } catch {
      // Ignore errors cleaning up lock
    }
  }
}

function ensureRunner(name) {
  // Check if already running
  if (runningProcesses.has(name)) {
    return;
  }

  const child = spawn(process.execPath, ["./pipeline-runner.js", name], {
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
    cwd: ROOT,
  });

  runningProcesses.set(name, {
    process: child,
    startedAt: new Date().toISOString(),
    name,
  });

  child.on("exit", (code, signal) => {
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
    console.error(`Failed to start pipeline ${name}:`, err);
    runningProcesses.delete(name);
  });
}

async function listDirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

function makeId() {
  return (
    "pl-" +
    new Date().toISOString().replaceAll(/[:.]/g, "-") +
    "-" +
    crypto.randomBytes(3).toString("hex")
  );
}

async function atomicWrite(file, data) {
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

async function cleanup() {
  console.log("Shutting down orchestrator...");

  // Gracefully terminate all running processes
  for (const [name, info] of runningProcesses) {
    console.log(`Terminating pipeline: ${name}`);
    info.process.kill("SIGTERM");
  }

  // Wait a bit for graceful shutdown
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Force kill any remaining processes
  for (const [name, info] of runningProcesses) {
    if (!info.process.killed) {
      console.log(`Force killing pipeline: ${name}`);
      info.process.kill("SIGKILL");
    }
  }

  process.exit(0);
}
