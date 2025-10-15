import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeState,
  taskDisplayDurationMs,
  jobCumulativeDurationMs,
  fmtDuration,
  elapsedBetween,
} from "../src/utils/duration.js";

describe("normalizeState", () => {
  it("normalizes done to completed", () => {
    expect(normalizeState("done")).toBe("completed");
  });

  it("normalizes failed to error", () => {
    expect(normalizeState("failed")).toBe("error");
  });

  it("normalizes error to error", () => {
    expect(normalizeState("error")).toBe("error");
  });

  it("passes through known states", () => {
    expect(normalizeState("pending")).toBe("pending");
    expect(normalizeState("running")).toBe("running");
    expect(normalizeState("current")).toBe("current");
    expect(normalizeState("completed")).toBe("completed");
    expect(normalizeState("rejected")).toBe("rejected");
  });

  it("passes through unknown states", () => {
    expect(normalizeState("unknown")).toBe("unknown");
    expect(normalizeState("custom")).toBe("custom");
  });
});

describe("taskDisplayDurationMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for tasks without startedAt", () => {
    const task = { state: "running" };
    expect(taskDisplayDurationMs(task)).toBe(0);
  });

  it("returns 0 for pending tasks", () => {
    const task = {
      state: "pending",
      startedAt: "2023-01-01T00:00:00.000Z",
    };
    vi.setSystemTime(new Date("2023-01-01T00:01:00.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(0);
  });

  it("calculates duration for running tasks", () => {
    const task = {
      state: "running",
      startedAt: "2023-01-01T00:00:00.000Z",
    };
    vi.setSystemTime(new Date("2023-01-01T00:01:30.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(90000); // 90 seconds
  });

  it("calculates duration for current tasks", () => {
    const task = {
      state: "current",
      startedAt: "2023-01-01T00:00:00.000Z",
    };
    vi.setSystemTime(new Date("2023-01-01T00:00:45.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(45000); // 45 seconds
  });

  it("prefers executionTime for completed tasks", () => {
    const task = {
      state: "completed",
      startedAt: "2023-01-01T00:00:00.000Z",
      endedAt: "2023-01-01T00:02:00.000Z",
      executionTime: 75000, // 75 seconds
    };
    vi.setSystemTime(new Date("2023-01-01T00:03:00.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(75000);
  });

  it("calculates duration for completed tasks without executionTime", () => {
    const task = {
      state: "completed",
      startedAt: "2023-01-01T00:00:00.000Z",
      endedAt: "2023-01-01T00:01:30.000Z",
    };
    vi.setSystemTime(new Date("2023-01-01T00:02:00.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(90000); // 90 seconds
  });

  it("calculates duration for completed tasks without endedAt", () => {
    const task = {
      state: "completed",
      startedAt: "2023-01-01T00:00:00.000Z",
    };
    vi.setSystemTime(new Date("2023-01-01T00:01:15.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(75000); // 75 seconds
  });

  it("returns 0 for rejected tasks", () => {
    const task = {
      state: "rejected",
      startedAt: "2023-01-01T00:00:00.000Z",
    };
    vi.setSystemTime(new Date("2023-01-01T00:01:00.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(0);
  });

  it("handles normalized states", () => {
    const task = {
      state: "done", // should be normalized to completed
      startedAt: "2023-01-01T00:00:00.000Z",
      executionTime: 50000,
    };
    expect(taskDisplayDurationMs(task)).toBe(50000);
  });

  it("handles future times gracefully", () => {
    const task = {
      state: "running",
      startedAt: "2023-01-01T00:05:00.000Z", // Future time
    };
    vi.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
    expect(taskDisplayDurationMs(task)).toBe(0); // Should not be negative
  });

  it("accepts custom now parameter", () => {
    const task = {
      state: "running",
      startedAt: "2023-01-01T00:00:00.000Z",
    };
    const customNow = new Date("2023-01-01T00:02:00.000Z").getTime();
    expect(taskDisplayDurationMs(task, customNow)).toBe(120000);
  });
});

describe("jobCumulativeDurationMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sums durations for array-shaped tasks", () => {
    const job = {
      tasks: [
        {
          state: "completed",
          startedAt: "2023-01-01T00:00:00.000Z",
          executionTime: 30000,
        },
        {
          state: "running",
          startedAt: "2023-01-01T00:01:00.000Z",
        },
        {
          state: "pending",
          startedAt: "2023-01-01T00:02:00.000Z",
        },
      ],
    };
    vi.setSystemTime(new Date("2023-01-01T00:01:30.000Z"));
    expect(jobCumulativeDurationMs(job)).toBe(60000); // 30s + 30s + 0s
  });

  it("sums durations for object-shaped tasks", () => {
    const job = {
      tasks: {
        analysis: {
          state: "completed",
          startedAt: "2023-01-01T00:00:00.000Z",
          executionTime: 45000,
        },
        processing: {
          state: "running",
          startedAt: "2023-01-01T00:01:00.000Z",
        },
      },
    };
    vi.setSystemTime(new Date("2023-01-01T00:01:20.000Z"));
    expect(jobCumulativeDurationMs(job)).toBe(65000); // 45s + 20s
  });

  it("returns 0 for jobs without tasks", () => {
    const job = {};
    expect(jobCumulativeDurationMs(job)).toBe(0);
  });

  it("returns 0 for jobs with null tasks", () => {
    const job = { tasks: null };
    expect(jobCumulativeDurationMs(job)).toBe(0);
  });

  it("handles mixed task states", () => {
    const job = {
      tasks: [
        { state: "rejected", startedAt: "2023-01-01T00:00:00.000Z" },
        { state: "pending", startedAt: "2023-01-01T00:00:30.000Z" },
        { state: "running", startedAt: "2023-01-01T00:01:00.000Z" },
        {
          state: "completed",
          startedAt: "2023-01-01T00:00:00.000Z",
          executionTime: 25000,
        },
      ],
    };
    vi.setSystemTime(new Date("2023-01-01T00:01:30.000Z"));
    expect(jobCumulativeDurationMs(job)).toBe(55000); // 0 + 0 + 30s + 25s
  });

  it("accepts custom now parameter", () => {
    const job = {
      tasks: [
        {
          state: "running",
          startedAt: "2023-01-01T00:00:00.000Z",
        },
      ],
    };
    const customNow = new Date("2023-01-01T00:03:00.000Z").getTime();
    expect(jobCumulativeDurationMs(job, customNow)).toBe(180000);
  });
});

describe("legacy helpers", () => {
  it("fmtDuration formats milliseconds correctly", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(500)).toBe("0s");
    expect(fmtDuration(1000)).toBe("1s");
    expect(fmtDuration(65000)).toBe("1m 5s");
    expect(fmtDuration(3665000)).toBe("1h 1m 5s");
  });

  it("elapsedBetween calculates time difference", () => {
    const start = new Date("2023-01-01T00:00:00.000Z").getTime();
    const end = new Date("2023-01-01T00:01:30.000Z").getTime();
    expect(elapsedBetween(start, end)).toBe(90000);
  });

  it("elapsedBetween uses current time as default end", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-01-01T00:02:00.000Z"));
    const start = new Date("2023-01-01T00:01:00.000Z").getTime();
    expect(elapsedBetween(start)).toBe(60000);
    vi.useRealTimers();
  });
});
