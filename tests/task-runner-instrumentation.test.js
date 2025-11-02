import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runPipeline } from "../src/core/task-runner.js";
import { setupMockPipeline } from "./test-utils.js";

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
        outputSummary: { type: "object", keys: [] },
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

      // Mock fs.writeFileSync to fail for snapshot only
      const originalWriteFileSync = fs.writeFileSync;
      let snapshotWriteCalled = false;
      fs.writeFileSync = vi.fn((path, data) => {
        if (path.includes("stage-ingestion-context.json")) {
          snapshotWriteCalled = true;
          throw new Error("Mocked write failure");
        }
        return originalWriteFileSync(path, data);
      });

      const result = await runPipeline(
        mockPipeline.absoluteModulePath,
        context
      );
      expect(result.ok).toBe(true);
      expect(snapshotWriteCalled).toBe(true);

      // Restore original
      fs.writeFileSync = originalWriteFileSync;
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
          if (ctx.data?.seed?.data === undefined) {
            throw new Error("Missing seed.data");
          }
          return { output: {}, flags: {} };
        },
      };
      const context = {
        workDir: mockPipeline.tempDir,
        taskName: "test",
        statusPath: mockPipeline.statusPath,
        jobId: "test-job",
        seed: { data: {} }, // Missing data
        tasksOverride: tasks,
      };

      const result = await runPipeline(
        mockPipeline.absoluteModulePath,
        context
      );
      expect(result.ok).toBe(false);
      expect(result.error.debug.dataHasSeed).toBe(true);
      expect(result.error.debug.seedHasData).toBe(false);
    });
  });
});
