import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import JobCard from "./src/components/JobCard.jsx";

// Mock the utilities to focus on duration logic
vi.mock("./src/utils/jobs.js", () => ({
  countCompleted: vi.fn((job) => {
    const tasks = Array.isArray(job.tasks)
      ? job.tasks
      : Object.values(job.tasks || {});
    return tasks.filter(
      (task) => task.state === "done" || task.state === "completed"
    ).length;
  }),
}));

vi.mock("./src/utils/ui.js", () => ({
  statusBadge: vi.fn((status) => (
    <span data-testid={`status-${status}`}>{status}</span>
  )),
  progressClasses: vi.fn(() => "bg-blue-500"),
}));

// Mock the ticker to return a fixed time
vi.mock("./src/ui/client/hooks/useTicker.js", () => ({
  useTicker: vi.fn(() => new Date("2025-10-06T00:30:00Z").getTime()),
}));

describe("JobCard - Debug", () => {
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

  it("debug duration calculation", () => {
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

    // Debug: check if clock icon exists
    const clockIcon = screen.queryByTestId("clock-icon");
    console.log("Clock icon found:", !!clockIcon);

    if (clockIcon) {
      const parentElement = clockIcon.closest("div");
      console.log("Parent text content:", parentElement.textContent);
    }
  });
});
