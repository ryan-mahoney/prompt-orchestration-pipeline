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

describe("JobDetail - Detail-Shaped Job with Pipeline from API", () => {
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

  it("receives detail-shaped job with array tasks and pipeline from API", () => {
    const detailShapedJob = {
      id: "test-job-123",
      pipelineId: "test-job-123",
      name: "Test Pipeline Job",
      status: "running",
      progress: 60,
      createdAt: "2025-10-06T00:00:00Z",
      updatedAt: "2025-10-06T01:00:00Z",
      location: "current",
      taskCount: 3,
      doneCount: 2,
      tasks: [
        {
          name: "research",
          state: "done",
          startedAt: "2025-10-06T00:05:00Z",
          endedAt: "2025-10-06T00:15:00Z",
          attempts: 1,
          executionTimeMs: 600000,
          config: { model: "gpt-4", temperature: 0.7 },
        },
        {
          name: "analysis",
          state: "done",
          startedAt: "2025-10-06T00:15:00Z",
          endedAt: "2025-10-06T00:25:00Z",
          attempts: 1,
          executionTimeMs: 600000,
          config: { model: "gpt-4", temperature: 0.5 },
        },
        {
          name: "synthesis",
          state: "running",
          startedAt: "2025-10-06T00:25:00Z",
          attempts: 1,
          config: { model: "gpt-4", temperature: 0.3 },
        },
      ],
      pipeline: {
        tasks: ["research", "analysis", "synthesis"],
      },
    };

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Check that the component rendered with correct job info
    expect(screen.getByText("Test Pipeline Job")).toBeDefined();
    expect(screen.getByText("ID: test-job-123")).toBeDefined();

    // Verify computeDagItems was called with the detail-shaped job and pipeline
    expect(computeDagItemsSpy).toHaveBeenCalledWith(
      detailShapedJob,
      detailShapedJob.pipeline
    );
  });

  it("uses pipeline from API when provided, even if job has different task order", () => {
    const detailShapedJob = {
      id: "test-job-456",
      pipelineId: "test-job-456",
      name: "Job with Different Order",
      status: "running",
      tasks: [
        { name: "synthesis", state: "running" },
        { name: "research", state: "done" },
        { name: "analysis", state: "done" },
      ],
      pipeline: {
        tasks: ["research", "analysis", "synthesis"], // Canonical order
      },
    };

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should use pipeline order from API, not job task order
    expect(computeDagItemsSpy).toHaveBeenCalledWith(
      detailShapedJob,
      detailShapedJob.pipeline
    );

    // Verify pipeline tasks are in canonical order
    const callArgs = computeDagItemsSpy.mock.calls[0];
    const pipelineUsed = callArgs[1];
    expect(pipelineUsed.tasks).toEqual(["research", "analysis", "synthesis"]);
  });

  it("defensively normalizes array tasks to lookup format internally", () => {
    const detailShapedJob = {
      id: "test-job-789",
      pipelineId: "test-job-789",
      name: "Defensive Normalization Test",
      status: "running",
      tasks: [
        { name: "task1", state: "done", config: { model: "gpt-4" } },
        { name: "task2", state: "running", config: { temperature: 0.7 } },
        { name: "task3", state: "pending" },
      ],
      pipeline: {
        tasks: ["task1", "task2", "task3"],
      },
    };

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // The component should render successfully without errors
    expect(screen.getByText("Defensive Normalization Test")).toBeDefined();

    // DAG computation should work with the normalized data
    expect(computeDagItemsSpy).toHaveBeenCalled();
    expect(computeActiveIndexSpy).toHaveBeenCalled();
  });

  it("handles detail-shaped job with missing pipeline gracefully", () => {
    const detailShapedJob = {
      id: "test-job-no-pipeline",
      pipelineId: "test-job-no-pipeline",
      name: "Job Without Pipeline",
      status: "pending",
      tasks: [
        { name: "step1", state: "pending" },
        { name: "step2", state: "pending" },
      ],
      // No pipeline property
    };

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={null}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should still render successfully
    expect(screen.getByText("Job Without Pipeline")).toBeDefined();

    // Should derive pipeline from job tasks
    expect(computeDagItemsSpy).toHaveBeenCalledWith(
      detailShapedJob,
      expect.objectContaining({
        tasks: ["step1", "step2"],
      })
    );
  });

  it("preserves task metadata from detail-shaped job", () => {
    const detailShapedJob = {
      id: "test-job-metadata",
      pipelineId: "test-job-metadata",
      name: "Metadata Test Job",
      status: "done",
      tasks: [
        {
          name: "complex-task",
          state: "done",
          startedAt: "2025-10-06T00:00:00Z",
          endedAt: "2025-10-06T00:10:00Z",
          attempts: 3,
          executionTimeMs: 600000,
          artifacts: ["output.json", "logs.txt", "report.pdf"],
          config: { model: "gpt-4", temperature: 0.7, max_tokens: 2000 },
        },
      ],
      pipeline: {
        tasks: ["complex-task"],
      },
    };

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should render successfully with all metadata preserved
    expect(screen.getByText("Metadata Test Job")).toBeDefined();

    // DAG computation should have access to all task metadata
    expect(computeDagItemsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: expect.arrayContaining([
          expect.objectContaining({
            name: "complex-task",
            state: "done",
            attempts: 3,
            executionTimeMs: 600000,
            artifacts: ["output.json", "logs.txt", "report.pdf"],
          }),
        ]),
      }),
      detailShapedJob.pipeline
    );
  });

  it("handles edge case tasks with missing names or invalid states", () => {
    const detailShapedJob = {
      id: "test-job-edge-cases",
      pipelineId: "test-job-edge-cases",
      name: "Edge Cases Test Job",
      status: "running",
      tasks: [
        { state: "done" }, // Missing name
        { name: "", state: "running" }, // Empty name
        { name: "valid-task", state: "invalid_state" }, // Invalid state
        { name: null, state: "pending" }, // Null name
      ],
      pipeline: {
        tasks: ["task-0", "task-2", "task-3"], // Expected fallback names
      },
    };

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Should handle edge cases gracefully without crashing
    expect(screen.getByText("Edge Cases Test Job")).toBeDefined();
    expect(computeDagItemsSpy).toHaveBeenCalled();
  });
});
