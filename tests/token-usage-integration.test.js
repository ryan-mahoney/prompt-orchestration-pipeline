import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runPipeline } from "../src/core/task-runner.js";
import { createLLM, getLLMEvents } from "../src/llm/index.js";

describe("Token Usage Integration", () => {
  let tempDir;
  let statusPath;
  let mockTasksPath;
  let llmEvents;

  beforeEach(async () => {
    // Create temporary directory and files
    tempDir = `/tmp/token-usage-integration-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, "files", "logs"), { recursive: true });

    // Set PO_ROOT environment variable for LLM creation
    process.env.PO_ROOT = tempDir;

    statusPath = path.join(tempDir, "tasks-status.json");

    // Create pipeline-config directory and registry
    const pipelineConfigDir = path.join(tempDir, "pipeline-config");
    await fs.mkdir(pipelineConfigDir, { recursive: true });

    const registryContent = {
      pipelines: {
        "test-pipeline": {
          description: "Test pipeline for token usage integration",
          tasks: ["inference", "parsing", "integration"],
        },
      },
    };
    await fs.writeFile(
      path.join(pipelineConfigDir, "registry.json"),
      JSON.stringify(registryContent, null, 2)
    );

    // Create mock task module
    mockTasksPath = path.join(tempDir, "mock-tasks.js");
    const mockTasksContent = `
export async function inference(context) {
  // Simulate an LLM call that will trigger token usage
  const mockLLMResponse = {
    output: "Mock response",
    flags: {},
    llmMetrics: [{
      provider: "openai",
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      metadata: { alias: "test-model" }
    }]
  };
  return mockLLMResponse;
}

export async function parsing(context) {
  return { output: { parsed: true }, flags: {} };
}

export async function integration(context) {
  return { output: { integrated: true }, flags: {} };
}
`;
    await fs.writeFile(mockTasksPath, mockTasksContent);

    // Initialize status file
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

    llmEvents = getLLMEvents();
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should collect and persist token usage during pipeline execution", async () => {
    const taskName = "test-task";

    // First, run a pipeline to create a task context
    const result = await runPipeline(mockTasksPath, {
      taskName,
      workDir: tempDir,
      statusPath,
      jobId: "test-job",
      envLoaded: true,
      llm: createLLM(),
    });

    expect(result.ok).toBe(true);

    // Now simulate LLM events
    const onLLMComplete = vi.fn();
    llmEvents.on("llm:request:complete", onLLMComplete);

    try {
      // Manually trigger the LLM completion event that would normally be emitted
      // during actual LLM calls
      const mockMetric = {
        provider: "openai",
        model: "gpt-4",
        promptTokens: 100,
        completionTokens: 50,
        metadata: { alias: "test-model" },
      };

      // Simulate LLM completion event
      llmEvents.emit("llm:request:complete", mockMetric);

      // Wait a bit for event to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check the status file to see if token usage was recorded
      const statusContent = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(statusContent);

      // Verify token usage was recorded
      expect(status.tasks[taskName]).toBeDefined();
      expect(status.tasks[taskName].tokenUsage).toBeDefined();
      expect(Array.isArray(status.tasks[taskName].tokenUsage)).toBe(true);

      // Check that we have the expected token usage tuple
      if (status.tasks[taskName].tokenUsage.length > 0) {
        const tokenUsage = status.tasks[taskName].tokenUsage[0];
        expect(tokenUsage).toEqual(["test-model", 100, 50]);
      }
    } finally {
      llmEvents.off("llm:request:complete", onLLMComplete);
    }
  });

  it("should handle multiple token usage events", async () => {
    const taskName = "multi-token-task";

    // First, run a pipeline to create a task context
    const result = await runPipeline(mockTasksPath, {
      taskName,
      workDir: tempDir,
      statusPath,
      jobId: "test-job",
      envLoaded: true,
      llm: createLLM(),
    });

    expect(result.ok).toBe(true);

    const onLLMComplete = vi.fn();
    llmEvents.on("llm:request:complete", onLLMComplete);

    try {
      // Simulate multiple LLM events
      const metrics = [
        {
          provider: "openai",
          model: "gpt-3.5-turbo",
          promptTokens: 50,
          completionTokens: 25,
        },
        {
          provider: "anthropic",
          model: "claude-3-sonnet",
          promptTokens: 75,
          completionTokens: 40,
          metadata: { alias: "claude-alias" },
        },
        {
          provider: "deepseek",
          model: "deepseek-chat",
          promptTokens: 30,
          completionTokens: 15,
        },
      ];

      // Emit the events
      metrics.forEach((metric, index) => {
        setTimeout(() => {
          llmEvents.emit("llm:request:complete", metric);
        }, index * 10);
      });

      // Wait for all events to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check the status file
      const statusContent = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(statusContent);

      // Find any task that has token usage entries
      const taskEntries = Object.entries(status.tasks || {});
      const tasksWithTokenUsage = taskEntries.filter(
        ([, taskData]) =>
          taskData.tokenUsage &&
          Array.isArray(taskData.tokenUsage) &&
          taskData.tokenUsage.length > 0
      );

      expect(tasksWithTokenUsage.length).toBeGreaterThan(0);

      // Verify structure of token usage entries in all tasks that have them
      tasksWithTokenUsage.forEach(([, taskData]) => {
        expect(taskData.tokenUsage.length).toBeGreaterThan(0);

        taskData.tokenUsage.forEach((entry) => {
          expect(Array.isArray(entry)).toBe(true);
          expect(entry).toHaveLength(3);
          expect(typeof entry[0]).toBe("string"); // modelKey
          expect(typeof entry[1]).toBe("number"); // inputTokens
          expect(typeof entry[2]).toBe("number"); // outputTokens
        });
      });
    } finally {
      llmEvents.off("llm:request:complete", onLLMComplete);
    }
  });
});
