import { describe, test, expect } from "bun:test";
import { computeDeterministicProgress, KNOWN_STAGES } from "../../src/core/progress";

describe("computeDeterministicProgress", () => {
  test('["task1","task2"], "task1", "ingestion" → 5', () => {
    // round(100 * 1 / 22) = round(4.545...) = 5
    expect(computeDeterministicProgress(["task1", "task2"], "task1", "ingestion")).toBe(5);
  });

  test('["task1","task2"], "task2", "integration" → 100', () => {
    expect(computeDeterministicProgress(["task1", "task2"], "task2", "integration")).toBe(100);
  });

  test("unknown task ID defaults to task index 0", () => {
    const withUnknown = computeDeterministicProgress(["task1", "task2"], "unknown", "ingestion");
    const withTask1 = computeDeterministicProgress(["task1", "task2"], "task1", "ingestion");
    expect(withUnknown).toBe(withTask1);
  });

  test("unknown stage name defaults to stage index 0", () => {
    const withUnknown = computeDeterministicProgress(["task1", "task2"], "task1", "unknownStage");
    const withFirst = computeDeterministicProgress(["task1", "task2"], "task1", KNOWN_STAGES[0]);
    expect(withUnknown).toBe(withFirst);
  });

  test("empty pipelineTaskIds returns clamped value (no throw, no NaN)", () => {
    const result = computeDeterministicProgress([], "task1", "ingestion");
    expect(typeof result).toBe("number");
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test("custom stages parameter overrides KNOWN_STAGES", () => {
    const custom = ["alpha", "beta", "gamma"] as const;
    // taskIndex=0, stageIndex=1, totalSteps=1*3=3 → round(100*2/3) = 67
    expect(computeDeterministicProgress(["t1"], "t1", "beta", custom)).toBe(67);
  });
});
