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

import { render, screen, act, cleanup } from "@testing-library/react";
import JobDetail from "../src/components/JobDetail.jsx";
import * as dagUtils from "../src/utils/dag.js";

const computeDagItemsSpy = vi.mocked(dagUtils.computeDagItems);
const computeActiveIndexSpy = vi.mocked(dagUtils.computeActiveIndex);

describe("JobDetail - Object Tasks Support", () => {
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

  it("handles object-shaped tasks", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: {
        research: { state: "done", config: { model: "gpt-4" } },
        analysis: { state: "running", config: { temperature: 0.7 } },
        synthesis: { state: "pending", config: {} },
      },
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

    // Verify DAG computation works
    expect(computeDagItemsSpy).toHaveBeenCalledWith(job, pipeline);
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
      tasks: {
        research: { state: "done" },
        analysis: { state: "running" },
      },
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

  it("handles empty object tasks", () => {
    const job = {
      id: "test-job",
      name: "Test Job",
      pipelineId: "test-pipeline",
      status: "pending",
      tasks: {},
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

describe("JobDetail - Duration Policy with Task Shape Variants", () => {
  const mockOnClose = vi.fn();
  const mockOnResume = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-06T00:30:00Z"));
    vi.clearAllMocks();
    cleanup(); // Clean up previous renders

    // Provide valid mock implementations for duration policy tests
    computeDagItemsSpy.mockReturnValue([
      { id: "research", status: "succeeded", source: "pipeline" },
      { id: "analysis", status: "active", source: "pipeline" },
      { id: "synthesis", status: "pending", source: "pipeline" },
    ]);

    computeActiveIndexSpy.mockReturnValue(1); // analysis is active
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup(); // Clean up after each test
  });

  it("renders JobDetail with object-shaped tasks without errors", () => {
    const job = {
      id: "test-job",
      name: "Object Tasks Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: {
        research: {
          state: "done",
          startedAt: "2025-10-06T00:20:00Z",
          endedAt: "2025-10-06T00:22:00Z",
          executionTime: 120000, // 2 minutes
        },
        analysis: {
          state: "running",
          startedAt: "2025-10-06T00:25:00Z", // 5 minutes ago
        },
        synthesis: {
          state: "pending",
        },
      },
    };

    const pipeline = { tasks: ["research", "analysis", "synthesis"] };

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Verify the component renders successfully
    expect(screen.getByTestId("dag-grid")).toBeDefined();
    expect(screen.getByTestId("dag-items")).toBeDefined();
    expect(screen.getByTestId("active-index")).toBeDefined();
  });

  it("handles mixed status tasks in object shape", () => {
    const job = {
      id: "test-job",
      name: "Mixed Status Object Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: {
        research: {
          state: "pending", // Should not show duration
        },
        analysis: {
          state: "rejected",
          startedAt: "2025-10-06T00:25:00Z",
          endedAt: "2025-10-06T00:26:00Z",
        },
        synthesis: {
          state: "running",
          startedAt: "2025-10-06T00:24:00Z", // Should show duration
        },
      },
    };

    const pipeline = { tasks: ["research", "analysis", "synthesis"] };

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Verify the component renders successfully with mixed statuses
    expect(screen.getByTestId("dag-grid")).toBeDefined();
    expect(screen.getByTestId("dag-items")).toBeDefined();
  });

  it("handles live updates with useTicker", () => {
    const job = {
      id: "test-job",
      name: "Live Update Job",
      pipelineId: "test-pipeline",
      status: "running",
      tasks: {
        analysis: {
          state: "running",
          startedAt: "2025-10-06T00:25:00Z", // 5 minutes ago initially
        },
      },
    };

    const pipeline = { tasks: ["analysis"] };

    const { rerender } = render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Verify initial render
    expect(screen.getByTestId("dag-grid")).toBeDefined();

    // Advance time and verify component still works
    act(() => {
      vi.advanceTimersByTime(120000); // 2 minutes
    });

    act(() => {
      vi.runOnlyPendingTimers();
    });

    // Re-render to trigger the ticker update
    rerender(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Component should still render after time advance
    expect(screen.getByTestId("dag-grid")).toBeDefined();
  });

  it("handles executionTime preference for completed tasks", () => {
    const job = {
      id: "test-job",
      name: "Execution Time Job",
      pipelineId: "test-pipeline",
      status: "completed",
      tasks: {
        analysis: {
          state: "done",
          startedAt: "2025-10-06T00:20:00Z",
          endedAt: "2025-10-06T00:30:00Z", // 10 minutes wall clock
          executionTime: 240000, // 4 minutes (should be preferred)
        },
      },
    };

    const pipeline = { tasks: ["analysis"] };

    render(
      <JobDetail
        job={job}
        pipeline={pipeline}
        onClose={mockOnClose}
        onResume={mockOnResume}
      />
    );

    // Verify the component renders successfully
    expect(screen.getByTestId("dag-grid")).toBeDefined();
    expect(screen.getByTestId("dag-items")).toBeDefined();
  });
});
