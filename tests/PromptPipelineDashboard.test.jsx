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

// Mock the Button component to avoid import issues
vi.mock("../src/components/ui/button.jsx", () => {
  const MockButton = ({ children, onClick, className, ...props }) => {
    const React = require("react");
    return React.createElement(
      "button",
      { onClick, className, ...props },
      children
    );
  };
  return {
    Button: MockButton,
  };
});

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
            // Only use job.id for the data attribute, fallback to name for display
            const jobId = j.id || j.name;
            return React.createElement(
              "div",
              {
                key: jobId,
                "data-testid": "job-row",
                "data-job-id": jobId,
                "data-job-status": j.status,
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

    render(
      <MemoryRouter>
        <PromptPipelineDashboard />
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter>
        <PromptPipelineDashboard />
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter>
        <PromptPipelineDashboard />
      </MemoryRouter>
    );

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

    it("should not navigate when job lacks proper ID", async () => {
      const mockJobs = [
        {
          // No id field and empty name - should not navigate
          name: "",
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
      // The adapter will use empty string as ID when name is empty
      expect(jobRow.getAttribute("data-job-id")).toBe("");

      jobRow.click();

      // Should not navigate since job lacks proper ID
      expect(mockNavigate).not.toHaveBeenCalled();
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

  describe("Tab counts and filtering", () => {
    it("renders tab counts from initial data", async () => {
      const mockJobs = [
        {
          id: "job-1",
          name: "Running Job 1",
          status: "running",
          progress: 50,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          displayCategory: "current",
          tasks: [{ name: "task-1", state: "running" }],
        },
        {
          id: "job-2",
          name: "Running Job 2",
          status: "running",
          progress: 25,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          displayCategory: "current",
          tasks: [{ name: "task-2", state: "running" }],
        },
        {
          id: "job-3",
          name: "Error Job",
          status: "error",
          progress: 0,
          createdAt: "2024-01-01T00:00:00Z",
          location: "rejected",
          displayCategory: "errors",
          tasks: [{ name: "task-3", state: "failed" }],
        },
        {
          id: "job-4",
          name: "Completed Job",
          status: "complete",
          progress: 100,
          createdAt: "2024-01-01T00:00:00Z",
          location: "complete",
          displayCategory: "complete",
          tasks: [{ name: "task-4", state: "done" }],
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

      // Assert tab buttons exist with correct counts based on displayCategory
      expect(screen.getByRole("tab", { name: /Current \(2\)/i })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /Errors \(1\)/i })).toBeTruthy();
      expect(
        screen.getByRole("tab", { name: /Completed \(1\)/i })
      ).toBeTruthy();
    });

    it("switches between tabs successfully", async () => {
      const mockJobs = [
        {
          id: "job-1",
          name: "Running Job",
          status: "running",
          progress: 50,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          displayCategory: "current",
          tasks: [{ name: "task-1", state: "running" }],
        },
        {
          id: "job-2",
          name: "Error Job",
          status: "error",
          progress: 0,
          createdAt: "2024-01-01T00:00:00Z",
          location: "rejected",
          displayCategory: "errors",
          tasks: [{ name: "task-2", state: "failed" }],
        },
        {
          id: "job-3",
          name: "Completed Job",
          status: "complete",
          progress: 100,
          createdAt: "2024-01-01T00:00:00Z",
          location: "complete",
          displayCategory: "complete",
          tasks: [{ name: "task-3", state: "done" }],
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

      // All tabs should be present and clickable
      const currentTab = screen.getByRole("tab", { name: /Current \(1\)/i });
      const errorsTab = screen.getByRole("tab", { name: /Errors \(1\)/i });
      const completedTab = screen.getByRole("tab", {
        name: /Completed \(1\)/i,
      });

      expect(currentTab).toBeTruthy();
      expect(errorsTab).toBeTruthy();
      expect(completedTab).toBeTruthy();

      // Click tabs - should not throw errors
      errorsTab.click();
      completedTab.click();
      currentTab.click();
    });

    it("filters jobs correctly by displayCategory", async () => {
      const mockJobs = [
        {
          id: "job-1",
          name: "Ambiguous Job",
          status: "pending",
          progress: 0,
          createdAt: "2024-01-01T00:00:00Z",
          location: "pending",
          displayCategory: "current", // fallback to current for ambiguous states
          tasks: [{ name: "task-1", state: "pending" }],
        },
        {
          id: "job-2",
          name: "Failed Job",
          status: "running",
          progress: 75,
          createdAt: "2024-01-01T00:00:00Z",
          location: "current",
          displayCategory: "errors", // failed task overrides running status
          tasks: [
            { name: "task-1", state: "running" },
            { name: "task-2", state: "failed" },
          ],
        },
        {
          id: "job-3",
          name: "Done Job",
          status: "complete",
          progress: 100,
          createdAt: "2024-01-01T00:00:00Z",
          location: "complete",
          displayCategory: "complete",
          tasks: [
            { name: "task-1", state: "done" },
            { name: "task-2", state: "done" },
          ],
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

      // Tab counts should reflect displayCategory, not status
      expect(screen.getByRole("tab", { name: /Current \(1\)/i })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /Errors \(1\)/i })).toBeTruthy();
      expect(
        screen.getByRole("tab", { name: /Completed \(1\)/i })
      ).toBeTruthy();

      // Switch to errors tab - should show only jobs with displayCategory "errors"
      const errorsTab = screen.getByRole("tab", { name: /Errors \(1\)/i });
      errorsTab.click();

      // Should find the failed job even though its status is "running"
      expect(screen.getByText("Failed Job")).toBeTruthy();
    });
  });
});
