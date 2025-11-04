import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { writeJobStatus } from "../src/core/status-writer.js";
import { runPipeline } from "../src/core/task-runner.js";
import { getLLMEvents } from "../src/llm/index.js";

describe("token usage flush on failure", () => {
  let tempDir;
  let jobDir;
  let statusPath;
  let llmEvents;

  beforeEach(async () => {
    // Create unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "token-flush-test-"));
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

  it("flushes tokenUsage on early pipeline failure", async () => {
    const taskName = "test-task";
    const metric = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 25,
      completionTokens: 15,
      metadata: { alias: "openai:gpt-4" },
    };

    // Create a task that emits LLM event then throws
    const taskModule = {
      default: {
        async inference(context) {
          // Emit LLM completion event
          llmEvents.emit("llm:request:complete", metric);

          // Immediately throw to cause failure
          throw new Error("Simulated inference failure");
        },
        async validateStructure(context) {
          return {
            output: { valid: true },
            flags: { validationFailed: false },
          };
        },
      },
    };

    // Run pipeline and expect it to fail
    const result = await runPipeline(taskModule, {
      workDir: jobDir,
      taskName,
      statusPath,
      jobId: "test-job",
      seed: { data: "test input" },
    });

    // Verify pipeline failed
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("inference");
    expect(result.error.message).toBe("Simulated inference failure");

    // Read final status
    const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // Verify tokenUsage was flushed despite failure
    expect(finalStatus.tasks[taskName].tokenUsage).toEqual([
      ["openai:gpt-4", 25, 15],
    ]);

    // Verify failure state is recorded
    expect(finalStatus.tasks[taskName].state).toBe("failed");
    expect(finalStatus.tasks[taskName].failedStage).toBe("inference");
  });

  it("flushes tokenUsage on validation failure", async () => {
    const taskName = "test-task";
    const metric = {
      provider: "deepseek",
      model: "deepseek-chat",
      promptTokens: 30,
      completionTokens: 20,
      metadata: { alias: "deepseek:deepseek-chat" },
    };

    // Create a task that emits LLM event then fails validation
    const taskModule = {
      default: {
        async inference(context) {
          // Emit LLM completion event
          llmEvents.emit("llm:request:complete", metric);

          return {
            output: { result: "test output" },
            flags: { inferenceComplete: true },
          };
        },
        async validateStructure(context) {
          // Emit another LLM event during validation
          llmEvents.emit("llm:request:complete", {
            ...metric,
            promptTokens: 10,
            completionTokens: 5,
          });

          // Throw validation error
          throw new Error("Validation failed intentionally");
        },
      },
    };

    // Run pipeline and expect it to fail
    const result = await runPipeline(taskModule, {
      workDir: jobDir,
      taskName,
      statusPath,
      jobId: "test-job",
      seed: { data: "test input" },
    });

    // Verify pipeline failed
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("validateStructure");

    // Read final status
    const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // Verify both tokenUsage entries were flushed despite failure
    expect(finalStatus.tasks[taskName].tokenUsage).toEqual([
      ["deepseek:deepseek-chat", 30, 20],
      ["deepseek:deepseek-chat", 10, 5],
    ]);

    // Verify failure state is recorded
    expect(finalStatus.tasks[taskName].state).toBe("failed");
    expect(finalStatus.tasks[taskName].failedStage).toBe("validateStructure");
  });

  it("flushes tokenUsage on refinement failure", async () => {
    const taskName = "test-task";
    const metric1 = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 20,
      completionTokens: 10,
      metadata: { alias: "openai:gpt-4" },
    };
    const metric2 = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 15,
      completionTokens: 8,
      metadata: { alias: "openai:gpt-4" },
    };

    // Create a task that fails during refinement
    const taskModule = {
      default: {
        async inference(context) {
          // Emit LLM completion
          llmEvents.emit("llm:request:complete", metric1);

          return {
            output: { result: "test output" },
            flags: { inferenceComplete: true },
          };
        },
        async validateStructure(context) {
          // Emit another LLM event during validation
          llmEvents.emit("llm:request:complete", metric2);

          // Always fail validation to trigger refinement
          return {
            output: { valid: false },
            flags: { validationFailed: true },
          };
        },
        async critique(context) {
          // Fail during critique
          throw new Error("Critique failed");
        },
        async refine(context) {
          // This shouldn't be reached due to critique failure
          return {
            output: { refined: true },
            flags: { refined: true },
          };
        },
      },
    };

    // Run pipeline with 1 refinement allowed
    const result = await runPipeline(taskModule, {
      workDir: jobDir,
      taskName,
      statusPath,
      jobId: "test-job",
      seed: { data: "test input", maxRefinements: 1 },
    });

    // Verify pipeline failed during refinement
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("critique");

    // Read final status
    const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // Verify both tokenUsage entries were flushed despite failure
    expect(finalStatus.tasks[taskName].tokenUsage).toEqual([
      ["openai:gpt-4", 20, 10],
      ["openai:gpt-4", 15, 8],
    ]);

    // Verify failure state is recorded
    expect(finalStatus.tasks[taskName].state).toBe("failed");
    expect(finalStatus.tasks[taskName].failedStage).toBe("critique");
  });

  it("preserves event listener cleanup on multiple failures", async () => {
    const taskName = "test-task";
    const metric = {
      provider: "openai",
      model: "gpt-4",
      promptTokens: 15,
      completionTokens: 8,
      metadata: { alias: "openai:gpt-4" },
    };

    // Spy on event listener methods
    const offSpy = vi.spyOn(llmEvents, "off");

    // Create a task that fails multiple times
    const taskModule = {
      default: {
        async inference(context) {
          // Emit LLM completion
          llmEvents.emit("llm:request:complete", metric);

          // Fail first time
          throw new Error("First failure");
        },
        async validateStructure(context) {
          return {
            output: { valid: true },
            flags: { validationFailed: false },
          };
        },
      },
    };

    // Run pipeline multiple times to test cleanup
    for (let i = 0; i < 3; i++) {
      const result = await runPipeline(taskModule, {
        workDir: jobDir,
        taskName: `${taskName}-${i}`,
        statusPath,
        jobId: `test-job-${i}`,
        seed: { data: "test input" },
      });

      expect(result.ok).toBe(false);
    }

    // Verify event listener was cleaned up after each failure
    expect(offSpy).toHaveBeenCalledWith(
      "llm:request:complete",
      expect.any(Function)
    );
    expect(offSpy).toHaveBeenCalledTimes(3);
  });

  it("handles concurrent token writes during failure", async () => {
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
      promptTokens: 8,
      completionTokens: 4,
      metadata: { alias: "openai:gpt-4" },
    };

    // Create a task that emits multiple events then fails
    const taskModule = {
      default: {
        async inference(context) {
          // Emit multiple LLM events rapidly
          llmEvents.emit("llm:request:complete", metric1);

          // Small delay
          await new Promise((resolve) => setTimeout(resolve, 1));

          llmEvents.emit("llm:request:complete", metric2);

          // Concurrent status update during token emission
          const concurrentUpdate = writeJobStatus(jobDir, (snapshot) => {
            snapshot.currentStage = "processing";
            return snapshot;
          });

          // Wait for concurrent update
          await concurrentUpdate;

          // Fail after all emissions
          throw new Error("Failure after token emissions");
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

    // Verify pipeline failed
    expect(result.ok).toBe(false);

    // Read final status
    const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));

    // Verify both tokenUsage entries were flushed despite concurrent updates and failure
    expect(finalStatus.tasks[taskName].tokenUsage).toEqual([
      ["openai:gpt-4", 10, 5],
      ["openai:gpt-4", 8, 4],
    ]);

    // Verify concurrent update was also applied
    expect(finalStatus.currentStage).toBe("processing");
  });
});
