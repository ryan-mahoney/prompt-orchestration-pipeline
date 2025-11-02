import { describe, it, expect } from "vitest";
import {
  computeDagItems,
  computeActiveIndex,
  computeTaskStage,
} from "../src/utils/dag.js";

describe("computeDagItems", () => {
  it("maps status values correctly", () => {
    const job = {
      tasks: {
        research: { state: "done" },
        analysis: { state: "running" },
        synthesis: { state: "error" },
        formatting: { state: "pending" },
        queued: { state: "queued" },
        created: { state: "created" },
        skipped: { state: "skipped" },
        canceled: { state: "canceled" },
        unknown: { state: "unknown-state" },
      },
    };

    const pipeline = {
      tasks: [
        "research",
        "analysis",
        "synthesis",
        "formatting",
        "queued",
        "created",
        "skipped",
        "canceled",
        "unknown",
      ],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "succeeded", source: "pipeline" },
      { id: "analysis", status: "active", source: "pipeline" },
      { id: "synthesis", status: "error", source: "pipeline" },
      { id: "formatting", status: "pending", source: "pipeline" },
      { id: "queued", status: "pending", source: "pipeline" },
      { id: "created", status: "pending", source: "pipeline" },
      { id: "skipped", status: "succeeded", source: "pipeline" },
      { id: "canceled", status: "succeeded", source: "pipeline" },
      { id: "unknown", status: "pending", source: "pipeline" },
    ]);
  });

  it("orders items by pipeline tasks first, then appends job-only tasks", () => {
    const job = {
      tasks: {
        research: { state: "done" },
        analysis: { state: "running" },
        extra1: { state: "pending" },
        synthesis: { state: "pending" },
        extra2: { state: "done" },
      },
    };

    const pipeline = {
      tasks: ["synthesis", "research", "analysis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items.map((item) => item.id)).toEqual([
      "synthesis",
      "research",
      "analysis",
      "extra1",
      "extra2",
    ]);

    expect(items.map((item) => item.source)).toEqual([
      "pipeline",
      "pipeline",
      "pipeline",
      "job-extra",
      "job-extra",
    ]);
  });

  it("handles missing job tasks gracefully", () => {
    const job = {
      tasks: {
        research: { state: "done" },
      },
    };

    const pipeline = {
      tasks: ["research", "analysis", "synthesis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "succeeded", source: "pipeline" },
      { id: "analysis", status: "pending", source: "pipeline" },
      { id: "synthesis", status: "pending", source: "pipeline" },
    ]);
  });

  it("handles null/empty job", () => {
    const job = null;
    const pipeline = {
      tasks: ["research", "analysis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "pending", source: "pipeline" },
      { id: "analysis", status: "pending", source: "pipeline" },
    ]);
  });

  it("handles null/empty pipeline", () => {
    const job = {
      tasks: {
        extra1: { state: "done" },
        extra2: { state: "running" },
      },
    };

    const pipeline = null;

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "extra1", status: "succeeded", source: "job-extra" },
      { id: "extra2", status: "active", source: "job-extra" },
    ]);
  });

  it("preserves job order for job-only tasks", () => {
    const job = {
      tasks: {
        zebra: { state: "pending" },
        alpha: { state: "done" },
        beta: { state: "running" },
      },
    };

    const pipeline = {
      tasks: [],
    };

    const items = computeDagItems(job, pipeline);

    // Should preserve the order they appear in the job object
    expect(items.map((item) => item.id)).toEqual(["zebra", "alpha", "beta"]);
  });

  it("handles failed state mapping to error", () => {
    const job = {
      tasks: {
        research: { state: "failed" },
      },
    };

    const pipeline = {
      tasks: ["research"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "error", source: "pipeline" },
    ]);
  });

  it("handles array-based job tasks", () => {
    const job = {
      tasks: [
        { name: "research", state: "done", config: { model: "gpt-4" } },
        { name: "analysis", state: "running", config: { temperature: 0.7 } },
        { name: "synthesis", state: "error" },
      ],
    };

    const pipeline = {
      tasks: ["research", "analysis", "synthesis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "succeeded", source: "pipeline" },
      { id: "analysis", status: "active", source: "pipeline" },
      { id: "synthesis", status: "error", source: "pipeline" },
    ]);
  });

  it("maintains pipeline order with array tasks", () => {
    const job = {
      tasks: [
        { name: "research", state: "done" },
        { name: "synthesis", state: "pending" },
        { name: "analysis", state: "running" },
      ],
    };

    const pipeline = {
      tasks: ["synthesis", "research", "analysis"], // Different order
    };

    const items = computeDagItems(job, pipeline);

    expect(items.map((item) => item.id)).toEqual([
      "synthesis",
      "research",
      "analysis",
    ]);

    expect(items.map((item) => item.status)).toEqual([
      "pending",
      "succeeded",
      "active",
    ]);
  });

  it("handles array tasks with job-only tasks", () => {
    const job = {
      tasks: [
        { name: "research", state: "done" },
        { name: "extra1", state: "pending" },
        { name: "analysis", state: "running" },
        { name: "extra2", state: "done" },
      ],
    };

    const pipeline = {
      tasks: ["research", "analysis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items.map((item) => item.id)).toEqual([
      "research",
      "analysis",
      "extra1",
      "extra2",
    ]);

    expect(items.map((item) => item.source)).toEqual([
      "pipeline",
      "pipeline",
      "job-extra",
      "job-extra",
    ]);
  });

  it("handles array tasks missing name field", () => {
    const job = {
      tasks: [
        { id: "research", state: "done" }, // Use id as fallback
        { state: "running" }, // No identifier, should be skipped
        { name: "analysis", state: "pending" },
      ],
    };

    const pipeline = {
      tasks: ["research", "analysis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "succeeded", source: "pipeline" },
      { id: "analysis", status: "pending", source: "pipeline" },
    ]);
  });

  it("handles empty array tasks", () => {
    const job = {
      tasks: [],
    };

    const pipeline = {
      tasks: ["research", "analysis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "pending", source: "pipeline" },
      { id: "analysis", status: "pending", source: "pipeline" },
    ]);
  });

  it("handles null job with array pipeline tasks", () => {
    const job = null;

    const pipeline = {
      tasks: ["research", "analysis"],
    };

    const items = computeDagItems(job, pipeline);

    expect(items).toEqual([
      { id: "research", status: "pending", source: "pipeline" },
      { id: "analysis", status: "pending", source: "pipeline" },
    ]);
  });
});

describe("computeActiveIndex", () => {
  it("selects first active task", () => {
    const items = [
      { id: "research", status: "succeeded" },
      { id: "analysis", status: "active" },
      { id: "synthesis", status: "pending" },
      { id: "formatting", status: "active" },
    ];

    expect(computeActiveIndex(items)).toBe(1);
  });

  it("selects first error when no active tasks", () => {
    const items = [
      { id: "research", status: "succeeded" },
      { id: "analysis", status: "error" },
      { id: "synthesis", status: "error" },
      { id: "formatting", status: "succeeded" },
    ];

    expect(computeActiveIndex(items)).toBe(1);
  });

  it("selects last succeeded when no active or error tasks", () => {
    const items = [
      { id: "research", status: "succeeded" },
      { id: "analysis", status: "succeeded" },
      { id: "synthesis", status: "pending" },
      { id: "formatting", status: "pending" },
    ];

    expect(computeActiveIndex(items)).toBe(1);
  });

  it("selects index 0 when no active, error, or succeeded tasks", () => {
    const items = [
      { id: "research", status: "pending" },
      { id: "analysis", status: "pending" },
      { id: "synthesis", status: "pending" },
    ];

    expect(computeActiveIndex(items)).toBe(0);
  });

  it("handles empty array", () => {
    const items = [];

    expect(computeActiveIndex(items)).toBe(0);
  });

  it("handles complex mixed scenario", () => {
    const items = [
      { id: "research", status: "succeeded" },
      { id: "analysis", status: "error" },
      { id: "synthesis", status: "succeeded" },
      { id: "formatting", status: "pending" },
    ];

    // Should select first error (index 1) even though there are succeeded tasks after
    expect(computeActiveIndex(items)).toBe(1);
  });

  it("handles multiple active tasks", () => {
    const items = [
      { id: "research", status: "active" },
      { id: "analysis", status: "active" },
      { id: "synthesis", status: "active" },
    ];

    // Should select first active
    expect(computeActiveIndex(items)).toBe(0);
  });
});

describe("computeTaskStage", () => {
  it("derives stage from job.currentStage when current matches task", () => {
    const job = {
      current: "analysis",
      currentStage: "inference",
      tasks: {
        analysis: { state: "running" },
      },
    };

    const stage = computeTaskStage(job, "analysis");
    expect(stage).toBe("inference");
  });

  it("derives stage from task.failedStage", () => {
    const job = {
      tasks: {
        analysis: { state: "error", failedStage: "promptTemplating" },
      },
    };

    const stage = computeTaskStage(job, "analysis");
    expect(stage).toBe("promptTemplating");
  });

  it("derives stage from error.debug.stage as fallback", () => {
    const job = {
      tasks: {
        analysis: {
          state: "error",
          error: {
            debug: {
              stage: "validate_structure",
            },
          },
        },
      },
    };

    const stage = computeTaskStage(job, "analysis");
    expect(stage).toBe("validate_structure");
  });

  it("returns undefined when no stage information is available", () => {
    const job = {
      tasks: {
        analysis: { state: "pending" },
      },
    };

    const stage = computeTaskStage(job, "analysis");
    expect(stage).toBeUndefined();
  });

  it("prioritizes currentStage over failedStage for active task", () => {
    const job = {
      current: "analysis",
      currentStage: "inference",
      tasks: {
        analysis: { state: "running", failedStage: "promptTemplating" },
      },
    };

    const stage = computeTaskStage(job, "analysis");
    expect(stage).toBe("inference");
  });

  it("prioritizes failedStage over error.debug.stage", () => {
    const job = {
      tasks: {
        analysis: {
          state: "error",
          failedStage: "promptTemplating",
          error: {
            debug: {
              stage: "validate_structure",
            },
          },
        },
      },
    };

    const stage = computeTaskStage(job, "analysis");
    expect(stage).toBe("promptTemplating");
  });
});

describe("computeDagItems stage integration", () => {
  it("includes stage for active mapping", () => {
    const job = {
      current: "analysis",
      currentStage: "inference",
      tasks: {
        analysis: { state: "running" },
      },
    };

    const pipeline = {
      tasks: ["analysis", "synthesis"],
    };

    const items = computeDagItems(job, pipeline);
    const analysisItem = items.find((item) => item.id === "analysis");
    expect(analysisItem.stage).toBe("inference");
  });

  it("includes stage for failed mapping", () => {
    const job = {
      tasks: {
        analysis: { state: "error", failedStage: "inference" },
      },
    };

    const pipeline = {
      tasks: ["analysis", "synthesis"],
    };

    const items = computeDagItems(job, pipeline);
    const analysisItem = items.find((item) => item.id === "analysis");
    expect(analysisItem.stage).toBe("inference");
  });

  it("includes undefined stage when no stage information available", () => {
    const job = {
      tasks: {
        analysis: { state: "pending" },
      },
    };

    const pipeline = {
      tasks: ["analysis", "synthesis"],
    };

    const items = computeDagItems(job, pipeline);
    const analysisItem = items.find((item) => item.id === "analysis");
    expect(analysisItem.stage).toBeUndefined();
  });
});
