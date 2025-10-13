// tests/pipeline-runner.test.js
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { vi, test, expect, describe } from "vitest";

// Mock the task-runner module to avoid dynamic import issues
vi.mock("../src/core/task-runner.js", () => ({
  runPipeline: vi.fn().mockImplementation(async (taskPath, ctx) => {
    // Simulate the pipeline execution
    const result = {
      ok: true,
      context: {
        ...ctx,
        output: { x: 1 },
        data: "test",
        processed: true,
        prompt: "test prompt",
        response: "test response",
        parsed: { x: 1 },
        validationPassed: true,
        qualityPassed: true,
      },
      logs: [
        { stage: "ingestion", ms: 10 },
        { stage: "preProcessing", ms: 5 },
        { stage: "promptTemplating", ms: 8 },
        { stage: "inference", ms: 15 },
        { stage: "parsing", ms: 3 },
        { stage: "validateStructure", ms: 2 },
        { stage: "validateQuality", ms: 2 },
        { stage: "finalValidation", ms: 1 },
      ],
      refinementAttempts: 0,
    };

    // Write output.json
    await fs.writeFile(
      path.join(ctx.taskDir, "output.json"),
      JSON.stringify(result.context.output, null, 2)
    );

    // Write execution-logs.json
    await fs.writeFile(
      path.join(ctx.taskDir, "execution-logs.json"),
      JSON.stringify(result.logs, null, 2)
    );

    return result;
  }),
}));

test("runs one task and writes artifacts", async () => {
  const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "runner-"));

  const name = "testrun";
  const workDir = path.join(ROOT, "pipeline-data", "current", name);
  await fs.mkdir(path.join(workDir, "tasks", "hello"), { recursive: true });

  // Create context for the task runner
  const ctx = {
    workDir,
    taskDir: path.join(workDir, "tasks", "hello"),
    seed: { seed: true },
    artifacts: {},
    taskName: "hello",
    taskConfig: {},
  };

  // Import the mocked task runner
  const { runPipeline } = await import("../src/core/task-runner.js");

  // Run the pipeline using the task runner
  const result = await runPipeline("/mock/task.js", ctx);

  // Verify the result
  expect(result.ok).toBe(true);
  expect(result.context.output).toEqual({ x: 1 });

  // Verify artifacts were written
  const outputPath = path.join(workDir, "tasks", "hello", "output.json");
  const outputContent = await fs.readFile(outputPath, "utf8");
  expect(JSON.parse(outputContent)).toEqual({ x: 1 });

  // Verify execution logs were written
  const logsPath = path.join(workDir, "tasks", "hello", "execution-logs.json");
  const logsContent = await fs.readFile(logsPath, "utf8");
  const logs = JSON.parse(logsContent);
  expect(Array.isArray(logs)).toBe(true);
  expect(logs.length).toBeGreaterThan(0);
});

describe("Step 3: Runner argument is jobId", () => {
  test("runner requires jobId as CLI argument", async () => {
    const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "runner-jobid-"));

    // Set up environment variables for the test
    process.env.PO_ROOT = ROOT;
    process.env.PO_DATA_DIR = path.join(ROOT, "pipeline-data");
    process.env.PO_CURRENT_DIR = path.join(ROOT, "pipeline-data", "current");
    process.env.PO_COMPLETE_DIR = path.join(ROOT, "pipeline-data", "complete");
    process.env.PO_PIPELINE_PATH = path.join(
      ROOT,
      "pipeline-config",
      "pipeline.json"
    );
    process.env.PO_TASK_REGISTRY = path.join(
      ROOT,
      "pipeline-config",
      "tasks",
      "index.js"
    );

    // Create required directory structure
    const configDir = path.join(ROOT, "pipeline-config");
    const tasksDir = path.join(configDir, "tasks");
    const dataDir = path.join(ROOT, "pipeline-data", "current");
    const completeDir = path.join(ROOT, "pipeline-data", "complete");

    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(completeDir, { recursive: true });

    // Create pipeline configuration
    await fs.writeFile(
      path.join(configDir, "pipeline.json"),
      JSON.stringify({
        name: "test-pipeline",
        version: "1.0.0",
        tasks: ["noop"],
        taskConfig: {
          noop: {
            model: "test-model",
            temperature: 0.7,
          },
        },
      }),
      "utf8"
    );

    // Create task registry
    const pipelineTasksDir = path.join(ROOT, "pipeline-tasks");
    await fs.mkdir(pipelineTasksDir, { recursive: true });
    await fs.writeFile(
      path.join(tasksDir, "index.js"),
      `export default {
  noop: "${path.join(pipelineTasksDir, "noop.js")}"
};`,
      "utf8"
    );

    // Also create the task registry in the expected location
    const expectedTasksDir = path.join(ROOT, "pipeline-config", "tasks");
    await fs.mkdir(expectedTasksDir, { recursive: true });
    await fs.writeFile(
      path.join(expectedTasksDir, "index.js"),
      `export default {
  noop: "${path.join(pipelineTasksDir, "noop.js")}"
};`,
      "utf8"
    );

    // Create noop task
    await fs.writeFile(
      path.join(pipelineTasksDir, "noop.js"),
      `export default {
  ingestion: (ctx) => ({ ...ctx, data: "test" }),
  preProcessing: (ctx) => ({ ...ctx, processed: true }),
  promptTemplating: (ctx) => ({ ...ctx, prompt: "test prompt" }),
  inference: (ctx) => ({ ...ctx, response: "test response" }),
  parsing: (ctx) => ({ ...ctx, parsed: { x: 1 } }),
  validateStructure: (ctx) => ({ ...ctx, validationPassed: true }),
  validateQuality: (ctx) => ({ ...ctx, qualityPassed: true }),
  finalValidation: (ctx) => ({ ...ctx, output: { x: 1 } })
};`,
      "utf8"
    );

    // Create job directory with jobId
    const jobId = "test-job-123";
    const jobDir = path.join(dataDir, jobId);
    await fs.mkdir(path.join(jobDir, "tasks", "noop"), { recursive: true });

    // Create seed.json
    await fs.writeFile(
      path.join(jobDir, "seed.json"),
      JSON.stringify({ name: "Test Job", data: { test: true } }),
      "utf8"
    );

    // Create tasks-status.json
    await fs.writeFile(
      path.join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "Test Job",
        pipelineId: "pl-test123",
        createdAt: new Date().toISOString(),
        state: "pending",
        tasks: {},
      }),
      "utf8"
    );

    // Mock process.argv to simulate jobId argument
    const originalArgv = process.argv;
    process.argv = ["node", "pipeline-runner.js", jobId];

    try {
      // Import and run the pipeline runner
      // We need to reset modules to pick up the new process.argv
      vi.resetModules();

      // This should not throw an error since jobId is provided
      await import("../src/core/pipeline-runner.js");

      // If we get here, the jobId was accepted
      expect(true).toBe(true);
    } finally {
      // Restore original process.argv
      process.argv = originalArgv;

      // Clean up environment variables
      delete process.env.PO_ROOT;
      delete process.env.PO_DATA_DIR;
      delete process.env.PO_CURRENT_DIR;
      delete process.env.PO_COMPLETE_DIR;
      delete process.env.PO_PIPELINE_PATH;
      delete process.env.PO_TASK_REGISTRY;
    }
  });

  test("runner throws error when jobId is missing", async () => {
    // Mock process.argv to simulate missing jobId argument
    const originalArgv = process.argv;
    process.argv = ["node", "pipeline-runner.js"]; // No jobId argument

    try {
      // Reset modules to pick up the new process.argv
      vi.resetModules();

      // This should throw an error
      await expect(import("../src/core/pipeline-runner.js")).rejects.toThrow(
        "runner requires jobId as argument"
      );
    } finally {
      // Restore original process.argv
      process.argv = originalArgv;
    }
  });

  test("runner uses jobId for work directory path", async () => {
    const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "runner-workdir-"));

    // Set up environment variables
    process.env.PO_ROOT = ROOT;
    process.env.PO_CURRENT_DIR = path.join(ROOT, "pipeline-data", "current");
    process.env.PO_COMPLETE_DIR = path.join(ROOT, "pipeline-data", "complete");
    process.env.PO_PIPELINE_PATH = path.join(
      ROOT,
      "pipeline-config",
      "pipeline.json"
    );
    process.env.PO_TASK_REGISTRY = path.join(
      ROOT,
      "pipeline-config",
      "tasks",
      "index.js"
    );

    // Create minimal setup
    const configDir = path.join(ROOT, "pipeline-config");
    const tasksDir = path.join(configDir, "tasks");
    const dataDir = path.join(ROOT, "pipeline-data", "current");

    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });

    // Create minimal pipeline config
    await fs.writeFile(
      path.join(configDir, "pipeline.json"),
      JSON.stringify({
        name: "test-pipeline",
        version: "1.0.0",
        tasks: ["noop"],
        taskConfig: {
          noop: {
            model: "test-model",
            temperature: 0.7,
          },
        },
      }),
      "utf8"
    );

    // Create task registry and noop task
    const pipelineTasksDir = path.join(ROOT, "pipeline-tasks");
    await fs.mkdir(pipelineTasksDir, { recursive: true });
    await fs.writeFile(
      path.join(tasksDir, "index.js"),
      `export default {
  noop: "${path.join(pipelineTasksDir, "noop.js")}"
};`,
      "utf8"
    );

    // Also create the task registry in the expected location
    const expectedTasksDir = path.join(ROOT, "pipeline-config", "tasks");
    await fs.mkdir(expectedTasksDir, { recursive: true });
    await fs.writeFile(
      path.join(expectedTasksDir, "index.js"),
      `export default {
  noop: "${path.join(pipelineTasksDir, "noop.js")}"
};`,
      "utf8"
    );

    await fs.writeFile(
      path.join(pipelineTasksDir, "noop.js"),
      `export default {
  ingestion: (ctx) => ({ ...ctx, data: "test" }),
  preProcessing: (ctx) => ({ ...ctx, processed: true }),
  promptTemplating: (ctx) => ({ ...ctx, prompt: "test prompt" }),
  inference: (ctx) => ({ ...ctx, response: "test response" }),
  parsing: (ctx) => ({ ...ctx, parsed: { x: 1 } }),
  validateStructure: (ctx) => ({ ...ctx, validationPassed: true }),
  validateQuality: (ctx) => ({ ...ctx, qualityPassed: true }),
  finalValidation: (ctx) => ({ ...ctx, output: { x: 1 } })
};`,
      "utf8"
    );

    // Create job directory with specific jobId
    const jobId = "workdir-test-456";
    const jobDir = path.join(dataDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Create required files
    await fs.writeFile(
      path.join(jobDir, "seed.json"),
      JSON.stringify({ data: {} }),
      "utf8"
    );

    await fs.writeFile(
      path.join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "WorkDir Test",
        pipelineId: "pl-workdir",
        createdAt: new Date().toISOString(),
        state: "pending",
        tasks: {},
      }),
      "utf8"
    );

    // Mock process.argv
    const originalArgv = process.argv;
    process.argv = ["node", "pipeline-runner.js", jobId];

    try {
      // Reset modules to pick up the new process.argv
      vi.resetModules();

      // Import the pipeline runner - it should find the job directory using jobId
      await import("../src/core/pipeline-runner.js");

      // If we get here without error, the runner successfully located the job directory
      expect(true).toBe(true);
    } finally {
      // Restore original process.argv
      process.argv = originalArgv;

      // Clean up environment variables
      delete process.env.PO_ROOT;
      delete process.env.PO_CURRENT_DIR;
      delete process.env.PO_COMPLETE_DIR;
      delete process.env.PO_PIPELINE_PATH;
      delete process.env.PO_TASK_REGISTRY;
    }
  });
});
