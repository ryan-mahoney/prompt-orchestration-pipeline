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

import { render, screen, act } from "@testing-library/react";
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

    // Check that the component rendered (job name and ID are now in Layout header, not JobDetail)
    // Verify DAG computation still works
    expect(computeDagItemsSpy).toHaveBeenCalledWith(
      detailShapedJob,
      detailShapedJob.pipeline
    );

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

    // The component should render successfully without errors (job name is now in Layout header)
    // Verify DAG computation works with the normalized data

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

    // Should still render successfully (job name is now in Layout header, not JobDetail)
    // Verify DAG computation works
    expect(computeDagItemsSpy).toHaveBeenCalled();

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

    // Should render successfully with all metadata preserved (job name is now in Layout header)
    // Verify DAG computation works
    expect(computeDagItemsSpy).toHaveBeenCalled();

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
    // Job name is now in Layout header, not JobDetail component
    expect(computeDagItemsSpy).toHaveBeenCalled();
  });

  it("passes error message as item.body for failed task", () => {
    const errorMessage =
      "analysis failed after 2 attempts: Validation failed after all refinement attempts";

    // Mock computeDagItems to return items with error status and body
    computeDagItemsSpy.mockReturnValue([
      { id: "research", status: "succeeded", source: "pipeline" },
      {
        id: "analysis",
        status: "error",
        source: "pipeline",
        body: errorMessage,
      },
      { id: "synthesis", status: "pending", source: "pipeline" },
    ]);

    computeActiveIndexSpy.mockReturnValue(1); // analysis is active (first error)

    const detailShapedJob = {
      id: "test-job-with-error",
      pipelineId: "test-job-with-error",
      name: "Test Job with Error",
      status: "failed",
      tasks: [
        {
          name: "research",
          state: "done",
          startedAt: "2025-10-13T22:10:09.101Z",
          endedAt: "2025-10-13T22:10:09.107Z",
          attempts: 1,
        },
        {
          name: "analysis",
          state: "failed",
          startedAt: "2025-10-13T22:10:09.107Z",
          endedAt: "2025-10-13T22:10:09.109Z",
          attempts: 1,
          error: {
            message: errorMessage,
          },
        },
        {
          name: "synthesis",
          state: "pending",
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

    // Verify the component rendered (job name is now in Layout header, not JobDetail)
    // DAG computation should work with error data

    // Get the DAG items from the mocked DAGGrid component (use the last one since multiple tests may have rendered)
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[dagItemsElements.length - 1];
    const dagItems = JSON.parse(dagItemsElement.textContent);

    // Find the analysis item and verify it has the error message as body
    const analysisItem = dagItems.find((item) => item.id === "analysis");
    expect(analysisItem).toBeDefined();
    expect(analysisItem.status).toBe("error");
    expect(analysisItem.body).toBe(errorMessage);

    // Verify computeDagItems was called with the job containing the error
    expect(computeDagItemsSpy).toHaveBeenCalledWith(
      detailShapedJob,
      detailShapedJob.pipeline
    );
  });

  it("applies duration policy to task subtitles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-06T00:30:00Z"));

    const detailShapedJob = {
      id: "test-job-durations",
      pipelineId: "test-job-durations",
      name: "Duration Policy Test Job",
      status: "running",
      tasks: [
        {
          name: "completed-task",
          state: "done",
          startedAt: "2025-10-06T00:05:00Z",
          endedAt: "2025-10-06T00:10:00Z",
          executionTime: 250000, // 4m 10s - should be preferred
          config: { model: "gpt-4" },
        },
        {
          name: "running-task",
          state: "running",
          startedAt: "2025-10-06T00:25:00Z",
          config: { temperature: 0.7 },
        },
        {
          name: "pending-task",
          state: "pending",
          startedAt: "2025-10-06T00:20:00Z",
          config: { model: "gpt-3.5" },
        },
        {
          name: "rejected-task",
          state: "rejected",
          startedAt: "2025-10-06T00:15:00Z",
          endedAt: "2025-10-06T00:16:00Z",
          config: { temperature: 0.5 },
        },
      ],
      pipeline: {
        tasks: [
          "completed-task",
          "running-task",
          "pending-task",
          "rejected-task",
        ],
      },
    };

    // Mock computeDagItems to return basic items
    computeDagItemsSpy.mockReturnValue([
      { id: "completed-task", status: "succeeded", source: "pipeline" },
      { id: "running-task", status: "active", source: "pipeline" },
      { id: "pending-task", status: "pending", source: "pipeline" },
      { id: "rejected-task", status: "failed", source: "pipeline" },
    ]);

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Get the DAG items from the mocked DAGGrid component
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[dagItemsElements.length - 1];
    const dagItems = JSON.parse(dagItemsElement.textContent);

    // Find each task and verify duration policy application
    const completedTask = dagItems.find((item) => item.id === "completed-task");
    expect(completedTask.subtitle).toContain("model: gpt-4");
    expect(completedTask.subtitle).toContain("4m 10s"); // executionTime preferred

    const runningTask = dagItems.find((item) => item.id === "running-task");
    expect(runningTask.subtitle).toContain("temp: 0.7");
    expect(runningTask.subtitle).toContain("5m 0s"); // running for 5 minutes

    const pendingTask = dagItems.find((item) => item.id === "pending-task");
    expect(pendingTask.subtitle).toContain("model: gpt-3.5");
    expect(pendingTask.subtitle).not.toContain("0s"); // pending tasks should not show duration

    const rejectedTask = dagItems.find((item) => item.id === "rejected-task");
    expect(rejectedTask.subtitle).toContain("temp: 0.5");
    expect(rejectedTask.subtitle).not.toContain("0s"); // rejected tasks should not show duration

    vi.useRealTimers();
  });

  it("handles tasks without startedAt gracefully", () => {
    const detailShapedJob = {
      id: "test-job-no-start-time",
      pipelineId: "test-job-no-start-time",
      name: "No Start Time Test Job",
      status: "running",
      tasks: [
        {
          name: "no-start-task",
          state: "running",
          // Missing startedAt
          config: { model: "gpt-4" },
        },
      ],
      pipeline: {
        tasks: ["no-start-task"],
      },
    };

    computeDagItemsSpy.mockReturnValue([
      { id: "no-start-task", status: "active", source: "pipeline" },
    ]);

    render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Get the DAG items from the mocked DAGGrid component
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[dagItemsElements.length - 1];
    const dagItems = JSON.parse(dagItemsElement.textContent);

    const noStartTask = dagItems.find((item) => item.id === "no-start-task");
    expect(noStartTask.subtitle).toContain("model: gpt-4");
    expect(noStartTask.subtitle).not.toContain("0s"); // Should not show duration without startedAt
  });

  it("updates running task duration when time advances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-06T00:30:00Z"));

    const detailShapedJob = {
      id: "test-job-live-update",
      pipelineId: "test-job-live-update",
      name: "Live Update Test Job",
      status: "running",
      tasks: [
        {
          name: "running-task",
          state: "running",
          startedAt: "2025-10-06T00:25:00Z", // Started 5 minutes ago
          config: { model: "gpt-4" },
        },
      ],
      pipeline: {
        tasks: ["running-task"],
      },
    };

    computeDagItemsSpy.mockReturnValue([
      { id: "running-task", status: "active", source: "pipeline" },
    ]);

    const { rerender } = render(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Get initial DAG items
    const dagItemsElements = screen.getAllByTestId("dag-items");
    const dagItemsElement = dagItemsElements[dagItemsElements.length - 1];
    let dagItems = JSON.parse(dagItemsElement.textContent);

    const runningTask = dagItems.find((item) => item.id === "running-task");
    expect(runningTask.subtitle).toContain("model: gpt-4");
    expect(runningTask.subtitle).toContain("5m 0s"); // Initial duration

    // Advance time by 2 minutes
    act(() => {
      vi.advanceTimersByTime(120000); // 2 minutes
    });

    // Re-render to trigger the ticker update
    rerender(
      <JobDetail
        job={detailShapedJob}
        pipeline={detailShapedJob.pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Get updated DAG items
    const updatedDagItemsElements = screen.getAllByTestId("dag-items");
    const updatedDagItemsElement =
      updatedDagItemsElements[updatedDagItemsElements.length - 1];
    dagItems = JSON.parse(updatedDagItemsElement.textContent);

    const updatedRunningTask = dagItems.find(
      (item) => item.id === "running-task"
    );
    expect(updatedRunningTask.subtitle).toContain("model: gpt-4");
    expect(updatedRunningTask.subtitle).toContain("7m 0s"); // Updated duration

    vi.useRealTimers();
  });
});
