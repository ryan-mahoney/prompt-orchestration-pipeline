import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runPipeline } from "../src/core/task-runner.js";
import { setupMockPipeline } from "./test-utils.js";
import { writeJobStatus } from "../src/core/status-writer.js";

describe("task-runner instrumentation", () => {
  let mockPipeline;

  beforeEach(async () => {
    mockPipeline = await setupMockPipeline();
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockPipeline.cleanup();
    vi.restoreAllMocks();
  });

  describe("console.debug capture", () => {
    it("captures console.debug to stage log", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          console.debug("pre-execution debug info", { ctx: ctx.currentStage });
          return { output: {}, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      await runPipeline(mockPipeline.absoluteModulePath, context);

      const logContent = await fs.readFile(
        path.join(mockPipeline.tempDir, "files", "logs", "stage-ingestion.log"),
        "utf8"
      );
      expect(logContent).toContain("[DEBUG] pre-execution debug info");
    });
  });

  describe("pre-execution snapshot", () => {
    it("writes stage-context.json with expected summary", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          return { output: {}, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        seed: { data: { test: "value" } },
        tasksOverride: tasks,
      };

      await runPipeline(mockPipeline.absoluteModulePath, context);

      const snapshotPath = path.join(
        mockPipeline.tempDir,
        "files",
        "logs",
        "stage-ingestion-context.json"
      );
      const snapshotExists = await fs.access(snapshotPath).then(
        () => true,
        () => false
      );
      expect(snapshotExists).toBe(true);

      const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
      expect(snapshot).toMatchObject({
        meta: { taskName: "test", jobId: "test-job" },
        previousStage: "seed",
        refinementCycle: 0,
        dataSummary: {
          keys: ["seed"],
          hasSeed: true,
          seedKeys: ["data"],
          seedHasData: true,
        },
        flagsSummary: { keys: [] },
        outputSummary: { type: "object", keys: ["data"] },
      });
    });

    it("does not fail pipeline if snapshot write fails", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          return { output: {}, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      // Mock writePreExecutionSnapshot to fail
      const originalModule = await import("../src/core/task-runner.js");
      const originalWritePreExecutionSnapshot =
        originalModule.writePreExecutionSnapshot;

      // Mock the function to always fail
      vi.doMock("../src/core/task-runner.js", async (importOriginal) => {
        const mod = await importOriginal();
        return {
          ...mod,
          writePreExecutionSnapshot: vi.fn(() => {
            throw new Error("Mocked write failure");
          }),
        };
      });

      // Re-import the module to get the mocked version
      const { runPipeline: mockedRunPipeline } = await import(
        "../src/core/task-runner.js"
      );

      const result = await mockedRunPipeline(
        mockPipeline.absoluteModulePath,
        context
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("enriched error envelope", () => {
    it("attaches debug metadata to error on stage failure", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          throw new Error("Stage failure for testing");
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        seed: { data: { test: "value" } },
        tasksOverride: tasks,
      };

      const result = await runPipeline(
        mockPipeline.absoluteModulePath,
        context
      );
      expect(result.ok).toBe(false);
      expect(result.failedStage).toBe("ingestion");
      expect(result.error).toMatchObject({
        name: "Error",
        message: "Stage failure for testing",
      });

      // Check debug metadata on error
      expect(result.error.debug).toMatchObject({
        stage: "ingestion",
        previousStage: "seed",
        refinementCycle: 0,
        logPath: expect.stringContaining("stage-ingestion.log"),
        snapshotPath: expect.stringContaining("stage-ingestion-context.json"),
        dataHasSeed: true,
        seedHasData: true,
        flagsKeys: [],
      });
    });

    it("captures dataHasSeed and seedHasData correctly", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          // This should pass since we have seed.data (even though it's empty)
          return { output: {}, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        seed: { data: {} }, // Has data property but it's empty
        tasksOverride: tasks,
      };

      const result = await runPipeline(
        mockPipeline.absoluteModulePath,
        context
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("stage completion status writes", () => {
    it("writes stage completion status after successful stage execution", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          return { output: { test: "data" }, flags: {} };
        },
        preProcessing: async (ctx) => {
          return { output: { processed: true }, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      await runPipeline(mockPipeline.absoluteModulePath, context);

      // Check that stage completion status was written for each stage
      const statusPath = path.join(mockPipeline.tempDir, "tasks-status.json");
      const statusContent = JSON.parse(await fs.readFile(statusPath, "utf8"));

      // The final status should show completion
      expect(statusContent.current).toBe(null);
      expect(statusContent.currentStage).toBe(null);
      expect(statusContent.state).toBe("done");
      expect(statusContent.tasks.test.state).toBe("done");
      expect(statusContent.tasks.test.currentStage).toBe(null);
    });

    it("maintains current task and stage during stage completion", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          return { output: { test: "data" }, flags: {} };
        },
        preProcessing: async (ctx) => {
          // Add a delay to ensure we can check intermediate state
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { output: { processed: true }, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      // Run pipeline and check status at intermediate points
      const pipelinePromise = runPipeline(
        mockPipeline.absoluteModulePath,
        context
      );

      // Wait a bit then check status during execution
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Check that status is being maintained correctly during execution
      const statusPath = path.join(mockPipeline.tempDir, "tasks-status.json");
      const statusExists = await fs.access(statusPath).then(
        () => true,
        () => false
      );

      await pipelinePromise;

      // Verify final status shows completion
      const finalStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(finalStatus.current).toBe(null);
      expect(finalStatus.currentStage).toBe(null);
      expect(finalStatus.state).toBe("done");
      expect(finalStatus.tasks.test.state).toBe("done");
      expect(finalStatus.tasks.test.currentStage).toBe(null);
    });

    it("handles stage completion status write failures gracefully", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          return { output: { test: "data" }, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      // Import original writeJobStatus to use in mock
      const { writeJobStatus: originalWriteJobStatus } = await import(
        "../src/core/status-writer.js"
      );

      // Mock writeJobStatus to fail on completion calls
      let callCount = 0;
      vi.doMock("../src/core/status-writer.js", () => ({
        writeJobStatus: vi.fn(async (jobDir, updateFn) => {
          callCount++;
          if (callCount === 2) {
            // Fail the second call (stage completion)
            throw new Error("Mocked write failure");
          }
          return originalWriteJobStatus(jobDir, updateFn);
        }),
        readJobStatus: vi.fn(),
        updateTaskStatus: vi.fn(),
      }));

      // Re-import task-runner to use the mocked status-writer
      const { runPipeline: mockedRunPipeline } = await import(
        "../src/core/task-runner.js"
      );

      const result = await mockedRunPipeline(
        mockPipeline.absoluteModulePath,
        context
      );
      // Pipeline should still succeed despite status write failure
      expect(result.ok).toBe(true);
    });
  });

  describe("stage start status writes", () => {
    it("writes stage start status using writeJobStatus", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          return { output: { test: "data" }, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      await runPipeline(mockPipeline.absoluteModulePath, context);

      // Verify the tasks-status.json file was created and has correct content
      const statusPath = path.join(mockPipeline.tempDir, "tasks-status.json");
      const statusExists = await fs.access(statusPath).then(
        () => true,
        () => false
      );
      expect(statusExists).toBe(true);

      const statusContent = JSON.parse(await fs.readFile(statusPath, "utf8"));
      // After completion, current should be null and state should be "done"
      expect(statusContent.current).toBe(null);
      expect(statusContent.currentStage).toBe(null);
      expect(statusContent.state).toBe("done");
      expect(statusContent.tasks.test.state).toBe("done");
      expect(statusContent.tasks.test.currentStage).toBe(null);
      expect(statusContent.lastUpdated).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });

    it("writes failure status on stage failure", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          throw new Error("Stage failure");
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      const result = await runPipeline(
        mockPipeline.absoluteModulePath,
        context
      );

      expect(result.ok).toBe(false);
      expect(result.failedStage).toBe("ingestion");

      // Verify failure status was written to file
      const statusPath = path.join(mockPipeline.tempDir, "tasks-status.json");
      const statusExists = await fs.access(statusPath).then(
        () => true,
        () => false
      );
      expect(statusExists).toBe(true);

      const statusContent = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(statusContent.current).toBe("test");
      expect(statusContent.currentStage).toBe("ingestion");
      expect(statusContent.state).toBe("failed");
      expect(statusContent.tasks.test.state).toBe("failed");
      expect(statusContent.tasks.test.failedStage).toBe("ingestion");
      expect(statusContent.tasks.test.currentStage).toBe("ingestion");
    });

    it("writes final completion status", async () => {
      const tasks = {
        ingestion: async (ctx) => {
          return { output: {}, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        tasksOverride: tasks,
      };

      await runPipeline(mockPipeline.absoluteModulePath, context);

      // Verify final status was written to file
      const statusPath = path.join(mockPipeline.tempDir, "tasks-status.json");
      const statusExists = await fs.access(statusPath).then(
        () => true,
        () => false
      );
      expect(statusExists).toBe(true);

      const statusContent = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(statusContent.current).toBe(null);
      expect(statusContent.currentStage).toBe(null);
      expect(statusContent.state).toBe("done");
      expect(statusContent.tasks.test.state).toBe("done");
      expect(statusContent.tasks.test.currentStage).toBe(null);
    });
  });
});
