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

describe("Legacy Stage Integration Test", () => {
  let tempDir;
  let mockTasksModule;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "legacy-integration-test-")
    );

    // Create logs directory for testing
    await fs.mkdir(path.join(tempDir, "test-job-123", "files", "logs"), {
      recursive: true,
    });

    // Create mock legacy tasks that demonstrate real usage
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

      // Legacy-style task that expects context.output chaining
      ingestion: vi.fn((context) => {
        expect(context.data.seed).toBeDefined();
        expect(context.data.seed.data).toEqual({ test: "data" });
        return { output: "ingested-data", flags: { ingestionComplete: true } };
      }),

      // Legacy-style task that expects context.output from previous stage
      promptTemplating: vi.fn((context) => {
        expect(context.output).toBe("ingested-data");
        return { output: "templated-data", flags: { templateReady: true } };
      }),

      // Legacy-style task that expects context.output from previous stage
      parsing: vi.fn((context) => {
        expect(context.output).toBe("templated-data");
        return { output: "parsed-data", flags: { parsingComplete: true } };
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

  it("should demonstrate legacy stage chaining works with real task-runner", async () => {
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

    // Verify the legacy stages were executed and chained correctly
    expect(mockTasksModule.ingestion).toHaveBeenCalled();
    expect(mockTasksModule.promptTemplating).toHaveBeenCalled();
    expect(mockTasksModule.parsing).toHaveBeenCalled();

    // Verify stage chaining: promptTemplating should receive ingestion output
    const promptTemplatingCall =
      mockTasksModule.promptTemplating.mock.calls[0][0];
    expect(promptTemplatingCall.output).toBe("ingested-data");

    // Verify stage chaining: parsing should receive promptTemplating output
    const parsingCall = mockTasksModule.parsing.mock.calls[0][0];
    expect(parsingCall.output).toBe("templated-data");

    // Verify outputs are stored in context.data
    expect(result.context.data.ingestion).toBe("ingested-data");
    expect(result.context.data.promptTemplating).toBe("templated-data");
    expect(result.context.data.parsing).toBe("parsed-data");

    // Verify flags are accumulated
    expect(result.context.flags.validationFailed).toBe(false);
    expect(result.context.flags.ingestionComplete).toBe(true);
    expect(result.context.flags.templateReady).toBe(true);
    expect(result.context.flags.parsingComplete).toBe(true);
  });
});
