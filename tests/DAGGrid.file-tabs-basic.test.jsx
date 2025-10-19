/**
 * Basic tests for DAGGrid file tabs functionality
 * @module tests/DAGGrid.file-tabs-basic
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";
import { createEmptyTaskFiles } from "../src/utils/task-files.js";

describe("DAGGrid File Tabs Basic Functionality", () => {
  const mockJobId = "test-job-123";
  const mockItems = [
    { id: "task-1", status: "done", title: "Analysis Task" },
    { id: "task-2", status: "running", title: "Processing Task" },
  ];

  // Mock with files by default for all tests
  const mockFilesByTypeForItem = vi.fn(() => ({
    artifacts: ["output.json", "results.csv"],
    logs: ["execution.log", "debug.log"],
    tmp: ["temp-file.txt"],
  }));

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("should switch between file type tabs", () => {
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

    // Should show artifacts tab active by default
    const artifactsTab = screen.getByRole("button", { name: "Artifacts" });
    expect(artifactsTab).toHaveClass("bg-white");

    // Switch to Logs tab
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);

    // Should show logs tab active and artifacts inactive
    expect(logsTab).toHaveClass("bg-white");
    expect(artifactsTab).not.toHaveClass("bg-white");

    // Should show logs files section
    expect(screen.getByText(/Logs files for task-1/i)).toBeInTheDocument();

    // Switch to Temp tab
    const tempTab = screen.getByRole("button", { name: "Temp" });
    fireEvent.click(tempTab);

    // Should show temp tab active and others inactive
    expect(tempTab).toHaveClass("bg-white");
    expect(logsTab).not.toHaveClass("bg-white");
    expect(artifactsTab).not.toHaveClass("bg-white");

    // Should show temp files section
    expect(screen.getByText(/Tmp files for task-1/i)).toBeInTheDocument();
  });

  it("should reset file pane type when opening different tasks", () => {
    render(
      <DAGGrid
        items={mockItems}
        jobId={mockJobId}
        filesByTypeForItem={mockFilesByTypeForItem}
      />
    );

    // Open first task
    const firstTask = screen
      .getAllByText("Analysis Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(firstTask);

    // Switch to Logs tab
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);

    // Should show logs tab active
    expect(logsTab).toHaveClass("bg-white");

    // Close slide-over
    const closeButton = screen.getByRole("button", { name: "Close details" });
    fireEvent.click(closeButton);

    // Open second task
    const secondTask = screen
      .getAllByText("Processing Task")
      .find((el) => el.closest('[role="listitem"]'))
      .closest('[role="listitem"]');
    fireEvent.click(secondTask);

    // Should reset to artifacts tab (default) - verify by checking the section text
    expect(screen.getByText(/Artifacts files for task-2/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Logs files for task-2/i)
    ).not.toBeInTheDocument();
  });

  it("should close slide-over and reset state when Escape key is pressed", () => {
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

    // Switch to Logs tab
    const logsTab = screen.getByRole("button", { name: "Logs" });
    fireEvent.click(logsTab);

    // Should show slide-over
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(logsTab).toHaveClass("bg-white");

    // Press Escape key
    fireEvent.keyDown(document, { key: "Escape" });

    // Slide-over should be hidden
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
});
