import { describe, it, expect } from "vitest";
import {
  DisplayCategory,
  classifyJobForDisplay,
} from "../../src/utils/jobs.js";

describe("classifyJobForDisplay", () => {
  it("should return 'errors' when any task is failed", () => {
    const job = {
      status: "running",
      tasks: {
        task1: { state: "done" },
        task2: { state: "failed" },
        task3: { state: "pending" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.ERRORS);
  });

  it("should return 'errors' when job status is failed (even if no tasks failed)", () => {
    const job = {
      status: "failed",
      tasks: {
        task1: { state: "done" },
        task2: { state: "done" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.ERRORS);
  });

  it("should return 'current' when any task is running (and no failures)", () => {
    const job = {
      status: "pending",
      tasks: {
        task1: { state: "done" },
        task2: { state: "running" },
        task3: { state: "pending" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.CURRENT);
  });

  it("should return 'current' when job status is running (and no task failures)", () => {
    const job = {
      status: "running",
      tasks: {
        task1: { state: "pending" },
        task2: { state: "pending" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.CURRENT);
  });

  it("should return 'complete' when all tasks are done", () => {
    const job = {
      status: "pending",
      tasks: {
        task1: { state: "done" },
        task2: { state: "done" },
        task3: { state: "done" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.COMPLETE);
  });

  it("should return 'current' for mixed/pending states with no running or failed tasks", () => {
    const job = {
      status: "pending",
      tasks: {
        task1: { state: "done" },
        task2: { state: "pending" },
        task3: { state: "pending" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.CURRENT);
  });

  it("should return 'current' when job has no tasks", () => {
    const job = {
      status: "pending",
      tasks: {},
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.CURRENT);
  });

  it("should return 'current' when job has null/undefined tasks", () => {
    const job = {
      status: "pending",
      tasks: null,
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.CURRENT);
  });

  it("should return 'current' when job is null or undefined", () => {
    expect(classifyJobForDisplay(null)).toBe(DisplayCategory.CURRENT);
    expect(classifyJobForDisplay(undefined)).toBe(DisplayCategory.CURRENT);
  });

  it("should handle array format tasks", () => {
    const job = {
      status: "pending",
      tasks: [
        { name: "task1", state: "done" },
        { name: "task2", state: "failed" },
        { name: "task3", state: "pending" },
      ],
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.ERRORS);
  });

  it("should normalize task states using normalizeTaskState", () => {
    const job = {
      status: "pending",
      tasks: {
        task1: { state: "succeeded" }, // normalizes to "done"
        task2: { state: "error" }, // normalizes to "failed"
        task3: { state: "invalid" }, // normalizes to "pending"
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.ERRORS);
  });

  it("should prioritize errors over running", () => {
    const job = {
      status: "pending",
      tasks: {
        task1: { state: "running" },
        task2: { state: "failed" },
        task3: { state: "pending" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.ERRORS);
  });

  it("should prioritize running over complete", () => {
    const job = {
      status: "pending",
      tasks: {
        task1: { state: "done" },
        task2: { state: "running" },
        task3: { state: "done" },
      },
    };

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.CURRENT);
  });

  it("should handle empty job object", () => {
    const job = {};

    expect(classifyJobForDisplay(job)).toBe(DisplayCategory.CURRENT);
  });
});
