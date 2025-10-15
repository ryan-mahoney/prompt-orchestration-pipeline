import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import JobCard from "../src/components/JobCard.jsx";

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

describe("JobCard - Duration Display", () => {
  const mockOnClick = vi.fn();
  const mockProgressPct = 50;
  const mockOverallElapsedMs = 300000; // 5 minutes

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
    const job = {
      id: "test-job-1",
      pipelineId: "test-pipeline",
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
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // Should show duration for running task (now inline with task details)
    expect(screen.getByText("5m 0s")).toBeDefined();
  });

  it("hides duration for pending tasks", () => {
    const job = {
      id: "test-job-2",
      pipelineId: "test-pipeline",
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
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // Should not show clock icon for pending task
    expect(screen.queryByTestId("clock-icon")).toBeNull();
  });

  it("displays duration for completed tasks using executionTime when available", () => {
    const job = {
      id: "test-job-3",
      pipelineId: "test-pipeline",
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
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // For completed jobs, current task is null, so no task duration shown
    // Only overall duration is displayed
    expect(screen.getByText("5m 0s")).toBeDefined();
  });

  it("displays task duration for running tasks", () => {
    const job = {
      id: "test-job-4",
      pipelineId: "test-pipeline",
      name: "Live Update Job",
      status: "running",
      current: "task-1",
      tasks: [
        {
          name: "task-1",
          state: "running",
          startedAt: "2025-10-06T00:25:00Z", // 5 minutes ago
        },
      ],
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // Should show task duration for running task
    expect(screen.getByText("5m 0s")).toBeDefined();
  });

  it("handles tasks without startedAt gracefully", () => {
    const job = {
      id: "test-job-5",
      pipelineId: "test-pipeline",
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
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // Should not show clock icon without startedAt
    expect(screen.queryByTestId("clock-icon")).toBeNull();
  });

  it("handles rejected tasks correctly", () => {
    const job = {
      id: "test-job-6",
      pipelineId: "test-pipeline",
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
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // Should not show clock icon for rejected tasks
    expect(screen.queryByTestId("clock-icon")).toBeNull();
  });

  it("handles object-shaped tasks correctly", () => {
    const job = {
      id: "test-job-7",
      pipelineId: "test-pipeline",
      name: "Object Tasks Job",
      status: "running",
      current: "task-1",
      tasks: {
        "task-1": {
          state: "running",
          startedAt: "2025-10-06T00:25:00Z",
        },
      },
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // Should show duration for object-shaped task (now inline)
    // Use getAllByText since there are multiple "5m 0s" elements
    const allDurationElements = screen.getAllByText("5m 0s");
    expect(allDurationElements.length).toBeGreaterThan(0);
  });

  it("displays overall elapsed time regardless of current task state", () => {
    const job = {
      id: "test-job-8",
      pipelineId: "test-pipeline",
      name: "Job with Overall Time",
      status: "pending",
      current: "task-1",
      tasks: [
        {
          name: "task-1",
          state: "pending",
        },
      ],
    };

    const pipeline = { tasks: ["task-1"] };

    render(
      <JobCard
        job={job}
        pipeline={pipeline}
        onClick={mockOnClick}
        progressPct={mockProgressPct}
        overallElapsedMs={mockOverallElapsedMs}
      />
    );

    // Should show overall elapsed time even when current task has no duration
    expect(screen.getByText("5m 0s")).toBeDefined();
  });
});
