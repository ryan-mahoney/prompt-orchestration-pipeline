import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PromptPipelineDashboard from "../src/pages/PromptPipelineDashboard.jsx";

/* Mock the hook used by the dashboard */
vi.mock("../src/ui/client/hooks/useJobListWithUpdates.js", () => ({
  useJobListWithUpdates: vi.fn(),
}));

/* Stub heavy child components to make tests deterministic:
   - JobTable: render a simple list of job names with click handlers for navigation
   - UploadSeed: simple button stub that reflects the disabled prop
*/
vi.mock("../src/components/JobTable.jsx", () => ({
  default: (props) => {
    const React = require("react");
    return React.createElement(
      "div",
      null,
      Array.isArray(props.jobs)
        ? props.jobs.map((j) => {
            const jobId = j.id || j.pipelineId;
            return React.createElement(
              "div",
              {
                key: jobId,
                "data-testid": "job-row",
                "data-job-id": jobId,
                onClick: () => props.onOpenJob && props.onOpenJob(j),
                style: { cursor: "pointer" },
              },
              j.name
            );
          })
        : null
    );
  },
}));

vi.mock("../src/components/UploadSeed.jsx", () => ({
  default: (props) => {
    const React = require("react");
    // Render a stable test id so tests can target the UploadSeed instance
    return React.createElement(
      "div",
      { "data-testid": "upload-seed" },
      React.createElement(
        "button",
        {
          "data-testid": "upload-seed-button",
          disabled: !!props.disabled,
          onClick: () =>
            props.onUploadSuccess && props.onUploadSuccess({ jobName: "mock" }),
        },
        props.disabled ? "UploadSeedStub (disabled)" : "UploadSeedStub"
      )
    );
  },
}));

// Import the mocked hook to control its return values per test
import { useJobListWithUpdates } from "../src/ui/client/hooks/useJobListWithUpdates.js";

// Mock react-router-dom at the top level
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("PromptPipelineDashboard (integration-ish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useJobListWithUpdates.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders job list when API hook returns jobs", async () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
        tasks: [{ name: "task-1", state: "running" }],
        pipelineId: "job-1",
      },
    ];

    useJobListWithUpdates.mockReturnValue({
      loading: false,
      data: mockJobs,
      error: null,
      refetch: vi.fn(),
      connectionStatus: "connected",
    });

    render(<PromptPipelineDashboard />);

    // The JobTable should render the job name synchronously (hook is mocked)
    expect(screen.getByText("Test Job 1")).toBeTruthy();
  });

  it("shows error banner when API hook errors and does not use demo data", async () => {
    useJobListWithUpdates.mockReturnValue({
      loading: false,
      data: [],
      error: new Error("API down"),
      refetch: vi.fn(),
      connectionStatus: "disconnected",
    });

    render(<PromptPipelineDashboard />);

    // Banner text should show a neutral error and NOT render demo jobs
    expect(
      screen.queryByText("Using demo data (live API unavailable)")
    ).toBeNull();
    expect(
      screen.getByText("Unable to load jobs from the server")
    ).toBeTruthy();
    expect(screen.queryByText("Demo Job 1")).toBeNull();
  });

  it("allows upload when API is reachable even if SSE is disconnected (data empty)", async () => {
    useJobListWithUpdates.mockReturnValue({
      loading: false,
      data: [],
      error: null,
      refetch: vi.fn(),
      connectionStatus: "disconnected",
    });

    render(<PromptPipelineDashboard />);

    // Our UploadSeed stub renders a button; it should NOT be disabled when error == null
    // There may be multiple mount instances during StrictMode double-render;
    // assert at least one rendered UploadSeed button is enabled.
    const buttons = screen.getAllByTestId("upload-seed-button");
    expect(buttons.some((b) => b && b.disabled === false)).toBe(true);
  });

  it("keeps upload enabled even when the jobs API reports an error", async () => {
    useJobListWithUpdates.mockReturnValue({
      loading: false,
      data: [],
      error: new Error("API down"),
      refetch: vi.fn(),
      connectionStatus: "disconnected",
    });

    render(<PromptPipelineDashboard />);

    // Upload should remain enabled even when API reports an error.
    const buttons = screen.getAllByTestId("upload-seed-button");
    expect(buttons.some((b) => b && b.disabled === false)).toBe(true);
  });

  describe("Navigation functionality", () => {
    it("should navigate to /pipeline/:jobId when job row is clicked", async () => {
      const mockJobs = [
        {
          id: "job-123",
          name: "Test Job 123",
          status: "running",
          progress: 50,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          tasks: [{ name: "task-1", state: "running" }],
          pipelineId: "job-123",
        },
      ];

      useJobListWithUpdates.mockReturnValue({
        loading: false,
        data: mockJobs,
        error: null,
        refetch: vi.fn(),
        connectionStatus: "connected",
      });

      render(
        <MemoryRouter>
          <PromptPipelineDashboard />
        </MemoryRouter>
      );

      // Find the job row and click it
      const jobRow = screen.getByTestId("job-row");
      expect(jobRow).toBeTruthy();
      expect(jobRow.getAttribute("data-job-id")).toBe("job-123");

      jobRow.click();

      // Should navigate to the job detail page
      expect(mockNavigate).toHaveBeenCalledWith("/pipeline/job-123");
    });

    it("should use job.id for navigation when available", async () => {
      const mockJobs = [
        {
          id: "unique-job-id",
          name: "Job with unique ID",
          status: "running",
          progress: 100,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          tasks: [{ name: "task-1", state: "done" }],
          pipelineId: "legacy-id",
        },
      ];

      useJobListWithUpdates.mockReturnValue({
        loading: false,
        data: mockJobs,
        error: null,
        refetch: vi.fn(),
        connectionStatus: "connected",
      });

      render(
        <MemoryRouter>
          <PromptPipelineDashboard />
        </MemoryRouter>
      );

      const jobRow = screen.getByTestId("job-row");
      expect(jobRow.getAttribute("data-job-id")).toBe("unique-job-id");

      jobRow.click();

      expect(mockNavigate).toHaveBeenCalledWith("/pipeline/unique-job-id");
    });

    it("should use job name as fallback when no proper ID is provided", async () => {
      const mockJobs = [
        {
          // No id field - adapter will fall back to name
          name: "Legacy Job",
          status: "running",
          progress: 25,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          tasks: [{ name: "task-1", state: "running" }],
        },
      ];

      useJobListWithUpdates.mockReturnValue({
        loading: false,
        data: mockJobs,
        error: null,
        refetch: vi.fn(),
        connectionStatus: "connected",
      });

      render(
        <MemoryRouter>
          <PromptPipelineDashboard />
        </MemoryRouter>
      );

      const jobRow = screen.getByTestId("job-row");
      // The adapter will use the job name as the ID when no proper ID is provided
      expect(jobRow.getAttribute("data-job-id")).toBe("Legacy Job");

      jobRow.click();

      expect(mockNavigate).toHaveBeenCalledWith("/pipeline/Legacy Job");
    });

    it("should not render inline JobDetail component", async () => {
      const mockJobs = [
        {
          id: "job-456",
          name: "Test Job 456",
          status: "running",
          progress: 50,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          tasks: [{ name: "task-1", state: "running" }],
          pipelineId: "job-456",
        },
      ];

      useJobListWithUpdates.mockReturnValue({
        loading: false,
        data: mockJobs,
        error: null,
        refetch: vi.fn(),
        connectionStatus: "connected",
      });

      render(
        <MemoryRouter>
          <PromptPipelineDashboard />
        </MemoryRouter>
      );

      // JobDetail component should not be rendered
      expect(screen.queryByTestId("job-detail")).toBeNull();

      // Should still show the job table
      expect(screen.getByTestId("job-row")).toBeTruthy();
    });
  });
});
