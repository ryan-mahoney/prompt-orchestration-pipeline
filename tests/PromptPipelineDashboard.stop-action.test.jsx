import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import PromptPipelineDashboard from "../src/pages/PromptPipelineDashboard.jsx";
import { stopJob } from "../src/ui/client/api.js";

// Mock the API
vi.mock("../src/ui/client/api.js", () => ({
  stopJob: vi.fn(),
}));

// Mock the hooks
vi.mock("../src/ui/client/hooks/useJobListWithUpdates", () => ({
  useJobListWithUpdates: vi.fn(),
}));

// Mock the adapter
vi.mock("../src/ui/client/adapters/job-adapter", () => ({
  adaptJobSummary: vi.fn((job) => job),
}));

// Mock Layout component to simplify testing
vi.mock("../src/components/Layout.jsx", () => ({
  default: ({ title, actions, children }) => (
    <div>
      <header>
        <h1>{title}</h1>
        {actions}
      </header>
      <main>{children}</main>
    </div>
  ),
}));

// Mock JobTable component
vi.mock("../src/components/JobTable", () => ({
  default: ({ jobs, onOpenJob }) => (
    <div data-testid="job-table">
      {jobs.map((job) => (
        <div
          key={job.id}
          data-testid={`job-${job.id}`}
          onClick={() => onOpenJob(job)}
        >
          {job.name}
        </div>
      ))}
    </div>
  ),
}));

const mockUseJobListWithUpdates = vi.imported(
  "../src/ui/client/hooks/useJobListWithUpdates"
).useJobListWithUpdates;

describe("PromptPipelineDashboard Stop Action", () => {
  const mockJobs = [
    {
      id: "job-1",
      name: "Running Job 1",
      displayCategory: "current",
      progress: 50,
    },
    {
      id: "job-2",
      name: "Running Job 2",
      displayCategory: "current",
      progress: 75,
    },
    {
      id: "job-3",
      name: "Completed Job",
      displayCategory: "complete",
      progress: 100,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    stopJob.mockResolvedValue({ ok: true, stopped: true });
    mockUseJobListWithUpdates.mockReturnValue({
      data: mockJobs,
      loading: false,
      error: null,
      connectionStatus: "connected",
    });
  });

  const renderDashboard = () => {
    return render(
      <BrowserRouter>
        <PromptPipelineDashboard isConnected={true} />
      </BrowserRouter>
    );
  };

  it("should show Stop button when there are running jobs", () => {
    renderDashboard();

    expect(screen.getByText("Stop…")).toBeInTheDocument();
  });

  it("should show single Stop button when there is exactly one running job", () => {
    mockUseJobListWithUpdates.mockReturnValue({
      data: [mockJobs[0]], // Only one running job
      loading: false,
      error: null,
      connectionStatus: "connected",
    });

    renderDashboard();

    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("should not show Stop button when there are no running jobs", () => {
    mockUseJobListWithUpdates.mockReturnValue({
      data: [mockJobs[2]], // Only completed jobs
      loading: false,
      error: null,
      connectionStatus: "connected",
    });

    renderDashboard();

    expect(screen.queryByText("Stop")).not.toBeInTheDocument();
    expect(screen.queryByText("Stop…")).not.toBeInTheDocument();
  });

  it("should open modal with single job pre-selected when clicking Stop button with one running job", () => {
    mockUseJobListWithUpdates.mockReturnValue({
      data: [mockJobs[0]], // Only one running job
      loading: false,
      error: null,
      connectionStatus: "connected",
    });

    renderDashboard();

    fireEvent.click(screen.getByText("Stop"));

    expect(screen.getByText("Stop pipeline?")).toBeInTheDocument();
    expect(screen.getByText("Job to stop:")).toBeInTheDocument();
    expect(screen.getByText("Running Job 1")).toBeInTheDocument();
  });

  it("should open modal with job selector when clicking Stop button with multiple running jobs", () => {
    renderDashboard();

    fireEvent.click(screen.getByText("Stop…"));

    expect(screen.getByText("Stop pipeline?")).toBeInTheDocument();
    expect(screen.getByText("Select which job to stop:")).toBeInTheDocument();
  });

  it("should call stopJob with correct job ID when confirming stop for single job", async () => {
    mockUseJobListWithUpdates.mockReturnValue({
      data: [mockJobs[0]], // Only one running job
      loading: false,
      error: null,
      connectionStatus: "connected",
    });

    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop"));

    // Confirm stop
    fireEvent.click(screen.getByText("Stop"));

    await waitFor(() => {
      expect(stopJob).toHaveBeenCalledWith("job-1");
    });
  });

  it("should call stopJob with selected job ID when confirming stop for multiple jobs", async () => {
    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop…"));

    // Select first job
    const select = screen.getByRole("combobox");
    fireEvent.click(select);

    // Click on first option
    fireEvent.click(screen.getByText("Running Job 1 (50%)"));

    // Confirm stop
    fireEvent.click(screen.getByText("Stop"));

    await waitFor(() => {
      expect(stopJob).toHaveBeenCalledWith("job-1");
    });
  });

  it("should close modal when clicking Cancel", () => {
    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop…"));

    expect(screen.getByText("Stop pipeline?")).toBeInTheDocument();

    // Click cancel
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Stop pipeline?")).not.toBeInTheDocument();
  });

  it("should close modal on successful stop", async () => {
    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop…"));

    // Select first job
    const select = screen.getByRole("combobox");
    fireEvent.click(select);
    fireEvent.click(screen.getByText("Running Job 1 (50%)"));

    // Confirm stop
    fireEvent.click(screen.getByText("Stop"));

    await waitFor(() => {
      expect(screen.queryByText("Stop pipeline?")).not.toBeInTheDocument();
    });
  });

  it("should show loading state while stopping", async () => {
    let resolveStop;
    stopJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStop = resolve;
        })
    );

    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop…"));

    // Select job and confirm
    const select = screen.getByRole("combobox");
    fireEvent.click(select);
    fireEvent.click(screen.getByText("Running Job 1 (50%)"));
    fireEvent.click(screen.getByText("Stop"));

    // Should show loading state
    expect(screen.getByText("Stopping...")).toBeInTheDocument();

    // Resolve the stop call
    resolveStop({ ok: true, stopped: true });

    await waitFor(() => {
      expect(screen.queryByText("Stopping...")).not.toBeInTheDocument();
    });
  });

  it("should disable stop button when no job is selected in multi-job scenario", () => {
    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop…"));

    // Stop button should be disabled initially
    const stopButton = screen.getByText("Stop");
    expect(stopButton).toBeDisabled();
  });

  it("should enable stop button when job is selected in multi-job scenario", () => {
    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop…"));

    // Select a job
    const select = screen.getByRole("combobox");
    fireEvent.click(select);
    fireEvent.click(screen.getByText("Running Job 1 (50%)"));

    // Stop button should be enabled
    const stopButton = screen.getByText("Stop");
    expect(stopButton).not.toBeDisabled();
  });

  it("should handle stop error gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stopJob.mockRejectedValue(new Error("Stop failed"));

    renderDashboard();

    // Open modal
    fireEvent.click(screen.getByText("Stop…"));

    // Select job and confirm
    const select = screen.getByRole("combobox");
    fireEvent.click(select);
    fireEvent.click(screen.getByText("Running Job 1 (50%)"));
    fireEvent.click(screen.getByText("Stop"));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to stop job:",
        expect.any(Error)
      );
    });

    // Modal should close even on error
    expect(screen.queryByText("Stop pipeline?")).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
