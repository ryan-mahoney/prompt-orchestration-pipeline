import { describe, it, expect } from "vitest";
import {
  KNOWN_STAGES,
  computeDeterministicProgress,
} from "../src/core/progress.js";

describe("KNOWN_STAGES", () => {
  it("should contain the expected stages in the correct order", () => {
    expect(KNOWN_STAGES).toEqual([
      "ingestion",
      "preProcessing",
      "promptTemplating",
      "inference",
      "parsing",
      "validateStructure",
      "validateQuality",
      "critique",
      "refine",
      "finalValidation",
      "integration",
    ]);
  });

  it("should have 11 stages total", () => {
    expect(KNOWN_STAGES).toHaveLength(11);
  });
});

describe("computeDeterministicProgress", () => {
  describe("basic two-task pipeline verification", () => {
    const pipelineTasks = ["task-a", "task-b"];
    const totalStages = KNOWN_STAGES.length;

    it("should compute progress for first task at first stage", () => {
      const progress = computeDeterministicProgress(
        pipelineTasks,
        "task-a",
        "ingestion"
      );
      const expected = Math.round((100 * 1) / (2 * totalStages));
      expect(progress).toBe(expected);
    });

    it("should compute progress for first task at last stage", () => {
      const progress = computeDeterministicProgress(
        pipelineTasks,
        "task-a",
        "integration"
      );
      const expected = Math.round((100 * totalStages) / (2 * totalStages));
      expect(progress).toBe(50);
    });

    it("should compute progress for second task at first stage", () => {
      const progress = computeDeterministicProgress(
        pipelineTasks,
        "task-b",
        "ingestion"
      );
      const expected = Math.round(
        (100 * (totalStages + 1)) / (2 * totalStages)
      );
      expect(progress).toBe(55);
    });

    it("should compute progress for second task at last stage", () => {
      const progress = computeDeterministicProgress(
        pipelineTasks,
        "task-b",
        "integration"
      );
      expect(progress).toBe(100);
    });
  });

  describe("edge cases", () => {
    it("should handle unknown task ID gracefully", () => {
      const progress = computeDeterministicProgress(
        ["task-a", "task-b"],
        "unknown-task",
        "ingestion"
      );
      const expected = Math.round((100 * 1) / (2 * KNOWN_STAGES.length));
      expect(progress).toBe(expected);
    });

    it("should handle unknown stage name gracefully", () => {
      const progress = computeDeterministicProgress(
        ["task-a", "task-b"],
        "task-a",
        "unknown-stage"
      );
      const expected = Math.round((100 * 1) / (2 * KNOWN_STAGES.length));
      expect(progress).toBe(expected);
    });

    it("should handle both unknown task and stage", () => {
      const progress = computeDeterministicProgress(
        ["task-a", "task-b"],
        "unknown-task",
        "unknown-stage"
      );
      const expected = Math.round((100 * 1) / (2 * KNOWN_STAGES.length));
      expect(progress).toBe(expected);
    });

    it("should handle empty pipeline task list", () => {
      const progress = computeDeterministicProgress(
        [],
        "any-task",
        "any-stage"
      );
      // With empty pipeline, totalSteps = 1, taskIdx = 0, stageIdx = 0, completed = 1
      expect(progress).toBe(100);
    });

    it("should handle single task pipeline", () => {
      const pipelineTasks = ["single-task"];

      const firstStage = computeDeterministicProgress(
        pipelineTasks,
        "single-task",
        "ingestion"
      );
      expect(firstStage).toBe(Math.round((100 * 1) / KNOWN_STAGES.length));

      const lastStage = computeDeterministicProgress(
        pipelineTasks,
        "single-task",
        "integration"
      );
      expect(lastStage).toBe(100);
    });
  });

  describe("boundary conditions", () => {
    it("should never exceed 100", () => {
      // Test with maximum values
      const progress = computeDeterministicProgress(
        ["task"],
        "task",
        "integration"
      );
      expect(progress).toBeLessThanOrEqual(100);
    });

    it("should never go below 0", () => {
      // Test with empty pipeline which could potentially cause issues
      const progress = computeDeterministicProgress([], "task", "stage");
      expect(progress).toBeGreaterThanOrEqual(0);
    });

    it("should always return an integer", () => {
      const progress = computeDeterministicProgress(
        ["task-a", "task-b"],
        "task-a",
        "preProcessing"
      );
      expect(Number.isInteger(progress)).toBe(true);
    });
  });

  describe("deterministic behavior", () => {
    it("should return the same result for identical inputs", () => {
      const inputs = ["task-a", "task-b"];
      const taskId = "task-a";
      const stage = "inference";

      const result1 = computeDeterministicProgress(inputs, taskId, stage);
      const result2 = computeDeterministicProgress(inputs, taskId, stage);

      expect(result1).toBe(result2);
    });

    it("should be monotonic within the same task", () => {
      const pipelineTasks = ["task-a", "task-b"];

      let previousProgress = -1;
      for (const stage of KNOWN_STAGES) {
        const progress = computeDeterministicProgress(
          pipelineTasks,
          "task-a",
          stage
        );
        expect(progress).toBeGreaterThan(previousProgress);
        previousProgress = progress;
      }
    });

    it("should be monotonic across tasks", () => {
      const pipelineTasks = ["task-a", "task-b"];

      const lastStageOfFirstTask = computeDeterministicProgress(
        pipelineTasks,
        "task-a",
        "integration"
      );
      const firstStageOfSecondTask = computeDeterministicProgress(
        pipelineTasks,
        "task-b",
        "ingestion"
      );

      expect(firstStageOfSecondTask).toBeGreaterThan(lastStageOfFirstTask);
    });
  });

  describe("custom stages parameter", () => {
    it("should use custom stages when provided", () => {
      const customStages = ["stage1", "stage2", "stage3"];
      const pipelineTasks = ["task-a", "task-b"];

      const progress = computeDeterministicProgress(
        pipelineTasks,
        "task-a",
        "stage2",
        customStages
      );
      const expected = Math.round((100 * 2) / (2 * 3)); // 2 completed steps out of 6 total
      expect(progress).toBe(expected);
    });

    it("should fallback to first stage when current stage not in custom list", () => {
      const customStages = ["stage1", "stage2", "stage3"];
      const pipelineTasks = ["task-a"];

      const progress = computeDeterministicProgress(
        pipelineTasks,
        "task-a",
        "unknown-stage",
        customStages
      );
      const expected = Math.round((100 * 1) / 3); // stageIdx = 0, so completed = 1
      expect(progress).toBe(expected);
    });
  });

  describe("large pipeline handling", () => {
    it("should handle pipeline with many tasks", () => {
      const manyTasks = Array.from({ length: 10 }, (_, i) => `task-${i}`);

      const firstProgress = computeDeterministicProgress(
        manyTasks,
        "task-0",
        "ingestion"
      );
      const lastProgress = computeDeterministicProgress(
        manyTasks,
        "task-9",
        "integration"
      );

      expect(firstProgress).toBe(
        Math.round((100 * 1) / (10 * KNOWN_STAGES.length))
      );
      expect(lastProgress).toBe(100);
    });
  });
});
