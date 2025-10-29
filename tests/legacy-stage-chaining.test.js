import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as taskRunner from "../src/core/task-runner.js";
import { fileURLToPath } from "node:url";

// Get absolute path to the dummy tasks module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dummyTasksPath = path.resolve(__dirname, "./fixtures/dummy-tasks.js");

describe("Legacy Stage Chaining", () => {
  let tempDir;
  let mockTasksModule;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-chaining-test-"));

    // Create logs directory for testing
    await fs.mkdir(path.join(tempDir, "test-job-123", "files", "logs"), {
      recursive: true,
    });

    // Create mock tasks that simulate legacy behavior
    mockTasksModule = {
      // Required for validation - make it pass so no refinement is triggered
      validateStructure: vi.fn((context) => {
        expect(context.data.seed).toBeDefined();
        expect(context.data.seed.data).toEqual({ test: "data" });
        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      }),

      // Required for refinement - include empty implementations to prevent errors
      critique: vi.fn((context) => {
        return {
          output: { critique: "no critique needed" },
          flags: { critiqueComplete: true },
        };
      }),

      refine: vi.fn((context) => {
        return {
          output: { refined: false },
          flags: { refined: false },
        };
      }),

      // Legacy ingestion stage - expects context.data.seed
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

    // Create vi.fn() spies for each function to track calls
    Object.keys(mockTasksModule).forEach((name) => {
      mockTasksModule[name] = vi.fn().mockImplementation(mockTasksModule[name]);
    });

    // Mock performance.now()
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should populate stageContext.output from previous stage for legacy stages", async () => {
    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "test-task",
      workDir: tempDir,
      statusPath: path.join(tempDir, "status.json"),
      jobId: "test-job-123",
    };

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: mockTasksModule,
    });

    if (!result.ok) {
      console.log("Pipeline failed:", result);
    }

    expect(result.ok).toBe(true);

    // Verify all legacy stages were called
    expect(mockTasksModule.ingestion).toHaveBeenCalled();
    expect(mockTasksModule.promptTemplating).toHaveBeenCalled();
    expect(mockTasksModule.inference).toHaveBeenCalled();

    // Verify stage chaining worked correctly
    const promptTemplatingCall =
      mockTasksModule.promptTemplating.mock.calls[0][0];
    expect(promptTemplatingCall.output).toBe("ingested");

    const inferenceCall = mockTasksModule.inference.mock.calls[0][0];
    expect(inferenceCall.output).toBe("templated");

    // Verify outputs are stored in context.data
    expect(result.context.data.ingestion).toBe("ingested");
    expect(result.context.data.promptTemplating).toBe("templated");
    expect(result.context.data.inference).toBe("inferred");
  });

  it("should handle missing previous stage gracefully", async () => {
    // Mock tasks with only promptTemplating (no ingestion before it) plus required stages
    const partialMockTasks = {
      validateStructure: vi.fn((context) => {
        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      }),
      critique: vi.fn((context) => {
        return {
          output: { critique: "no critique needed" },
          flags: { critiqueComplete: true },
        };
      }),
      refine: vi.fn((context) => {
        return {
          output: { refined: false },
          flags: { refined: false },
        };
      }),
      promptTemplating: vi.fn((context) => {
        // Should not have context.output when no previous stage
        expect(context.output).toBeUndefined();
        return { output: "templated", flags: {} };
      }),
    };

    // Create logs directory for this test too
    await fs.mkdir(path.join(tempDir, "test-job-123", "files", "logs"), {
      recursive: true,
    });

    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "test-task",
      workDir: tempDir,
      statusPath: path.join(tempDir, "status.json"),
      jobId: "test-job-123",
    };

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: partialMockTasks,
    });

    if (!result.ok) {
      console.log("Pipeline failed:", result);
    }

    expect(result.ok).toBe(true);
    expect(partialMockTasks.promptTemplating).toHaveBeenCalled();

    const call = partialMockTasks.promptTemplating.mock.calls[0][0];
    expect(call.output).toBeUndefined();
  });

  it("should find nearest previous stage when intermediate stage is missing", async () => {
    // Mock tasks with ingestion, missing promptTemplating, but having inference plus required stages
    const gapMockTasks = {
      validateStructure: vi.fn((context) => {
        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      }),
      critique: vi.fn((context) => {
        return {
          output: { critique: "no critique needed" },
          flags: { critiqueComplete: true },
        };
      }),
      refine: vi.fn((context) => {
        return {
          output: { refined: false },
          flags: { refined: false },
        };
      }),
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

    // Create logs directory for this test too
    await fs.mkdir(path.join(tempDir, "test-job-123", "files", "logs"), {
      recursive: true,
    });

    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "test-task",
      workDir: tempDir,
      statusPath: path.join(tempDir, "status.json"),
      jobId: "test-job-123",
    };

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: gapMockTasks,
    });

    if (!result.ok) {
      console.log("Pipeline failed:", result);
    }

    expect(result.ok).toBe(true);
    expect(gapMockTasks.ingestion).toHaveBeenCalled();
    expect(gapMockTasks.inference).toHaveBeenCalled();

    const inferenceCall = gapMockTasks.inference.mock.calls[0][0];
    expect(inferenceCall.output).toBe("ingested"); // Should skip missing promptTemplating and find ingestion
  });
});
