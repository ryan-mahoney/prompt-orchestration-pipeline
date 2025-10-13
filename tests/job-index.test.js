/**
 * Tests for job-index.js
 * @module job-index.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  JobIndex,
  createJobIndex,
  getJobIndex,
  resetJobIndex,
} from "../src/ui/job-index.js";
import { createJobTree, createMultipleJobTrees } from "./test-data-utils.js";
import * as configBridge from "../src/ui/config-bridge.js";

describe("job-index", () => {
  let jobTrees;
  let mockResolvePipelinePaths;

  beforeEach(async () => {
    // Create test job data
    jobTrees = await createMultipleJobTrees([
      {
        jobId: "job-1",
        location: "current",
        tasksStatus: {
          id: "job-1",
          name: "Job 1",
          createdAt: "2024-01-01T00:00:00Z",
          tasks: { task1: { state: "running" } },
        },
      },
      {
        jobId: "job-2",
        location: "complete",
        tasksStatus: {
          id: "job-2",
          name: "Job 2",
          createdAt: "2024-01-01T00:00:00Z",
          tasks: { task1: { state: "done" } },
        },
      },
      {
        jobId: "job-3",
        location: "current",
        tasksStatus: {
          id: "job-3",
          name: "Job 3",
          createdAt: "2024-01-01T00:00:00Z",
          tasks: { task1: { state: "pending" } },
        },
      },
    ]);

    // Mock the path functions to use test directories
    mockResolvePipelinePaths = vi.spyOn(configBridge, "resolvePipelinePaths");
    mockResolvePipelinePaths.mockReturnValue({
      current: jobTrees.jobTrees[0].locationDir, // job-1 and job-3
      complete: jobTrees.jobTrees[1].locationDir, // job-2
      pending: "/tmp/pending",
      rejected: "/tmp/rejected",
    });

    // Mock PATHS to use test directories for job-scanner
    vi.spyOn(configBridge, "PATHS", "get").mockReturnValue({
      current: jobTrees.jobTrees[0].locationDir,
      complete: jobTrees.jobTrees[1].locationDir,
      pending: "/tmp/pending",
      rejected: "/tmp/rejected",
    });

    // Mock Constants for job-scanner
    vi.spyOn(configBridge, "Constants", "get").mockReturnValue({
      JOB_LOCATIONS: ["current", "complete", "pending", "rejected"],
      JOB_ID_REGEX: /^[a-zA-Z0-9_-]+$/,
    });

    // Mock getJobPath and getTasksStatusPath
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

    // Reset singleton for each test
    resetJobIndex();
  });

  afterEach(async () => {
    if (jobTrees) {
      await jobTrees.cleanup();
    }
    if (mockResolvePipelinePaths) {
      mockResolvePipelinePaths.mockRestore();
    }
    resetJobIndex();
  });

  describe("JobIndex class", () => {
    it("should create empty index", () => {
      const index = new JobIndex();

      expect(index.getJobCount()).toBe(0);
      expect(index.getAllJobs()).toEqual([]);
      expect(index.getJob("non-existent")).toBeNull();
      expect(index.hasJob("non-existent")).toBe(false);
    });

    it("should refresh and populate index", async () => {
      const index = new JobIndex();
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await index.refresh();

      expect(index.getJobCount()).toBe(3);
      expect(index.hasJob("job-1")).toBe(true);
      expect(index.hasJob("job-2")).toBe(true);
      expect(index.hasJob("job-3")).toBe(true);

      const job1 = index.getJob("job-1");
      expect(job1.id).toBe("job-1");
      expect(job1.name).toBe("Job 1");
      expect(job1.location).toBe("current");

      const job2 = index.getJob("job-2");
      expect(job2.id).toBe("job-2");
      expect(job2.name).toBe("Job 2");
      expect(job2.location).toBe("complete");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[JobIndex] Starting refresh")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[JobIndex] Refresh complete: 3 jobs indexed")
      );

      consoleLogSpy.mockRestore();
    });

    it("should handle concurrent refresh calls", async () => {
      const index = new JobIndex();
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      // Start multiple refresh calls concurrently
      const refreshPromise1 = index.refresh();
      const refreshPromise2 = index.refresh();
      const refreshPromise3 = index.refresh();

      await Promise.all([refreshPromise1, refreshPromise2, refreshPromise3]);

      // Should only log start and complete once
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(index.getJobCount()).toBe(3);

      consoleLogSpy.mockRestore();
    });

    it("should get jobs by location", async () => {
      const index = new JobIndex();
      await index.refresh();

      const currentJobs = index.getJobsByLocation("current");
      const completeJobs = index.getJobsByLocation("complete");

      expect(currentJobs).toHaveLength(2);
      expect(currentJobs.map((j) => j.id)).toEqual(
        expect.arrayContaining(["job-1", "job-3"])
      );

      expect(completeJobs).toHaveLength(1);
      expect(completeJobs[0].id).toBe("job-2");
    });

    it("should get index statistics", async () => {
      const index = new JobIndex();
      await index.refresh();

      const stats = index.getStats();

      expect(stats.totalJobs).toBe(3);
      expect(stats.lastRefresh).toBeInstanceOf(Date);
      expect(stats.refreshInProgress).toBe(false);
      expect(stats.locations).toEqual({
        current: 2,
        complete: 1,
      });
    });

    it("should clear cache", () => {
      const index = new JobIndex();
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      // Manually add some data
      index.jobsById.set("test-job", { id: "test-job" });
      index.lastRefresh = new Date();

      expect(index.getJobCount()).toBe(1);

      index.clear();

      expect(index.getJobCount()).toBe(0);
      expect(index.lastRefresh).toBeNull();

      expect(consoleLogSpy).toHaveBeenCalledWith("[JobIndex] Cache cleared");

      consoleLogSpy.mockRestore();
    });

    it("should update single job", () => {
      const index = new JobIndex();
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const jobData = { id: "test-job", name: "Test Job" };
      index.updateJob("test-job", jobData, "current", "/path/to/job");

      expect(index.getJobCount()).toBe(1);
      const job = index.getJob("test-job");
      expect(job.id).toBe("test-job");
      expect(job.name).toBe("Test Job");
      expect(job.location).toBe("current");
      expect(job.path).toBe("/path/to/job");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[JobIndex] Updated job test-job in cache"
      );

      consoleLogSpy.mockRestore();
    });

    it("should remove job", () => {
      const index = new JobIndex();
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      index.jobsById.set("test-job", { id: "test-job" });
      expect(index.getJobCount()).toBe(1);

      const removed = index.removeJob("test-job");

      expect(removed).toBe(true);
      expect(index.getJobCount()).toBe(0);
      expect(index.hasJob("test-job")).toBe(false);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[JobIndex] Removed job test-job from cache"
      );

      consoleLogSpy.mockRestore();
    });

    it("should handle refresh errors gracefully", async () => {
      const index = new JobIndex();
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Mock listJobs to throw an error
      const { listJobs } = await import("../src/ui/job-scanner.js");
      const mockListJobs = vi
        .spyOn({ listJobs }, "listJobs")
        .mockRejectedValue(new Error("Scan failed"));

      await expect(index.refresh()).rejects.toThrow("Scan failed");
      expect(index.refreshInProgress).toBe(false);

      mockListJobs.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("createJobIndex", () => {
    it("should create new JobIndex instance", () => {
      const index = createJobIndex();

      expect(index).toBeInstanceOf(JobIndex);
      expect(index.getJobCount()).toBe(0);
    });
  });

  describe("getJobIndex singleton", () => {
    it("should return same instance on multiple calls", () => {
      const index1 = getJobIndex();
      const index2 = getJobIndex();

      expect(index1).toBe(index2);
      expect(index1).toBeInstanceOf(JobIndex);
    });
  });

  describe("resetJobIndex", () => {
    it("should reset singleton instance", () => {
      const index1 = getJobIndex();
      resetJobIndex();
      const index2 = getJobIndex();

      expect(index1).not.toBe(index2);
      expect(index1).toBeInstanceOf(JobIndex);
      expect(index2).toBeInstanceOf(JobIndex);
    });
  });

  describe("integration with job data", () => {
    it("should handle real job data structure", async () => {
      const index = new JobIndex();
      await index.refresh();

      const job = index.getJob("job-1");
      expect(job).toMatchObject({
        id: "job-1",
        name: "Job 1",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: { task1: { state: "running" } },
        location: "current",
      });
      expect(job.path).toContain("job-1");
    });

    it("should handle missing jobs gracefully", async () => {
      const index = new JobIndex();

      // Mock readJob to return not found for some jobs
      const originalReadJob = await import("../src/ui/job-reader.js");
      const mockReadJob = vi
        .spyOn(originalReadJob, "readJob")
        .mockImplementation(async (jobId) => {
          if (jobId === "job-2") {
            return { ok: false, code: "job_not_found" };
          }
          return originalReadJob.readJob(jobId);
        });

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      await index.refresh();

      expect(index.getJobCount()).toBe(2); // Only job-1 and job-3
      expect(index.hasJob("job-1")).toBe(true);
      expect(index.hasJob("job-2")).toBe(false);
      expect(index.hasJob("job-3")).toBe(true);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[JobIndex] Failed to read job job-2")
      );

      mockReadJob.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });
});
