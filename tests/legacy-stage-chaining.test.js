import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPipeline } from "../src/core/task-runner.js";

describe("Legacy Stage Chaining", () => {
  let mockTasks;

  beforeEach(() => {
    // Mock environment loading
    vi.mock("../src/core/environment.js", () => ({
      loadEnvironment: vi.fn().mockResolvedValue(undefined),
    }));

    // Mock LLM creation
    vi.mock("../src/llm/index.js", () => ({
      createLLM: vi.fn().mockReturnValue({
        openai: { chat: vi.fn() },
        deepseek: { chat: vi.fn() },
      }),
      getLLMEvents: vi.fn().mockReturnValue({
        on: vi.fn(),
        off: vi.fn(),
      }),
    }));

    // Mock config
    vi.mock("../src/core/config.js", () => ({
      getConfig: vi.fn().mockReturnValue({}),
    }));

    // Mock file IO
    vi.mock("../src/core/file-io.js", () => ({
      createTaskFileIO: vi.fn().mockReturnValue({
        readFile: vi.fn(),
        writeFile: vi.fn(),
        listFiles: vi.fn(),
      }),
    }));

    // Create mock tasks that simulate legacy behavior
    mockTasks = {
      // Legacy ingestion stage - expects context.seed.data
      ingestion: vi.fn((context) => {
        // Should read from context.data.seed (new structure)
        expect(context.data.seed).toBeDefined();
        expect(context.data.seed.data).toEqual({ test: "data" });
        return { output: "ingested", flags: {} };
      }),

      // Legacy promptTemplating stage - expects context.output from ingestion
      promptTemplating: vi.fn((context) => {
        // Should have context.output populated from previous stage (ingestion)
        expect(context.output).toBe("ingested");
        return { output: "templated", flags: {} };
      }),

      // Legacy inference stage - expects context.output from promptTemplating
      inference: vi.fn((context) => {
        // Should have context.output populated from previous stage (promptTemplating)
        expect(context.output).toBe("templated");
        return { output: "inferred", flags: {} };
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should populate stageContext.output from previous stage for legacy stages", async () => {
    const modulePath = "/fake/path/to/tasks.js";

    // Mock module loading to return our mock tasks
    vi.doMock("/fake/path/to/tasks.js", () => mockTasks, { virtual: true });

    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "test-task",
      workDir: "/tmp/test",
      statusPath: "/tmp/test/status.json",
      jobId: "test-job-123",
    };

    const result = await runPipeline(modulePath, initialContext);

    expect(result.ok).toBe(true);

    // Verify all legacy stages were called
    expect(mockTasks.ingestion).toHaveBeenCalled();
    expect(mockTasks.promptTemplating).toHaveBeenCalled();
    expect(mockTasks.inference).toHaveBeenCalled();

    // Verify stage chaining worked correctly
    const promptTemplatingCall = mockTasks.promptTemplating.mock.calls[0][0];
    expect(promptTemplatingCall.output).toBe("ingested");

    const inferenceCall = mockTasks.inference.mock.calls[0][0];
    expect(inferenceCall.output).toBe("templated");

    // Verify outputs are stored in context.data
    expect(result.context.data.ingestion).toBe("ingested");
    expect(result.context.data.promptTemplating).toBe("templated");
    expect(result.context.data.inference).toBe("inferred");
  });

  it("should handle missing previous stage gracefully", async () => {
    const modulePath = "/fake/path/to/tasks.js";

    // Mock tasks with only promptTemplating (no ingestion before it)
    const partialMockTasks = {
      promptTemplating: vi.fn((context) => {
        // Should not have context.output when no previous stage
        expect(context.output).toBeUndefined();
        return { output: "templated", flags: {} };
      }),
    };

    vi.doMock("/fake/path/to/tasks.js", () => partialMockTasks, {
      virtual: true,
    });

    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "test-task",
      workDir: "/tmp/test",
      statusPath: "/tmp/test/status.json",
      jobId: "test-job-123",
    };

    const result = await runPipeline(modulePath, initialContext);

    expect(result.ok).toBe(true);
    expect(partialMockTasks.promptTemplating).toHaveBeenCalled();

    const call = partialMockTasks.promptTemplating.mock.calls[0][0];
    expect(call.output).toBeUndefined();
  });

  it("should find nearest previous stage when intermediate stage is missing", async () => {
    const modulePath = "/fake/path/to/tasks.js";

    // Mock tasks with ingestion, missing promptTemplating, but having inference
    const gapMockTasks = {
      ingestion: vi.fn((context) => {
        return { output: "ingested", flags: {} };
      }),
      // promptTemplating is missing
      inference: vi.fn((context) => {
        // Should find ingestion as the nearest previous stage
        expect(context.output).toBe("ingested");
        return { output: "inferred", flags: {} };
      }),
    };

    vi.doMock("/fake/path/to/tasks.js", () => gapMockTasks, { virtual: true });

    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "test-task",
      workDir: "/tmp/test",
      statusPath: "/tmp/test/status.json",
      jobId: "test-job-123",
    };

    const result = await runPipeline(modulePath, initialContext);

    expect(result.ok).toBe(true);
    expect(gapMockTasks.ingestion).toHaveBeenCalled();
    expect(gapMockTasks.inference).toHaveBeenCalled();

    const inferenceCall = gapMockTasks.inference.mock.calls[0][0];
    expect(inferenceCall.output).toBe("ingested"); // Should skip missing promptTemplating and find ingestion
  });
});
