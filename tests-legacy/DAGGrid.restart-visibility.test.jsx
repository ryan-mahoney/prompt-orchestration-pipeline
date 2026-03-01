import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";
import { createEmptyTaskFiles } from "../src/utils/task-files.js";

describe("DAGGrid Restart Visibility", () => {
  const mockJobId = "test-job-123";
  const defaultProps = {
    items: [],
    jobId: mockJobId,
    filesByTypeForItem: () => createEmptyTaskFiles(),
  };

  it("shows Restart button for failed, done, and succeeded statuses", () => {
    const items = [
      { id: "task-1", status: "failed" },
      { id: "task-2", status: "done" },
      { id: "task-3", status: "succeeded" },
    ];

    render(<DAGGrid {...defaultProps} items={items} />);

    // Check that Restart buttons are present for eligible statuses
    const restartButtons = screen.getAllByRole("button", { name: "Restart" });
    expect(restartButtons).toHaveLength(3);
    restartButtons.forEach((button) => {
      expect(button).toBeInTheDocument();
    });
  });

  it("hides Restart button for running and pending statuses", () => {
    const items = [
      { id: "task-1", status: "running" },
      { id: "task-2", status: "pending" },
      // Simulate a derived pending by not setting status and placing after activeIndex
      { id: "task-3" },
    ];

    const { container } = render(
      <DAGGrid
        {...defaultProps}
        items={items}
        activeIndex={0} // Makes task-1 running, task-2 pending, task-3 pending
      />
    );

    // Get list items only from this render's container
    const allListItems = container.querySelectorAll('[role="listitem"]');

    // Check each task card specifically - look for "Active" (running status shows as Active) and "pending" status indicators
    const task1Card = Array.from(allListItems).find(
      (item) =>
        item.textContent.includes("Task-1") &&
        item.textContent.includes("Active")
    );
    const task2Card = Array.from(allListItems).find(
      (item) =>
        item.textContent.includes("Task-2") &&
        item.textContent.includes("pending")
    );
    const task3Card = Array.from(allListItems).find(
      (item) =>
        item.textContent.includes("Task-3") &&
        item.textContent.includes("pending")
    );

    // Verify we found the right cards
    expect(task1Card).toBeInTheDocument();
    expect(task2Card).toBeInTheDocument();
    expect(task3Card).toBeInTheDocument();

    expect(
      within(task1Card).queryByRole("button", { name: "Restart" })
    ).not.toBeInTheDocument();
    expect(
      within(task2Card).queryByRole("button", { name: "Restart" })
    ).not.toBeInTheDocument();
    expect(
      within(task3Card).queryByRole("button", { name: "Restart" })
    ).not.toBeInTheDocument();
  });

  it("shows Restart but disabled when job is running (job-level disablement)", () => {
    const items = [
      {
        id: "task-1",
        status: "failed",
        state: "running",
        lifecycle: "current",
      },
    ];

    const { container } = render(<DAGGrid {...defaultProps} items={items} />);

    const restartButtons = within(container).getAllByRole("button", {
      name: "Restart",
    });
    expect(restartButtons.length).toBeGreaterThanOrEqual(1);
    const restartButton = restartButtons[0];
    expect(restartButton).toBeInTheDocument();
    expect(restartButton).toBeDisabled();
    expect(restartButton).toHaveAttribute("title", "Job is currently running");
  });

  it("shows Restart but disabled when job lifecycle is not current", () => {
    const items = [
      { id: "task-1", status: "failed", state: "idle", lifecycle: "archived" },
    ];

    const { container } = render(
      <DAGGrid {...defaultProps} items={items} activeIndex={undefined} />
    );

    const restartButtons = within(container).getAllByRole("button", {
      name: "Restart",
    });
    expect(restartButtons.length).toBeGreaterThanOrEqual(1);
    const restartButton = restartButtons[0];
    expect(restartButton).toBeInTheDocument();
    expect(restartButton).toBeDisabled();
    expect(restartButton).toHaveAttribute(
      "title",
      "Job must be in current lifecycle"
    );
  });

  it("does not render stray border when Restart button is hidden", () => {
    const items = [
      { id: "task-1", status: "running" },
      { id: "task-2", status: "pending" },
    ];

    const { container } = render(
      <DAGGrid
        {...defaultProps}
        items={items}
        activeIndex={0} // task-1 running, task-2 pending
      />
    );

    // Check that no elements with the Restart section border class exist
    const borderElements = container.querySelectorAll(
      ".border-t.border-gray-100"
    );
    expect(borderElements).toHaveLength(0);
  });

  it("handles mixed statuses correctly", () => {
    const items = [
      { id: "task-1", status: "failed" },
      { id: "task-2", status: "running" },
      { id: "task-3", status: "done" },
      { id: "task-4", status: "pending" },
      { id: "task-5", status: "succeeded" },
    ];

    const { container } = render(
      <DAGGrid
        {...defaultProps}
        items={items}
        activeIndex={1} // task-2 running
      />
    );

    const restartButtons = within(container).getAllByRole("button", {
      name: "Restart",
    });
    // Should have buttons for failed, done, and succeeded tasks
    expect(restartButtons.length).toBeGreaterThanOrEqual(3);

    // All buttons should be disabled because task-2 is running
    restartButtons.forEach((button) => {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Job is currently running");
    });
  });
});
