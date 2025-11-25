import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useParams } from "react-router-dom";
import PipelineDetail from "../src/pages/PipelineDetail.jsx";
import * as apiModule from "../src/ui/client/api.js";
import * as hooks from "../src/ui/client/hooks/useJobDetailWithUpdates.js";

// Mock useParams
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: vi.fn(),
  };
});

// Mock child components to isolate testing
vi.mock("../src/components/JobDetail.jsx", () => ({
  default: ({ job }) => <div data-testid="job-detail">{job.name}</div>,
}));

vi.mock("../src/components/Layout.jsx", () => ({
  default: ({ children, title }) => (
    <div data-testid="layout">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("../src/components/PageSubheader.jsx", () => ({
  default: ({ children }) => <div data-testid="page-subheader">{children}</div>,
}));

vi.mock("../src/utils/ui.jsx", () => ({
  statusBadge: (status) => <span data-testid="status-badge">{status}</span>,
}));

vi.mock("../src/utils/formatters.js", () => ({
  formatCurrency4: (value) => `$${value.toFixed(4)}`,
  formatTokensCompact: (value) => `${value} tokens`,
}));

vi.mock("../src/components/ui/StopJobModal.jsx", () => ({
  default: ({
    isOpen,
    onClose,
    onConfirm,
    runningJobs,
    defaultJobId,
    isSubmitting,
  }) =>
    isOpen ? (
      <div data-testid="stop-modal">
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
        <button
          onClick={() => onConfirm(defaultJobId)}
          data-testid="modal-confirm"
        >
          {isSubmitting ? "Stopping..." : "Confirm Stop"}
        </button>
        <div data-testid="running-jobs-count">{runningJobs.length}</div>
      </div>
    ) : null,
}));

// Mock Radix tooltip to avoid warnings
vi.mock("@radix-ui/react-tooltip", () => ({
  Provider: ({ children }) => children,
  Root: ({ children }) => children,
  Trigger: ({ children, asChild }) =>
    asChild ? children : <button>{children}</button>,
  Portal: ({ children }) => children,
  Content: ({ children }) => <div>{children}</div>,
  Arrow: () => <div>Arrow</div>,
}));

describe("PipelineDetail Stop Button", () => {
  const mockJobId = "test-job-123";
  const mockJob = {
    id: mockJobId,
    name: "Test Pipeline",
    status: "running",
    progress: 45,
    tasks: {
      task1: { state: "completed" },
      task2: { state: "running" },
    },
    costs: {
      summary: {
        totalCost: 0.1234,
        totalTokens: 1000,
        totalInputTokens: 600,
        totalOutputTokens: 400,
      },
    },
  };

  const mockJobCompleted = {
    ...mockJob,
    status: "completed",
    tasks: {
      task1: { state: "completed" },
      task2: { state: "completed" },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock useParams
    vi.mocked(useParams).mockReturnValue({ jobId: mockJobId });

    // Mock hook
    vi.mocked(hooks.useJobDetailWithUpdates).mockReturnValue({
      data: mockJob,
      loading: false,
      error: null,
      isRefreshing: false,
      isHydrated: true,
    });

    // Mock API functions
    vi.mocked(apiModule.stopJob).mockResolvedValue(undefined);
    vi.mocked(apiModule.rescanJob).mockResolvedValue({
      ok: true,
      added: [],
      removed: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter>
        <PipelineDetail />
      </MemoryRouter>
    );
  };

  it("shows Stop button when job is running", () => {
    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    expect(stopButton).toBeInTheDocument();
    expect(stopButton).not.toBeDisabled();
  });

  it("does not show Stop button when job is not running", () => {
    vi.mocked(hooks.useJobDetailWithUpdates).mockReturnValue({
      data: mockJobCompleted,
      loading: false,
      error: null,
      isRefreshing: false,
      isHydrated: true,
    });

    renderComponent();

    const stopButton = screen.queryByRole("button", { name: /stop/i });
    expect(stopButton).not.toBeInTheDocument();
  });

  it("opens StopJobModal when Stop button is clicked", async () => {
    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(screen.getByTestId("stop-modal")).toBeInTheDocument();
    });

    expect(screen.getByTestId("modal-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("modal-close")).toBeInTheDocument();
  });

  it("calls stopJob API when modal confirm is clicked", async () => {
    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(screen.getByTestId("stop-modal")).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("modal-confirm");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiModule.stopJob).toHaveBeenCalledWith(mockJobId);
    });

    expect(apiModule.stopJob).toHaveBeenCalledTimes(1);
  });

  it("closes modal after successful stop operation", async () => {
    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(screen.getByTestId("stop-modal")).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("modal-confirm");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.queryByTestId("stop-modal")).not.toBeInTheDocument();
    });
  });

  it("handles API errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(apiModule.stopJob).mockRejectedValue(new Error("Network error"));

    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(screen.getByTestId("stop-modal")).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("modal-confirm");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to stop job:",
        expect.any(Error)
      );
    });

    // Modal should still close even on error
    await waitFor(() => {
      expect(screen.queryByTestId("stop-modal")).not.toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it("disables Stop button while stopping", async () => {
    vi.mocked(apiModule.stopJob).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(screen.getByTestId("stop-modal")).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("modal-confirm");
    fireEvent.click(confirmButton);

    // Check that button shows "Stopping..." state
    await waitFor(() => {
      expect(screen.getByText("Stopping...")).toBeInTheDocument();
    });

    // Original button should be disabled
    expect(stopButton).toBeDisabled();
  });

  it("shows Stop button when job has running tasks even if status is not 'running'", () => {
    const jobWithRunningTasks = {
      ...mockJob,
      status: "pending", // Not 'running' but has running tasks
      tasks: {
        task1: { state: "pending" },
        task2: { state: "running" },
      },
    };

    vi.mocked(hooks.useJobDetailWithUpdates).mockReturnValue({
      data: jobWithRunningTasks,
      loading: false,
      error: null,
      isRefreshing: false,
      isHydrated: true,
    });

    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    expect(stopButton).toBeInTheDocument();
  });

  it("passes correct job data to StopJobModal", async () => {
    renderComponent();

    const stopButton = screen.getByRole("button", { name: /stop/i });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(screen.getByTestId("stop-modal")).toBeInTheDocument();
    });

    expect(screen.getByTestId("running-jobs-count")).toHaveTextContent("1");
  });
});
