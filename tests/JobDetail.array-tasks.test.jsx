import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

// Mock the DAGGrid component to focus on JobDetail logic
vi.mock("../src/components/DAGGrid.jsx", () => ({
  default: ({ items, activeIndex }) => (
    <div data-testid="dag-grid">
      <div data-testid="dag-items">{JSON.stringify(items)}</div>
      <div data-testid="active-index">{activeIndex}</div>
    </div>
  ),
}));

// Mock the computeDagItems and computeActiveIndex to spy on them
vi.mock("../src/utils/dag.js", () => ({
  computeDagItems: vi.fn(),
  computeActiveIndex: vi.fn(),
}));

import { render, screen } from "@testing-library/react";
import JobDetail from "../src/components/JobDetail.jsx";
import * as dagUtils from "../src/utils/dag.js";

const computeDagItemsSpy = vi.mocked(dagUtils.computeDagItems);
const computeActiveIndexSpy = vi.mocked(dagUtils.computeActiveIndex);

describe("JobDetail - Array Tasks Support", () => {
  const mockOnClose = vi.fn();
  const mockOnResume = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Provide default mock implementations
    computeDagItemsSpy.mockReturnValue([
      { id: "research", status: "succeeded", source: "pipeline" },
      { id: "analysis", status: "succeeded", source: "pipeline" },
      { id: "synthesis", status: "active", source: "pipeline" },
    ]);

    computeActiveIndexSpy.mockReturnValue(2); // synthesis is active
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes array tasks to lookup format", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: [
        { name: "research", state: "done", config: { model: "gpt-4" } },
        { name: "analysis", state: "running", config: { temperature: 0.7 } },
        { name: "synthesis", state: "pending", config: {} },
      ],
    };

    const pipeline = {
      tasks: ["research", "analysis", "synthesis"],
    };

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Check that the component rendered (job name is now in Layout header, not JobDetail)
    // Verify DAG computation works
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, pipeline);

    // Verify computeDagItems was called with the job
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, pipeline);
  });

  it("computes pipelineTasks from array tasks when no pipeline provided", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: [
        { name: "research", state: "done" },
        { name: "analysis", state: "running" },
        { name: "synthesis", state: "pending" },
      ],
    };

    const pipeline = null;

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should derive pipeline tasks from array task names
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, expect.any(Object));

    const callArgs = computeDagItemsSpy.mock.calls[0];
    const derivedPipeline = callArgs[1];
    expect(derivedPipeline.tasks).toEqual([
      "research",
      "analysis",
      "synthesis",
    ]);
  });

  it("computes pipelineTasks from object tasks when no pipeline provided", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: {
        research: { state: "done" },
        analysis: { state: "running" },
        synthesis: { state: "pending" },
      },
    };

    const pipeline = null;

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should derive pipeline tasks from object keys
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, expect.any(Object));

    const callArgs = computeDagItemsSpy.mock.calls[0];
    const derivedPipeline = callArgs[1];
    expect(derivedPipeline.tasks).toEqual([
      "research",
      "analysis",
      "synthesis",
    ]);
  });

  it("uses provided pipeline tasks over derived tasks", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: [
        { name: "research", state: "done" },
        { name: "analysis", state: "running" },
      ],
    };

    const pipeline = {
      tasks: ["analysis", "research"], // Different order
    };

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should use provided pipeline tasks, not derived from job
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, pipeline);
  });

  it("handles empty array tasks", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "pending",
      tasks: [],
    };

    const pipeline = null;

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should handle empty tasks gracefully
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, expect.any(Object));

    const callArgs = computeDagItemsSpy.mock.calls[0];
    const derivedPipeline = callArgs[1];
    expect(derivedPipeline.tasks).toEqual([]);
  });

  it("handles missing tasks in job", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "pending",
      // No tasks property
    };

    const pipeline = null;

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should handle missing tasks gracefully
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, expect.any(Object));

    const callArgs = computeDagItemsSpy.mock.calls[0];
    const derivedPipeline = callArgs[1];
    expect(derivedPipeline.tasks).toEqual([]);
  });
});
