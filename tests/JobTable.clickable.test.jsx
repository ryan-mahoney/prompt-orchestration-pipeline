import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import JobTable from "../src/components/JobTable.jsx";

// Mock the UI utilities
vi.mock("../src/utils/ui", () => ({
  progressClasses: vi.fn(() => "mock-progress-class"),
  statusBadge: vi.fn((status) => (
    <span data-testid="status-badge">{status}</span>
  )),
}));

// Mock the duration utilities
vi.mock("../src/utils/duration", () => ({
  fmtDuration: vi.fn(() => "0m 0s"),
  taskDisplayDurationMs: vi.fn(() => 0),
}));

// Mock the jobs utility
vi.mock("../src/utils/jobs", () => ({
  countCompleted: vi.fn(() => 1),
}));

// Mock the Progress component
vi.mock("../src/components/ui/progress", () => ({
  Progress: ({ value, ...props }) => (
    <div data-testid="progress" data-value={value} {...props} />
  ),
}));

describe("JobTable - Clickable Rows", () => {
  const mockOnOpenJob = vi.fn();
  const mockPipeline = { tasks: [{ id: "task1" }, { id: "task2" }] };
  const mockOverallElapsed = vi.fn(() => 0);
  const mockNow = new Date("2024-01-01T00:00:00Z");

  const mockJobWithId = {
    id: "test-job-123",
    title: "Test Job",
    status: "running",
    progress: 50,
    current: "task1",
    tasks: { task1: { state: "running" }, task2: { state: "pending" } },
  };

  const mockJobWithoutId = {
    title: "Job Without ID",
    status: "pending",
    progress: 0,
    tasks: { task1: { state: "pending" } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("should make rows clickable when job has valid id", () => {
    render(
      <JobTable
        jobs={[mockJobWithId]}
        pipeline={mockPipeline}
        onOpenJob={mockOnOpenJob}
        overallElapsed={mockOverallElapsed}
        now={mockNow}
      />
    );

    const rows = screen.getAllByRole("row");
    const dataRow = rows.find((row) =>
      row.getAttribute("aria-label")?.includes("Open Test Job")
    );

    expect(dataRow).toHaveClass("cursor-pointer");
    expect(dataRow).toHaveClass("hover:bg-slate-50/50");
    expect(dataRow).not.toHaveClass("cursor-not-allowed");
    expect(dataRow).not.toHaveClass("opacity-60");
    expect(dataRow).toHaveAttribute("tabIndex", "0");
  });

  it("should make rows non-clickable when job lacks valid id", () => {
    render(
      <JobTable
        jobs={[mockJobWithoutId]}
        pipeline={mockPipeline}
        onOpenJob={mockOnOpenJob}
        overallElapsed={mockOverallElapsed}
        now={mockNow}
      />
    );

    const rows = screen.getAllByRole("row");
    const dataRow = rows.find((row) =>
      row
        .getAttribute("aria-label")
        ?.includes("Job Without ID - No valid job ID")
    );

    expect(dataRow).toHaveClass("cursor-not-allowed");
    expect(dataRow).toHaveClass("opacity-60");
    expect(dataRow).not.toHaveClass("cursor-pointer");
    expect(dataRow).not.toHaveClass("hover:bg-slate-50/50");
    expect(dataRow).toHaveAttribute("tabIndex", "-1");
  });

  it("should call onOpenJob when clickable row is clicked", () => {
    render(
      <JobTable
        jobs={[mockJobWithId]}
        pipeline={mockPipeline}
        onOpenJob={mockOnOpenJob}
        overallElapsed={mockOverallElapsed}
        now={mockNow}
      />
    );

    const rows = screen.getAllByRole("row");
    const dataRow = rows.find((row) =>
      row.getAttribute("aria-label")?.includes("Open Test Job")
    );

    fireEvent.click(dataRow);
    expect(mockOnOpenJob).toHaveBeenCalledWith(mockJobWithId);
    expect(mockOnOpenJob).toHaveBeenCalledTimes(1);
  });

  it("should not call onOpenJob when non-clickable row is clicked", () => {
    render(
      <JobTable
        jobs={[mockJobWithoutId]}
        pipeline={mockPipeline}
        onOpenJob={mockOnOpenJob}
        overallElapsed={mockOverallElapsed}
        now={mockNow}
      />
    );

    const rows = screen.getAllByRole("row");
    const dataRow = rows.find((row) =>
      row
        .getAttribute("aria-label")
        ?.includes("Job Without ID - No valid job ID")
    );

    fireEvent.click(dataRow);
    expect(mockOnOpenJob).not.toHaveBeenCalled();
  });

  it("should handle keyboard navigation for clickable rows", () => {
    render(
      <JobTable
        jobs={[mockJobWithId]}
        pipeline={mockPipeline}
        onOpenJob={mockOnOpenJob}
        overallElapsed={mockOverallElapsed}
        now={mockNow}
      />
    );

    const rows = screen.getAllByRole("row");
    const dataRow = rows.find((row) =>
      row.getAttribute("aria-label")?.includes("Open Test Job")
    );

    // Test Enter key
    fireEvent.keyDown(dataRow, { key: "Enter" });
    expect(mockOnOpenJob).toHaveBeenCalledWith(mockJobWithId);
    expect(mockOnOpenJob).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // Test Space key
    fireEvent.keyDown(dataRow, { key: " " });
    expect(mockOnOpenJob).toHaveBeenCalledWith(mockJobWithId);
    expect(mockOnOpenJob).toHaveBeenCalledTimes(1);
  });

  it("should display job id in the first data row", () => {
    render(
      <JobTable
        jobs={[mockJobWithId]}
        pipeline={mockPipeline}
        onOpenJob={mockOnOpenJob}
        overallElapsed={mockOverallElapsed}
        now={mockNow}
      />
    );

    const firstDataRow = screen.getAllByRole("row")[1]; // Skip header row
    expect(firstDataRow).toHaveTextContent("test-job-123");
  });
});
