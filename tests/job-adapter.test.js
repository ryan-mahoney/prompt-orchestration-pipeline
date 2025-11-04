import { describe, it, expect } from "vitest";
import {
  adaptJobSummary,
  adaptJobDetail,
} from "../src/ui/client/adapters/job-adapter.js";

describe("job-adapter", () => {
  it("adaptJobSummary - happy path canonical API object with tasks", () => {
    const apiJob = {
      jobId: "job1",
      title: "Job 1",
      status: "running",
      progress: 50,
      createdAt: "2025-10-06T00:00:00Z",
      updatedAt: "2025-10-06T01:00:00Z",
      location: "current",
      tasks: {
        t1: {
          name: "t1",
          state: "done",
          startedAt: "2025-10-06T00:00:01Z",
          endedAt: "2025-10-06T00:05:00Z",
        },
        t2: { name: "t2", state: "running", startedAt: "2025-10-06T00:06:00Z" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.id).toBe("job1");
    expect(out.name).toBe("Job 1");
    expect(out.status).toBe("running");
    expect(out.progress).toBe(50);
    expect(out.createdAt).toBe("2025-10-06T00:00:00Z");
    expect(out.updatedAt).toBe("2025-10-06T01:00:00Z");
    expect(out.location).toBe("current");
    expect(out.taskCount).toBe(2);
    expect(out.doneCount).toBe(1);
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks).not.toBeNull();
    expect(out.tasks.t1.state).toBe("done");
    expect(out.tasks.t2.state).toBe("running");
  });

  it("adaptJobSummary - applies sensible defaults when optional fields missing", () => {
    const apiJob = { tasks: {} }; // minimal with demo schema
    const out = adaptJobSummary(apiJob);
    expect(out.id).toBeUndefined();
    expect(out.name).toBe("");
    expect(out.status).toBe("pending");
    expect(out.progress).toBe(0);
    expect(out.taskCount).toBe(0);
    expect(out.doneCount).toBe(0);
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks).toEqual({});
  });

  it("adaptJobSummary - normalizes unknown task state to pending and records warning", () => {
    const apiJob = {
      jobId: "job-unknown-state",
      tasks: {
        compile: { state: "weird" },
        lint: { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.id).toBe("job-unknown-state");
    // tasks normalized from object to object (no longer converted to array)
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks.compile).toBeDefined();
    expect(out.tasks.compile.state).toBe("pending");
    // warnings include => unknown state marker
    expect(
      out.__warnings &&
        out.__warnings.some((w) =>
          String(w).includes("compile:unknown_state:weird")
        )
    ).toBe(true);
    // progress computed: 1 done out of 2 tasks -> 50
    expect(out.progress).toBe(50);
  });

  it("adaptJobSummary - backward compatibility with legacy/demo payloads using tasksStatus", () => {
    const apiJob = {
      jobId: "legacy1",
      title: "Legacy Job",
      tasksStatus: {
        stepA: { state: "done" },
        stepB: { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.id).toBe("legacy1");
    expect(out.name).toBe("Legacy Job");
    // both tasks done -> complete & 100%
    expect(out.status).toBe("complete");
    expect(out.progress).toBe(100);
    expect(out.taskCount).toBe(2);
    expect(out.doneCount).toBe(2);
    // Because adapter reads tasks but payload uses tasksStatus, fallback results in empty tasks and warnings about invalid shape
    expect(out.__warnings).toEqual(
      expect.arrayContaining(["invalid_tasks_shape"])
    );
    expect(out.taskCount).toBe(0);
    expect(out.doneCount).toBe(0);
    expect(out.status).toBe("pending");
    expect(out.progress).toBe(0);
  });

  it("adaptJobDetail - maps detail shape to normalized detail", () => {
    const apiDetail = {
      jobId: "detail1",
      title: "Detail Job",
      tasks: {
        a: { name: "a", state: "running", startedAt: "2025-10-06T00:00:00Z" },
        b: { name: "b", state: "pending" },
      },
      createdAt: "2025-10-06T00:00:00Z",
    };

    const out = adaptJobDetail(apiDetail);
    expect(out.id).toBe("detail1");
    expect(out.name).toBe("Detail Job");
    expect(out.taskCount).toBe(2);
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks.a.name).toBe("a");
    expect(out.tasks.a.state).toBe("running");
    expect(out.createdAt).toBe("2025-10-06T00:00:00Z");
  });

  it("adaptJobSummary - preserves job-level stage metadata", () => {
    const apiJob = {
      jobId: "job1",
      title: "Job 1",
      current: "task-1",
      currentStage: "enrich",
      tasks: {
        "task-1": { state: "running" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.current).toBe("task-1");
    expect(out.currentStage).toBe("enrich");
  });

  it("adaptJobDetail - preserves job-level stage metadata", () => {
    const apiDetail = {
      jobId: "detail1",
      title: "Detail Job",
      current: "task-1",
      currentStage: "enrich",
      tasks: {
        "task-1": { state: "running" },
      },
    };

    const out = adaptJobDetail(apiDetail);
    expect(out.current).toBe("task-1");
    expect(out.currentStage).toBe("enrich");
  });

  it("normalizeTasks - preserves task-level stage metadata for object input", () => {
    const apiJob = {
      jobId: "job1",
      tasks: {
        "task-1": {
          state: "running",
          currentStage: "enrich",
          failedStage: "validate",
        },
        "task-2": {
          state: "done",
          currentStage: "", // Empty string should be ignored
          failedStage: null, // Non-string should be ignored
        },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.tasks["task-1"].currentStage).toBe("enrich");
    expect(out.tasks["task-1"].failedStage).toBe("validate");
    expect(out.tasks["task-2"]).not.toHaveProperty("currentStage");
    expect(out.tasks["task-2"]).not.toHaveProperty("failedStage");
  });

  it("normalizeTasks - preserves task-level stage metadata for array input", () => {
    const apiJob = {
      jobId: "job1",
      tasks: [
        {
          name: "task-1",
          state: "running",
          currentStage: "enrich",
          failedStage: "validate",
        },
        {
          name: "task-2",
          state: "done",
          currentStage: "", // Empty string should be ignored
        },
      ],
    };

    const out = adaptJobSummary(apiJob);
    expect(out.tasks["task-1"].currentStage).toBe("enrich");
    expect(out.tasks["task-1"].failedStage).toBe("validate");
    expect(out.tasks["task-2"]).not.toHaveProperty("currentStage");
  });

  it("adaptJobSummary - includes pipeline metadata when available", () => {
    const apiJob = {
      jobId: "job1",
      title: "Job with Pipeline",
      pipelineSlug: "content-generation",
      pipelineLabel: "Content Generation",
      tasks: {
        "task-1": { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.pipeline).toBe("content-generation");
    expect(out.pipelineLabel).toBe("Content Generation");
  });

  it("adaptJobSummary - derives pipeline label from slug when label not provided", () => {
    const apiJob = {
      jobId: "job1",
      title: "Job with Slug Only",
      pipelineSlug: "market-analysis",
      tasks: {
        "task-1": { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.pipeline).toBe("market-analysis");
    expect(out.pipelineLabel).toBe("Market Analysis");
  });

  it("adaptJobSummary - handles pipeline as object", () => {
    const apiJob = {
      jobId: "job1",
      title: "Job with Pipeline Object",
      pipeline: {
        name: "custom-pipeline",
        version: "1.0",
      },
      tasks: {
        "task-1": { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.pipeline).toEqual({
      name: "custom-pipeline",
      version: "1.0",
    });
    expect(out.pipelineLabel).toBeUndefined();
  });

  it("adaptJobSummary - handles missing pipeline metadata gracefully", () => {
    const apiJob = {
      jobId: "job1",
      title: "Job without Pipeline",
      tasks: {
        "task-1": { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.pipeline).toBeUndefined();
    expect(out.pipelineLabel).toBeUndefined();
  });
});
