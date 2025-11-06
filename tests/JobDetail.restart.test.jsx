import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import JobDetail from "../src/components/JobDetail.jsx";
import { ToastProvider } from "../src/components/ui/toast.jsx";

// Mock dependencies
vi.mock("../src/components/DAGGrid.jsx", () => ({
  default: ({ items, activeIndex }) => (
    <div data-testid="dag-grid">
      <div data-testid="dag-items">{JSON.stringify(items)}</div>
      <div data-testid="active-index">{activeIndex}</div>
    </div>
  ),
}));

vi.mock("../src/utils/dag.js", () => ({
  computeDagItems: vi.fn(() => [
    { id: "task1", status: "succeeded", source: "pipeline" },
    { id: "task2", status: "failed", source: "pipeline" },
  ]),
  computeActiveIndex: vi.fn(() => 1),
}));

vi.mock("../src/ui/client/api.js", () => ({
  restartJob: vi.fn(),
}));

vi.mock("../src/components/ui/RestartJobModal.jsx", () => ({
  RestartJobModal: ({ open, onClose, onConfirm, isSubmitting }) => {
    if (!open) return null;
    return (
      <div data-testid="restart-modal">
        <div data-testid="submitting-state">{isSubmitting.toString()}</div>
        <button data-testid="cancel-button" onClick={onClose}>
          Cancel
        </button>
        <button data-testid="confirm-button" onClick={onConfirm}>
          Restart
        </button>
      </div>
    );
  },
}));

import { restartJob } from "../src/ui/client/api.js";
const restartJobMock = vi.mocked(restartJob);

describe("JobDetail - Restart Functionality", () => {
  const mockOnClose = vi.fn();
  const mockOnResume = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    restartJobMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows restart button when job is in current lifecycle and not running", () => {
    const job = {
      id: "test-job-123",
      lifecycle: "current",
      state: "failed",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    expect(restartButton).toBeInTheDocument();
    expect(restartButton).toBeEnabled();
  });

  it("shows disabled restart button when job is running", () => {
    const job = {
      id: "test-job-123",
      lifecycle: "current",
      state: "running",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    expect(restartButton).toBeInTheDocument();
    expect(restartButton).toBeDisabled();
    expect(restartButton).toHaveAttribute("title", "Job is currently running");
  });

  it("shows disabled restart button when job is not in current lifecycle", () => {
    const job = {
      id: "test-job-123",
      lifecycle: "archived",
      state: "failed",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    expect(restartButton).toBeInTheDocument();
    expect(restartButton).toBeDisabled();
    expect(restartButton).toHaveAttribute(
      "title",
      "Job must be in current lifecycle"
    );
  });

  it("opens restart modal when restart button is clicked", () => {
    const job = {
      id: "test-job-123",
      lifecycle: "current",
      state: "failed",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    fireEvent.click(restartButton);

    expect(screen.getByTestId("restart-modal")).toBeInTheDocument();
    expect(screen.getByTestId("submitting-state")).toHaveTextContent("false");
  });

  it("closes modal when cancel button is clicked", () => {
    const job = {
      id: "test-job-123",
      lifecycle: "current",
      state: "failed",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    // Open modal
    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    fireEvent.click(restartButton);

    expect(screen.getByTestId("restart-modal")).toBeInTheDocument();

    // Close modal
    const cancelButton = screen.getByTestId("cancel-button");
    fireEvent.click(cancelButton);

    expect(screen.queryByTestId("restart-modal")).not.toBeInTheDocument();
  });

  it("calls restart API when confirm button is clicked", async () => {
    const job = {
      id: "test-job-123",
      lifecycle: "current",
      state: "failed",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    // Open modal
    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    fireEvent.click(restartButton);

    // Confirm restart
    const confirmButton = screen.getByTestId("confirm-button");
    fireEvent.click(confirmButton);

    expect(restartJobMock).toHaveBeenCalledWith("test-job-123", {
      options: { clearTokenUsage: true },
    });
  });

  it("shows success message when restart succeeds", async () => {
    const job = {
      id: "test-job-123",
      lifecycle: "current",
      state: "failed",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    // Open and confirm modal
    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    fireEvent.click(restartButton);

    const confirmButton = screen.getByTestId("confirm-button");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Restart requested. The job will reset to pending and start in the background."
        )
      ).toBeInTheDocument();
    });

    // Modal should be closed after success
    expect(screen.queryByTestId("restart-modal")).not.toBeInTheDocument();
  });

  it("shows error message when restart fails", async () => {
    const error = new Error("Job is currently running");
    error.code = "job_running";
    restartJobMock.mockRejectedValue(error);

    const job = {
      id: "test-job-123",
      lifecycle: "current",
      state: "failed",
      tasks: {},
    };

    render(
      <ToastProvider>
        <JobDetail
          job={job}
          pipeline={{ tasks: [] }}
          onClose={mockOnClose}
          onResume={mockOnResume}
        />
      </ToastProvider>
    );

    // Open and confirm modal
    const restartButton = screen.getByRole("button", {
      name: "Restart job (reset progress)",
    });
    fireEvent.click(restartButton);

    const confirmButton = screen.getByTestId("confirm-button");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(
        screen.getByText("Job is currently running; restart is unavailable.")
      ).toBeInTheDocument();
    });

    // Modal should remain open after error
    expect(screen.getByTestId("restart-modal")).toBeInTheDocument();
  });

  it("handles different error codes correctly", async () => {
    const testCases = [
      { code: "job_not_found", expectedMessage: "Job not found." },
      {
        code: "spawn_failed",
        expectedMessage: "Failed to start restart. Try again.",
      },
      {
        code: "conflict",
        message: "unsupported_lifecycle",
        expectedMessage: "Job must be in current to restart.",
      },
    ];

    for (const testCase of testCases) {
      vi.clearAllMocks();

      const error = new Error(testCase.message || "Test error");
      error.code = testCase.code;
      error.message = testCase.message || "Test error";
      restartJobMock.mockRejectedValue(error);

      const job = {
        id: "test-job-123",
        lifecycle: "current",
        state: "failed",
        tasks: {},
      };

      render(
        <ToastProvider>
          <JobDetail
            job={job}
            pipeline={{ tasks: [] }}
            onClose={mockOnClose}
            onResume={mockOnResume}
          />
        </ToastProvider>
      );

      const restartButton = screen.getAllByRole("button", {
        name: "Restart job (reset progress)",
      })[0];
      fireEvent.click(restartButton);

      const confirmButton = screen.getByTestId("confirm-button");
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(testCase.expectedMessage)).toBeInTheDocument();
      });
    }
  });
});
