import { describe, it, expect } from "vitest";
import { computeDagItems, computeActiveIndex } from "../src/utils/dag.js";

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
