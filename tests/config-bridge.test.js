/**
 * Tests for config-bridge.js
 * @module config-bridge.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Constants,
  resolvePipelinePaths,
  getJobPath,
  getTasksStatusPath,
  getSeedPath,
  getTaskPath,
  isLocked,
  getUIConfig,
  createErrorResponse,
  validateJobId,
  validateTaskState,
  getStatusPriority,
  computeProgress,
  determineJobStatus,
  PATHS,
  CONFIG,
} from "../src/ui/config-bridge.js";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("config-bridge", () => {
  describe("Constants", () => {
    it("should have correct job ID regex", () => {
      expect(Constants.JOB_ID_REGEX.test("valid-job-123")).toBe(true);
      expect(Constants.JOB_ID_REGEX.test("invalid job")).toBe(false);
    });

    it("should have correct task states", () => {
      expect(Constants.TASK_STATES).toEqual([
        "pending",
        "running",
        "done",
        "error",
      ]);
    });

    it("should have correct job locations", () => {
      expect(Constants.JOB_LOCATIONS).toEqual(["current", "complete"]);
    });

    it("should have correct status order", () => {
      expect(Constants.STATUS_ORDER).toEqual([
        "running",
        "error",
        "pending",
        "complete",
      ]);
    });

    it("should have correct file limits", () => {
      expect(Constants.FILE_LIMITS.MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
    });

    it("should have correct retry configuration", () => {
      expect(Constants.RETRY_CONFIG.MAX_ATTEMPTS).toBe(3);
      // In test mode, delay should be shorter (10ms) for faster tests
      expect(Constants.RETRY_CONFIG.DELAY_MS).toBe(10);
    });

    it("should have correct SSE configuration", () => {
      expect(Constants.SSE_CONFIG.DEBOUNCE_MS).toBe(200);
    });

    it("should have correct error codes", () => {
      expect(Constants.ERROR_CODES).toEqual({
        NOT_FOUND: "not_found",
        INVALID_JSON: "invalid_json",
        FS_ERROR: "fs_error",
        JOB_NOT_FOUND: "job_not_found",
        BAD_REQUEST: "bad_request",
      });
    });
  });

  describe("resolvePipelinePaths", () => {
    it("should resolve pipeline paths correctly", () => {
      const paths = resolvePipelinePaths();

      expect(paths.current).toContain("pipeline-data/current");
      expect(paths.complete).toContain("pipeline-data/complete");
      expect(paths.pending).toContain("pipeline-data/pending");
      expect(paths.rejected).toContain("pipeline-data/rejected");

      // All paths should be absolute
      expect(path.isAbsolute(paths.current)).toBe(true);
      expect(path.isAbsolute(paths.complete)).toBe(true);
      expect(path.isAbsolute(paths.pending)).toBe(true);
      expect(path.isAbsolute(paths.rejected)).toBe(true);
    });
  });

  describe("getJobPath", () => {
    it("should get job path for current location", () => {
      const jobPath = getJobPath("test-job-123", "current");

      expect(jobPath).toContain("pipeline-data/current/test-job-123");
      expect(path.isAbsolute(jobPath)).toBe(true);
    });

    it("should get job path for complete location", () => {
      const jobPath = getJobPath("test-job-123", "complete");

      expect(jobPath).toContain("pipeline-data/complete/test-job-123");
      expect(path.isAbsolute(jobPath)).toBe(true);
    });

    it("should default to current location", () => {
      const jobPath = getJobPath("test-job-123");

      expect(jobPath).toContain("pipeline-data/current/test-job-123");
    });

    it("should throw error for invalid location", () => {
      expect(() => getJobPath("test-job-123", "invalid")).toThrow(
        "Invalid location: invalid. Must be one of: current, complete"
      );
    });

    it("should throw error for invalid job ID", () => {
      expect(() => getJobPath("invalid job")).toThrow(
        "Invalid job ID: invalid job. Must match /^[A-Za-z0-9-_]+$/"
      );
    });
  });

  describe("getTasksStatusPath", () => {
    it("should get tasks status path", () => {
      const tasksStatusPath = getTasksStatusPath("test-job-123", "current");

      expect(tasksStatusPath).toContain(
        "pipeline-data/current/test-job-123/tasks-status.json"
      );
      expect(path.isAbsolute(tasksStatusPath)).toBe(true);
    });
  });

  describe("getSeedPath", () => {
    it("should get seed path", () => {
      const seedPath = getSeedPath("test-job-123", "current");

      expect(seedPath).toContain(
        "pipeline-data/current/test-job-123/seed.json"
      );
      expect(path.isAbsolute(seedPath)).toBe(true);
    });
  });

  describe("getTaskPath", () => {
    it("should get task path", () => {
      const taskPath = getTaskPath("test-job-123", "analysis-task", "current");

      expect(taskPath).toContain(
        "pipeline-data/current/test-job-123/tasks/analysis-task"
      );
      expect(path.isAbsolute(taskPath)).toBe(true);
    });
  });

  describe("isLocked", () => {
    let tempDir;
    let jobDir;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(import.meta.dirname, "test-lock-"));
      jobDir = path.join(tempDir, "test-job");
      await fs.mkdir(jobDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    it("should return false for unlocked directory", async () => {
      const locked = await isLocked(jobDir);
      expect(locked).toBe(false);
    });

    it("should return true for directory with lock file", async () => {
      const lockPath = path.join(jobDir, "job.lock");
      await fs.writeFile(lockPath, "locked");

      const locked = await isLocked(jobDir);
      expect(locked).toBe(true);
    });

    it("should return true for directory with lock file in subdirectory", async () => {
      const tasksDir = path.join(jobDir, "tasks");
      await fs.mkdir(tasksDir, { recursive: true });

      const lockPath = path.join(tasksDir, "task.lock");
      await fs.writeFile(lockPath, "locked");

      const locked = await isLocked(jobDir);
      expect(locked).toBe(true);
    });

    it("should return false for non-existent directory", async () => {
      const locked = await isLocked("/non/existent/path");
      expect(locked).toBe(false);
    });

    it("should handle permission errors gracefully", async () => {
      // Mock fs.readdir to throw an error
      const mockReaddir = vi
        .spyOn(fs, "readdir")
        .mockRejectedValue(new Error("Permission denied"));

      const locked = await isLocked(jobDir);
      expect(locked).toBe(false);

      mockReaddir.mockRestore();
    });
  });

  describe("getUIConfig", () => {
    beforeEach(() => {
      delete process.env.UI_REAL_DATA;
      delete process.env.UI_LOG_LEVEL;
    });

    it("should return default config", () => {
      const config = getUIConfig();

      expect(config.useRealData).toBe(false);
      expect(config.featureFlags.realData).toBe(false);
      expect(config.logging.level).toBe("warn");
      expect(config.logging.rateLimit.errors).toBe(100);
    });

    it("should respect UI_REAL_DATA environment variable", () => {
      process.env.UI_REAL_DATA = "1";

      const config = getUIConfig();
      expect(config.useRealData).toBe(true);
      expect(config.featureFlags.realData).toBe(true);
    });

    it("should respect UI_LOG_LEVEL environment variable", () => {
      process.env.UI_LOG_LEVEL = "debug";

      const config = getUIConfig();
      expect(config.logging.level).toBe("debug");
    });
  });

  describe("createErrorResponse", () => {
    it("should create error response without path", () => {
      const error = createErrorResponse("not_found", "File not found");

      expect(error).toEqual({
        ok: false,
        code: "not_found",
        message: "File not found",
      });
    });

    it("should create error response with path", () => {
      const error = createErrorResponse(
        "fs_error",
        "Read error",
        "/path/to/file.json"
      );

      expect(error).toEqual({
        ok: false,
        code: "fs_error",
        message: "Read error",
        path: "/path/to/file.json",
      });
    });
  });

  describe("validateJobId", () => {
    it("should validate valid job IDs", () => {
      expect(validateJobId("job-123")).toBe(true);
      expect(validateJobId("JOB_456")).toBe(true);
      expect(validateJobId("test-job-789")).toBe(true);
    });

    it("should reject invalid job IDs", () => {
      expect(validateJobId("invalid job")).toBe(false);
      expect(validateJobId("job@special")).toBe(false);
      expect(validateJobId("")).toBe(false);
    });
  });

  describe("validateTaskState", () => {
    it("should validate valid task states", () => {
      expect(validateTaskState("pending")).toBe(true);
      expect(validateTaskState("running")).toBe(true);
      expect(validateTaskState("done")).toBe(true);
      expect(validateTaskState("error")).toBe(true);
    });

    it("should reject invalid task states", () => {
      expect(validateTaskState("invalid")).toBe(false);
      expect(validateTaskState("")).toBe(false);
      expect(validateTaskState("completed")).toBe(false);
    });
  });

  describe("getStatusPriority", () => {
    it("should return correct priorities for valid statuses", () => {
      expect(getStatusPriority("running")).toBe(0);
      expect(getStatusPriority("error")).toBe(1);
      expect(getStatusPriority("pending")).toBe(2);
      expect(getStatusPriority("complete")).toBe(3);
    });

    it("should return length for invalid statuses", () => {
      expect(getStatusPriority("invalid")).toBe(4);
      expect(getStatusPriority("")).toBe(4);
    });
  });

  describe("computeProgress", () => {
    it("should return 0 for empty tasks", () => {
      expect(computeProgress({})).toBe(0);
    });

    it("should return 0 for all pending tasks", () => {
      const tasks = {
        "task-1": { state: "pending" },
        "task-2": { state: "pending" },
        "task-3": { state: "pending" },
      };

      expect(computeProgress(tasks)).toBe(0);
    });

    it("should return 100 for all done tasks", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "done" },
        "task-3": { state: "done" },
      };

      expect(computeProgress(tasks)).toBe(100);
    });

    it("should return correct percentage for mixed tasks", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "running" },
        "task-3": { state: "pending" },
        "task-4": { state: "done" },
      };

      expect(computeProgress(tasks)).toBe(50); // 2 out of 4 done = 50%
    });

    it("should round progress correctly", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "pending" },
      };

      expect(computeProgress(tasks)).toBe(50); // 1 out of 2 done = 50%
    });
  });

  describe("determineJobStatus", () => {
    it("should return pending for empty tasks", () => {
      expect(determineJobStatus({})).toBe("pending");
    });

    it("should return error if any task has error state", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "error" },
        "task-3": { state: "running" },
      };

      expect(determineJobStatus(tasks)).toBe("error");
    });

    it("should return running if any task is running and no errors", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "running" },
        "task-3": { state: "pending" },
      };

      expect(determineJobStatus(tasks)).toBe("running");
    });

    it("should return complete if all tasks are done", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "done" },
        "task-3": { state: "done" },
      };

      expect(determineJobStatus(tasks)).toBe("complete");
    });

    it("should return pending for mixed pending/done tasks", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "pending" },
        "task-3": { state: "pending" },
      };

      expect(determineJobStatus(tasks)).toBe("pending");
    });
  });

  describe("PATHS and CONFIG exports", () => {
    it("should export PATHS constant", () => {
      expect(PATHS).toBeDefined();
      expect(PATHS.current).toContain("pipeline-data/current");
      expect(PATHS.complete).toContain("pipeline-data/complete");
    });

    it("should export CONFIG constant", () => {
      expect(CONFIG).toBeDefined();
      expect(CONFIG.useRealData).toBe(false);
      expect(CONFIG.featureFlags.realData).toBe(false);
    });
  });
});
