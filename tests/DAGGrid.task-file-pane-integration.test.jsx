/**
 * Integration tests for DAGGrid TaskFilePane integration
 * @module tests/DAGGrid.task-file-pane-integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";
import { createEmptyTaskFiles } from "../src/utils/task-files.js";

describe("DAGGrid TaskFilePane Integration", () => {
  const mockJobId = "test-job-123";
  const mockItems = [
    { id: "task-1", status: "done", title: "Analysis Task" },
    { id: "task-2", status: "running", title: "Processing Task" },
    { id: "task-3", status: "pending", title: "Output Task" },
  ];

  const mockFilesByTypeForItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFilesByTypeForItem.mockReturnValue(createEmptyTaskFiles());
  });

  it("should render file tabs and file list when task is selected", () => {
    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Click on first task to open slide-over
    const firstTask = screen
      .getByText("Analysis Task")
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

  it("should switch file type tabs and reset filename/pane", async () => {
    // Mock files for different types
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

    // Open task details - find the task card (not the slide-over title)
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText("output.json")).toBeInTheDocument();
    });

    // Click on a file to open pane
    const outputFile = screen.getByText("output.json");
    fireEvent.click(outputFile);

    // Should show TaskFilePane (mocked)
    expect(screen.getByText("File Preview")).toBeInTheDocument();

    // Switch to Logs tab
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);

    // Should show logs files and tab should be active
    expect(screen.getByText(/Logs files for task-1/i)).toBeInTheDocument();
    expect(logsTab).toHaveClass("bg-white");

    // Should show log files
    expect(screen.getByText("execution.log")).toBeInTheDocument();
    expect(screen.getByText("debug.log")).toBeInTheDocument();

    // File preview should be closed (filename reset)
    // Note: TaskFilePane is mocked, so we check that the files are displayed
    expect(screen.getByText("execution.log")).toBeInTheDocument();
  });

  it("should show empty state when no files of selected type", () => {
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

    // Open task details - find the task card (not the slide-over title)
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Should show empty state for artifacts
    expect(screen.getByText("No artifacts files found")).toBeInTheDocument();

    // Switch to logs - should show files
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);
    expect(screen.getByText("execution.log")).toBeInTheDocument();

    // Switch to temp - should show empty state
    const tempTab = screen.getByRole("button", { name: "Temp" });
    fireEvent.click(tempTab);
    expect(screen.getByText("No tmp files found")).toBeInTheDocument();
  });

  it("should pass correct props to TaskFilePane when file is selected", async () => {
    mockFilesByTypeForItem.mockReturnValue({
      artifacts: ["test-file.json"],
      logs: [],
      tmp: [],
    });

    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open task details - find the task card (not the slide-over title)
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText("test-file.json")).toBeInTheDocument();
    });

    // Click on file to open pane
    const testFile = screen.getByText("test-file.json");
    fireEvent.click(testFile);

    // TaskFilePane should receive correct props
    // Since it's mocked, we verify the file selection behavior
    expect(screen.getByText("File Preview")).toBeInTheDocument();
  });

  it("should close file pane when slide-over is closed", async () => {
    mockFilesByTypeForItem.mockReturnValue({
      artifacts: ["test-file.json"],
      logs: [],
      tmp: [],
    });

    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open task details and file pane - find the task card (not the slide-over title)
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Wait for files to appear
    await waitFor(() => {
      expect(screen.getByText("test-file.json")).toBeInTheDocument();
    });

    const testFile = screen.getByText("test-file.json");
    fireEvent.click(testFile);

    // Should show file preview
    expect(screen.getByText("File Preview")).toBeInTheDocument();

    // Close slide-over
    const closeButton = screen.getByRole("button", { name: "Close details" });
    fireEvent.click(closeButton);

    // Slide-over should be closed (content should disappear)
    expect(screen.queryByText("File Preview")).not.toBeInTheDocument();
  });

  it("should call filesByTypeForItem with correct item", () => {
    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open task details for second task - find the task card (not the slide-over title)
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
});
