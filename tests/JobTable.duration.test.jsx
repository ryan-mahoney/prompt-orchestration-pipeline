import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import JobTable from "../src/components/JobTable.jsx";

// Mock the utilities to focus on duration logic
vi.mock("../src/utils/jobs.js", () => ({
  countCompleted: vi.fn((job) => {
    const tasks = Array.isArray(job.tasks)
      ? job.tasks
      : Object.values(job.tasks || {});
    return tasks.filter(
      (task) => task.state === "done" || task.state === "completed"
    ).length;
  }),
}));

vi.mock("../src/utils/ui.js", () => ({
  statusBadge: vi.fn((status) => (
    <span data-testid={`status-${status}`}>{status}</span>
  )),
  progressClasses: vi.fn(() => "bg-blue-500"),
}));

describe("JobTable - Duration Display", () => {
  const mockOnOpenJob = vi.fn();
  const mockTotalProgressPct = vi.fn(() => 50);
  const mockOverallElapsed = vi.fn(() => 300000); // 5 minutes

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-10-06T00:30:00Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("displays duration for running tasks", () => {
    const jobs = [
      {
        id: "test-job-1",
        pipelineId: "test-job-1",
        name: "Running Job",
        status: "running",
        current: "task-1",
        tasks: [
          {
            name: "task-1",
            state: "running",
            startedAt: "2025-10-06T00:25:00Z", // 5 minutes ago
          },
        ],
      },
    ];

    render(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Should show duration for running task (now inline with task details)
    // Use getAllByText since there are multiple "5m 0s" elements
    const initialDurationElements = screen.getAllByText("5m 0s");
    expect(initialDurationElements.length).toBeGreaterThan(0);
  });

  it("hides duration for pending tasks", () => {
    const jobs = [
      {
        id: "test-job-2",
        pipelineId: "test-job-2",
        name: "Pending Job",
        status: "pending",
        current: "task-1",
        tasks: [
          {
            name: "task-1",
            state: "pending",
            startedAt: "2025-10-06T00:25:00Z",
          },
        ],
      },
    ];

    render(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Should not show clock icon for pending task
    expect(screen.queryByTestId("clock-icon")).toBeNull();

    // Overall duration column should still show (from mock)
    expect(screen.getByText("5m 0s")).toBeDefined();
  });

  it("displays duration for completed tasks using executionTime when available", () => {
    const jobs = [
      {
        id: "test-job-3",
        pipelineId: "test-job-3",
        name: "Completed Job",
        status: "completed",
        current: "task-1",
        tasks: [
          {
            name: "task-1",
            state: "done",
            startedAt: "2025-10-06T00:20:00Z",
            endedAt: "2025-10-06T00:25:00Z",
            executionTime: 240000, // 4 minutes (should be preferred)
          },
        ],
      },
    ];

    render(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Should show executionTime (4 minutes) inline with task details
    expect(screen.getByText("4m 0s")).toBeDefined();

    // Overall duration column should still show (from mock)
    expect(screen.getByText("5m 0s")).toBeDefined();
  });

  it("updates running task duration when time advances", () => {
    const jobs = [
      {
        id: "test-job-4",
        pipelineId: "test-job-4",
        name: "Live Update Job",
        status: "running",
        current: "task-1",
        tasks: [
          {
            name: "task-1",
            state: "running",
            startedAt: "2025-10-06T00:25:00Z", // 5 minutes ago initially
          },
        ],
      },
    ];

    const { rerender } = render(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Initial duration should be 5 minutes in task section
    // Use getAllByText since there are multiple "5m 0s" elements
    const allDurationElements = screen.getAllByText("5m 0s");
    expect(allDurationElements.length).toBeGreaterThan(0);

    // Advance time by 2 minutes and trigger the interval
    act(() => {
      vi.advanceTimersByTime(120000); // 2 minutes
    });

    // Wait for the next interval tick
    act(() => {
      vi.runOnlyPendingTimers();
    });

    // Re-render to trigger the ticker update
    rerender(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Duration should now be 7 minutes (plus 1 second due to timing)
    // Use getAllByText since there are multiple elements
    const updatedDurationElements = screen.getAllByText("7m 1s");
    expect(updatedDurationElements.length).toBeGreaterThan(0);
  });

  it("handles tasks without startedAt gracefully", () => {
    const jobs = [
      {
        id: "test-job-5",
        pipelineId: "test-job-5",
        name: "No Start Time Job",
        status: "running",
        current: "task-1",
        tasks: [
          {
            name: "task-1",
            state: "running",
            // Missing startedAt
          },
        ],
      },
    ];

    render(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Should not show clock icon without startedAt
    expect(screen.queryByTestId("clock-icon")).toBeNull();

    // Overall duration column should still show (from mock)
    expect(screen.getByText("5m 0s")).toBeDefined();
  });

  it("handles rejected tasks correctly", () => {
    const jobs = [
      {
        id: "test-job-6",
        pipelineId: "test-job-6",
        name: "Rejected Job",
        status: "failed",
        current: "task-1",
        tasks: [
          {
            name: "task-1",
            state: "rejected",
            startedAt: "2025-10-06T00:25:00Z",
            endedAt: "2025-10-06T00:26:00Z",
          },
        ],
      },
    ];

    render(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Should not show clock icon for rejected tasks
    expect(screen.queryByTestId("clock-icon")).toBeNull();

    // Overall duration column should still show (from mock)
    expect(screen.getByText("5m 0s")).toBeDefined();
  });

  it("handles object-shaped tasks correctly", () => {
    const jobs = [
      {
        id: "test-job-7",
        pipelineId: "test-job-7",
        name: "Object Tasks Job",
        status: "running",
        current: "task-1",
        tasks: {
          "task-1": {
            state: "running",
            startedAt: "2025-10-06T00:25:00Z",
          },
        },
      },
    ];

    render(
      <JobTable
        jobs={jobs}
        pipeline={{ tasks: ["task-1"] }}
        onOpenJob={mockOnOpenJob}
        totalProgressPct={mockTotalProgressPct}
        overallElapsed={mockOverallElapsed}
      />
    );

    // Should show duration for object-shaped task (now inline in task details)
    // Look for the task details section specifically
    const taskDetails = screen.getByText("task-1").closest("div");
    expect(taskDetails.textContent).toContain("5m 0s");
  });
});
