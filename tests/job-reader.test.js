/**
 * Tests for job-reader.js
 * @module job-reader.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readJob,
  readMultipleJobs,
  getJobReadingStats,
  validateJobData,
} from "../src/ui/job-reader.js";
import { createJobTree, createMultipleJobTrees } from "./test-data-utils.js";
import * as configBridge from "../src/ui/config-bridge.js";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("job-reader", () => {
  describe("readJob", () => {
    let jobTrees;
    let mockResolvePipelinePaths;

    beforeEach(async () => {
      jobTrees = await createMultipleJobTrees([
        {
          jobId: "job-current",
          location: "current",
          tasksStatus: {
            id: "job-current",
            name: "Current Job",
            createdAt: "2024-01-01T00:00:00Z",
            tasks: {
              analysis: { state: "done" },
              processing: { state: "running" },
            },
          },
        },
        {
          jobId: "job-complete",
          location: "complete",
          tasksStatus: {
            id: "job-complete",
            name: "Complete Job",
            createdAt: "2024-01-01T00:00:00Z",
            tasks: {
              analysis: { state: "done" },
              processing: { state: "done" },
            },
          },
        },
      ]);

      // Mock the path functions to use test directories
      mockResolvePipelinePaths = vi.spyOn(configBridge, "resolvePipelinePaths");
      mockResolvePipelinePaths.mockReturnValue({
        current: jobTrees.jobTrees[0].locationDir,
        complete: jobTrees.jobTrees[1].locationDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      // Mock getJobPath and getTasksStatusPath to use the mocked paths
      vi.spyOn(configBridge, "getJobPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return `${paths[location]}/${jobId}`;
        }
      );

      vi.spyOn(configBridge, "getTasksStatusPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return `${paths[location]}/${jobId}/tasks-status.json`;
        }
      );
    });

    afterEach(async () => {
      if (jobTrees) {
        await jobTrees.cleanup();
      }
      if (mockResolvePipelinePaths) {
        mockResolvePipelinePaths.mockRestore();
      }
    });

    it("should read job from current location", async () => {
      const result = await readJob("job-current");

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe("job-current");
      expect(result.location).toBe("current");
      expect(result.path).toContain("job-current");
    });

    it("should read job from complete location", async () => {
      const result = await readJob("job-complete");

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe("job-complete");
      expect(result.location).toBe("complete");
      expect(result.path).toContain("job-complete");
    });

    it("should prefer current over complete location", async () => {
      // Create same job ID in both locations
      const duplicateTrees = await createMultipleJobTrees([
        {
          jobId: "duplicate-job",
          location: "current",
          tasksStatus: {
            id: "duplicate-job",
            name: "Current Version",
            createdAt: "2024-01-01T00:00:00Z",
            tasks: { task1: { state: "running" } },
          },
        },
        {
          jobId: "duplicate-job",
          location: "complete",
          tasksStatus: {
            id: "duplicate-job",
            name: "Complete Version",
            createdAt: "2024-01-01T00:00:00Z",
            tasks: { task1: { state: "done" } },
          },
        },
      ]);

      // Mock resolvePipelinePaths for duplicate trees
      mockResolvePipelinePaths.mockReturnValue({
        current: duplicateTrees.jobTrees[0].locationDir,
        complete: duplicateTrees.jobTrees[1].locationDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      const result = await readJob("duplicate-job");

      expect(result.ok).toBe(true);
      expect(result.data.name).toBe("Current Version");
      expect(result.location).toBe("current");

      await duplicateTrees.cleanup();
    });

    it("should return job_not_found for non-existent job", async () => {
      const result = await readJob("non-existent-job");

      expect(result.ok).toBe(false);
      expect(result.code).toBe("job_not_found");
      expect(result.message).toContain("Job not found");
    });

    it("should return bad_request for invalid job ID", async () => {
      const result = await readJob("invalid job id");

      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad_request");
      expect(result.message).toContain("Invalid job ID format");
    });

    it("should handle locked job with retry", async () => {
      const jobTree = await createJobTree({
        jobId: "locked-job",
        location: "current",
        tasksStatus: {
          id: "locked-job",
          name: "Locked Job",
          createdAt: "2024-01-01T00:00:00Z",
          tasks: { task1: { state: "running" } },
        },
      });

      // Mock resolvePipelinePaths for this job tree
      mockResolvePipelinePaths.mockReturnValue({
        current: jobTree.locationDir,
        complete: "/tmp/complete",
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      // Create a lock file
      const lockPath = path.join(jobTree.jobDir, "job.lock");
      await fs.writeFile(lockPath, "locked");

      // Mock isLocked to return false after first check
      let lockCheckCount = 0;
      const { isLocked } = await import("../src/ui/config-bridge.js");
      const mockIsLocked = vi
        .spyOn({ isLocked }, "isLocked")
        .mockImplementation(async () => {
          lockCheckCount++;
          return lockCheckCount === 1; // Locked on first check, unlocked after
        });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const result = await readJob("locked-job");

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe("locked-job");

      // Should have logged about lock
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Job locked-job in current is locked, retrying")
      );

      consoleLogSpy.mockRestore();
      mockIsLocked.mockRestore();
      await jobTree.cleanup();
    }, 10000); // Add timeout to prevent hanging

    it("should handle job with missing tasks-status.json", async () => {
      const jobTree = await createJobTree({
        jobId: "missing-status",
        location: "current",
        tasksStatus: null, // Don't create tasks-status.json
      });

      // Remove the tasks-status.json file that was created by default
      await fs.unlink(path.join(jobTree.jobDir, "tasks-status.json"));

      // Mock resolvePipelinePaths for this job tree
      mockResolvePipelinePaths.mockReturnValue({
        current: jobTree.locationDir,
        complete: "/tmp/complete",
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = await readJob("missing-status");

      expect(result.ok).toBe(false);
      expect(result.code).toBe("job_not_found");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to read tasks-status.json for job missing-status in current"
        )
      );

      consoleWarnSpy.mockRestore();
      await jobTree.cleanup();
    });
  });

  describe("readMultipleJobs", () => {
    let jobTrees;
    let mockResolvePipelinePaths;

    beforeEach(async () => {
      jobTrees = await createMultipleJobTrees([
        { jobId: "job-1", location: "current" },
        { jobId: "job-2", location: "current" },
        { jobId: "job-3", location: "complete" },
      ]);

      // Mock the path functions to use test directories
      mockResolvePipelinePaths = vi.spyOn(configBridge, "resolvePipelinePaths");
      mockResolvePipelinePaths.mockReturnValue({
        current: jobTrees.jobTrees[0].locationDir,
        complete: jobTrees.jobTrees[2].locationDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      // Mock getJobPath and getTasksStatusPath to use the mocked paths
      vi.spyOn(configBridge, "getJobPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return `${paths[location]}/${jobId}`;
        }
      );

      vi.spyOn(configBridge, "getTasksStatusPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return `${paths[location]}/${jobId}/tasks-status.json`;
        }
      );
    });

    afterEach(async () => {
      if (jobTrees) {
        await jobTrees.cleanup();
      }
      if (mockResolvePipelinePaths) {
        mockResolvePipelinePaths.mockRestore();
      }
    });

    it("should read multiple jobs successfully", async () => {
      const results = await readMultipleJobs(["job-1", "job-2", "job-3"]);

      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect(results[0].data.id).toBe("job-1");
      expect(results[1].ok).toBe(true);
      expect(results[1].data.id).toBe("job-2");
      expect(results[2].ok).toBe(true);
      expect(results[2].data.id).toBe("job-3");
    });

    it("should handle mixed success and failure", async () => {
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const results = await readMultipleJobs([
        "job-1",
        "non-existent",
        "job-3",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(false);
      expect(results[2].ok).toBe(true);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Read 2/3 jobs successfully, 1 errors")
      );

      consoleLogSpy.mockRestore();
    });

    it("should handle empty job list", async () => {
      const results = await readMultipleJobs([]);

      expect(results).toEqual([]);
    });
  });

  describe("getJobReadingStats", () => {
    it("should calculate correct statistics", () => {
      const jobIds = ["job-1", "job-2", "job-3", "job-4"];
      const results = [
        { ok: true, location: "current" },
        { ok: true, location: "complete" },
        { ok: false, code: "job_not_found" },
        { ok: false, code: "fs_error" },
      ];

      const stats = getJobReadingStats(jobIds, results);

      expect(stats.totalJobs).toBe(4);
      expect(stats.successCount).toBe(2);
      expect(stats.errorCount).toBe(2);
      expect(stats.successRate).toBe(50);
      expect(stats.errorTypes).toEqual({
        job_not_found: 1,
        fs_error: 1,
      });
      expect(stats.locations).toEqual({
        current: 1,
        complete: 1,
      });
    });

    it("should handle empty arrays", () => {
      const stats = getJobReadingStats([], []);

      expect(stats.totalJobs).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.errorTypes).toEqual({});
      expect(stats.locations).toEqual({});
    });

    it("should handle all successful reads", () => {
      const jobIds = ["job-1", "job-2"];
      const results = [
        { ok: true, location: "current" },
        { ok: true, location: "current" },
      ];

      const stats = getJobReadingStats(jobIds, results);

      expect(stats.totalJobs).toBe(2);
      expect(stats.successCount).toBe(2);
      expect(stats.errorCount).toBe(0);
      expect(stats.successRate).toBe(100);
      expect(stats.errorTypes).toEqual({});
      expect(stats.locations).toEqual({ current: 2 });
    });
  });

  describe("validateJobData", () => {
    it("should validate correct job data", () => {
      const jobData = {
        id: "test-job",
        name: "Test Job",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: {
          analysis: { state: "pending" },
          processing: { state: "running" },
        },
      };

      const result = validateJobData(jobData, "test-job");

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("should handle job ID mismatch with warning", () => {
      const jobData = {
        id: "different-id",
        name: "Test Job",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: {
          analysis: { state: "pending" },
        },
      };

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = validateJobData(jobData, "test-job");

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual(["Job ID mismatch"]);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Job ID mismatch: expected test-job, found different-id"
        )
      );

      consoleWarnSpy.mockRestore();
    });

    it("should reject non-object job data", () => {
      const result = validateJobData(null, "test-job");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Job data must be an object");
    });

    it("should reject job data missing required fields", () => {
      const jobData = {
        id: "test-job",
        // Missing name
        createdAt: "2024-01-01T00:00:00Z",
        tasks: {},
      };

      const result = validateJobData(jobData, "test-job");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing required field: name");
    });

    it("should reject invalid tasks structure", () => {
      const jobData = {
        id: "test-job",
        name: "Test Job",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: "not-an-object",
      };

      const result = validateJobData(jobData, "test-job");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Tasks must be an object");
    });

    it("should reject task without state", () => {
      const jobData = {
        id: "test-job",
        name: "Test Job",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: {
          analysis: { noState: true }, // Missing state
        },
      };

      const result = validateJobData(jobData, "test-job");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Task analysis missing state field");
    });

    it("should warn about unknown task states", () => {
      const jobData = {
        id: "test-job",
        name: "Test Job",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: {
          analysis: { state: "unknown-state" },
        },
      };

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = validateJobData(jobData, "test-job");

      expect(result.valid).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Unknown task state for analysis: unknown-state"
        )
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe("instrumentation", () => {
    it("should log lock retry attempts", async () => {
      const jobTree = await createJobTree({
        jobId: "instrumented-job",
        location: "current",
        tasksStatus: {
          id: "instrumented-job",
          name: "Instrumented Job",
          createdAt: "2024-01-01T00:00:00Z",
          tasks: { task1: { state: "running" } },
        },
      });

      // Mock the path functions for this job tree
      const mockResolvePipelinePaths = vi.spyOn(
        configBridge,
        "resolvePipelinePaths"
      );
      mockResolvePipelinePaths.mockReturnValue({
        current: jobTree.locationDir,
        complete: "/tmp/complete",
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      // Mock getJobPath and getTasksStatusPath to use the mocked paths
      vi.spyOn(configBridge, "getJobPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return `${paths[location]}/${jobId}`;
        }
      );

      vi.spyOn(configBridge, "getTasksStatusPath").mockImplementation(
        (jobId, location = "current") => {
          const paths = configBridge.resolvePipelinePaths();
          return `${paths[location]}/${jobId}/tasks-status.json`;
        }
      );

      // Create a lock file
      const lockPath = path.join(jobTree.jobDir, "job.lock");
      await fs.writeFile(lockPath, "locked");

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await readJob("instrumented-job");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Job instrumented-job in current is locked, retrying"
        )
      );

      consoleLogSpy.mockRestore();
      mockResolvePipelinePaths.mockRestore();
      await jobTree.cleanup();
    });

    it("should log successful reads after lock retries", async () => {
      const jobTree = await createJobTree({
        jobId: "retry-success-job",
        location: "current",
        tasksStatus: {
          id: "retry-success-job",
          name: "Retry Success Job",
          createdAt: "2024-01-01T00:00:00Z",
          tasks: { task1: { state: "running" } },
        },
      });

      // Mock resolvePipelinePaths for this job tree
      const mockResolvePipelinePaths = vi.spyOn(
        configBridge,
        "resolvePipelinePaths"
      );
      mockResolvePipelinePaths.mockReturnValue({
        current: jobTree.locationDir,
        complete: "/tmp/complete",
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      // Create a lock file that will be removed after first check
      const lockPath = path.join(jobTree.jobDir, "job.lock");
      await fs.writeFile(lockPath, "locked");

      // Mock isLocked to return true once then false
      let lockCheckCount = 0;
      const { isLocked } = await import("../src/ui/config-bridge.js");
      const mockIsLocked = vi
        .spyOn({ isLocked }, "isLocked")
        .mockImplementation(async () => {
          lockCheckCount++;
          return lockCheckCount === 1; // Locked on first check, unlocked after
        });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const result = await readJob("retry-success-job");

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe("retry-success-job");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Job retry-success-job in current is locked, retrying"
        )
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Successfully read job retry-success-job after 1 retry"
        )
      );

      consoleLogSpy.mockRestore();
      mockIsLocked.mockRestore();
      mockResolvePipelinePaths.mockRestore();
      await jobTree.cleanup();
    });
  });
});
