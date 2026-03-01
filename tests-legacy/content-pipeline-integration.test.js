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

describe("Content Pipeline Integration Tests", () => {
  let tempDir;
  let mockTasksModule;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "content-pipeline-test-")
    );

    // Create mock content pipeline tasks
    mockTasksModule = {
      // Required for validation - make it pass so no refinement is triggered
      validateStructure: vi.fn((context) => {
        expect(context.data.seed).toBeDefined();
        return {
          output: { validationPassed: true, details: "All good" },
          flags: { validationFailed: false, timestamp: Date.now() },
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

      // New-style ingestion task
      ingestion: vi.fn((context) => {
        expect(context.data.seed).toBeDefined();
        expect(context.previousStage).toBe("seed");
        expect(context.output).toEqual(context.data.seed);
        return {
          output: {
            topic: "Research Topic",
            content: "Ingested content",
            source: context.data.seed.data?.source || "unknown",
          },
          flags: { ingestionComplete: true },
        };
      }),

      // New-style promptTemplating task
      promptTemplating: vi.fn((context) => {
        expect(context.previousStage).toBe("ingestion");
        expect(context.output).toBeDefined();
        expect(context.output.topic).toBe("Research Topic");
        return {
          output: {
            ...context.output,
            system: "You are a helpful assistant",
            prompt: `Analyze: ${context.output.topic}`,
          },
          flags: { templateReady: true },
        };
      }),

      // New-style inference task
      inference: vi.fn((context) => {
        expect(context.previousStage).toBe("promptTemplating");
        expect(context.output).toBeDefined();
        expect(context.output.prompt).toContain("Research Topic");
        return {
          output: {
            ...context.output,
            response: "Analysis complete",
            model: "test-model",
          },
          flags: { inferenceComplete: true },
        };
      }),

      // New-style integration task
      integration: vi.fn((context) => {
        expect(context.previousStage).toBe("inference");
        expect(context.output).toBeDefined();
        expect(context.output.response).toBe("Analysis complete");
        return {
          output: {
            finalResult: context.output.response,
            metadata: {
              model: context.output.model,
              topic: context.output.topic,
            },
          },
          flags: { integrationComplete: true },
        };
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

  it("should execute content pipeline with new context contract", async () => {
    // Create logs directory for this test
    await fs.mkdir(
      path.join(tempDir, "content-pipeline-123", "files", "logs"),
      {
        recursive: true,
      }
    );

    const initialContext = {
      seed: {
        data: {
          test: "data",
          source: "test-source",
          topic: "Research Topic",
        },
      },
      taskName: "content-pipeline-test",
      workDir: tempDir,
      statusPath: path.join(tempDir, "status.json"),
      jobId: "content-pipeline-123",
    };

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: mockTasksModule,
    });

    if (!result.ok) {
      console.log("Pipeline failed:", result);
    }

    expect(result.ok).toBe(true);

    // Verify all stages were called
    expect(mockTasksModule.validateStructure).toHaveBeenCalled();
    expect(mockTasksModule.ingestion).toHaveBeenCalled();
    expect(mockTasksModule.promptTemplating).toHaveBeenCalled();
    expect(mockTasksModule.inference).toHaveBeenCalled();
    expect(mockTasksModule.integration).toHaveBeenCalled();

    // Verify context.data contains all stage outputs
    expect(result.context.data.seed).toEqual(initialContext.seed);
    expect(result.context.data.validateStructure).toEqual({
      validationPassed: true,
      details: "All good",
    });
    expect(result.context.data.ingestion).toEqual({
      topic: "Research Topic",
      content: "Ingested content",
      source: "test-source",
    });
    expect(result.context.data.integration).toEqual({
      finalResult: "Analysis complete",
      metadata: {
        model: "test-model",
        topic: "Research Topic",
      },
    });

    // Verify context.flags are accumulated
    expect(result.context.flags.validationFailed).toBe(false);
    expect(result.context.flags.ingestionComplete).toBe(true);
    expect(result.context.flags.templateReady).toBe(true);
    expect(result.context.flags.inferenceComplete).toBe(true);
    expect(result.context.flags.integrationComplete).toBe(true);
  });

  it("should handle research task with context.data.seed access", async () => {
    // Create logs directory for this test
    await fs.mkdir(path.join(tempDir, "research-123", "files", "logs"), {
      recursive: true,
    });

    // Create research-specific mock tasks
    const researchMockTasks = {
      validateStructure: vi.fn((context) => {
        expect(context.data.seed).toBeDefined();
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
        // Research task should access seed from context.data
        const { data = {} } = context;
        const { seed = {} } = data;
        const { data: seedData = {} } = seed;

        expect(seedData.topic).toBeDefined();

        expect(context.previousStage).toBe("seed");
        expect(context.output).toEqual(context.data.seed);

        return {
          output: {
            topic: seedData.topic || "Unknown topic",
            focusAreas: seedData.focusAreas || [],
            requirements: seedData,
          },
          flags: {},
        };
      }),
    };

    // Create vi.fn() spies
    Object.keys(researchMockTasks).forEach((name) => {
      researchMockTasks[name] = vi
        .fn()
        .mockImplementation(researchMockTasks[name]);
    });

    const initialContext = {
      seed: {
        data: {
          topic: "AI Research",
          focusAreas: ["machine learning", "neural networks"],
        },
      },
      taskName: "research-test",
      workDir: tempDir,
      statusPath: path.join(tempDir, "status.json"),
      jobId: "research-123",
    };

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: researchMockTasks,
    });

    if (!result.ok) {
      console.log("Pipeline failed:", result);
    }

    expect(result.ok).toBe(true);

    // Verify research task correctly accessed context.data.seed
    expect(researchMockTasks.ingestion).toHaveBeenCalled();
    expect(researchMockTasks.validateStructure).toHaveBeenCalled();

    const ingestionCall = researchMockTasks.ingestion.mock.calls[0][0];
    expect(ingestionCall.data.seed.data.topic).toBe("AI Research");

    expect(result.context.data.ingestion).toEqual({
      topic: "AI Research",
      focusAreas: ["machine learning", "neural networks"],
      requirements: initialContext.seed.data,
    });
    expect(result.context.data.validateStructure).toEqual({
      validationPassed: true,
    });
  });

  it("should populate stageContext.output for legacy-style stages", async () => {
    // Create logs directory for this test
    await fs.mkdir(path.join(tempDir, "mixed-123", "files", "logs"), {
      recursive: true,
    });

    // Create mixed mock tasks (new-style and legacy-style)
    const mixedMockTasks = {
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

      // New-style stage
      ingestion: vi.fn((context) => {
        expect(context.data.seed).toBeDefined();
        expect(context.previousStage).toBe("seed");
        expect(context.output).toEqual(context.data.seed);
        return { output: "ingested-data", flags: {} };
      }),

      // New-style stage that expects context.output
      promptTemplating: vi.fn((context) => {
        expect(context.previousStage).toBe("ingestion");
        expect(context.output).toBe("ingested-data");
        return { output: "templated-data", flags: {} }; // New return format
      }),

      // New-style stage
      integration: vi.fn((context) => {
        expect(context.previousStage).toBe("promptTemplating");
        expect(context.output).toBe("templated-data");
        return { output: "final-result", flags: {} };
      }),
    };

    // Create vi.fn() spies
    Object.keys(mixedMockTasks).forEach((name) => {
      mixedMockTasks[name] = vi.fn().mockImplementation(mixedMockTasks[name]);
    });

    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "mixed-test",
      workDir: tempDir,
      statusPath: path.join(tempDir, "status.json"),
      jobId: "mixed-123",
    };

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: mixedMockTasks,
    });

    if (!result.ok) {
      console.log("Pipeline failed:", result);
    }

    expect(result.ok).toBe(true);

    // Verify stage chaining worked for mixed tasks
    const promptTemplatingCall =
      mixedMockTasks.promptTemplating.mock.calls[0][0];
    expect(promptTemplatingCall.output).toBe("ingested-data");

    const integrationCall = mixedMockTasks.integration.mock.calls[0][0];
    expect(integrationCall.output).toBe("templated-data");

    // Verify outputs are stored correctly
    expect(result.context.data.ingestion).toBe("ingested-data");
    expect(result.context.data.promptTemplating).toBe("templated-data");
    expect(result.context.data.integration).toBe("final-result");
  });

  it("should persist context structure to status file", async () => {
    const statusPath = path.join(tempDir, "tasks-status.json");
    const jobId = "status-123";

    // Create logs directory for this test
    await fs.mkdir(path.join(tempDir, jobId, "files", "logs"), {
      recursive: true,
    });

    const initialContext = {
      seed: { data: { test: "status-test" } },
      taskName: "status-test",
      workDir: tempDir,
      statusPath,
      jobId,
    };

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: mockTasksModule,
    });

    if (!result.ok) {
      console.log("Pipeline failed:", result);
    }

    // Read status file
    const statusContent = await fs.readFile(statusPath, "utf8");
    const statusData = JSON.parse(statusContent);

    // Verify new context structure is persisted
    expect(statusData.data).toBeDefined();
    expect(statusData.data.seed).toEqual(initialContext.seed);
    expect(statusData.data.validateStructure).toBeDefined();
    expect(statusData.data.ingestion).toBeDefined();

    expect(statusData.flags).toBeDefined();
    expect(statusData.flags.validationFailed).toBe(false);
    expect(statusData.flags.ingestionComplete).toBe(true);

    expect(statusData.logs).toBeDefined();
    expect(statusData.currentStage).toBeDefined();
    expect(statusData.refinementCount).toBeDefined();
    expect(statusData.lastUpdated).toBeDefined();
  });
});
