import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { vi, test, expect, describe, beforeEach, afterEach } from "vitest";
import { createMultiPipelineTestEnv } from "./utils/createTempPipelineDir.js";

// Mock the task-runner module to capture the context passed to runPipeline
const mockRunPipeline = vi.fn();
vi.mock("../src/core/task-runner.js", () => ({
  runPipeline: mockRunPipeline,
}));

// Mock validation module
vi.mock("../src/core/validation.js", () => ({
  validatePipelineOrThrow: vi.fn(),
}));

describe("Step 2: Pipeline tasks injection", () => {
  let testEnv;

  beforeEach(async () => {
    // Create a multi-pipeline test environment with multiple tasks
    testEnv = await createMultiPipelineTestEnv([
      {
        slug: "test-pipeline",
        name: "Test Pipeline",
        description: "Test pipeline for pipelineTasks testing",
        tasks: ["analysis", "synthesis", "validation"],
        taskConfig: {
          analysis: { model: "test-model" },
          synthesis: { model: "test-model" },
          validation: { model: "test-model" },
        },
      },
    ]);

    // Set PO_ROOT to test environment
    process.env.PO_ROOT = testEnv.tempDir;

    // Clear mock history
    mockRunPipeline.mockClear();
  });

  afterEach(async () => {
    // Clean up test environment
    try {
      await fs.rm(testEnv.tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    delete process.env.PO_ROOT;
    vi.resetModules();
  });

  test("pipelineTasks is correctly injected into runPipeline context", async () => {
    const jobId = "pipeline-tasks-test-123";
    const workDir = path.join(testEnv.pipelineDataDir, "current", jobId);

    // Create work directory and seed
    await fs.mkdir(path.join(workDir, "tasks", "analysis"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workDir, "seed.json"),
      JSON.stringify({
        name: "Pipeline Tasks Test",
        pipeline: "test-pipeline",
        data: { test: "pipeline-tasks" },
      }),
      "utf8"
    );

    // Create tasks-status.json
    await fs.writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "Pipeline Tasks Test",
        pipeline: "test-pipeline",
        createdAt: new Date().toISOString(),
        state: "pending",
        tasks: {},
      }),
      "utf8"
    );

    // Mock process.argv for runner
    const originalArgv = process.argv;
    process.argv = ["node", "pipeline-runner.js", jobId];

    // Mock environment variables
    const originalEnv = process.env.PO_PIPELINE_SLUG;
    process.env.PO_PIPELINE_SLUG = "test-pipeline";

    try {
      // Mock runPipeline to capture the context and return success
      mockRunPipeline.mockResolvedValue({
        ok: true,
        context: {
          meta: {
            taskName: "analysis",
            workDir,
            jobId,
          },
          data: { analysis: { result: "success" } },
          flags: {},
          logs: [],
          currentStage: null,
        },
        logs: [{ stage: "analysis", ms: 10 }],
        refinementAttempts: 0,
      });

      // Reset modules to pick up new environment
      vi.resetModules();

      // Import and run the pipeline-runner
      await import("../src/core/pipeline-runner.js");

      // Allow some time for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify that runPipeline was called
      expect(mockRunPipeline).toHaveBeenCalled();

      // Get the context passed to runPipeline
      const capturedContext = mockRunPipeline.mock.calls[0][1];

      // Verify that pipelineTasks is correctly passed in the context
      expect(capturedContext).toBeDefined();
      expect(capturedContext.meta).toBeDefined();
      expect(capturedContext.meta.pipelineTasks).toBeDefined();
      expect(Array.isArray(capturedContext.meta.pipelineTasks)).toBe(true);

      // Verify that pipelineTasks contains the expected tasks in order
      expect(capturedContext.meta.pipelineTasks).toEqual([
        "analysis",
        "synthesis",
        "validation",
      ]);

      // Verify other expected context properties
      expect(capturedContext.workDir).toBe(workDir);
      expect(capturedContext.taskName).toBe("analysis");
      expect(capturedContext.jobId).toBe(jobId);
    } finally {
      // Restore original environment
      process.argv = originalArgv;
      if (originalEnv) {
        process.env.PO_PIPELINE_SLUG = originalEnv;
      } else {
        delete process.env.PO_PIPELINE_SLUG;
      }
    }
  });

  test("pipelineTasks preserves original order from pipeline.json", async () => {
    const jobId = "order-test-456";
    const workDir = path.join(testEnv.pipelineDataDir, "current", jobId);

    // Create work directory and seed
    await fs.mkdir(path.join(workDir, "tasks", "synthesis"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workDir, "seed.json"),
      JSON.stringify({
        name: "Order Test",
        pipeline: "test-pipeline",
        data: { test: "order" },
      }),
      "utf8"
    );

    // Create tasks-status.json with synthesis task already done, so it runs validation next
    await fs.writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "Order Test",
        pipeline: "test-pipeline",
        createdAt: new Date().toISOString(),
        state: "pending",
        tasks: {
          analysis: { state: "done" },
        },
      }),
      "utf8"
    );

    // Mock process.argv for runner
    const originalArgv = process.argv;
    process.argv = ["node", "pipeline-runner.js", jobId];

    // Mock environment variables
    const originalEnv = process.env.PO_PIPELINE_SLUG;
    process.env.PO_PIPELINE_SLUG = "test-pipeline";

    try {
      // Mock runPipeline to capture the context and return success
      mockRunPipeline.mockResolvedValue({
        ok: true,
        context: {
          meta: {
            taskName: "synthesis",
            workDir,
            jobId,
          },
          data: { synthesis: { result: "success" } },
          flags: {},
          logs: [],
          currentStage: null,
        },
        logs: [{ stage: "synthesis", ms: 15 }],
        refinementAttempts: 0,
      });

      // Reset modules to pick up new environment
      vi.resetModules();

      // Import and run the pipeline-runner
      await import("../src/core/pipeline-runner.js");

      // Allow some time for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get the context passed to runPipeline
      const capturedContext = mockRunPipeline.mock.calls[0][1];

      // Verify that pipelineTasks preserves the original order from pipeline.json
      expect(capturedContext.meta.pipelineTasks).toEqual([
        "analysis",
        "synthesis",
        "validation",
      ]);

      // The order should match exactly what's in pipeline.json, not alphabetical or execution order
      expect(capturedContext.meta.pipelineTasks[0]).toBe("analysis");
      expect(capturedContext.meta.pipelineTasks[1]).toBe("synthesis");
      expect(capturedContext.meta.pipelineTasks[2]).toBe("validation");
    } finally {
      // Restore original environment
      process.argv = originalArgv;
      if (originalEnv) {
        process.env.PO_PIPELINE_SLUG = originalEnv;
      } else {
        delete process.env.PO_PIPELINE_SLUG;
      }
    }
  });

  test("pipelineTasks works with single task pipeline", async () => {
    // Create a single-task pipeline for this test
    const singleTaskTestEnv = await createMultiPipelineTestEnv([
      {
        slug: "single-task-pipeline",
        name: "Single Task Pipeline",
        description: "Pipeline with single task",
        tasks: ["only-task"],
        taskConfig: {
          "only-task": { model: "test-model" },
        },
      },
    ]);

    process.env.PO_ROOT = singleTaskTestEnv.tempDir;

    const jobId = "single-task-789";
    const workDir = path.join(
      singleTaskTestEnv.pipelineDataDir,
      "current",
      jobId
    );

    // Create work directory and seed
    await fs.mkdir(path.join(workDir, "tasks", "only-task"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workDir, "seed.json"),
      JSON.stringify({
        name: "Single Task Test",
        pipeline: "single-task-pipeline",
        data: { test: "single" },
      }),
      "utf8"
    );

    // Create tasks-status.json
    await fs.writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "Single Task Test",
        pipeline: "single-task-pipeline",
        createdAt: new Date().toISOString(),
        state: "pending",
        tasks: {},
      }),
      "utf8"
    );

    // Mock process.argv for runner
    const originalArgv = process.argv;
    process.argv = ["node", "pipeline-runner.js", jobId];

    // Mock environment variables
    const originalEnv = process.env.PO_PIPELINE_SLUG;
    process.env.PO_PIPELINE_SLUG = "single-task-pipeline";

    try {
      // Mock runPipeline to capture the context and return success
      mockRunPipeline.mockResolvedValue({
        ok: true,
        context: {
          meta: {
            taskName: "only-task",
            workDir,
            jobId,
          },
          data: { "only-task": { result: "success" } },
          flags: {},
          logs: [],
          currentStage: null,
        },
        logs: [{ stage: "ingestion", ms: 5 }],
        refinementAttempts: 0,
      });

      // Reset modules to pick up new environment
      vi.resetModules();

      // Import and run the pipeline-runner
      await import("../src/core/pipeline-runner.js");

      // Allow some time for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get the context passed to runPipeline
      const capturedContext = mockRunPipeline.mock.calls[0][1];

      // Verify that pipelineTasks works with single task
      expect(capturedContext.meta.pipelineTasks).toEqual(["only-task"]);
      expect(capturedContext.meta.pipelineTasks.length).toBe(1);
    } finally {
      // Restore original environment
      process.argv = originalArgv;
      if (originalEnv) {
        process.env.PO_PIPELINE_SLUG = originalEnv;
      } else {
        delete process.env.PO_PIPELINE_SLUG;
      }

      // Clean up single task test environment
      try {
        await fs.rm(singleTaskTestEnv.tempDir, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        // Ignore cleanup errors
      }
      delete process.env.PO_ROOT;
    }
  });
});
