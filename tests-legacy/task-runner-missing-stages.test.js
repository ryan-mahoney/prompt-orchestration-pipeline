import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import * as taskRunner from "../src/core/task-runner.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Get absolute path to the dummy tasks module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dummyTasksPath = path.resolve(__dirname, "./fixtures/dummy-tasks.js");

describe("Missing Stage Handler Tests", () => {
  let tempDir;
  let mockTasksModule;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "task-runner-missing-stages-")
    );

    // Create a mock tasks module with only ingestion and integration stages
    mockTasksModule = {
      ingestion: vi.fn().mockImplementation(async (context) => ({
        output: {
          ingested: true,
          data: context.output,
          processedContent: "processed data",
        },
        flags: { ingestionComplete: true },
      })),
      integration: vi.fn().mockImplementation(async (context) => ({
        output: {
          integrated: true,
          data: context.output,
          finalResult: "integration complete",
        },
        flags: { integrationComplete: true },
      })),
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

  it("should skip missing stages and pass output from last executed stage", async () => {
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { initialData: "test seed" },
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: mockTasksModule, // Only provide ingestion and integration
    });

    // Verify pipeline completed successfully
    expect(result.ok).toBe(true);

    // Verify only the available stages were called
    expect(mockTasksModule.ingestion).toHaveBeenCalledTimes(1);
    expect(mockTasksModule.integration).toHaveBeenCalledTimes(1);

    // Verify ingestion was called with seed data
    expect(mockTasksModule.ingestion).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { initialData: "test seed" }, // Should receive seed as output
        previousStage: "seed",
      })
    );

    // Verify integration was called with ingestion's output
    expect(mockTasksModule.integration).toHaveBeenCalledWith(
      expect.objectContaining({
        output: {
          ingested: true,
          data: { initialData: "test seed" },
          processedContent: "processed data",
        },
        previousStage: "ingestion",
      })
    );

    // Verify the final context contains both stage outputs
    expect(result.context.data.ingestion).toEqual({
      ingested: true,
      data: { initialData: "test seed" },
      processedContent: "processed data",
    });
    expect(result.context.data.integration).toEqual({
      integrated: true,
      data: {
        ingested: true,
        data: { initialData: "test seed" },
        processedContent: "processed data",
      },
      finalResult: "integration complete",
    });

    // Verify that some stages were skipped (missing handlers)
    // Missing stages are logged in result.logs with skipped: true
    const skippedStages = result.logs.filter((log) => log.skipped === true);
    expect(skippedStages.length).toBeGreaterThan(0); // Should have some skipped stages

    // The key assertion: integration receives output from the last executed stage (ingestion)
    // This is verified by the integration call above which receives ingestion's output
  });

  it("should handle edge case with only ingestion stage", async () => {
    const minimalTasksModule = {
      ingestion: vi.fn().mockImplementation(async (context) => ({
        output: { ingested: true, minimal: true },
        flags: { ingestionComplete: true },
      })),
    };

    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: minimalTasksModule, // Only provide ingestion
    });

    // Verify pipeline completed successfully
    expect(result.ok).toBe(true);

    // Verify only ingestion was called
    expect(minimalTasksModule.ingestion).toHaveBeenCalledTimes(1);

    // Verify ingestion received seed data
    expect(minimalTasksModule.ingestion).toHaveBeenCalledWith(
      expect.objectContaining({
        output: {}, // Empty seed
        previousStage: "seed",
      })
    );

    // Verify final context contains ingestion output
    expect(result.context.data.ingestion).toEqual({
      ingested: true,
      minimal: true,
    });
  });

  it("should handle edge case with only integration stage", async () => {
    const minimalTasksModule = {
      integration: vi.fn().mockImplementation(async (context) => ({
        output: { integrated: true, fromSeed: true },
        flags: { integrationComplete: true },
      })),
    };

    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { testData: "direct to integration" },
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: minimalTasksModule, // Only provide integration
    });

    // Verify pipeline completed successfully
    expect(result.ok).toBe(true);

    // Verify only integration was called
    expect(minimalTasksModule.integration).toHaveBeenCalledTimes(1);

    // Verify integration received seed data directly (no previous stage)
    expect(minimalTasksModule.integration).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { testData: "direct to integration" },
        previousStage: "seed",
      })
    );

    // Verify final context contains integration output
    expect(result.context.data.integration).toEqual({
      integrated: true,
      fromSeed: true,
    });
  });

  it("should handle edge case with no stages provided", async () => {
    const emptyTasksModule = {};

    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { testData: "no stages test" },
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: emptyTasksModule, // No stages provided
    });

    // Verify pipeline completed successfully (all stages skipped)
    expect(result.ok).toBe(true);

    // Verify final context contains only seed data
    expect(result.context.data).toEqual({
      seed: { testData: "no stages test" },
    });

    // Verify all stages were skipped
    const skippedStages = result.logs.filter((log) => log.skipped === true);
    expect(skippedStages.length).toBeGreaterThan(0);
  });

  it("should properly chain stages with gaps", async () => {
    // Create a tasks module with non-consecutive stages: ingestion -> parsing -> integration
    const gappedTasksModule = {
      ingestion: vi.fn().mockImplementation(async (context) => ({
        output: { ingested: true, step: 1 },
        flags: { ingestionComplete: true },
      })),
      parsing: vi.fn().mockImplementation(async (context) => ({
        output: { parsed: true, step: 2, data: context.output },
        flags: { parsingComplete: true },
      })),
      integration: vi.fn().mockImplementation(async (context) => ({
        output: { integrated: true, step: 3, data: context.output },
        flags: { integrationComplete: true },
      })),
    };

    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { startData: "gapped test" },
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(dummyTasksPath, {
      ...initialContext,
      tasksOverride: gappedTasksModule,
    });

    // Verify pipeline completed successfully
    expect(result.ok).toBe(true);

    // Verify all provided stages were called in order
    expect(gappedTasksModule.ingestion).toHaveBeenCalledTimes(1);
    expect(gappedTasksModule.parsing).toHaveBeenCalledTimes(1);
    expect(gappedTasksModule.integration).toHaveBeenCalledTimes(1);

    // Verify ingestion received seed data
    expect(gappedTasksModule.ingestion).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { startData: "gapped test" },
        previousStage: "seed",
      })
    );

    // Verify parsing received ingestion's output (skipping missing stages)
    expect(gappedTasksModule.parsing).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { ingested: true, step: 1 },
        previousStage: "ingestion",
      })
    );

    // Verify integration received parsing's output (skipping missing stages)
    expect(gappedTasksModule.integration).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { parsed: true, step: 2, data: { ingested: true, step: 1 } },
        previousStage: "parsing",
      })
    );

    // Verify final context contains all stage outputs in correct order
    expect(result.context.data.ingestion).toEqual({
      ingested: true,
      step: 1,
    });
    expect(result.context.data.parsing).toEqual({
      parsed: true,
      step: 2,
      data: { ingested: true, step: 1 },
    });
    expect(result.context.data.integration).toEqual({
      integrated: true,
      step: 3,
      data: { parsed: true, step: 2, data: { ingested: true, step: 1 } },
    });
  });
});
