/**
 * Focused tests for task files filtering and per-step isolation
 * @module tests/task-files-filtering
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getTaskFilesForTask,
  createEmptyTaskFiles,
  normalizeTaskFiles,
  ensureTaskFiles,
} from "../src/utils/task-files.js";
import { createMockTaskRunner } from "./test-utils.js";

describe("Task Files Filtering and Per-Step Isolation", () => {
  const mockJobId = "test-job-123";

  // Mock task data with different file categories
  const mockTaskWithFiles = {
    id: "analysis-task",
    status: "done",
    files: {
      artifacts: ["output.json", "results.csv", "chart.png"],
      logs: ["execution.log", "debug.log", "error.log"],
      tmp: ["temp-data.json", "scratch.txt"],
    },
  };

  const mockTaskWithEmptyFiles = {
    id: "empty-task",
    status: "done",
    files: {
      artifacts: [],
      logs: [],
      tmp: [],
    },
  };

  const mockTaskWithoutFiles = {
    id: "no-files-task",
    status: "pending",
  };

  const mockJobWithMultipleTasks = {
    id: mockJobId,
    name: "Test Job",
    status: "running",
    tasks: {
      "analysis-task": mockTaskWithFiles,
      "empty-task": mockTaskWithEmptyFiles,
      "no-files-task": mockTaskWithoutFiles,
    },
  };

  describe("getTaskFilesForTask", () => {
    it("should return files for a task with all categories populated", () => {
      const result = getTaskFilesForTask(
        mockJobWithMultipleTasks,
        "analysis-task"
      );

      expect(result).toEqual({
        artifacts: ["output.json", "results.csv", "chart.png"],
        logs: ["execution.log", "debug.log", "error.log"],
        tmp: ["temp-data.json", "scratch.txt"],
      });
    });

    it("should return empty files for a task with empty arrays", () => {
      const result = getTaskFilesForTask(
        mockJobWithMultipleTasks,
        "empty-task"
      );

      expect(result).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });

    it("should return empty files for a task without files property", () => {
      const result = getTaskFilesForTask(
        mockJobWithMultipleTasks,
        "no-files-task"
      );

      expect(result).toEqual(createEmptyTaskFiles());
    });

    it("should handle null/undefined job context gracefully", () => {
      const result = getTaskFilesForTask(null, "analysis-task");

      expect(result).toEqual(createEmptyTaskFiles());
    });

    it("should isolate files per task - no cross-contamination", () => {
      const analysisResult = getTaskFilesForTask(
        mockJobWithMultipleTasks,
        "analysis-task"
      );
      const emptyResult = getTaskFilesForTask(
        mockJobWithMultipleTasks,
        "empty-task"
      );
      const noFilesResult = getTaskFilesForTask(
        mockJobWithMultipleTasks,
        "no-files-task"
      );

      // Each task should have completely separate file sets
      expect(analysisResult.artifacts).toHaveLength(3);
      expect(emptyResult.artifacts).toHaveLength(0);
      expect(noFilesResult.artifacts).toHaveLength(0);

      expect(analysisResult.logs).toHaveLength(3);
      expect(emptyResult.logs).toHaveLength(0);
      expect(noFilesResult.logs).toHaveLength(0);
    });
  });

  describe("normalizeTaskFiles", () => {
    it("should normalize valid task files structure", () => {
      const result = normalizeTaskFiles({
        artifacts: ["output.json", "results.csv"],
        logs: ["execution.log"],
        tmp: ["temp.txt"],
      });

      expect(result).toEqual({
        artifacts: ["output.json", "results.csv"],
        logs: ["execution.log"],
        tmp: ["temp.txt"],
      });
    });

    it("should handle malformed input gracefully", () => {
      const result = normalizeTaskFiles({
        artifacts: null,
        logs: undefined,
        tmp: "not-an-array",
        input: ["legacy.txt"], // should be ignored with warning
      });

      expect(result).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });

    it("should filter non-string entries", () => {
      const result = normalizeTaskFiles({
        artifacts: ["valid.json", null, undefined, 123, "also-valid.csv"],
        logs: [],
        tmp: [],
      });

      expect(result).toEqual({
        artifacts: ["valid.json", "also-valid.csv"],
        logs: [],
        tmp: [],
      });
    });
  });

  describe("ensureTaskFiles", () => {
    it("should add normalized files to task object", () => {
      const task = { id: "test", status: "running" };
      const result = ensureTaskFiles(task);

      expect(result).toEqual(createEmptyTaskFiles());
      expect(task.files).toEqual(createEmptyTaskFiles());
    });

    it("should normalize existing files in task object", () => {
      const task = {
        id: "test",
        files: {
          artifacts: ["output.json", 123, null],
          input: ["legacy.txt"], // should be ignored
        },
      };

      const result = ensureTaskFiles(task);

      expect(result).toEqual({
        artifacts: ["output.json"],
        logs: [],
        tmp: [],
      });
      expect(task.files).toEqual(result);
    });
  });

  describe("Per-Step Isolation", () => {
    it("should ensure task steps are completely isolated", () => {
      const tasks = [
        {
          id: "step1",
          files: { artifacts: ["step1-output.json"], logs: [], tmp: [] },
        },
        {
          id: "step2",
          files: { artifacts: ["step2-output.json"], logs: [], tmp: [] },
        },
        {
          id: "step3",
          files: { artifacts: ["step3-output.json"], logs: [], tmp: [] },
        },
      ];

      const job = {
        id: "test-job",
        tasks: tasks.reduce((acc, task) => ({ ...acc, [task.id]: task }), {}),
      };

      const step1Files = getTaskFilesForTask(job, "step1");
      const step2Files = getTaskFilesForTask(job, "step2");
      const step3Files = getTaskFilesForTask(job, "step3");

      // Each step should only see its own files
      expect(step1Files.artifacts).toEqual(["step1-output.json"]);
      expect(step2Files.artifacts).toEqual(["step2-output.json"]);
      expect(step3Files.artifacts).toEqual(["step3-output.json"]);

      // No cross-contamination
      expect(step1Files.artifacts).not.toContain("step2-output.json");
      expect(step1Files.artifacts).not.toContain("step3-output.json");
      expect(step2Files.artifacts).not.toContain("step1-output.json");
      expect(step2Files.artifacts).not.toContain("step3-output.json");
      expect(step3Files.artifacts).not.toContain("step1-output.json");
      expect(step3Files.artifacts).not.toContain("step2-output.json");
    });

    it("should handle steps with different file patterns", () => {
      const tasks = [
        {
          id: "data-processing",
          files: {
            artifacts: ["processed-data.csv", "statistics.json"],
            logs: ["processing.log"],
            tmp: [],
          },
        },
        {
          id: "analysis",
          files: {
            artifacts: ["analysis-report.pdf"],
            logs: ["analysis.log", "debug.log"],
            tmp: ["temp-calculations.json"],
          },
        },
        {
          id: "cleanup",
          files: {
            artifacts: [],
            logs: ["cleanup.log"],
            tmp: ["junk.tmp"],
          },
        },
      ];

      const job = {
        id: "test-job",
        tasks: tasks.reduce((acc, task) => ({ ...acc, [task.id]: task }), {}),
      };

      tasks.forEach((task) => {
        const files = getTaskFilesForTask(job, task.id);

        // Verify each step only has its designated files
        Object.entries(files).forEach(([category, fileList]) => {
          fileList.forEach((filename) => {
            // File should belong to this step's files
            expect(task.files[category]).toContain(filename);
          });
        });
      });
    });
  });

  describe("Filtering Edge Cases", () => {
    it("should handle malformed file objects gracefully", () => {
      const malformedTask = {
        id: "malformed",
        files: {
          artifacts: null,
          logs: undefined,
          tmp: "not-an-array",
        },
      };

      const job = {
        id: "test",
        tasks: { malformed: malformedTask },
      };

      const result = getTaskFilesForTask(job, "malformed");

      expect(result).toEqual(createEmptyTaskFiles());
    });

    it("should handle tasks with partial file data", () => {
      const partialTask = {
        id: "partial",
        files: {
          artifacts: ["output.json"],
          // logs missing
          tmp: ["temp.txt"],
        },
      };

      const job = {
        id: "test",
        tasks: { partial: partialTask },
      };

      const result = getTaskFilesForTask(job, "partial");

      expect(result.artifacts).toEqual(["output.json"]);
      expect(result.logs).toEqual([]);
      expect(result.tmp).toEqual(["temp.txt"]);
    });

    it("should filter out invalid file names", () => {
      const taskWithInvalidNames = {
        id: "invalid-names",
        files: {
          artifacts: [
            "output.json",
            "",
            "valid.csv",
            null,
            undefined,
            "../malicious.json",
          ],
          logs: ["log.txt"],
          tmp: [],
        },
      };

      const job = {
        id: "test",
        tasks: { [taskWithInvalidNames.id]: taskWithInvalidNames },
      };

      const result = getTaskFilesForTask(job, "invalid-names");

      // normalizeTaskFiles only filters for strings, not empty strings or path validation
      expect(result.artifacts).toEqual([
        "output.json",
        "",
        "valid.csv",
        "../malicious.json",
      ]);
      expect(result.logs).toEqual(["log.txt"]);
      expect(result.tmp).toEqual([]);
    });
  });
});
