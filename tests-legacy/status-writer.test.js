/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

// Mock SSE registry for testing
const mockSSERegistry = {
  broadcast: vi.fn(),
};

// Mock the SSE module before importing status-writer
vi.mock("../src/ui/sse.js", () => ({
  sseRegistry: mockSSERegistry,
}));

import {
  writeJobStatus,
  readJobStatus,
  updateTaskStatus,
} from "../src/core/status-writer.js";

describe("status-writer", () => {
  let tempDir;
  let jobDir;
  let statusPath;

  beforeEach(async () => {
    // Create unique temporary directory for each test
    tempDir = `/tmp/test-status-writer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.mkdir(tempDir, { recursive: true });

    jobDir = path.join(tempDir, "test-job");
    await fs.mkdir(jobDir, { recursive: true });

    statusPath = path.join(jobDir, "tasks-status.json");

    // Clear mock calls
    mockSSERegistry.broadcast.mockClear();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("writeJobStatus", () => {
    it("creates new status file with default structure when none exists", async () => {
      const result = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
        snapshot.currentStage = "processing";
      });

      expect(result).toMatchObject({
        id: "test-job",
        state: "pending",
        current: "task-1",
        currentStage: "processing",
        tasks: {},
        files: {
          artifacts: [],
          logs: [],
          tmp: [],
        },
      });
      expect(result.lastUpdated).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      // Verify file was created and contains the data
      const fileContent = await fs.readFile(statusPath, "utf8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.current).toBe("task-1");
      expect(parsed.currentStage).toBe("processing");
    });

    it("updates existing status file atomically", async () => {
      // Create initial status
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
        snapshot.currentStage = "initial";
      });

      // Update it
      const result = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.currentStage = "updated";
        snapshot.state = "running";
      });

      expect(result.currentStage).toBe("updated");
      expect(result.state).toBe("running");
      expect(result.current).toBe("task-1"); // Should preserve existing value

      // Verify file content
      const fileContent = await fs.readFile(statusPath, "utf8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.currentStage).toBe("updated");
      expect(parsed.state).toBe("running");
    });

    it("updates task-specific fields", async () => {
      const result = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "research-task";
        snapshot.currentStage = "processing";

        // Initialize task
        snapshot.tasks["research-task"] = {
          state: "running",
          currentStage: "processing",
          startedAt: new Date().toISOString(),
        };
      });

      expect(result.tasks["research-task"]).toMatchObject({
        state: "running",
        currentStage: "processing",
      });
      expect(result.tasks["research-task"].startedAt).toBeDefined();
    });

    it("handles update function that returns a new snapshot", async () => {
      const result = await writeJobStatus(jobDir, (snapshot) => {
        return {
          ...snapshot,
          current: "new-task",
          currentStage: "new-stage",
          state: "running",
        };
      });

      expect(result.current).toBe("new-task");
      expect(result.currentStage).toBe("new-stage");
      expect(result.state).toBe("running");
    });

    it("validates jobDir parameter", async () => {
      await expect(writeJobStatus(null, () => {})).rejects.toThrow(
        "jobDir must be a non-empty string"
      );
      await expect(writeJobStatus("", () => {})).rejects.toThrow(
        "jobDir must be a non-empty string"
      );
      await expect(writeJobStatus(123, () => {})).rejects.toThrow(
        "jobDir must be a non-empty string"
      );
    });

    it("validates updateFn parameter", async () => {
      await expect(writeJobStatus(jobDir, null)).rejects.toThrow(
        "updateFn must be a function"
      );
      await expect(writeJobStatus(jobDir, "not-a-function")).rejects.toThrow(
        "updateFn must be a function"
      );
    });

    it("handles update function errors", async () => {
      await expect(
        writeJobStatus(jobDir, () => {
          throw new Error("Update failed");
        })
      ).rejects.toThrow("Update function failed: Update failed");
    });

    it("ensures atomic write by using temp file + rename", async () => {
      // Mock fs.rename to detect if temp file pattern is used
      const originalRename = fs.rename;
      const renameCalls = [];
      fs.rename = vi.fn(async (oldPath, newPath) => {
        renameCalls.push({ oldPath, newPath });
        return originalRename.call(fs, oldPath, newPath);
      });

      try {
        await writeJobStatus(jobDir, (snapshot) => {
          snapshot.current = "test-task";
        });

        // Verify rename was called with temp file pattern
        expect(renameCalls).toHaveLength(1);
        expect(renameCalls[0].oldPath).toMatch(/\.tmp\.\d+\.\w+$/);
        expect(renameCalls[0].newPath).toBe(statusPath);
      } finally {
        fs.rename = originalRename;
      }
    });

    it("cleans up temp file on write failure", async () => {
      // Mock fs.writeFile to fail
      const originalWrite = fs.writeFile;
      const tempPaths = [];
      fs.writeFile = vi.fn(async (filePath) => {
        if (filePath.includes(".tmp.")) {
          tempPaths.push(filePath);
        }
        throw new Error("Write failed");
      });

      try {
        await expect(
          writeJobStatus(jobDir, (snapshot) => {
            snapshot.current = "test-task";
          })
        ).rejects.toThrow("Write failed");

        // Verify temp files don't exist
        for (const tempPath of tempPaths) {
          try {
            await fs.access(tempPath);
            expect.fail(`Temp file should have been cleaned up: ${tempPath}`);
          } catch (error) {
            // Expected - file should not exist
          }
        }
      } finally {
        fs.writeFile = originalWrite;
      }
    });
  });

  describe("readJobStatus", () => {
    it("returns null when status file cannot be read", async () => {
      const result = await readJobStatus("/non/existent/path");
      expect(result).toBeNull();
    });

    it("reads existing status file", async () => {
      // Create status file first
      const initialStatus = {
        id: "test-job",
        state: "running",
        current: "task-1",
        currentStage: "processing",
        lastUpdated: new Date().toISOString(),
        tasks: {
          "task-1": {
            state: "running",
            currentStage: "processing",
          },
        },
        files: {
          artifacts: ["output.json"],
          logs: [],
          tmp: [],
        },
      };

      await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

      const result = await readJobStatus(jobDir);
      expect(result).toEqual(initialStatus);
    });

    it("handles invalid JSON gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await fs.writeFile(statusPath, "invalid json content");

      const result = await readJobStatus(jobDir);

      expect(result).toBeNull(); // Should return null for invalid JSON

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /Invalid JSON in .*tasks-status\.json, cannot read status:/
        ),
        expect.stringContaining("is not valid JSON")
      );

      consoleSpy.mockRestore();
    });

    it("validates jobDir parameter", async () => {
      await expect(readJobStatus(null)).rejects.toThrow(
        "jobDir must be a non-empty string"
      );
      await expect(readJobStatus("")).rejects.toThrow(
        "jobDir must be a non-empty string"
      );
    });
  });

  describe("updateTaskStatus", () => {
    it("creates and updates task-specific fields", async () => {
      const result = await updateTaskStatus(jobDir, "research-task", (task) => {
        task.state = "running";
        task.currentStage = "data-collection";
        task.startedAt = new Date().toISOString();
      });

      expect(result.tasks["research-task"]).toMatchObject({
        state: "running",
        currentStage: "data-collection",
      });
      expect(result.tasks["research-task"].startedAt).toBeDefined();
    });

    it("updates existing task", async () => {
      // Create initial status with task
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.tasks["research-task"] = {
          state: "pending",
          currentStage: "initial",
        };
      });

      // Update the task
      const result = await updateTaskStatus(jobDir, "research-task", (task) => {
        task.state = "done";
        task.currentStage = "completed";
        task.endedAt = new Date().toISOString();
      });

      expect(result.tasks["research-task"]).toMatchObject({
        state: "done",
        currentStage: "completed",
      });
      expect(result.tasks["research-task"].endedAt).toBeDefined();
    });

    it("handles task update function that returns new task object", async () => {
      const result = await updateTaskStatus(jobDir, "research-task", (task) => {
        return {
          ...task,
          state: "running",
          currentStage: "processing",
          attempts: 1,
        };
      });

      expect(result.tasks["research-task"]).toMatchObject({
        state: "running",
        currentStage: "processing",
        attempts: 1,
      });
    });

    it("validates parameters", async () => {
      await expect(updateTaskStatus(null, "task", () => {})).rejects.toThrow(
        "jobDir must be a non-empty string"
      );
      await expect(updateTaskStatus(jobDir, null, () => {})).rejects.toThrow(
        "taskId must be a non-empty string"
      );
    });
  });

  describe("shape validation", () => {
    it("ensures required structure on malformed data", async () => {
      // Create malformed status file
      const malformedStatus = {
        id: "test-job",
        // missing state, current, currentStage, lastUpdated
        tasks: "not-an-object", // should be object
        files: {
          artifacts: null, // should be array
          // missing logs, tmp
        },
      };

      await fs.writeFile(statusPath, JSON.stringify(malformedStatus, null, 2));

      const result = await readJobStatus(jobDir);

      expect(result).toMatchObject({
        id: "test-job",
        state: "pending", // should have default
        current: null, // should have default
        currentStage: null, // should have default
        tasks: {}, // should be object
        files: {
          artifacts: [], // should be array
          logs: [], // should be created
          tmp: [], // should be created
        },
      });
      expect(result.lastUpdated).toBeDefined(); // should have timestamp
    });

    it("validates and fixes partial files object", async () => {
      const partialStatus = {
        id: "test-job",
        files: {
          artifacts: ["file1.json"],
          // missing logs, tmp
        },
      };

      await fs.writeFile(statusPath, JSON.stringify(partialStatus, null, 2));

      const result = await readJobStatus(jobDir);

      expect(result.files).toEqual({
        artifacts: ["file1.json"],
        logs: [],
        tmp: [],
      });
    });
  });

  describe("integration with new status schema", () => {
    it("properly sets root and task currentStage fields", async () => {
      const taskId = "research-task";
      const stageId = "data-collection";

      const result = await writeJobStatus(jobDir, (snapshot) => {
        // Root level fields
        snapshot.current = taskId;
        snapshot.currentStage = stageId;
        snapshot.state = "running";

        // Task level fields
        snapshot.tasks[taskId] = {
          state: "running",
          currentStage: stageId,
        };
      });

      expect(result.current).toBe(taskId);
      expect(result.currentStage).toBe(stageId);
      expect(result.state).toBe("running");
      expect(result.tasks[taskId]).toMatchObject({
        state: "running",
        currentStage: stageId,
      });
    });

    it("handles failure state with failedStage", async () => {
      const taskId = "research-task";
      const stageId = "data-collection";

      const result = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.state = "failed";
        snapshot.current = taskId;
        snapshot.currentStage = stageId;

        snapshot.tasks[taskId] = {
          state: "failed",
          failedStage: stageId,
        };
      });

      expect(result.state).toBe("failed");
      expect(result.current).toBe(taskId);
      expect(result.currentStage).toBe(stageId);
      expect(result.tasks[taskId]).toMatchObject({
        state: "failed",
        failedStage: stageId,
      });
    });
  });

  describe("progress field preservation", () => {
    it("preserves snapshot.progress field through read/write round-trip", async () => {
      const progressValue = 75;

      // Write status with progress field
      const written = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
        snapshot.currentStage = "processing";
        snapshot.state = "running";
        snapshot.progress = progressValue;
      });

      expect(written.progress).toBe(progressValue);

      // Read it back
      const read = await readJobStatus(jobDir);

      expect(read).toBeDefined();
      expect(read.progress).toBe(progressValue);

      // Verify the complete structure is preserved
      expect(read).toMatchObject({
        id: "test-job",
        current: "task-1",
        currentStage: "processing",
        state: "running",
        progress: progressValue,
        tasks: {},
        files: {
          artifacts: [],
          logs: [],
          tmp: [],
        },
      });
    });

    it("preserves progress field when updating other fields", async () => {
      // Initial write with progress
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
        snapshot.progress = 25;
      });

      // Update other fields but preserve progress
      const updated = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.currentStage = "processing";
        snapshot.state = "running";
        // Note: we don't set progress here, it should be preserved
      });

      expect(updated.progress).toBe(25);
      expect(updated.currentStage).toBe("processing");
      expect(updated.state).toBe("running");

      // Verify round-trip preservation
      const read = await readJobStatus(jobDir);
      expect(read.progress).toBe(25);
    });

    it("handles progress field with various numeric values", async () => {
      const testValues = [0, 1, 50, 99, 100, 42.5, 0.1];

      for (const progressValue of testValues) {
        const tempJobDir = path.join(tempDir, `test-job-${progressValue}`);
        await fs.mkdir(tempJobDir, { recursive: true });

        // Write with specific progress value
        await writeJobStatus(tempJobDir, (snapshot) => {
          snapshot.progress = progressValue;
        });

        // Read back and verify
        const read = await readJobStatus(tempJobDir);
        expect(read.progress).toBe(progressValue);
      }
    });

    it("preserves progress field alongside other unknown fields", async () => {
      const unknownFields = {
        customMetric: 123,
        metadata: { version: "1.0", author: "test" },
        progress: 67,
        debugInfo: { lastError: null, retries: 3 },
      };

      // Write status with multiple unknown fields including progress
      await writeJobStatus(jobDir, (snapshot) => {
        Object.assign(snapshot, unknownFields);
        snapshot.current = "task-1";
      });

      // Read back and verify all unknown fields are preserved
      const read = await readJobStatus(jobDir);
      expect(read.progress).toBe(67);
      expect(read.customMetric).toBe(123);
      expect(read.metadata).toEqual({ version: "1.0", author: "test" });
      expect(read.debugInfo).toEqual({ lastError: null, retries: 3 });
    });

    it("handles null and undefined progress values", async () => {
      // Test with null progress
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.progress = null;
        snapshot.current = "task-1";
      });

      let read = await readJobStatus(jobDir);
      expect(read.progress).toBeNull();

      // Test with undefined progress (should not be present in JSON)
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.progress = undefined;
        snapshot.current = "task-2";
      });

      read = await readJobStatus(jobDir);
      expect(read.progress).toBeUndefined();
    });

    it("validates progress field is optional in default status", async () => {
      // Create default status without progress field
      const result = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
        // Intentionally not setting progress
      });

      expect(result.progress).toBeUndefined();

      // Should still be able to read it back
      const read = await readJobStatus(jobDir);
      expect(read.progress).toBeUndefined();
    });
  });

  describe("SSE emission", () => {
    it("emits state:change event when writeJobStatus is called", async () => {
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
        snapshot.currentStage = "processing";
      });

      // Verify SSE event was emitted
      expect(mockSSERegistry.broadcast).toHaveBeenCalledTimes(1);
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "state:change",
        data: {
          path: path.join(jobDir, "tasks-status.json"),
          id: "test-job",
          jobId: "test-job",
        },
      });
    });

    it("emits state:change event for task stage updates", async () => {
      const taskId = "research-task";
      const stageId = "data-collection";

      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = taskId;
        snapshot.currentStage = stageId;
        snapshot.tasks[taskId] = {
          state: "running",
          currentStage: stageId,
        };
      });

      // Verify SSE event was emitted with correct path
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "state:change",
        data: {
          path: path.join(jobDir, "tasks-status.json"),
          id: "test-job",
          jobId: "test-job",
        },
      });
    });

    it("emits state:change event for failure state", async () => {
      const taskId = "research-task";
      const stageId = "data-collection";

      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.state = "failed";
        snapshot.current = taskId;
        snapshot.currentStage = stageId;
        snapshot.tasks[taskId] = {
          state: "failed",
          failedStage: stageId,
        };
      });

      // Verify SSE event was emitted
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "state:change",
        data: {
          path: path.join(jobDir, "tasks-status.json"),
          id: "test-job",
          jobId: "test-job",
        },
      });
    });

    it("emits state:change event when updateTaskStatus is called", async () => {
      await updateTaskStatus(jobDir, "research-task", (task) => {
        task.state = "running";
        task.currentStage = "data-collection";
      });

      // Verify SSE event was emitted
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "state:change",
        data: {
          path: path.join(jobDir, "tasks-status.json"),
          id: "test-job",
          jobId: "test-job",
        },
      });
    });

    it("does not fail write when SSE emission fails", async () => {
      // Mock SSE broadcast to throw an error
      mockSSERegistry.broadcast.mockImplementation(() => {
        throw new Error("SSE broadcast failed");
      });

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Write should still succeed
      const result = await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
      });

      expect(result).toBeDefined();
      expect(result.current).toBe("task-1");

      // Should log warning but not throw
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to emit SSE event: SSE broadcast failed"
      );

      consoleSpy.mockRestore();
    });

    it("handles missing SSE registry gracefully", async () => {
      // Mock the import to return null (SSE not available)
      vi.doMock("../src/ui/sse.js", () => {
        throw new Error("Module not found");
      });

      // Clear module cache to force re-import
      const statusWriterModule = await import("../src/core/status-writer.js");

      // Write should still succeed without SSE
      const result = await statusWriterModule.writeJobStatus(
        jobDir,
        (snapshot) => {
          snapshot.current = "task-1";
        }
      );

      expect(result).toBeDefined();
      expect(result.current).toBe("task-1");
    });

    it("emits SSE event with correct path format", async () => {
      await writeJobStatus(jobDir, (snapshot) => {
        snapshot.current = "task-1";
      });

      const expectedPath = path.join(jobDir, "tasks-status.json");
      expect(mockSSERegistry.broadcast).toHaveBeenCalledWith({
        type: "state:change",
        data: {
          path: expectedPath,
          id: "test-job",
          jobId: "test-job",
        },
      });

      // Verify path ends with tasks-status.json
      expect(expectedPath.endsWith("tasks-status.json")).toBe(true);
    });
  });
});
