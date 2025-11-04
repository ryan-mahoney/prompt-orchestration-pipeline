/**
 * Tests for job-reader.js
 * @module job-reader.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readJob,
  readMultipleJobs,
  getJobReadingStats,
} from "../src/ui/job-reader.js";
import { createJobTree, createMultipleJobTrees } from "./test-data-utils.js";
import * as configBridge from "../src/ui/config-bridge.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("job-reader", () => {
  describe("readJob", () => {
    let jobTrees;
    let mockResolvePipelinePaths;

    beforeEach(async () => {
      jobTrees = await createMultipleJobTrees([
        {
          jobId: "job-current",
          location: "current",
          tasks: {
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
          tasks: {
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
          tasks: {
            id: "duplicate-job",
            name: "Current Version",
            createdAt: "2024-01-01T00:00:00Z",
            tasks: { task1: { state: "running" } },
          },
        },
        {
          jobId: "duplicate-job",
          location: "complete",
          tasks: {
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

      // Mock isLocked properly - spy on the configBridge module
      let lockCheckCount = 0;
      const mockIsLocked = vi
        .spyOn(configBridge, "isLocked")
        .mockImplementation(async () => {
          lockCheckCount++;
          if (lockCheckCount === 1) {
            return true; // Locked on first check
          }
          // Remove lock file after first check
          try {
            await fs.unlink(lockPath);
          } catch {}
          return false; // Unlocked after
        });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const result = await readJob("locked-job");

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe("locked-job");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Job locked-job in current is locked, retrying")
      );

      consoleLogSpy.mockRestore();
      mockIsLocked.mockRestore();
      await jobTree.cleanup();
    });

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
        ),
        expect.any(Object)
      );

      consoleWarnSpy.mockRestore();
      await jobTree.cleanup();
    });
  });

  describe("readMultipleJobs", () => {
    let jobTrees;
    let mockResolvePipelinePaths;

    beforeEach(async () => {
      // Create a single temp directory for all jobs
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-tree-"));
      const pipelineDataDir = path.join(tempDir, "pipeline-data");
      const currentDir = path.join(pipelineDataDir, "current");
      const completeDir = path.join(pipelineDataDir, "complete");

      await fs.mkdir(currentDir, { recursive: true });
      await fs.mkdir(completeDir, { recursive: true });

      // Create job-1 and job-2 in current directory
      const job1Dir = path.join(currentDir, "job-1");
      const job2Dir = path.join(currentDir, "job-2");
      const job3Dir = path.join(completeDir, "job-3");

      await fs.mkdir(job1Dir, { recursive: true });
      await fs.mkdir(job2Dir, { recursive: true });
      await fs.mkdir(job3Dir, { recursive: true });

      // Create tasks-status.json for each job
      const job1Status = {
        id: "job-1",
        name: "Job 1",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: { task1: { state: "running" } },
      };

      const job2Status = {
        id: "job-2",
        name: "Job 2",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: { task1: { state: "done" } },
      };

      const job3Status = {
        id: "job-3",
        name: "Job 3",
        createdAt: "2024-01-01T00:00:00Z",
        tasks: { task1: { state: "done" } },
      };

      await fs.writeFile(
        path.join(job1Dir, "tasks-status.json"),
        JSON.stringify(job1Status, null, 2)
      );
      await fs.writeFile(
        path.join(job2Dir, "tasks-status.json"),
        JSON.stringify(job2Status, null, 2)
      );
      await fs.writeFile(
        path.join(job3Dir, "tasks-status.json"),
        JSON.stringify(job3Status, null, 2)
      );

      // Mock the path functions to use test directories
      mockResolvePipelinePaths = vi.spyOn(configBridge, "resolvePipelinePaths");
      mockResolvePipelinePaths.mockReturnValue({
        current: currentDir,
        complete: completeDir,
        pending: "/tmp/pending",
        rejected: "/tmp/rejected",
      });

      // Store cleanup function
      jobTrees = {
        cleanup: async () => {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch (error) {
            console.warn("Cleanup warning:", error.message);
          }
        },
      };

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
});
