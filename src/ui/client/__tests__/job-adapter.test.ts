import { describe, expect, it } from "vitest";

import {
  adaptJobDetail,
  adaptJobSummary,
  deriveAllowedActions,
  normalizeTasks,
} from "../adapters/job-adapter";

describe("job adapter", () => {
  it("normalizes task objects", () => {
    expect(normalizeTasks({ build: { state: "done" } })).toMatchObject({
      build: {
        name: "build",
        state: "done",
      },
    });
  });

  it("normalizes task arrays with synthetic names", () => {
    expect(normalizeTasks([{ state: "running" }])).toMatchObject({
      "task-0": {
        name: "task-0",
        state: "running",
      },
    });
  });

  it("returns an empty map for null task collections", () => {
    expect(normalizeTasks(null)).toEqual({});
  });

  it("maps numeric restartCount onto the normalized task", () => {
    expect(normalizeTasks({ t1: { state: "done", restartCount: 2 } })["t1"]?.restartCount).toBe(2);
  });

  it("treats null restartCount as undefined", () => {
    expect(normalizeTasks({ t1: { state: "done", restartCount: null } })["t1"]?.restartCount).toBeUndefined();
  });

  it("leaves restartCount undefined when absent", () => {
    expect(normalizeTasks({ t1: { state: "done" } })["t1"]?.restartCount).toBeUndefined();
  });

  it("adapts summary jobs with defaults", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      title: "Build",
      tasks: { build: { state: "done" }, test: { state: "pending" } },
    });

    expect(job).toMatchObject({
      id: "job-1",
      jobId: "job-1",
      name: "Build",
      taskCount: 2,
      doneCount: 1,
      progress: 50,
      displayCategory: "current",
    });
    expect(job.costsSummary).toEqual({
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      totalInputCost: 0,
      totalOutputCost: 0,
    });
  });

  it("reads tasksStatus when tasks is absent", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      tasksStatus: { build: { state: "done" } },
    });

    expect(job.tasks["build"]?.state).toBe("done");
  });

  it("preserves detailed cost breakdowns", () => {
    const detail = adaptJobDetail({
      jobId: "job-1",
      tasks: { build: { state: "done" } },
      costs: {
        build: {
          inputTokens: 1,
          outputTokens: 2,
          inputCost: 3,
          outputCost: 4,
          totalCost: 7,
        },
      },
    });

    expect(detail.costs).toEqual({
      build: {
        inputTokens: 1,
        outputTokens: 2,
        inputCost: 3,
        outputCost: 4,
        totalCost: 7,
      },
    });
  });

  it("derives taskCount from pipelineConfig when available", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      tasks: { build: { state: "done" }, test: { state: "pending" }, _fileTrack: { state: "pending" } },
      pipelineConfig: { tasks: [{ name: "build" }, { name: "test" }] },
    });

    expect(job.taskCount).toBe(2);
    expect(job.doneCount).toBe(1);
  });

  it("computes progress from pipelineConfig taskCount, ignoring api progress", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      progress: 100,
      tasks: {
        build: { state: "done" },
        test: { state: "done" },
        lint: { state: "done" },
      },
      pipelineConfig: {
        tasks: [
          { name: "build" },
          { name: "test" },
          { name: "lint" },
          { name: "deploy" },
          { name: "verify" },
          { name: "publish" },
        ],
      },
    });

    expect(job.taskCount).toBe(6);
    expect(job.doneCount).toBe(3);
    expect(job.progress).toBe(50);
  });

  it("falls back to taskList length when pipelineConfig is absent", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      tasks: { build: { state: "done" }, test: { state: "pending" }, _fileTrack: { state: "pending" } },
    });

    expect(job.taskCount).toBe(3);
  });

  it("adds warnings for unsupported task shapes", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      tasks: "bad-shape",
    });

    expect(job.__warnings).toEqual(["Unsupported task collection shape"]);
  });

  it("disables actions for running jobs", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      status: "running",
      tasks: { build: { state: "running" } },
    });

    expect(deriveAllowedActions(job, ["build"])).toEqual({ start: false, restart: false });
  });

  it("enables restart for non-running jobs with no startable work", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      tasks: { build: { state: "done" } },
    });

    expect(deriveAllowedActions(job, ["build"])).toEqual({ start: false, restart: true });
  });

  it("enables start when a pending task has met dependencies", () => {
    const job = adaptJobSummary({
      jobId: "job-1",
      tasks: {
        build: { state: "done" },
        test: { state: "pending" },
      },
    });

    expect(deriveAllowedActions(job, ["build", "test"])).toEqual({ start: true, restart: true });
  });
});
