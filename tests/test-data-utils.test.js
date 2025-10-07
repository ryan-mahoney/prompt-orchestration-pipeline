/**
 * Tests for test-data-utils.js
 * @module test-data-utils.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isValidJobId,
  createJobTree,
  createTasksStatus,
  createTask,
  createMultipleJobTrees,
  createLockFile,
  removeLockFile,
} from "./test-data-utils.js";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("test-data-utils", () => {
  describe("isValidJobId", () => {
    it("should validate valid job IDs", () => {
      expect(isValidJobId("job-123")).toBe(true);
      expect(isValidJobId("JOB_456")).toBe(true);
      expect(isValidJobId("test-job-789")).toBe(true);
      expect(isValidJobId("123")).toBe(true);
      expect(isValidJobId("job-with-dashes")).toBe(true);
      expect(isValidJobId("job_with_underscores")).toBe(true);
    });

    it("should reject invalid job IDs", () => {
      expect(isValidJobId("job with spaces")).toBe(false);
      expect(isValidJobId("job@special")).toBe(false);
      expect(isValidJobId("job#hash")).toBe(false);
      expect(isValidJobId("job$dollar")).toBe(false);
      expect(isValidJobId("job%percent")).toBe(false);
      expect(isValidJobId("")).toBe(false);
      expect(isValidJobId("job/with/slashes")).toBe(false);
      expect(isValidJobId("job\\with\\backslashes")).toBe(false);
    });
  });

  describe("createJobTree", () => {
    let jobTree;

    afterEach(async () => {
      if (jobTree) {
        await jobTree.cleanup();
      }
    });

    it("should create a job tree with default values", async () => {
      jobTree = await createJobTree();

      expect(jobTree.jobId).toMatch(/^test-job-\d+-[a-z0-9]+$/);
      expect(jobTree.location).toBe("current");

      // Verify directory structure
      const stats = await fs.stat(jobTree.jobDir);
      expect(stats.isDirectory()).toBe(true);

      const tasksStatusPath = path.join(jobTree.jobDir, "tasks-status.json");
      const tasksStatus = JSON.parse(
        await fs.readFile(tasksStatusPath, "utf8")
      );

      expect(tasksStatus.id).toBe(jobTree.jobId);
      expect(tasksStatus.name).toBe(`Test Job ${jobTree.jobId}`);
      expect(tasksStatus.createdAt).toBeDefined();
      expect(tasksStatus.updatedAt).toBeDefined();
      expect(tasksStatus.tasks).toEqual({});

      // Verify tasks directory exists
      const tasksDir = path.join(jobTree.jobDir, "tasks");
      const tasksStats = await fs.stat(tasksDir);
      expect(tasksStats.isDirectory()).toBe(true);
    });

    it("should create a job tree in complete location", async () => {
      jobTree = await createJobTree({ location: "complete" });

      expect(jobTree.location).toBe("complete");
      expect(jobTree.locationDir).toContain("complete");
    });

    it("should create a job tree with custom job ID", async () => {
      const customJobId = "custom-job-123";
      jobTree = await createJobTree({ jobId: customJobId });

      expect(jobTree.jobId).toBe(customJobId);

      const tasksStatusPath = path.join(jobTree.jobDir, "tasks-status.json");
      const tasksStatus = JSON.parse(
        await fs.readFile(tasksStatusPath, "utf8")
      );
      expect(tasksStatus.id).toBe(customJobId);
    });

    it("should create a job tree with custom tasks status", async () => {
      const customTasksStatus = {
        id: "custom-job",
        name: "Custom Job Name",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T01:00:00.000Z",
        tasks: {
          "task-1": { state: "pending" },
          "task-2": { state: "running" },
        },
      };

      jobTree = await createJobTree({
        jobId: "custom-job",
        tasksStatus: customTasksStatus,
      });

      const tasksStatusPath = path.join(jobTree.jobDir, "tasks-status.json");
      const tasksStatus = JSON.parse(
        await fs.readFile(tasksStatusPath, "utf8")
      );

      expect(tasksStatus.id).toBe("custom-job");
      expect(tasksStatus.name).toBe("Custom Job Name");
      expect(tasksStatus.tasks).toEqual({
        "task-1": { state: "pending" },
        "task-2": { state: "running" },
      });
    });

    it("should create a job tree with seed and task artifacts", async () => {
      const seedData = { project: "test", data: { key: "value" } };
      const taskArtifacts = {
        "analysis-task": {
          output: { result: "analysis complete" },
          letter: { content: "analysis letter" },
          executionLogs: ["log1", "log2"],
        },
      };

      jobTree = await createJobTree({
        jobId: "artifact-job",
        seed: seedData,
        tasks: taskArtifacts,
      });

      // Verify seed.json
      const seedPath = path.join(jobTree.jobDir, "seed.json");
      const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));
      expect(seed).toEqual(seedData);

      // Verify task artifacts
      const taskDir = path.join(jobTree.jobDir, "tasks", "analysis-task");

      const outputPath = path.join(taskDir, "output.json");
      const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
      expect(output).toEqual({ result: "analysis complete" });

      const letterPath = path.join(taskDir, "letter.json");
      const letter = JSON.parse(await fs.readFile(letterPath, "utf8"));
      expect(letter).toEqual({ content: "analysis letter" });

      const logsPath = path.join(taskDir, "execution-logs.json");
      const logs = JSON.parse(await fs.readFile(logsPath, "utf8"));
      expect(logs).toEqual(["log1", "log2"]);
    });

    it("should prefer jobId over tasks-status.json id", async () => {
      const tasksStatus = {
        id: "different-id",
        name: "Test Job",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: {},
      };

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      jobTree = await createJobTree({
        jobId: "correct-id",
        tasksStatus,
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Warning: tasks-status.json id (different-id) does not match jobId (correct-id)"
        )
      );

      const tasksStatusPath = path.join(jobTree.jobDir, "tasks-status.json");
      const finalTasksStatus = JSON.parse(
        await fs.readFile(tasksStatusPath, "utf8")
      );
      expect(finalTasksStatus.id).toBe("correct-id");

      consoleWarnSpy.mockRestore();
    });

    it("should throw error for invalid job ID", async () => {
      await expect(createJobTree({ jobId: "invalid job" })).rejects.toThrow(
        "Invalid job ID format: invalid job. Must match ^[A-Za-z0-9-_]+$"
      );
    });

    it("should throw error for invalid location", async () => {
      await expect(createJobTree({ location: "invalid" })).rejects.toThrow(
        "Invalid location: invalid. Must be 'current' or 'complete'"
      );
    });
  });

  describe("createTasksStatus", () => {
    it("should create valid tasks status object", () => {
      const tasks = {
        "task-1": { state: "pending" },
        "task-2": { state: "running", startedAt: "2024-01-01T00:00:00.000Z" },
        "task-3": { state: "done", endedAt: "2024-01-01T01:00:00.000Z" },
      };

      const tasksStatus = createTasksStatus({
        jobId: "test-job",
        name: "Test Job",
        tasks,
      });

      expect(tasksStatus.id).toBe("test-job");
      expect(tasksStatus.name).toBe("Test Job");
      expect(tasksStatus.tasks).toEqual(tasks);
      expect(tasksStatus.createdAt).toBeDefined();
      expect(tasksStatus.updatedAt).toBeDefined();
    });

    it("should validate task states", () => {
      const invalidTasks = {
        "task-1": { state: "invalid-state" },
      };

      expect(() =>
        createTasksStatus({
          jobId: "test-job",
          tasks: invalidTasks,
        })
      ).toThrow(
        "Invalid task state for task-1: invalid-state. Must be one of: pending, running, done, error"
      );
    });

    it("should validate job ID", () => {
      expect(() =>
        createTasksStatus({
          jobId: "invalid job",
          tasks: {},
        })
      ).toThrow("Invalid job ID: invalid job");
    });
  });

  describe("createTask", () => {
    it("should create a basic task", () => {
      const task = createTask({ state: "pending" });
      expect(task).toEqual({ state: "pending" });
    });

    it("should create a task with all optional fields", () => {
      const task = createTask({
        state: "done",
        startedAt: "2024-01-01T00:00:00.000Z",
        endedAt: "2024-01-01T01:00:00.000Z",
        attempts: 3,
        executionTimeMs: 1500,
        artifacts: ["tasks/task-1/output.json"],
      });

      expect(task).toEqual({
        state: "done",
        startedAt: "2024-01-01T00:00:00.000Z",
        endedAt: "2024-01-01T01:00:00.000Z",
        attempts: 3,
        executionTimeMs: 1500,
        artifacts: ["tasks/task-1/output.json"],
      });
    });

    it("should validate task state", () => {
      expect(() => createTask({ state: "invalid" })).toThrow(
        "Invalid task state: invalid. Must be one of: pending, running, done, error"
      );
    });
  });

  describe("createMultipleJobTrees", () => {
    let jobTrees;

    afterEach(async () => {
      if (jobTrees) {
        await jobTrees.cleanup();
      }
    });

    it("should create multiple job trees", async () => {
      const jobConfigs = [
        { jobId: "job-1", location: "current" },
        { jobId: "job-2", location: "complete" },
        { jobId: "job-3", location: "current" },
      ];

      jobTrees = await createMultipleJobTrees(jobConfigs);

      expect(jobTrees.jobTrees).toHaveLength(3);

      for (let i = 0; i < jobConfigs.length; i++) {
        const jobTree = jobTrees.jobTrees[i];
        const config = jobConfigs[i];

        expect(jobTree.jobId).toBe(config.jobId);
        expect(jobTree.location).toBe(config.location);

        // Verify each job tree exists
        const tasksStatusPath = path.join(jobTree.jobDir, "tasks-status.json");
        const tasksStatus = JSON.parse(
          await fs.readFile(tasksStatusPath, "utf8")
        );
        expect(tasksStatus.id).toBe(config.jobId);
      }
    });
  });

  describe("createLockFile and removeLockFile", () => {
    let jobTree;
    let lockPath;

    beforeEach(async () => {
      jobTree = await createJobTree({ jobId: "lock-test" });
    });

    afterEach(async () => {
      if (lockPath) {
        try {
          await removeLockFile(lockPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      if (jobTree) {
        await jobTree.cleanup();
      }
    });

    it("should create and remove lock file", async () => {
      lockPath = await createLockFile(jobTree.jobDir);

      // Verify lock file exists
      const stats = await fs.stat(lockPath);
      expect(stats.isFile()).toBe(true);

      // Remove lock file
      await removeLockFile(lockPath);

      // Verify lock file is removed
      await expect(fs.stat(lockPath)).rejects.toThrow();
    });

    it("should handle removing non-existent lock file gracefully", async () => {
      await expect(
        removeLockFile("/non/existent/path.lock")
      ).resolves.not.toThrow();
    });
  });

  describe("cleanup functionality", () => {
    it("should clean up temporary directories", async () => {
      const jobTree = await createJobTree({ jobId: "cleanup-test" });

      const jobDirExists = async () => {
        try {
          await fs.stat(jobTree.jobDir);
          return true;
        } catch {
          return false;
        }
      };

      // Verify directory exists before cleanup
      expect(await jobDirExists()).toBe(true);

      // Clean up
      await jobTree.cleanup();

      // Verify directory is removed
      expect(await jobDirExists()).toBe(false);
    });

    it("should handle cleanup errors gracefully", async () => {
      const jobTree = await createJobTree({ jobId: "error-cleanup-test" });

      // Manually remove the directory to cause cleanup error
      await fs.rm(jobTree.tempDir, { recursive: true, force: true });

      // Cleanup should not throw even if directory is already gone
      await expect(jobTree.cleanup()).resolves.not.toThrow();
    });
  });
});
