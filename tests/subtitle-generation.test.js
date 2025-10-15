import { describe, it, expect } from "vitest";
import { computeDagItems } from "../src/utils/dag.js";
import { fmtDuration } from "../src/utils/duration.js";

// Helper function to simulate the subtitle generation logic from JobDetail.jsx
function generateSubtitle(task, taskConfig) {
  const subtitleParts = [];
  if (taskConfig?.model) subtitleParts.push(`model: ${taskConfig.model}`);
  if (taskConfig?.temperature != null)
    subtitleParts.push(`temp: ${taskConfig.temperature}`);
  if (task?.attempts != null) subtitleParts.push(`attempts: ${task.attempts}`);
  if (task?.refinementAttempts != null)
    subtitleParts.push(`refinements: ${task.refinementAttempts}`);
  if (task?.startedAt) {
    const execMs =
      task?.executionTime ??
      (task.endedAt
        ? Date.parse(task.endedAt) - Date.parse(task.startedAt)
        : 0);
    if (execMs) subtitleParts.push(`time: ${fmtDuration(execMs)}`);
  }

  return subtitleParts.length > 0 ? subtitleParts.join(" · ") : null;
}

describe("subtitle generation", () => {
  it("generates subtitle with all available metadata", () => {
    const task = {
      state: "done",
      startedAt: "2025-10-12T13:13:23.805Z",
      endedAt: "2025-10-12T13:13:25.555Z",
      attempts: 2,
      refinementAttempts: 1,
      executionTime: 1750,
    };

    const taskConfig = {
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 2000,
    };

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("model: gpt-4");
    expect(subtitle).toContain("temp: 0.7");
    expect(subtitle).toContain("attempts: 2");
    expect(subtitle).toContain("refinements: 1");
    expect(subtitle).toContain("time:");
  });

  it("handles missing task config gracefully", () => {
    const task = {
      state: "done",
      startedAt: "2025-10-12T13:13:23.805Z",
      endedAt: "2025-10-12T13:13:25.555Z",
      attempts: 1,
    };

    const taskConfig = null;

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("attempts: 1");
    expect(subtitle).not.toContain("model:");
    expect(subtitle).not.toContain("temp:");
  });

  it("handles missing task metadata gracefully", () => {
    const task = {
      state: "pending",
    };

    const taskConfig = {
      model: "gpt-4",
      temperature: 0.7,
    };

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("model: gpt-4");
    expect(subtitle).toContain("temp: 0.7");
    expect(subtitle).not.toContain("attempts:");
    expect(subtitle).not.toContain("time:");
  });

  it("returns null when no metadata available", () => {
    const task = {
      state: "pending",
    };

    const taskConfig = {};

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toBeNull();
  });

  it("calculates time from executionTime when available", () => {
    const task = {
      state: "done",
      startedAt: "2025-10-12T13:13:23.805Z",
      executionTime: 1750,
    };

    const taskConfig = {};

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toBeTruthy();
    expect(subtitle).toContain("time:");
  });

  it("calculates time from startedAt/endedAt when executionTime not available", () => {
    const task = {
      state: "done",
      startedAt: "2025-10-12T13:13:23.805Z",
      endedAt: "2025-10-12T13:13:25.555Z",
    };

    const taskConfig = {};

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("time:");
  });

  it("handles zero temperature correctly", () => {
    const task = {
      state: "pending",
    };

    const taskConfig = {
      model: "gpt-4",
      temperature: 0,
    };

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("model: gpt-4");
    expect(subtitle).toContain("temp: 0");
  });

  it("handles zero attempts correctly", () => {
    const task = {
      state: "done",
      attempts: 0,
    };

    const taskConfig = {};

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("attempts: 0");
  });

  it("handles zero refinement attempts correctly", () => {
    const task = {
      state: "done",
      attempts: 1,
      refinementAttempts: 0,
    };

    const taskConfig = {};

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("attempts: 1");
    expect(subtitle).toContain("refinements: 0");
  });

  it("combines multiple metadata with proper separator", () => {
    const task = {
      state: "done",
      startedAt: "2025-10-12T13:13:23.805Z",
      attempts: 2,
      executionTime: 1000,
    };

    const taskConfig = {
      model: "gpt-4",
      temperature: 0.7,
    };

    const subtitle = generateSubtitle(task, taskConfig);

    expect(subtitle).toContain("model: gpt-4");
    expect(subtitle).toContain("temp: 0.7");
    expect(subtitle).toContain("attempts: 2");
    expect(subtitle).toContain("time:");
    expect(subtitle).toMatch(/model: gpt-4 · temp: 0\.7 · attempts: 2 · time:/);
  });

  it("handles partial metadata combinations", () => {
    const testCases = [
      {
        task: { state: "done", attempts: 3 },
        config: { model: "gpt-3.5-turbo" },
        expected: ["model:", "attempts:"],
      },
      {
        task: { state: "running", startedAt: "2025-10-12T13:13:23.805Z" },
        config: { temperature: 0.5 },
        expected: ["temp:"], // Running tasks without endedAt don't show time in this legacy test
      },
      {
        task: { state: "error", refinementAttempts: 2 },
        config: {},
        expected: ["refinements:"],
      },
      {
        task: { state: "pending" },
        config: { model: "claude-3", temperature: 0.8 },
        expected: ["model:", "temp:"],
      },
    ];

    testCases.forEach(({ task, config, expected }) => {
      const subtitle = generateSubtitle(task, config);
      expected.forEach((expectedPart) => {
        expect(subtitle).toContain(expectedPart);
      });
    });
  });
});
