import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import DAGGrid from "../src/components/DAGGrid.jsx";
import { createEmptyTaskFiles } from "../src/utils/task-files.js";
import * as api from "../src/ui/client/api.js";

// Mock the API module
vi.mock("../src/ui/client/api.js", () => ({
  restartJob: vi.fn(),
  startTask: vi.fn(),
}));

const mockStartTask = vi.mocked(api.startTask);

describe("DAGGrid Start Action Visibility and Interaction", () => {
  const mockJobId = "test-job-123";
  const defaultProps = {
    items: [],
    jobId: mockJobId,
    filesByTypeForItem: () => createEmptyTaskFiles(),
    taskById: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Start button visibility", () => {
    it("shows Start button for pending tasks when job is idle", () => {
      const items = [
        { id: "task-1", status: "pending" },
        { id: "task-2", status: "pending" },
        { id: "task-3", status: "pending" },
      ];

      render(<DAGGrid {...defaultProps} items={items} />);

      // Check that Start buttons are present for pending tasks
      const startButtons = screen.getAllByRole("button", { name: "Start" });
      expect(startButtons).toHaveLength(3);
      startButtons.forEach((button) => {
        expect(button).toBeInTheDocument();
        expect(button).not.toBeDisabled();
      });
    });

    it("hides Start button for running tasks", () => {
      const items = [
        { id: "task-1", status: "running" },
        { id: "task-2", status: "pending" },
      ];

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      // Get the task card for the running task
      const allListItems = container.querySelectorAll('[role="listitem"]');
      const runningTaskCard = Array.from(allListItems).find(
        (item) =>
          item.textContent.includes("Task-1") &&
          item.textContent.includes("Active")
      );

      expect(runningTaskCard).toBeInTheDocument();
      expect(
        within(runningTaskCard).queryByRole("button", { name: "Start" })
      ).not.toBeInTheDocument();

      // Pending task should still show Start button
      const pendingTaskCard = Array.from(allListItems).find(
        (item) =>
          item.textContent.includes("Task-2") &&
          item.textContent.includes("pending")
      );
      expect(
        within(pendingTaskCard).getByRole("button", { name: "Start" })
      ).toBeInTheDocument();
    });

    it("hides Start button for failed tasks", () => {
      const items = [
        { id: "task-1", status: "failed" },
        { id: "task-2", status: "pending" },
      ];

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      // Get the task card for the failed task
      const allListItems = container.querySelectorAll('[role="listitem"]');
      const failedTaskCard = Array.from(allListItems).find(
        (item) =>
          item.textContent.includes("Task-1") &&
          item.textContent.includes("failed")
      );

      expect(failedTaskCard).toBeInTheDocument();
      expect(
        within(failedTaskCard).queryByRole("button", { name: "Start" })
      ).not.toBeInTheDocument();

      // Should show Restart button for failed task instead
      expect(
        within(failedTaskCard).getByRole("button", { name: "Restart" })
      ).toBeInTheDocument();
    });

    it("hides Start button for done tasks", () => {
      const items = [
        { id: "task-1", status: "done" },
        { id: "task-2", status: "pending" },
      ];

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      // Get the task card for the done task
      const allListItems = container.querySelectorAll('[role="listitem"]');
      const doneTaskCard = Array.from(allListItems).find(
        (item) =>
          item.textContent.includes("Task-1") &&
          item.textContent.includes("done")
      );

      expect(doneTaskCard).toBeInTheDocument();
      expect(
        within(doneTaskCard).queryByRole("button", { name: "Start" })
      ).not.toBeInTheDocument();

      // Should show Restart button for done task instead
      expect(
        within(doneTaskCard).getByRole("button", { name: "Restart" })
      ).toBeInTheDocument();
    });

    it("disables Start buttons when any task is running", () => {
      const items = [
        { id: "task-1", status: "running" },
        { id: "task-2", status: "pending" },
        { id: "task-3", status: "pending" },
      ];

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      // All Start buttons should be disabled when any task is running
      const startButtons = within(container).getAllByRole("button", {
        name: "Start",
      });
      startButtons.forEach((button) => {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("title", "Job is currently running");
      });
    });

    it("disables Start buttons when job-level state is running", () => {
      const items = [
        {
          id: "task-1",
          status: "pending",
          state: "running", // job-level state
        },
        { id: "task-2", status: "pending" },
      ];

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      // All Start buttons should be disabled when job is running
      const startButtons = within(container).getAllByRole("button", {
        name: "Start",
      });
      startButtons.forEach((button) => {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("title", "Job is currently running");
      });
    });

    it("shows appropriate tooltips for disabled Start buttons", () => {
      const items = [
        { id: "task-1", status: "running" },
        { id: "task-2", status: "failed" }, // This one should not show Start at all
        { id: "task-3", status: "pending" },
      ];

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      const startButtons = within(container).getAllByRole("button", {
        name: "Start",
      });
      expect(startButtons).toHaveLength(1); // Only task-3 should show Start

      const startButton = startButtons[0];
      expect(startButton).toBeDisabled();
      expect(startButton).toHaveAttribute("title", "Job is currently running");
    });
  });

  describe("Start button interaction", () => {
    it("calls startTask API when Start button is clicked", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockResolvedValue({
        ok: true,
        jobId: mockJobId,
        taskId: "task-1",
        mode: "single-task-start",
        spawned: true,
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      expect(startButton).not.toBeDisabled();

      await fireEvent.click(startButton);

      expect(mockStartTask).toHaveBeenCalledWith(mockJobId, "task-1");
      expect(mockStartTask).toHaveBeenCalledTimes(1);
    });

    it("prevents card click when Start button is clicked", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockResolvedValue({ ok: true });

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      const taskCard = startButton.closest('[role="listitem"]');

      // Click the Start button
      await fireEvent.click(startButton);

      // The task sidebar should not open (no click event should bubble up)
      expect(
        container.querySelector('[role="dialog"]')
      ).not.toBeInTheDocument();
      expect(mockStartTask).toHaveBeenCalledWith(mockJobId, "task-1");
    });

    it("shows success alert when startTask succeeds", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockResolvedValue({
        ok: true,
        jobId: mockJobId,
        taskId: "task-1",
        mode: "single-task-start",
        spawned: true,
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show success alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Task task-1 started successfully.");
      expect(alert).toHaveClass(/bg-green-50/); // Success styling
    });

    it("shows error alert when startTask fails with job_running error", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue({
        code: "job_running",
        message: "Job is currently running",
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show error alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(
        "Job is currently running; start is unavailable."
      );
      expect(alert).toHaveClass(/bg-yellow-50/); // Warning styling
    });

    it("shows error alert when startTask fails with dependencies_not_satisfied error", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue({
        code: "dependencies_not_satisfied",
        message: "Dependencies not satisfied",
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show error alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Dependencies not satisfied for task.");
      expect(alert).toHaveClass(/bg-yellow-50/); // Warning styling
    });

    it("shows error alert when startTask fails with job_not_found error", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue({
        code: "job_not_found",
        message: "Job not found",
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show error alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Job not found.");
      expect(alert).toHaveClass(/bg-red-50/); // Error styling
    });

    it("shows error alert when startTask fails with task_not_found error", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue({
        code: "task_not_found",
        message: "Task not found",
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show error alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Task not found.");
      expect(alert).toHaveClass(/bg-red-50/); // Error styling
    });

    it("shows error alert when startTask fails with task_not_pending error", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue({
        code: "task_not_pending",
        message: "Task is not pending",
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show error alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Task is not in pending state.");
      expect(alert).toHaveClass(/bg-yellow-50/); // Warning styling
    });

    it("shows error alert when startTask fails with unsupported_lifecycle error", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue({
        code: "unsupported_lifecycle",
        message: "Job must be in current",
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show error alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(
        "Job must be in current to start a task."
      );
      expect(alert).toHaveClass(/bg-yellow-50/); // Warning styling
    });

    it("shows generic error alert for unknown errors", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue({
        code: "unknown_error",
        message: "Something went wrong",
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Should show error alert
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Something went wrong");
      expect(alert).toHaveClass(/bg-red-50/); // Error styling
    });

    it("disables Start button while submitting", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      let resolvePromise;
      mockStartTask.mockImplementation(() => {
        return new Promise((resolve) => {
          resolvePromise = resolve;
        });
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      expect(startButton).not.toBeDisabled();

      // Click to start the async operation
      fireEvent.click(startButton);

      // Button should be disabled during the operation
      expect(startButton).toBeDisabled();

      // Resolve the promise
      resolvePromise({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Button should be enabled again
      expect(startButton).not.toBeDisabled();
    });

    it("re-enables Start button after submission fails", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockRejectedValue(new Error("Network error"));

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      expect(startButton).not.toBeDisabled();

      // Click to start the async operation
      await fireEvent.click(startButton);

      // Button should be enabled again after the failure
      expect(startButton).not.toBeDisabled();
    });

    it("can dismiss alert notification", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockResolvedValue({
        ok: true,
        jobId: mockJobId,
        taskId: "task-1",
        mode: "single-task-start",
        spawned: true,
      });

      render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      await fireEvent.click(startButton);

      // Alert should be visible
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();

      // Find and click the dismiss button
      const dismissButton = within(alert).getByLabelText(
        "Dismiss notification"
      );
      await fireEvent.click(dismissButton);

      // Alert should be gone
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("No optimistic state mutations", () => {
    it("does not modify task state on click - relies on SSE updates", async () => {
      const items = [{ id: "task-1", status: "pending" }];
      mockStartTask.mockResolvedValue({ ok: true });

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      const startButton = screen.getByRole("button", { name: "Start" });
      const taskCard = startButton.closest('[role="listitem"]');

      // Verify initial state
      expect(taskCard).toHaveTextContent("pending");
      expect(taskCard).not.toHaveTextContent("running");

      await fireEvent.click(startButton);

      // State should not change immediately after click
      expect(taskCard).toHaveTextContent("pending");
      expect(taskCard).not.toHaveTextContent("running");

      // API was called
      expect(mockStartTask).toHaveBeenCalledWith(mockJobId, "task-1");
    });

    it("preserves task visibility and structure after start attempt", async () => {
      const items = [
        { id: "task-1", status: "pending", title: "Research Task" },
        { id: "task-2", status: "pending", title: "Analysis Task" },
      ];
      mockStartTask.mockResolvedValue({ ok: true });

      const { container } = render(<DAGGrid {...defaultProps} items={items} />);

      const startButtons = screen.getAllByRole("button", { name: "Start" });
      expect(startButtons).toHaveLength(2);

      // Start the first task
      await fireEvent.click(startButtons[0]);

      // Both task cards should still be visible
      const allListItems = container.querySelectorAll('[role="listitem"]');
      expect(allListItems).toHaveLength(2);

      // Both Start buttons should still be present (no optimistic mutation)
      const startButtonsAfter = within(container).getAllByRole("button", {
        name: "Start",
      });
      expect(startButtonsAfter).toHaveLength(2);
    });
  });
});
