/**
 * Tests for status-transformer.js
 * @module tests/status-transformer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  transformJobStatus,
  computeJobStatus,
  transformTasks,
  transformMultipleJobs,
  getTransformationStats,
} from "../src/ui/transformers/status-transformer.js";

describe("Status Transformer", () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("transformJobStatus", () => {
    it("should transform valid job data correctly", () => {
      const rawJobData = {
        jobId: "job-123",
        title: "Test Job",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T01:00:00Z",
        tasksStatus: {
          "task-1": {
            state: "done",
            startedAt: "2023-01-01T00:00:00Z",
            endedAt: "2023-01-01T00:30:00Z",
            attempts: 1,
            executionTimeMs: 1800000,
            artifacts: ["tasks/task-1/output.json"],
          },
          "task-2": {
            state: "running",
            startedAt: "2023-01-01T00:30:00Z",
          },
        },
      };

      const result = transformJobStatus(rawJobData, "job-123", "current");

      // Update expectations to match actual behavior
      expect(result.jobId).toBe("job-123");
      expect(result.title).toBe("Test Job");
      expect(result.status).toBe("running");
      expect(result.progress).toBe(50); // Should be calculated, not null
      expect(result.createdAt).toBe("2023-01-01T00:00:00Z");
      expect(result.updatedAt).toBe("2023-01-01T01:00:00Z");
      expect(result.location).toBe("current");

      // Check that files structure exists
      expect(result.files).toBeDefined();
      expect(result.files.artifacts).toEqual([]);
      expect(result.files.logs).toEqual([]);
      expect(result.files.tmp).toEqual([]);

      // Check tasksStatus structure
      expect(result.tasksStatus).toBeDefined();
      expect(result.tasksStatus["task-1"]).toBeDefined();
      expect(result.tasksStatus["task-1"].state).toBe("done");
      expect(result.tasksStatus["task-1"].executionTimeMs).toBe(1800000);
      expect(result.tasksStatus["task-2"]).toBeDefined();
      expect(result.tasksStatus["task-2"].state).toBe("running");
    });

    it("should handle job ID mismatch with warning", () => {
      const rawJobData = {
        jobId: "different-id",
        title: "Test Job",
        createdAt: "2023-01-01T00:00:00Z",
        tasksStatus: {
          "task-1": { state: "pending" },
        },
      };

      const result = transformJobStatus(rawJobData, "job-123", "current");

      expect(result.jobId).toBe("job-123"); // Prefer directory name
      expect(result.warnings).toContain(
        'Job ID mismatch: JSON has "different-id", using directory name "job-123"'
      );
    });

    it("should handle missing job title", () => {
      const rawJobData = {
        jobId: "job-123",
        createdAt: "2023-01-01T00:00:00Z",
        tasksStatus: {
          "task-1": { state: "pending" },
        },
      };

      const result = transformJobStatus(rawJobData, "job-123", "current");

      expect(result.title).toBe("Unnamed Job");
    });

    it("should handle missing updatedAt", () => {
      const rawJobData = {
        jobId: "job-123",
        title: "Test Job",
        createdAt: "2023-01-01T00:00:00Z",
        tasksStatus: {
          "task-1": { state: "pending" },
        },
      };

      const result = transformJobStatus(rawJobData, "job-123", "current");

      expect(result.updatedAt).toBe("2023-01-01T00:00:00Z"); // Fallback to createdAt
    });

    it("should return null for invalid raw data", () => {
      expect(transformJobStatus(null, "job-123", "current")).toBeNull();
      expect(transformJobStatus(undefined, "job-123", "current")).toBeNull();
      expect(transformJobStatus("invalid", "job-123", "current")).toBeNull();
    });

    it("should handle invalid tasks gracefully", () => {
      const rawJobData = {
        jobId: "job-123",
        title: "Test Job",
        createdAt: "2023-01-01T00:00:00Z",
        tasksStatus: "invalid-tasks", // This will be handled gracefully
      };

      const result = transformJobStatus(rawJobData, "job-123", "current");

      // Should handle invalid tasks by treating as empty tasks object
      expect(result.jobId).toBe("job-123");
      expect(result.title).toBe("Test Job");
      expect(result.status).toBe("pending");
      expect(result.progress).toBe(0);
      expect(result.createdAt).toBe("2023-01-01T00:00:00Z");
      expect(result.updatedAt).toBe("2023-01-01T00:00:00Z");
      expect(result.location).toBe("current");
      expect(result.files).toBeDefined();
      expect(result.files.artifacts).toEqual([]);
      expect(result.files.logs).toEqual([]);
      expect(result.files.tmp).toEqual([]);
      expect(result.tasksStatus).toEqual({});
    });
  });

  describe("computeJobStatus", () => {
    it("should compute status and progress for all done tasks", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "done" },
        "task-3": { state: "done" },
      };

      const result = computeJobStatus(tasks);

      expect(result.status).toBe("complete");
      expect(result.progress).toBe(100);
    });

    it("should compute status and progress for mixed states", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "running" },
        "task-3": { state: "pending" },
      };

      const result = computeJobStatus(tasks);

      expect(result.status).toBe("running");
      expect(result.progress).toBe(33); // 1/3 done
    });

    it("should prioritize error status", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "error" },
        "task-3": { state: "running" },
      };

      const result = computeJobStatus(tasks);

      expect(result.status).toBe("error");
      expect(result.progress).toBe(33);
    });

    it("should handle empty tasks", () => {
      const result = computeJobStatus({});

      expect(result.status).toBe("pending");
      expect(result.progress).toBe(0);
    });

    it("should handle invalid tasks object", () => {
      const result = computeJobStatus("invalid");

      expect(result.status).toBe("pending");
      expect(result.progress).toBe(0);
    });

    it("should handle unknown task states with warning", () => {
      const tasks = {
        "task-1": { state: "done" },
        "task-2": { state: "unknown-state" },
      };

      const result = computeJobStatus(tasks);

      expect(result.status).toBe("pending"); // Unknown state treated as pending
      expect(result.progress).toBe(50);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown task state "unknown-state"')
      );
    });

    it("should handle zero tasks job", () => {
      const result = computeJobStatus({});

      expect(result.status).toBe("pending");
      expect(result.progress).toBe(0);
    });
  });

  describe("transformTasks", () => {
    it("should transform tasks object to array", () => {
      const rawTasks = {
        "task-1": {
          state: "done",
          startedAt: "2023-01-01T00:00:00Z",
          endedAt: "2023-01-01T00:30:00Z",
          attempts: 1,
          executionTimeMs: 1800000,
          artifacts: ["tasks/task-1/output.json"],
        },
        "task-2": {
          state: "running",
          startedAt: "2023-01-01T00:30:00Z",
        },
      };

      const result = transformTasks(rawTasks);

      expect(result).toEqual({
        "task-1": {
          name: "task-1",
          state: "done",
          startedAt: "2023-01-01T00:00:00Z",
          endedAt: "2023-01-01T00:30:00Z",
          attempts: 1,
          executionTimeMs: 1800000,
          artifacts: ["tasks/task-1/output.json"],
          files: {
            artifacts: [],
            logs: [],
            tmp: [],
          },
        },
        "task-2": {
          name: "task-2",
          state: "running",
          startedAt: "2023-01-01T00:30:00Z",
          files: {
            artifacts: [],
            logs: [],
            tmp: [],
          },
        },
      });
    });

    it("should handle missing task state", () => {
      const rawTasks = {
        "task-1": {
          // No state field
          startedAt: "2023-01-01T00:00:00Z",
        },
      };

      const result = transformTasks(rawTasks);

      expect(result["task-1"].state).toBe("pending");
    });

    it("should handle invalid task state with warning", () => {
      const rawTasks = {
        "task-1": {
          state: "invalid-state",
        },
      };

      const result = transformTasks(rawTasks);

      expect(result["task-1"].state).toBe("pending");
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid task state "invalid-state"')
      );
    });

    it("should handle empty tasks object", () => {
      const result = transformTasks({});

      expect(result).toEqual({});
    });

    it("should handle invalid tasks input", () => {
      expect(transformTasks(null)).toEqual({});
      expect(transformTasks(undefined)).toEqual({});
      expect(transformTasks("invalid")).toEqual({});
    });
  });

  describe("transformMultipleJobs", () => {
    it("should transform multiple job read results", () => {
      const jobReadResults = [
        {
          ok: true,
          data: {
            jobId: "job-1",
            title: "Job 1",
            createdAt: "2023-01-01T00:00:00Z",
            tasksStatus: { "task-1": { state: "done" } },
          },
          jobId: "job-1",
          location: "current",
        },
        {
          ok: true,
          data: {
            jobId: "job-2",
            title: "Job 2",
            createdAt: "2023-01-01T01:00:00Z",
            tasksStatus: { "task-1": { state: "running" } },
          },
          jobId: "job-2",
          location: "complete",
        },
        {
          ok: false, // This should be filtered out
          code: "not_found",
        },
      ];

      const result = transformMultipleJobs(jobReadResults);

      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe("job-1");
      expect(result[1].jobId).toBe("job-2");
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Transforming 3 jobs")
      );
    });

    it("should handle empty input", () => {
      const result = transformMultipleJobs([]);

      expect(result).toEqual([]);
    });

    it("should handle all failed reads", () => {
      const jobReadResults = [
        { ok: false, code: "not_found" },
        { ok: false, code: "invalid_json" },
      ];

      const result = transformMultipleJobs(jobReadResults);

      expect(result).toEqual([]);
    });
  });

  describe("getTransformationStats", () => {
    it("should compute transformation statistics", () => {
      const jobReadResults = [
        { ok: true },
        { ok: true },
        { ok: false },
        { ok: false },
      ];

      const transformedJobs = [
        { jobId: "job-1", status: "running" },
        { jobId: "job-2", status: "complete" },
      ];

      const stats = getTransformationStats(jobReadResults, transformedJobs);

      expect(stats).toEqual({
        totalRead: 4,
        successfulReads: 2,
        successfulTransforms: 2,
        failedTransforms: 0,
        transformationRate: 50, // 2/4 * 100
        statusDistribution: {
          running: 1,
          complete: 1,
        },
      });
    });

    it("should handle empty inputs", () => {
      const stats = getTransformationStats([], []);

      expect(stats).toEqual({
        totalRead: 0,
        successfulReads: 0,
        successfulTransforms: 0,
        failedTransforms: 0,
        transformationRate: 0,
        statusDistribution: {},
      });
    });
  });

  describe("tasksStatus structure validation", () => {
    it("should preserve all required fields in tasksStatus", () => {
      const rawJobData = {
        jobId: "job-123",
        title: "Test Job",
        createdAt: "2023-01-01T00:00:00Z",
        current: "task-1",
        currentStage: "processing",
        tasksStatus: {
          "task-1": {
            state: "running",
            startedAt: "2023-01-01T00:00:00Z",
            executionTimeMs: 1500,
            currentStage: "processing",
          },
          "task-2": {
            state: "done",
            startedAt: "2023-01-01T00:30:00Z",
            endedAt: "2023-01-01T01:00:00Z",
            executionTimeMs: 1800000,
            currentStage: "completed",
          },
          "task-3": {
            state: "failed",
            startedAt: "2023-01-01T01:30:00Z",
            endedAt: "2023-01-01T02:00:00Z",
            failedStage: "error",
          },
        },
      };

      const result = transformJobStatus(rawJobData, "job-123", "current");

      // Verify root fields are present
      expect(result.current).toBe("task-1");
      expect(result.currentStage).toBe("processing");

      // Verify tasksStatus structure
      expect(result.tasksStatus).toBeDefined();
      expect(Object.keys(result.tasksStatus)).toHaveLength(3);

      // Verify task-1 (running) has all required fields
      const task1 = result.tasksStatus["task-1"];
      expect(task1.state).toBe("running");
      expect(task1.startedAt).toBe("2023-01-01T00:00:00Z");
      expect(task1.executionTimeMs).toBe(1500);
      expect(task1.currentStage).toBe("processing");
      expect(task1.failedStage).toBeUndefined();

      // Verify task-2 (done) has all required fields
      const task2 = result.tasksStatus["task-2"];
      expect(task2.state).toBe("done");
      expect(task2.startedAt).toBe("2023-01-01T00:30:00Z");
      expect(task2.endedAt).toBe("2023-01-01T01:00:00Z");
      expect(task2.executionTimeMs).toBe(1800000);
      expect(task2.currentStage).toBe("completed");
      expect(task2.failedStage).toBeUndefined();

      // Verify task-3 (failed) has all required fields
      const task3 = result.tasksStatus["task-3"];
      expect(task3.state).toBe("failed");
      expect(task3.startedAt).toBe("2023-01-01T01:30:00Z");
      expect(task3.endedAt).toBe("2023-01-01T02:00:00Z");
      expect(task3.failedStage).toBe("error");
      expect(task3.executionTimeMs).toBeUndefined();
    });

    it("should handle tasksStatus with missing optional fields", () => {
      const rawJobData = {
        jobId: "job-123",
        title: "Test Job",
        createdAt: "2023-01-01T00:00:00Z",
        tasksStatus: {
          "task-1": {
            state: "pending",
            // Missing optional fields
          },
          "task-2": {
            state: "done",
            executionTimeMs: 5000,
            // Missing startedAt/endedAt
          },
        },
      };

      const result = transformJobStatus(rawJobData, "job-123", "current");

      expect(result.tasksStatus).toBeDefined();
      expect(Object.keys(result.tasksStatus)).toHaveLength(2);

      // Verify task-1 has minimal structure
      const task1 = result.tasksStatus["task-1"];
      expect(task1.state).toBe("pending");
      expect(task1.startedAt).toBeUndefined();
      expect(task1.endedAt).toBeUndefined();
      expect(task1.executionTimeMs).toBeUndefined();
      expect(task1.currentStage).toBeUndefined();
      expect(task1.failedStage).toBeUndefined();

      // Verify task-2 has provided fields
      const task2 = result.tasksStatus["task-2"];
      expect(task2.state).toBe("done");
      expect(task2.executionTimeMs).toBe(5000);
      expect(task2.startedAt).toBeUndefined();
      expect(task2.endedAt).toBeUndefined();
    });
  });
});
