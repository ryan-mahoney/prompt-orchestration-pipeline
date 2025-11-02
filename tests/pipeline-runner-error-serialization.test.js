import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { setupMockPipeline } from "./test-utils.js";

// Import pipeline-runner functions to test
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

describe("pipeline-runner error serialization", () => {
  let mockPipeline;
  let originalArgv;
  let originalEnv;

  beforeEach(async () => {
    mockPipeline = await setupMockPipeline();
    vi.clearAllMocks();

    // Backup original argv and env
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    mockPipeline.cleanup();
    vi.restoreAllMocks();

    // Restore original argv and env
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  it("preserves error message in tasks-status.json when task fails", async () => {
    // Create a failing task module
    const failingTaskPath = path.join(mockPipeline.tasksDir, "failing-task.js");
    await fs.writeFile(
      failingTaskPath,
      `
export default async (ctx) => {
  throw new Error("Cannot read properties of undefined (reading 'data')");
};
    `
    );

    // Update task registry to include failing task
    const registryPath = path.join(mockPipeline.tasksDir, "index.js");
    await fs.writeFile(
      registryPath,
      `
export default {
  "test-task": "./test-task.js",
  "failing-task": "./failing-task.js"
};
    `
    );

    // Update pipeline.json to use failing task
    const pipelinePath = path.join(mockPipeline.configDir, "pipeline.json");
    await fs.writeFile(
      pipelinePath,
      JSON.stringify(
        {
          tasks: ["failing-task"],
        },
        null,
        2
      )
    );

    // Set up environment and argv for pipeline-runner
    process.env.PO_ROOT = mockPipeline.tempDir;
    process.env.PO_DATA_DIR = "pipeline-data";
    process.env.PO_CURRENT_DIR = path.join(
      mockPipeline.tempDir,
      "pipeline-data",
      "current"
    );
    process.env.PO_COMPLETE_DIR = path.join(
      mockPipeline.tempDir,
      "pipeline-data",
      "complete"
    );
    process.env.PO_TASK_REGISTRY = path.join(
      mockPipeline.configDir,
      "tasks",
      "index.js"
    );
    process.env.PO_PIPELINE_PATH = pipelinePath;
    process.argv = ["node", "pipeline-runner.js", "test-job"];

    // Create job directory structure
    const jobDir = path.join(
      mockPipeline.tempDir,
      "pipeline-data",
      "current",
      "test-job"
    );
    await fs.mkdir(jobDir, { recursive: true });

    // Create seed.json
    await fs.writeFile(
      path.join(jobDir, "seed.json"),
      JSON.stringify(
        {
          pipeline: "test",
          data: { test: "value" },
        },
        null,
        2
      )
    );

    // Create initial tasks-status.json
    const tasksStatusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      tasksStatusPath,
      JSON.stringify(
        {
          id: "test-job",
          name: "test",
          pipeline: "test",
          createdAt: new Date().toISOString(),
          state: "pending",
          tasks: {},
        },
        null,
        2
      )
    );

    // Mock the pipeline-runner logic (simplified version)
    const { runPipeline } = await import("../src/core/task-runner.js");

    const ctx = {
      workDir: jobDir,
      taskDir: path.join(jobDir, "tasks", "failing-task"),
      seed: { data: { test: "value" } },
      taskName: "failing-task",
      taskConfig: {},
      statusPath: tasksStatusPath,
      jobId: "test-job",
    };

    // Run the failing task
    const result = await runPipeline(failingTaskPath, ctx);

    // Verify the result has the expected error structure
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("ingestion");
    expect(result.error).toMatchObject({
      name: "Error",
      message: "Cannot read properties of undefined (reading 'data')",
    });

    // Simulate pipeline-runner updating tasks-status.json
    const statusData = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
    statusData.tasks["failing-task"] = {
      state: "failed",
      endedAt: new Date().toISOString(),
      error: result.error, // This should preserve the proper error message
      failedStage: result.failedStage,
      refinementAttempts: 0,
    };

    await fs.writeFile(tasksStatusPath, JSON.stringify(statusData, null, 2));

    // Verify tasks-status.json has the proper error message
    const finalStatus = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
    expect(finalStatus.tasks["failing-task"].error.message).toBe(
      "Cannot read properties of undefined (reading 'data')"
    );
    expect(finalStatus.tasks["failing-task"].error.message).not.toBe(
      "[object Object]"
    );
  });

  it("handles structured error objects correctly", async () => {
    // Test that pipeline-runner preserves structured errors from task-runner
    const structuredError = {
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'data')",
      stack: "Error stack trace...",
      debug: {
        stage: "ingestion",
        dataHasSeed: true,
        seedHasData: false,
      },
    };

    // Simulate pipeline-runner's normalizeError function
    const { normalizeError } = await import("../src/core/pipeline-runner.js");

    // Test that structured errors are passed through
    const normalized = normalizeError(structuredError);
    expect(normalized).toBe(structuredError);
    expect(normalized.message).toBe(
      "Cannot read properties of undefined (reading 'data')"
    );
  });
});
