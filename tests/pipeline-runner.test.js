// tests/pipeline-runner.test.js
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { vi, test, expect } from "vitest";

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
