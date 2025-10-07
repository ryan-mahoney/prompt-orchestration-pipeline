import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PromptPipelineDashboard from "../src/pages/PromptPipelineDashboard.jsx";

/* Mock the hook used by the dashboard */
vi.mock("../src/ui/client/hooks/useJobListWithUpdates.js", () => ({
  useJobListWithUpdates: vi.fn(),
}));

/* Stub heavy child components to make tests deterministic:
   - JobTable: render a simple list of job names (keys from pipelineId)
   - UploadSeed: simple button stub
*/
vi.mock("../src/components/JobTable.jsx", () => ({
  default: (props) => {
    const React = require("react");
    return React.createElement(
      "div",
      null,
      Array.isArray(props.jobs)
        ? props.jobs.map((j) =>
            React.createElement("div", { key: j.pipelineId }, j.name)
          )
        : null
    );
  },
}));

vi.mock("../src/components/UploadSeed.jsx", () => ({
  default: (props) => {
    const React = require("react");
    return React.createElement(
      "button",
      {
        onClick: () =>
          props.onUploadSuccess && props.onUploadSuccess({ jobName: "mock" }),
      },
      "UploadSeedStub"
    );
  },
}));

// Import the mocked hook to control its return values per test
import { useJobListWithUpdates } from "../src/ui/client/hooks/useJobListWithUpdates.js";

// Also mock demo data import so tests are stable if demoJobs change shape
vi.mock("../src/data/demoData", () => ({
  demoPipeline: { name: "Demo Pipeline", tasks: [{ id: "t1" }, { id: "t2" }] },
  demoJobs: [
    {
      id: "demo-job-1",
      name: "Demo Job 1",
      status: "running",
      progress: 10,
      createdAt: "2024-01-01T00:00:00Z",
      tasks: [{ name: "task-1", state: "running" }],
      location: "current",
      pipelineId: "demo-job-1",
    },
  ],
}));

describe("PromptPipelineDashboard (integration-ish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows demo fallback banner when API hook errors and uses demo data", async () => {
    useJobListWithUpdates.mockReturnValue({
      loading: false,
      data: [],
      error: new Error("API down"),
      refetch: vi.fn(),
      connectionStatus: "disconnected",
    });

    render(<PromptPipelineDashboard />);

    // Banner text should be visible and demo job rendered
    expect(
      screen.getByText("Using demo data (live API unavailable)")
    ).toBeTruthy();
    expect(screen.getByText("Demo Job 1")).toBeTruthy();
  });
});
