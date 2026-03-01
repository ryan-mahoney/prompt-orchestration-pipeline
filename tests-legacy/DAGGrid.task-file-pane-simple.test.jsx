/**
 * Simple integration tests for DAGGrid TaskFilePane integration
 * @module tests/DAGGrid.task-file-pane-simple
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";
import { createEmptyTaskFiles } from "../src/utils/task-files.js";

describe("DAGGrid TaskFilePane Simple Integration", () => {
  const mockJobId = "test-job-123";
  const mockItems = [
    { id: "task-1", status: "done", title: "Analysis Task" },
    { id: "task-2", status: "running", title: "Processing Task" },
  ];

  const mockFilesByTypeForItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFilesByTypeForItem.mockReturnValue(createEmptyTaskFiles());
  });

  it("should render file tabs when task is selected", () => {
    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Click on first task to open slide-over
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Should show file tabs
    expect(
      screen.getByRole("button", { name: "Artifacts" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Temp" })).toBeInTheDocument();

    // Should show file list section
    expect(screen.getByText(/Artifacts files for task-1/i)).toBeInTheDocument();
  });

  it("should switch file type tabs correctly", () => {
    // This test verifies the basic tab switching functionality
    // The actual file content rendering is tested in the basic tests
    mockFilesByTypeForItem.mockReturnValue({
      artifacts: ["output.json", "results.csv"],
      logs: ["execution.log", "debug.log"],
      tmp: ["temp-file.txt"],
    });

    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open task details
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Should show tabs and be able to switch between them
    expect(
      screen.getByRole("button", { name: "Artifacts" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Temp" })).toBeInTheDocument();

    // Switch to Logs tab
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);
    expect(logsTab).toHaveClass("bg-white");

    // Switch to Temp tab
    const tempTab = screen.getByRole("button", { name: "Temp" });
    fireEvent.click(tempTab);
    expect(tempTab).toHaveClass("bg-white");
  });

  it("should handle empty file arrays gracefully", () => {
    mockFilesByTypeForItem.mockReturnValue({
      artifacts: [],
      logs: ["execution.log"],
      tmp: [],
    });

    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open task details
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Should show tabs and be able to switch between them
    expect(
      screen.getByRole("button", { name: "Artifacts" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Temp" })).toBeInTheDocument();

    // Switch to logs - should show files
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);
    expect(logsTab).toHaveClass("bg-white");

    // Switch to temp - should work without errors
    const tempTab = screen.getByRole("button", { name: "Temp" });
    fireEvent.click(tempTab);
    expect(tempTab).toHaveClass("bg-white");
  });

  it("should call filesByTypeForItem with correct item", () => {
    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open task details for second task
    const secondTask = screen
      .getAllByText("Processing Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(secondTask);

    // Should have called filesByTypeForItem with the second item
    expect(mockFilesByTypeForItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-2", status: "running" })
    );
  });

  it("should reset filename when switching tabs", () => {
    // Mock files for different types
    mockFilesByTypeForItem.mockReturnValue({
      artifacts: ["output.json"],
      logs: ["execution.log"],
      tmp: [],
    });

    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open task details
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Should show artifacts files
    expect(screen.getByText("output.json")).toBeInTheDocument();

    // Switch to Logs tab
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);

    // Should show logs files (different from artifacts)
    expect(screen.getByText("execution.log")).toBeInTheDocument();
    expect(screen.queryByText("output.json")).not.toBeInTheDocument();

    // Switch back to Artifacts tab
    const artifactsTab = screen.getByRole("button", { name: "Artifacts" });
    fireEvent.click(artifactsTab);

    // Should show artifacts files again
    expect(screen.getByText("output.json")).toBeInTheDocument();
    expect(screen.queryByText("execution.log")).not.toBeInTheDocument();
  });
});
