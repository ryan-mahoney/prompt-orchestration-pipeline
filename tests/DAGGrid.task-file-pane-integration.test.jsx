/**
 * Integration tests for DAGGrid TaskFilePane integration
 * @module tests/DAGGrid.task-file-pane-integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";
import { createEmptyTaskFiles } from "../src/utils/task-files.js";

vi.mock("../src/components/TaskFilePane.jsx", () => ({
  TaskFilePane: ({ isOpen, filename }) =>
    isOpen ? (
      <div>
        <h2>File Preview</h2>
        {filename ? (
          <div data-testid="file-preview-filename">{filename}</div>
        ) : null}
      </div>
    ) : null,
}));

describe("DAGGrid TaskFilePane Integration", () => {
  const mockJobId = "test-job-123";
  const mockItems = [
    { id: "task-1", status: "done", title: "Analysis Task" },
    { id: "task-2", status: "running", title: "Processing Task" },
    { id: "task-3", status: "pending", title: "Output Task" },
  ];

  const mockFilesByTypeForItem = vi.fn();
  let taskFilesFixture;

  const setTaskFiles = (taskId, files) => {
    taskFilesFixture[taskId] = files;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskFilesFixture = {};
    mockFilesByTypeForItem.mockImplementation((item) => {
      const key = item?.id ?? item?.name ?? null;
      if (!key) {
        return createEmptyTaskFiles();
      }
      return taskFilesFixture[key] ?? createEmptyTaskFiles();
    });
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

  it("should show empty state when no files of selected type", () => {
    setTaskFiles("task-1", {
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
    expect(
      screen.getByText("No artifacts files available for this task")
    ).toBeInTheDocument();

    // Switch to logs - should show files
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);
    expect(screen.getByText("execution.log")).toBeInTheDocument();

    // Switch to temp - should show empty state
    const tempTab = screen.getByRole("button", { name: "Temp" });
    fireEvent.click(tempTab);
    expect(
      screen.getByText("No tmp files available for this task")
    ).toBeInTheDocument();
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
