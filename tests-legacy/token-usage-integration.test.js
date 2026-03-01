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

    // Set up LLM event listener before running pipeline
    const onLLMComplete = vi.fn();
    llmEvents.on("llm:request:complete", onLLMComplete);

    try {
      // Create a task that will emit LLM events during execution
      const mockTasksWithLLMContent = `
export async function inference(context) {
  // Simulate LLM call by emitting event directly
  const mockMetric = {
    provider: "openai",
    model: "gpt-4",
    promptTokens: 100,
    completionTokens: 50,
    metadata: { alias: "test-model" }
  };
  
  // Wait a moment to ensure context is properly set
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Emit LLM completion event (this is what the chat() function would do)
  const { getLLMEvents } = await import("../src/llm/index.js");
  getLLMEvents().emit("llm:request:complete", mockMetric);
  
  // Wait another moment for the event to be processed
  await new Promise(resolve => setTimeout(resolve, 20));
  
  return { output: "Mock response", flags: {} };
}

export async function parsing(context) {
  return { output: { parsed: true }, flags: {} };
}

export async function integration(context) {
  return { output: { integrated: true }, flags: {} };
}
`;
      await fs.writeFile(mockTasksPath, mockTasksWithLLMContent);

      // Run pipeline - LLM events will be emitted during execution
      const result = await runPipeline(mockTasksPath, {
        taskName,
        workDir: tempDir,
        statusPath,
        jobId: "test-job",
        envLoaded: true,
        llm: createLLM(),
      });

      expect(result.ok).toBe(true);

      // Wait a bit for all events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check status file to see if token usage was recorded
      const statusContent = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(statusContent);

      // Verify token usage was recorded
      expect(status.tasks[taskName]).toBeDefined();
      expect(status.tasks[taskName].tokenUsage).toBeDefined();
      expect(Array.isArray(status.tasks[taskName].tokenUsage)).toBe(true);

      // Check that we have the expected token usage tuple
      expect(status.tasks[taskName].tokenUsage.length).toBeGreaterThan(0);
      const tokenUsage = status.tasks[taskName].tokenUsage[0];
      expect(tokenUsage).toEqual(["test-model", 100, 50]);
    } finally {
      llmEvents.off("llm:request:complete", onLLMComplete);
    }
  });

  it("should handle multiple token usage events", async () => {
    const taskName = "multi-token-task";

    // Set up LLM event listener before running pipeline
    const onLLMComplete = vi.fn();
    llmEvents.on("llm:request:complete", onLLMComplete);

    try {
      // Create a task that will emit multiple LLM events during execution
      const mockTasksWithMultipleLLMContent = `
export async function inference(context) {
  // Simulate multiple LLM calls by emitting multiple events
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
  
  // Emit multiple LLM completion events (simulating multiple LLM calls)
  const { getLLMEvents } = await import("../src/llm/index.js");
  const llmEvents = getLLMEvents();
  
  metrics.forEach((metric, index) => {
    setTimeout(() => {
      llmEvents.emit("llm:request:complete", metric);
    }, index * 10);
  });
  
  // Wait for all events to be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  
  return { output: "Mock response with multiple LLM calls", flags: {} };
}

export async function parsing(context) {
  return { output: { parsed: true }, flags: {} };
}

export async function integration(context) {
  return { output: { integrated: true }, flags: {} };
}
`;
      await fs.writeFile(mockTasksPath, mockTasksWithMultipleLLMContent);

      // Run pipeline - LLM events will be emitted during execution
      const result = await runPipeline(mockTasksPath, {
        taskName,
        workDir: tempDir,
        statusPath,
        jobId: "test-job",
        envLoaded: true,
        llm: createLLM(),
      });

      expect(result.ok).toBe(true);

      // Wait for all events to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check status file
      const statusContent = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(statusContent);

      // Find the task that should have token usage entries
      expect(status.tasks[taskName]).toBeDefined();
      expect(status.tasks[taskName].tokenUsage).toBeDefined();
      expect(Array.isArray(status.tasks[taskName].tokenUsage)).toBe(true);
      expect(status.tasks[taskName].tokenUsage.length).toBeGreaterThan(0);

      // Verify structure of token usage entries
      status.tasks[taskName].tokenUsage.forEach((entry) => {
        expect(Array.isArray(entry)).toBe(true);
        expect(entry).toHaveLength(3);
        expect(typeof entry[0]).toBe("string"); // modelKey
        expect(typeof entry[1]).toBe("number"); // inputTokens
        expect(typeof entry[2]).toBe("number"); // outputTokens
      });

      // Verify we have the expected model keys
      const modelKeys = status.tasks[taskName].tokenUsage.map(
        (entry) => entry[0]
      );
      expect(modelKeys).toContain("openai:gpt-3.5-turbo");
      expect(modelKeys).toContain("claude-alias");
      expect(modelKeys).toContain("deepseek:deepseek-chat");
    } finally {
      llmEvents.off("llm:request:complete", onLLMComplete);
    }
  });
});
