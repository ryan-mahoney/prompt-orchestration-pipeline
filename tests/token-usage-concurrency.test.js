import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { writeJobStatus } from "../src/core/status-writer.js";
import { runPipeline } from "../src/core/task-runner.js";
import { getLLMEvents } from "../src/llm/index.js";

describe("token usage concurrency integrity", () => {
  let tempDir;
  let jobDir;
  let statusPath;
  let llmEvents;

  beforeEach(async () => {
    // Create unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "token-concurrency-test-"));

    // Set up environment for tests
    process.env.PO_ROOT = tempDir;

    jobDir = path.join(tempDir, "test-job");
    await fs.mkdir(jobDir, { recursive: true });

    // Create initial tasks-status.json
    statusPath = path.join(jobDir, "tasks-status.json");
    const initialStatus = {
      id: "test-job",
      state: "pending",
      current: null,
      currentStage: null,
      lastUpdated: new Date().toISOString(),
      tasks: {},
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
    };
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    // Get fresh LLM events for each test
    llmEvents = getLLMEvents();
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Reset mocks
    vi.restoreAllMocks();
  });

  it("preserves tokenUsage appends during concurrent status updates", async () => {
    const taskName = "test-task";
    const metric1 = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 10,
      completionTokens: 5,
      metadata: { alias: "openai:gpt-4" },
    };
    const metric2 = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 15,
      completionTokens: 8,
      metadata: { alias: "openai:gpt-4" },
    };

    // Create a simple task module file
    const taskModulePath = path.join(tempDir, "test-task.js");
    const taskModuleContent = `
export const inference = async (context) => {
  // This will be replaced by test logic
  return { output: { result: "test output" }, flags: { inferenceComplete: true } };
};
export const parsing = async (context) => {
  return { output: { parsed: "test output" }, flags: { parsingComplete: true } };
};
export const validateStructure = async (context) => {
  return { output: { valid: true }, flags: { validationFailed: false } };
};
export default { inference, parsing, validateStructure };
`;
    await fs.writeFile(taskModulePath, taskModuleContent);

    // Mock loadFreshModule to return our test module
    vi.doMock("../src/core/module-loader.js", () => ({
      loadFreshModule: async () => {
        const taskModule = {
          default: {
            async inference(context) {
              // Emit first LLM completion
              llmEvents.emit("llm:request:complete", metric1);

              // Small delay to allow interleaving
              await new Promise((resolve) => setTimeout(resolve, 10));

              // Emit second LLM completion
              llmEvents.emit("llm:request:complete", metric2);

              return {
                output: { result: "test output" },
                flags: { inferenceComplete: true },
              };
            },
            async parsing(context) {
              return {
                output: { parsed: "test output" },
                flags: { parsingComplete: true },
              };
            },
            async validateStructure(context) {
              return {
                output: { valid: true },
                flags: { validationFailed: false },
              };
            },
          },
        };
        return taskModule;
      },
    }));

    // Start pipeline execution
    const pipelinePromise = runPipeline(taskModule, {
      workDir: jobDir,
      taskName,
      statusPath,
      jobId: "test-job",
      seed: { data: "test input" },
    });

    // Wait a bit, then concurrently update status
    setTimeout(async () => {
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.currentStage = "inference";
        return snapshot;
      });
    }, 5);

    // Wait for pipeline to complete
    const result = await pipelinePromise;

    // Verify pipeline succeeded
    expect(result.ok).toBe(true);

    // Read final status
    const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // Verify tokenUsage array contains both metrics in order
    expect(finalStatus.tasks[taskName].tokenUsage).toEqual([
      ["openai:gpt-4", 10, 5],
      ["openai:gpt-4", 15, 8],
    ]);

    // Verify currentStage was preserved
    expect(finalStatus.currentStage).toBe("inference");
  });

  it("handles interleaved tokenUsage and status updates without lost updates", async () => {
    const taskName = "test-task";
    const metric = {
      provider: "deepseek",
      model: "deepseek-chat",
      promptTokens: 20,
      completionTokens: 10,
      metadata: { alias: "deepseek:chat" },
    };

    let emissionCount = 0;

    const taskModule = {
      default: {
        async inference(context) {
          // Emit multiple metrics with status updates interleaved
          for (let i = 0; i < 3; i++) {
            llmEvents.emit("llm:request:complete", {
              ...metric,
              promptTokens: metric.promptTokens + i * 5,
              completionTokens: metric.completionTokens + i * 2,
            });
            emissionCount++;

            // Concurrent status update
            await writeJobStatus(jobDir, (snapshot) => {
              snapshot.currentStage = `inference-step-${i}`;
              snapshot.progress = (i + 1) * 25;
              return snapshot;
            });
          }

          return {
            output: { result: "multi-step test" },
            flags: { inferenceComplete: true },
          };
        },
        async validateStructure(context) {
          return {
            output: { valid: true },
            flags: { validationFailed: false },
          };
        },
      },
    };

    // Run pipeline
    const result = await runPipeline(taskModule, {
      workDir: jobDir,
      taskName,
      statusPath,
      jobId: "test-job",
      seed: { data: "test input" },
    });

    expect(result.ok).toBe(true);
    expect(emissionCount).toBe(3);

    // Read final status
    const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // Verify all tokenUsage entries are present
    expect(finalStatus.tasks[taskName].tokenUsage).toHaveLength(3);
    expect(finalStatus.tasks[taskName].tokenUsage).toEqual([
      ["deepseek:chat", 20, 10],
      ["deepseek:chat", 25, 12],
      ["deepseek:chat", 30, 14],
    ]);

    // Verify final state is preserved
    expect(finalStatus.currentStage).toBe("inference-step-2");
    expect(finalStatus.progress).toBe(75);
  });

  it("maintains write queue serialization under high concurrency", async () => {
    const taskName = "test-task";

    // Create multiple concurrent operations
    const concurrentOps = [];

    for (let i = 0; i < 10; i++) {
      concurrentOps.push(
        writeJobStatus(jobDir, (snapshot) => {
          snapshot.currentStage = `stage-${i}`;
          snapshot.progress = i * 10;
          return snapshot;
        })
      );
    }

    // Wait for all operations to complete
    await Promise.all(concurrentOps);

    // Read final status
    const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // All operations should be applied, but in serialized order
    // The final state should reflect the last operation
    expect(finalStatus.currentStage).toBe("stage-9");
    expect(finalStatus.progress).toBe(90);
  });
});
