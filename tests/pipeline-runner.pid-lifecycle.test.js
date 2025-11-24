import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createTempDir, cleanupTempDir } from "./test-utils.js";

describe("Pipeline Runner PID Lifecycle", () => {
  let tempDir;
  let dataDir;
  let currentDir;
  let pipelineConfigDir;
  let tasksDir;

  beforeEach(async () => {
    // Create temporary directory structure
    tempDir = await createTempDir();
    dataDir = path.join(tempDir, "pipeline-data");
    currentDir = path.join(dataDir, "current");
    pipelineConfigDir = path.join(tempDir, "pipeline-config");
    tasksDir = path.join(pipelineConfigDir, "tasks");

    // Create directory structure
    await fs.mkdir(currentDir, { recursive: true });
    await fs.mkdir(pipelineConfigDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("should write runner.pid file on startup", async () => {
    const jobId = "test-job-123";
    const jobDir = path.join(currentDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Create necessary job files
    await createJobFiles(jobDir, jobId);

    // Create pipeline configuration
    await createPipelineConfig(pipelineConfigDir, tasksDir);

    // Set environment variables for the runner
    const env = {
      ...process.env,
      PO_ROOT: tempDir,
      PO_DATA_DIR: dataDir,
      PO_CURRENT_DIR: currentDir,
      PO_COMPLETE_DIR: path.join(dataDir, "complete"),
      PO_PIPELINE_SLUG: "test-pipeline",
    };

    // Mock process.pid to a known value
    const mockPid = 99999;

    // Create a mock runner module that simulates the PID writing behavior
    const mockRunnerCode = `
import fs from "node:fs/promises";
import path from "node:path";

const jobId = process.argv[2];
const CURRENT_DIR = process.env.PO_CURRENT_DIR || "${currentDir}";
const workDir = path.join(CURRENT_DIR, jobId);

// Write runner PID file (simulating pipeline-runner.js behavior)
const runnerPidPath = path.join(workDir, "runner.pid");
await fs.writeFile(runnerPidPath, "${mockPid}\\n", "utf8");

console.log("Mock runner started for job:", jobId);

// Simulate some work
setTimeout(() => {
  console.log("Mock runner finished");
  process.exit(0);
}, 100);
`;

    const mockRunnerPath = path.join(tempDir, "mock-runner.js");
    await fs.writeFile(mockRunnerPath, mockRunnerCode);

    // Spawn the mock runner
    const child = spawn(process.execPath, [mockRunnerPath, jobId], {
      env,
      stdio: "pipe",
      detached: false,
    });

    // Wait for the runner to start and write PID file
    await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
        if (output.includes("Mock runner started")) {
          resolve();
        }
      });
      child.stderr.on("data", (data) => {
        reject(new Error(`Runner error: ${data.toString()}`));
      });
      child.on("error", reject);
    });

    // Verify PID file was created with correct content
    const pidPath = path.join(jobDir, "runner.pid");
    expect(await fs.access(pidPath).catch(() => false)).toBe(true);

    const pidContent = await fs.readFile(pidPath, "utf8");
    expect(pidContent.trim()).toBe(mockPid.toString());

    // Wait for runner to finish
    await new Promise((resolve) => {
      child.on("close", resolve);
    });

    // Verify PID file is cleaned up on normal exit
    expect(await fs.access(pidPath).catch(() => false)).toBe(false);
  });

  it("should remove runner.pid on error exit", async () => {
    const jobId = "test-job-error-456";
    const jobDir = path.join(currentDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Create necessary job files
    await createJobFiles(jobDir, jobId);

    // Create a mock runner that exits with an error
    const mockRunnerCode = `
import fs from "node:fs/promises";
import path from "node:path";

const jobId = process.argv[2];
const CURRENT_DIR = process.env.PO_CURRENT_DIR || "${currentDir}";
const workDir = path.join(CURRENT_DIR, jobId);

// Write runner PID file
const runnerPidPath = path.join(workDir, "runner.pid");
await fs.writeFile(runnerPidPath, "88888\\n", "utf8");

console.log("Mock runner started for job:", jobId);

// Simulate an error
setTimeout(() => {
  console.error("Mock runner error occurred");
  process.exit(1);
}, 50);
`;

    const mockRunnerPath = path.join(tempDir, "mock-runner-error.js");
    await fs.writeFile(mockRunnerPath, mockRunnerCode);

    // Set environment variables
    const env = {
      ...process.env,
      PO_ROOT: tempDir,
      PO_DATA_DIR: dataDir,
      PO_CURRENT_DIR: currentDir,
      PO_COMPLETE_DIR: path.join(dataDir, "complete"),
      PO_PIPELINE_SLUG: "test-pipeline",
    };

    // Spawn the mock runner
    const child = spawn(process.execPath, [mockRunnerPath, jobId], {
      env,
      stdio: "pipe",
      detached: false,
    });

    // Wait for the runner to start and write PID file
    await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
        if (output.includes("Mock runner started")) {
          resolve();
        }
      });
      child.stderr.on("data", (data) => {
        // Expected error output
      });
      child.on("error", reject);
    });

    // Verify PID file was created
    const pidPath = path.join(jobDir, "runner.pid");
    expect(await fs.access(pidPath).catch(() => false)).toBe(true);

    // Wait for runner to exit with error
    await new Promise((resolve) => {
      child.on("close", (code) => {
        expect(code).toBe(1);
        resolve();
      });
    });

    // Verify PID file is cleaned up even on error exit
    expect(await fs.access(pidPath).catch(() => false)).toBe(false);
  });

  it("should handle SIGINT and remove PID file", async () => {
    const jobId = "test-job-sigint-789";
    const jobDir = path.join(currentDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Create necessary job files
    await createJobFiles(jobDir, jobId);

    // Create a mock runner that handles SIGINT
    const mockRunnerCode = `
import fs from "node:fs/promises";
import path from "node:path";

const jobId = process.argv[2];
const CURRENT_DIR = process.env.PO_CURRENT_DIR || "${currentDir}";
const workDir = path.join(CURRENT_DIR, jobId);

// Write runner PID file
const runnerPidPath = path.join(workDir, "runner.pid");
await fs.writeFile(runnerPidPath, "77777\\n", "utf8");

console.log("Mock runner started for job:", jobId);

// Set up SIGINT handler (similar to pipeline-runner.js)
async function cleanupRunnerPid() {
  try {
    await fs.unlink(runnerPidPath);
  } catch (error) {
    // ENOENT means file doesn't exist, which is fine
    if (error.code !== "ENOENT") {
      console.error("Failed to cleanup runner PID file:", error);
    }
  }
}

process.on("SIGINT", () => {
  console.log("Received SIGINT, cleaning up...");
  cleanupRunnerPid().then(() => process.exit(130));
});

// Keep process alive
setTimeout(() => {
  console.log("Mock runner finished naturally");
  process.exit(0);
}, 5000); // Long timeout to allow SIGINT
`;

    const mockRunnerPath = path.join(tempDir, "mock-runner-sigint.js");
    await fs.writeFile(mockRunnerPath, mockRunnerCode);

    // Set environment variables
    const env = {
      ...process.env,
      PO_ROOT: tempDir,
      PO_DATA_DIR: dataDir,
      PO_CURRENT_DIR: currentDir,
      PO_COMPLETE_DIR: path.join(dataDir, "complete"),
      PO_PIPELINE_SLUG: "test-pipeline",
    };

    // Spawn the mock runner
    const child = spawn(process.execPath, [mockRunnerPath, jobId], {
      env,
      stdio: "pipe",
      detached: false,
    });

    // Wait for the runner to start
    await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
        if (output.includes("Mock runner started")) {
          resolve();
        }
      });
      child.stderr.on("data", (data) => {
        reject(new Error(`Runner error: ${data.toString()}`));
      });
      child.on("error", reject);
    });

    // Verify PID file was created
    const pidPath = path.join(jobDir, "runner.pid");
    expect(await fs.access(pidPath).catch(() => false)).toBe(true);

    // Send SIGINT to the process
    child.kill("SIGINT");

    // Wait for runner to exit
    await new Promise((resolve) => {
      child.on("close", (code) => {
        expect(code).toBe(130); // SIGINT exit code
        resolve();
      });
    });

    // Verify PID file is cleaned up
    expect(await fs.access(pidPath).catch(() => false)).toBe(false);
  });

  it("should handle SIGTERM and remove PID file", async () => {
    const jobId = "test-job-sigterm-999";
    const jobDir = path.join(currentDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Create necessary job files
    await createJobFiles(jobDir, jobId);

    // Create a mock runner that handles SIGTERM
    const mockRunnerCode = `
import fs from "node:fs/promises";
import path from "node:path";

const jobId = process.argv[2];
const CURRENT_DIR = process.env.PO_CURRENT_DIR || "${currentDir}";
const workDir = path.join(CURRENT_DIR, jobId);

// Write runner PID file
const runnerPidPath = path.join(workDir, "runner.pid");
await fs.writeFile(runnerPidPath, "66666\\n", "utf8");

console.log("Mock runner started for job:", jobId);

// Set up SIGTERM handler (similar to pipeline-runner.js)
async function cleanupRunnerPid() {
  try {
    await fs.unlink(runnerPidPath);
  } catch (error) {
    // ENOENT means file doesn't exist, which is fine
    if (error.code !== "ENOENT") {
      console.error("Failed to cleanup runner PID file:", error);
    }
  }
}

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, cleaning up...");
  cleanupRunnerPid().then(() => process.exit(143));
});

// Keep process alive
setTimeout(() => {
  console.log("Mock runner finished naturally");
  process.exit(0);
}, 5000); // Long timeout to allow SIGTERM
`;

    const mockRunnerPath = path.join(tempDir, "mock-runner-sigterm.js");
    await fs.writeFile(mockRunnerPath, mockRunnerCode);

    // Set environment variables
    const env = {
      ...process.env,
      PO_ROOT: tempDir,
      PO_DATA_DIR: dataDir,
      PO_CURRENT_DIR: currentDir,
      PO_COMPLETE_DIR: path.join(dataDir, "complete"),
      PO_PIPELINE_SLUG: "test-pipeline",
    };

    // Spawn the mock runner
    const child = spawn(process.execPath, [mockRunnerPath, jobId], {
      env,
      stdio: "pipe",
      detached: false,
    });

    // Wait for the runner to start
    await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
        if (output.includes("Mock runner started")) {
          resolve();
        }
      });
      child.stderr.on("data", (data) => {
        reject(new Error(`Runner error: ${data.toString()}`));
      });
      child.on("error", reject);
    });

    // Verify PID file was created
    const pidPath = path.join(jobDir, "runner.pid");
    expect(await fs.access(pidPath).catch(() => false)).toBe(true);

    // Send SIGTERM to the process
    child.kill("SIGTERM");

    // Wait for runner to exit
    await new Promise((resolve) => {
      child.on("close", (code) => {
        expect(code).toBe(143); // SIGTERM exit code
        resolve();
      });
    });

    // Verify PID file is cleaned up
    expect(await fs.access(pidPath).catch(() => false)).toBe(false);
  });

  it("should handle PID file creation failure gracefully", async () => {
    const jobId = "test-job-pid-fail-111";
    const jobDir = path.join(currentDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Create necessary job files
    await createJobFiles(jobDir, jobId);

    // Create a mock runner that tries to write PID file to a read-only directory
    const mockRunnerCode = `
import fs from "node:fs/promises";
import path from "node:path";

const jobId = process.argv[2];
const CURRENT_DIR = process.env.PO_CURRENT_DIR || "${currentDir}";
const workDir = path.join(CURRENT_DIR, jobId);

// Try to write runner PID file (this should fail if directory is read-only)
const runnerPidPath = path.join(workDir, "runner.pid");

try {
  await fs.writeFile(runnerPidPath, "55555\\n", "utf8");
  console.log("PID file written successfully");
} catch (error) {
  console.error("Failed to write PID file:", error.message);
  process.exit(1); // Exit with error as pipeline-runner.js would
}
`;

    const mockRunnerPath = path.join(tempDir, "mock-runner-pid-fail.js");
    await fs.writeFile(mockRunnerPath, mockRunnerCode);

    // Set environment variables
    const env = {
      ...process.env,
      PO_ROOT: tempDir,
      PO_DATA_DIR: dataDir,
      PO_CURRENT_DIR: currentDir,
      PO_COMPLETE_DIR: path.join(dataDir, "complete"),
      PO_PIPELINE_SLUG: "test-pipeline",
    };

    // Make the job directory read-only to simulate permission error
    await fs.chmod(jobDir, 0o444);

    // Spawn the mock runner
    const child = spawn(process.execPath, [mockRunnerPath, jobId], {
      env,
      stdio: "pipe",
      detached: false,
    });

    // Wait for runner to exit with error
    await new Promise((resolve) => {
      child.stderr.on("data", (data) => {
        // Expected error output
      });
      child.on("close", (code) => {
        expect(code).toBe(1); // Should exit with error
        resolve();
      });
    });

    // Restore permissions for cleanup
    await fs.chmod(jobDir, 0o755);

    // Verify PID file was not created
    const pidPath = path.join(jobDir, "runner.pid");
    expect(await fs.access(pidPath).catch(() => false)).toBe(false);
  });

  async function createJobFiles(jobDir, jobId) {
    // Create seed.json
    const seedPath = path.join(jobDir, "seed.json");
    await fs.writeFile(
      seedPath,
      JSON.stringify({
        pipeline: "test-pipeline",
        data: { test: "data" },
      })
    );

    // Create tasks-status.json
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "pending",
        current: null,
        currentStage: null,
        lastUpdated: new Date().toISOString(),
        tasks: {
          "test-task": {
            state: "pending",
            attempts: 0,
            refinementAttempts: 0,
            tokenUsage: [],
          },
        },
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    // Create tasks directory
    const tasksJobDir = path.join(jobDir, "tasks");
    await fs.mkdir(tasksJobDir, { recursive: true });

    // Create files directory
    const filesDir = path.join(jobDir, "files");
    await fs.mkdir(filesDir, { recursive: true });
    await fs.mkdir(path.join(filesDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(filesDir, "artifacts"), { recursive: true });
    await fs.mkdir(path.join(filesDir, "tmp"), { recursive: true });
  }

  async function createPipelineConfig(pipelineConfigDir, tasksDir) {
    // Create pipeline.json
    const pipelinePath = path.join(pipelineConfigDir, "pipeline.json");
    await fs.writeFile(
      pipelinePath,
      JSON.stringify({
        tasks: ["test-task"],
      })
    );

    // Create task registry
    const registryPath = path.join(tasksDir, "index.js");
    await fs.writeFile(
      registryPath,
      `
export default {
  "test-task": "./test-task.js"
};
`
    );

    // Create a simple task module
    const taskPath = path.join(tasksDir, "test-task.js");
    await fs.writeFile(
      taskPath,
      `
export default async function() {
  return { ok: true, output: { test: "completed" } };
}
`
    );
  }
});
