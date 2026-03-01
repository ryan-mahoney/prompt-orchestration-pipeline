/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createEmptyTaskFiles,
  ensureTaskFiles,
  getTaskFilesForTask,
  normalizeTaskFiles,
} from "../src/utils/task-files.js";

describe("task-files selector utilities", () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("createEmptyTaskFiles", () => {
    it("returns empty arrays for all categories", () => {
      const result = createEmptyTaskFiles();
      expect(result).toEqual({ artifacts: [], logs: [], tmp: [] });
      expect(Object.isFrozen(result)).toBe(false);
    });
  });

  describe("normalizeTaskFiles", () => {
    it("coerces missing or invalid values into empty arrays", () => {
      const result = normalizeTaskFiles({
        artifacts: "not-an-array",
        logs: null,
        tmp: [{ foo: "bar" }],
      });
      expect(result).toEqual({ artifacts: [], logs: [], tmp: [] });
    });

    it("filters non-string entries and keeps only strings", () => {
      const result = normalizeTaskFiles({
        artifacts: ["valid", 42, { foo: "bar" }, "another"],
        logs: ["log.txt", false],
        tmp: ["tmp.json", undefined],
      });
      expect(result).toEqual({
        artifacts: ["valid", "another"],
        logs: ["log.txt"],
        tmp: ["tmp.json"],
      });
    });

    it("warns when unsupported keys are present", () => {
      normalizeTaskFiles({
        artifacts: ["file.txt"],
        input: ["legacy-input.json"],
        unknown: ["something"],
      });
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy.mock.calls[0][0]).toContain("legacy keys");
      expect(warnSpy.mock.calls[1][0]).toContain("unsupported task.files keys");
    });

    it("handles non-object input without throwing", () => {
      expect(normalizeTaskFiles(null)).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
      expect(normalizeTaskFiles("invalid")).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });
  });

  describe("ensureTaskFiles", () => {
    it("normalizes and mutates the provided task object", () => {
      const task = {
        files: {
          artifacts: ["a.json", 123],
          logs: ["log.txt"],
          tmp: null,
        },
      };

      const normalized = ensureTaskFiles(task);

      expect(normalized).toEqual({
        artifacts: ["a.json"],
        logs: ["log.txt"],
        tmp: [],
      });
      expect(task.files).toEqual(normalized);
    });

    it("assigns normalized files even when none were provided", () => {
      const task = {};
      const normalized = ensureTaskFiles(task);
      expect(normalized).toEqual({ artifacts: [], logs: [], tmp: [] });
      expect(task.files).toEqual(normalized);
    });
  });

  describe("getTaskFilesForTask", () => {
    it("returns empty arrays for missing job or task", () => {
      expect(getTaskFilesForTask(null, "foo")).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
      expect(getTaskFilesForTask({}, "foo")).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });

    it("supports task collections stored as arrays", () => {
      const job = {
        tasks: [
          { id: "task-a", files: { artifacts: ["a.json"] } },
          { name: "task-b", files: { logs: ["b.log"] } },
        ],
      };

      expect(getTaskFilesForTask(job, "task-a")).toEqual({
        artifacts: ["a.json"],
        logs: [],
        tmp: [],
      });
      expect(getTaskFilesForTask(job, "task-b")).toEqual({
        artifacts: [],
        logs: ["b.log"],
        tmp: [],
      });
    });

    it("supports task collections stored as keyed objects", () => {
      const job = {
        tasks: {
          "task-c": { files: { tmp: ["tmp.txt"] } },
        },
      };

      expect(getTaskFilesForTask(job, "task-c")).toEqual({
        artifacts: [],
        logs: [],
        tmp: ["tmp.txt"],
      });
    });

    it("falls back to matching by index when tasks array index is requested", () => {
      const job = {
        tasks: [
          { files: { artifacts: ["index-0.txt"] } },
          { files: { logs: ["index-1.log"] } },
        ],
      };

      expect(getTaskFilesForTask(job, 0)).toEqual({
        artifacts: ["index-0.txt"],
        logs: [],
        tmp: [],
      });
      expect(getTaskFilesForTask(job, 1)).toEqual({
        artifacts: [],
        logs: ["index-1.log"],
        tmp: [],
      });
    });

    it("normalizes files when a task uses legacy keys", () => {
      const job = {
        tasks: {
          taskLegacy: { files: { input: ["legacy.json"] } },
        },
      };

      expect(getTaskFilesForTask(job, "taskLegacy")).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
